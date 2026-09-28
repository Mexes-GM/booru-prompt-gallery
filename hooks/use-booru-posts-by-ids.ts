"use client"

import useSWR, { mutate, useSWRConfig } from "swr"
import { useState, useEffect, useRef, startTransition } from "react"
import { useApiStatus } from "@/hooks/use-api-status"
import type { BooruPost } from "@/lib/booru/types"
import { PROVIDER_URLS, USER_AGENT } from "@/lib/constants"
import { createClient } from "@/lib/supabase/client"
import { apiUrl, buildDanbooruIdsUrl } from "@/lib/booru/urls"
import { transformAibooruPost, transformDanbooruPost, transformE621Post } from "@/lib/booru/post-transformers"
import { addFavoritesBreadcrumb, setFavoritesContext } from "@/lib/error-context"
import { favKey } from "@/lib/favorites-logic"
import {
  type FavoriteItem,
  type CachedPostRow,
  getFavoritesCacheKey,
  getCachedFavorites,
  setCachedFavorites,
  getMergedCachedFavorites,
  cachedRowToBooruPost,
  persistToCache,
} from "@/lib/favorites/cache"

export type { FavoriteItem }

const AIBOORU_ONLY_FIELDS =
  "id,file_url,large_file_url,preview_file_url,tag_string,tag_string_artist,tag_string_character,tag_string_copyright,rating,score,ai_metadata,image_width,image_height"

interface FetchPlan {
  /** Ids per request. Direct providers: one `id:a,b,c` search per batch. */
  batchSize: number
  /** Pause between a provider's consecutive batches. */
  delayMs: number
  /** true → browser calls the provider directly (its own IP/quota). */
  direct: boolean
  url: (ids: number[]) => string
  parse: (data: unknown) => BooruPost[]
}

const parseWorkerPosts = (data: unknown): BooruPost[] => (Array.isArray(data) ? data : [])

/**
 * How each provider's posts are hydrated by id.
 *
 * Danbooru/Aibooru/e621 are fetched directly from the browser (like the
 * gallery itself), 100 ids per request — within Danbooru-family's `limit`
 * max of 200 and e621's 320 — and spaced ~1 req/s per origin. Gelbooru and
 * Rule34 need our Worker (API keys, Referer, tag categories); the Worker
 * meters them per upstream call, and Gelbooru costs one call per id, so its
 * batches are kept small to spread the load.
 */
const FETCH_PLANS: Record<string, FetchPlan> = {
  danbooru: {
    batchSize: 100,
    delayMs: 1100,
    direct: true,
    url: buildDanbooruIdsUrl,
    parse: (data) => (Array.isArray(data) ? data.filter(p => p && p.id).map(transformDanbooruPost) : []),
  },
  aibooru: {
    batchSize: 100,
    delayMs: 1100,
    direct: true,
    url: (ids) => `${PROVIDER_URLS.AIBOORU}/posts.json?${new URLSearchParams({
      limit: String(ids.length),
      only: AIBOORU_ONLY_FIELDS,
      tags: `id:${ids.join(',')}`,
    })}`,
    parse: (data) => (Array.isArray(data)
      ? data.filter(p => p && p.id).map(p => ({ ...transformAibooruPost(p), _provider: 'aibooru' as const }))
      : []),
  },
  e621: {
    batchSize: 100,
    delayMs: 1000,
    direct: true,
    url: (ids) => `${PROVIDER_URLS.E621}/posts.json?${new URLSearchParams({
      limit: String(ids.length),
      tags: `id:${ids.join(',')}`,
      _client: USER_AGENT,
    })}`,
    parse: (data) => {
      const posts = (data as { posts?: unknown[] } | null)?.posts
      return Array.isArray(posts)
        ? posts.filter(p => p && (p as { id?: unknown }).id).map(p => ({ ...transformE621Post(p), _provider: 'e621' as const }))
        : []
    },
  },
  gelbooru: { batchSize: 20, delayMs: 8000, direct: false, url: () => '', parse: parseWorkerPosts },
  rule34: { batchSize: 100, delayMs: 0, direct: false, url: () => '', parse: parseWorkerPosts },
}

/**
 * Fetches booru posts by their (provider, id) pairs (supports mixed
 * providers). The pure cache helpers live in lib/favorites/cache.ts; this
 * file owns only the React/SWR-dependent hook.
 *
 * Despite living next to the favorites cache helpers and taking a
 * `FavoriteItem[]` (a `{provider, id}` pair, not favorites-specific data),
 * this hook is generic post-hydration infrastructure, not favorites logic
 * itself — hooks/use-history-posts.ts reuses it verbatim to hydrate history
 * entries.
 *
 * Layered cache strategy per post: SWR in-memory cache → localStorage exact
 * match → localStorage merged entries → Supabase `booru_posts_cache` table →
 * booru API (batched/rate-limited per provider — see FETCH_PLANS). A circuit
 * breaker pauses fetching for 30s after 3 consecutive 429s.
 */
export function useBooruPostsByIds(favorites: FavoriteItem[]) {
  // Cargar todos los favoritos de una vez — el cache de Supabase evita rate limits.
  const effectiveFavorites = favorites
  const shouldFetch = effectiveFavorites.length > 0
  const cacheKey = getFavoritesCacheKey(effectiveFavorites)
  const { reportError, reportSlowResponse } = useApiStatus()
  const { cache: swrCache } = useSWRConfig()
  const [progress, setProgress] = useState({ loaded: 0, total: favorites.length })

  // Keep total in sync when favorites list changes (e.g., after fetchFavorites loads)
  useEffect(() => {
    setProgress(prev => ({ ...prev, total: favorites.length }))
  }, [favorites.length])

  // ── Cache seeding & stale-while-revalidate ──
  // Compute fallbackData synchronously from localStorage (read-only, no mutate)
  // and seed cachedPostsRef so the fetcher skips already-loaded posts.
  // This avoids mutate() during render (React Error #185) while still providing
  // instant cache display via SWR fallbackData.
  const cachedPostsRef = useRef<Map<string, BooruPost>>(new Map())
  // Holds latest progress values so the SWR fetcher can flush them
  // without calling setState on every batch (reduces re-render pressure).
  const progressRef = useRef({ loaded: 0, total: 0 })
  // Rate-limit circuit breaker cooldown — prevents re-fetching for 30s after tripping
  const rateLimitCooldownUntilRef = useRef<number>(0)


  // Helper: sort accumulated posts to match requested order.
  // IMPORTANT: always stamps _provider from the FavoriteItem (f.provider), NOT from
  // whatever the API or Supabase cache stored. This is the canonical provider from
  // core.favorites and is the only reliable value for downstream key comparisons
  // (folder filter, mismatch detection). Without this, a post cached with a wrong
  // provider would fail both this lookup AND the folder filter, creating a false positive.
  const getSortedPosts = (favs: FavoriteItem[], acc: Map<string, BooruPost>): BooruPost[] => {
    return favs
      .map(f => {
        const post = acc.get(favKey(f.provider, f.id))
        if (!post) return undefined
        // Guarantee _provider is always the canonical value from core.favorites
        return post._provider === f.provider
          ? post
          : { ...post, _provider: f.provider as BooruPost['_provider'] }
      })
      .filter((p): p is BooruPost => p !== undefined)
  }

  // ── Cache seeding: SWR global cache → localStorage → memory cache ──
  // Priority order ensures optimistic mutations from toggleFavorite are seen
  // immediately, before the fetcher completes.
  let fallbackData: BooruPost[] | undefined
  if (cacheKey) {
    // Priority 1: SWR in-memory global cache (catches optimistic mutations written
    // by toggleFavorite — eliminates the race between mutate() and fallbackData)
    const swrState = swrCache.get(cacheKey)
    const swrCachedPosts = swrState?.data as BooruPost[] | undefined

    if (swrCachedPosts && swrCachedPosts.length > 0) {
      swrCachedPosts.forEach(p =>
        cachedPostsRef.current.set(favKey(p._provider || '', p.id), p)
      )
      fallbackData = swrCachedPosts
    } else {
      // Priority 2: localStorage exact cache hit (fast cold load after previous visit)
      const exactCached = getCachedFavorites(cacheKey)
      if (exactCached && exactCached.length > 0) {
        exactCached.forEach(p => cachedPostsRef.current.set(favKey(p._provider || '', p.id), p))
        fallbackData = exactCached
      } else {
        // Priority 3: merge from old localStorage entries + memory cache
        const mergedPosts = getMergedCachedFavorites(effectiveFavorites)
        if (mergedPosts.length > 0) {
          mergedPosts.forEach(p => cachedPostsRef.current.set(favKey(p._provider || '', p.id), p))
        }
        // Always retain memory cache across paginations to avoid UI dropping to 0
        fallbackData = getSortedPosts(effectiveFavorites, cachedPostsRef.current)
      }
    }
  } else {
    cachedPostsRef.current = new Map()
  }

  const { data, error, isLoading, isValidating, mutate: boundMutate } = useSWR<BooruPost[]>(
    cacheKey,
    async (key: string, { signal }: { signal?: AbortSignal } = {}) => {
      if (!shouldFetch) return []

      const startTime = Date.now()
      // Start with any posts already loaded from cache (exact or merged)
      const accumulated = new Map(cachedPostsRef.current)
      let loadedCount = effectiveFavorites.filter(f => accumulated.has(favKey(f.provider, f.id))).length

      // Only fetch favorites that aren't already in cache, within visible window
      const toFetch = effectiveFavorites.filter(f => !accumulated.has(favKey(f.provider, f.id)))

      // Error context: record how the favorites load starts (count + cache hits),
      // so a subsequent crash shows exactly how far loading got.
      setFavoritesContext({ count: favorites.length })
      addFavoritesBreadcrumb('favorites load start', {
        total: favorites.length,
        fromCache: loadedCount,
        toFetch: toFetch.length,
      })

      let lastProgressUpdate = 0
      // Flush the grid + counter roughly this often while batches stream in.
      const PROGRESS_THROTTLE_MS = 1200

      // Sync the persistent ref with current total
      progressRef.current.total = favorites.length

      const addProgress = (count: number) => {
        loadedCount += count
        const displayed = Math.min(loadedCount, favorites.length)
        const now = Date.now()
        const isComplete = loadedCount >= effectiveFavorites.length
        // Flush INCREMENTALLY, not only at 100%. Previously the grid + counter
        // were updated exclusively when loadedCount reached the total, so a
        // heavy-favorites user watched a frozen "Loading N more" with an empty
        // grid for the entire (rate-limited, ~1.1s/batch) sequence — looking
        // exactly like a permanent hang. Now partial results render as they
        // arrive and the counter advances. The final flush still fires on
        // completion so the last batch is never dropped.
        const throttleElapsed = now - lastProgressUpdate >= PROGRESS_THROTTLE_MS

        // Always keep the ref fresh so the final flush has the correct value
        progressRef.current = { loaded: displayed, total: favorites.length }

        if (isComplete || throttleElapsed) {
          lastProgressUpdate = now
          // Batch setProgress + mutate into one render cycle via startTransition
          startTransition(() => {
            setProgress({ loaded: displayed, total: favorites.length })
            if (cacheKey) {
              mutate(cacheKey, getSortedPosts(effectiveFavorites, accumulated), { revalidate: false })
            }
          })
        }
      }

      // Report cached posts as already loaded
      if (loadedCount > 0) {
        startTransition(() => {
          setProgress({ loaded: loadedCount, total: favorites.length })
        })
      }

      // Helper: fetch with retry on 429 (rate limit) — exponential backoff.
      // Each attempt has a hard timeout (via AbortController) so a hung/slow
      // batch can't block the whole favorites load indefinitely. Without this,
      // one stalled request left Promise.allSettled unresolved forever, freezing
      // the grid at "Loading N more".
      const REQUEST_TIMEOUT_MS = 15000
      // `body` → POST JSON to our Worker; no body → plain GET (direct provider
      // call: no custom headers, so it stays a CORS "simple" request).
      const fetchWithRetry = async (url: string, body?: object, maxRetries = 2): Promise<Response> => {
        let lastStatus = 0
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          if (signal?.aborted) throw new Error("aborted")

          // Combine the SWR abort signal with a per-attempt timeout.
          const timeoutController = new AbortController()
          const onParentAbort = () => timeoutController.abort()
          signal?.addEventListener('abort', onParentAbort)
          const timer = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS)

          let res: Response
          try {
            res = await fetch(url, body
              ? {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: timeoutController.signal,
              }
              : { signal: timeoutController.signal })
          } catch {
            // Parent (SWR) aborted → bubble up so the fetcher stops cleanly.
            if (signal?.aborted) throw new Error("aborted")
            // Timeout or network error → treat as transient and retry with
            // backoff instead of hanging forever. If retries are exhausted the
            // loop falls through and returns a synthetic failure Response so the
            // caller still advances progress for this batch.
            lastStatus = 0
            console.warn(`[useBooruPostsByIds] Request timed out/failed (attempt ${attempt + 1}/${maxRetries + 1})`)
            if (attempt < maxRetries) {
              await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
            }
            continue
          } finally {
            clearTimeout(timer)
            signal?.removeEventListener('abort', onParentAbort)
          }

          if (res.ok || res.status !== 429) return res
          // 429 — wait and retry with exponential backoff
          lastStatus = res.status
          const retryAfter = parseInt(res.headers.get('Retry-After') || '2', 10)
          const delay = Math.max(retryAfter * 1000, 1000 * Math.pow(2, attempt))
          const jitter = delay * (0.4 * Math.random() - 0.2) // ±20% of delay
          const delayWithJitter = Math.round(delay + jitter)
          console.warn(`[useBooruPostsByIds] Rate limited (429), retrying in ${delayWithJitter}ms (attempt ${attempt + 1}/${maxRetries})`)
          await new Promise(r => setTimeout(r, delayWithJitter))
        }
        return new Response(null, { status: lastStatus })
      }

      try {
        // ── Supabase cache layer: query booru_posts_cache for posts not in localStorage ──
        // This avoids booru API calls entirely when posts are already cached in Supabase.
        if (toFetch.length > 0) {
          try {
            const supabase = createClient()
            const groups = new Map<string, number[]>()
            toFetch.forEach(f => {
              if (!groups.has(f.provider)) groups.set(f.provider, [])
              groups.get(f.provider)!.push(f.id)
            })
            const queries: Promise<{ data: CachedPostRow[] | null; error: unknown }>[] = []
            groups.forEach((ids, provider) => {
              queries.push(
                supabase.from('booru_posts_cache')
                  .select('*')
                  .eq('provider', provider)
                  .in('post_id', ids)
                  .order('post_id', { ascending: true })
                  .then((r: { data: CachedPostRow[] | null; error: unknown }) => ({ data: r.data as CachedPostRow[] | null, error: r.error }))
              )
            })
            const results = await Promise.allSettled(queries)
            let cacheHits = 0
            for (const result of results) {
              if (result.status === 'fulfilled' && result.value.data && !result.value.error) {
                for (const row of result.value.data) {
                  if (row && row.provider && row.post_id) {
                    const key = favKey(row.provider, row.post_id)
                    if (!accumulated.has(key)) {
                      accumulated.set(key, cachedRowToBooruPost(row))
                      cacheHits++
                    }
                  }
                }
              }
            }
            if (cacheHits > 0) {
              console.log(`[useBooruPostsByIds] Supabase cache hit: ${cacheHits} posts (${toFetch.length - cacheHits} remaining)`)
              loadedCount += cacheHits
              startTransition(() => {
                setProgress({ loaded: loadedCount, total: favorites.length })
              })
              // Recompute toFetch after cache population
              toFetch.length = 0
              effectiveFavorites.forEach(f => {
                if (!accumulated.has(favKey(f.provider, f.id))) {
                  toFetch.push(f)
                }
              })
            }
          } catch (e) {
            // Supabase unavailable or user not authenticated — fall through to booru API fetch
            console.warn('[useBooruPostsByIds] Supabase cache query failed, falling back to booru API:', e)
          }
        }

        // If everything was cached (localStorage + Supabase), we're done
        if (toFetch.length === 0) {
          return getSortedPosts(favorites, accumulated)
        }

        const favsByProvider = new Map<string, FavoriteItem[]>()
        toFetch.forEach(f => {
          if (!favsByProvider.has(f.provider)) favsByProvider.set(f.provider, [])
          favsByProvider.get(f.provider)!.push(f)
        })


        // Track parallel operations so we can await them before final return
        const parallelTasks: Promise<void>[] = []

        // ── Circuit breaker for rate limiting ──
        // Tracks consecutive 429 responses across batches. After 3 consecutive
        // 429s (surviving fetchWithRetry), stops all remaining batches and
        // sets a 30-second cooldown to prevent hammering the API.
        let consecutive429Hits = 0
        const MAX_CONSECUTIVE_429 = 3
        const CIRCUIT_COOLDOWN_MS = 30000
        let circuitBroken = false
        let rateLimitHits = 0

        // Check if the circuit is already open from a previous trip
        if (Date.now() < rateLimitCooldownUntilRef.current) {
          // Still in cooldown — return whatever we had cached, don't re-fetch
          const cached = getSortedPosts(effectiveFavorites, cachedPostsRef.current)
          if (cached.length > 0) return cached
          // No cached data either — return empty list; cooldown expires soon
          return []
        }

        const recordRateLimit = (provider: string) => {
          rateLimitHits++
          consecutive429Hits++
          if (consecutive429Hits >= MAX_CONSECUTIVE_429 && !circuitBroken) {
            circuitBroken = true
            rateLimitCooldownUntilRef.current = Date.now() + CIRCUIT_COOLDOWN_MS
            reportError(new Error('Rate limit reached — pausing 30s. Some favorites may not load.'))
            addFavoritesBreadcrumb('favorites rate-limit circuit tripped', { consecutive429Hits, provider })
            console.warn(`[useBooruPostsByIds] Circuit breaker tripped after ${consecutive429Hits} consecutive 429s`)
          }
        }

        // Each provider runs its batches sequentially (spaced by delayMs);
        // different providers run in parallel since they are different origins.
        for (const [provider, favs] of favsByProvider) {
          const plan = FETCH_PLANS[provider]
          if (!plan) {
            addProgress(favs.length)
            continue
          }

          const task = (async () => {
            for (let i = 0; i < favs.length; i += plan.batchSize) {
              if (signal?.aborted) return
              const batch = favs.slice(i, i + plan.batchSize)
              if (circuitBroken) {
                addProgress(batch.length)
                continue
              }
              try {
                const res = plan.direct
                  ? await fetchWithRetry(plan.url(batch.map(f => f.id)))
                  : await fetchWithRetry(apiUrl('/api/favorites'), { favorites: batch })
                if (signal?.aborted) return
                if (res.ok) {
                  consecutive429Hits = 0
                  const posts = plan.parse(await res.json())
                  if (signal?.aborted) return
                  posts.forEach(p => {
                    if (p && p.id) accumulated.set(favKey(p._provider || provider, p.id), p)
                  })
                } else {
                  if (res.status === 429) recordRateLimit(provider)
                  else consecutive429Hits = 0
                  console.warn(`[useBooruPostsByIds] ${provider} fetch error (${res.status}) after ${Date.now() - startTime}ms`)
                }
              } catch (err) {
                if (signal?.aborted) return
                console.warn(`[useBooruPostsByIds] ${provider} batch fetch error:`, err)
              }
              // Advance by favorites ATTEMPTED, not posts returned: deleted
              // posts come back missing, and counting only returned posts left
              // progress stuck below total ("Loading N more posts…" forever).
              // folderMismatch later surfaces the missing ones as unavailable.
              addProgress(batch.length)

              if (plan.delayMs > 0 && i + plan.batchSize < favs.length) {
                if (signal?.aborted) return
                await new Promise(resolve => setTimeout(resolve, plan.delayMs))
              }
            }
          })()
          parallelTasks.push(task)
        }

        // Wait for parallel tasks to settle before returning final sorted list
        await Promise.allSettled(parallelTasks)

        // Log rate-limit hits for observability
        if (rateLimitHits > 0) {
          console.warn(`[useBooruPostsByIds] ${rateLimitHits} batch(es) hit rate limit (429)${circuitBroken ? ' — circuit breaker tripped' : ''}`)
        }

        const finalPosts = getSortedPosts(effectiveFavorites, accumulated)
        addFavoritesBreadcrumb('favorites load complete', {
          loaded: finalPosts.length,
          total: favorites.length,
          rateLimitHits,
        })
        // Persist to localStorage cache for instant loads on next visit
        if (cacheKey) setCachedFavorites(cacheKey, finalPosts)
        // Persist to Supabase cache so future visits skip booru API entirely
        persistToCache(finalPosts)
        return finalPosts
      } catch (fetchError: unknown) {
        if (fetchError instanceof TypeError || (fetchError instanceof Error && (fetchError.name === 'AbortError' || fetchError.message === 'Failed to fetch'))) {
          console.warn('[ApiClient] Favorites fetch interrupted (likely navigation/logout)')
          return []
        }
        throw fetchError
      }
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 60000,
      keepPreviousData: true,
      fallbackData,
    }
  )

  return {
    data: data?.length || 0,
    posts: data || [],
    error,
    isLoading,
    isValidating,
    mutate: boundMutate,
    progress,
  }
}
