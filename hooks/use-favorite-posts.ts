"use client"

import useSWR, { mutate, useSWRConfig } from "swr"
import { useState, useEffect, useRef, startTransition } from "react"
import { useApiStatus } from "@/hooks/use-api-status"
import type { BooruPost } from "@/lib/booru/types"
import { PROVIDER_URLS } from "@/lib/constants"
import { createClient } from "@/lib/supabase/client"
import { apiUrl } from "@/lib/booru/urls"
import { transformAibooruPost, transformE621Post } from "@/lib/booru/post-transformers"
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

/**
 * Fetches favorite posts by their IDs (supports mixed providers). Extracted
 * from lib/api-client.ts (Fase 2b del refactor de sostenibilidad) — the pure
 * cache helpers now live in lib/favorites/cache.ts, this file owns only the
 * React/SWR-dependent hook.
 *
 * Layered cache strategy per post: SWR in-memory cache → localStorage exact
 * match → localStorage merged entries → Supabase `booru_posts_cache` table →
 * booru API (batched/rate-limited per provider). A circuit breaker pauses
 * Danbooru fetching for 30s after 3 consecutive 429s.
 */
export function useFavoritePosts(favorites: FavoriteItem[]) {
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

  const BATCH_SIZE = 20
  const DANBOORU_DELAY = 1100

  // Helper: sort accumulated posts to match requested order.
  // IMPORTANT: always stamps _provider from the FavoriteItem (f.provider), NOT from
  // whatever the API or Supabase cache stored. This is the canonical provider from
  // core.favorites and is the only reliable value for downstream key comparisons
  // (folder filter, mismatch detection). Without this, a post cached with a wrong
  // provider would fail both this lookup AND the folder filter, creating a false positive.
  const getSortedPosts = (favs: FavoriteItem[], acc: Map<string, BooruPost>): BooruPost[] => {
    return favs
      .map(f => {
        const post = acc.get(`${f.provider}:${f.id}`)
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
        cachedPostsRef.current.set(`${(p._provider || '').toLowerCase()}:${p.id}`, p)
      )
      fallbackData = swrCachedPosts
    } else {
      // Priority 2: localStorage exact cache hit (fast cold load after previous visit)
      const exactCached = getCachedFavorites(cacheKey)
      if (exactCached && exactCached.length > 0) {
        exactCached.forEach(p => cachedPostsRef.current.set(`${(p._provider || '').toLowerCase()}:${p.id}`, p))
        fallbackData = exactCached
      } else {
        // Priority 3: merge from old localStorage entries + memory cache
        const mergedPosts = getMergedCachedFavorites(effectiveFavorites)
        if (mergedPosts.length > 0) {
          mergedPosts.forEach(p => cachedPostsRef.current.set(`${(p._provider || '').toLowerCase()}:${p.id}`, p))
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
      let loadedCount = effectiveFavorites.filter(f => accumulated.has(`${f.provider}:${f.id}`)).length

      // Only fetch favorites that aren't already in cache, within visible window
      const toFetch = effectiveFavorites.filter(f => !accumulated.has(`${f.provider}:${f.id}`))

      let lastProgressUpdate = 0
      const PROGRESS_THROTTLE_MS = 3000

      // Sync the persistent ref with current total
      progressRef.current.total = favorites.length

      const addProgress = (count: number) => {
        loadedCount += count
        const displayed = Math.min(loadedCount, favorites.length)
        const now = Date.now()
        const shouldFlush = loadedCount >= effectiveFavorites.length

        // Always keep the ref fresh so the final flush has the correct value
        progressRef.current = { loaded: displayed, total: favorites.length }

        if (shouldFlush) {
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

      // Helper: fetch with retry on 429 (rate limit) — exponential backoff
      const fetchWithRetry = async (url: string, body: object, maxRetries = 3): Promise<Response> => {
        let lastStatus = 0
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          if (signal?.aborted) throw new Error("aborted")
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal,
          })
          if (res.ok || res.status !== 429) return res
          // 429 — wait and retry with exponential backoff
          lastStatus = res.status
          const retryAfter = parseInt(res.headers.get('Retry-After') || '2', 10)
          const delay = Math.max(retryAfter * 1000, 1000 * Math.pow(2, attempt))
          const jitter = delay * (0.4 * Math.random() - 0.2) // ±20% of delay
          const delayWithJitter = Math.round(delay + jitter)
          console.warn(`[useFavoritePosts] Rate limited (429), retrying in ${delayWithJitter}ms (attempt ${attempt + 1}/${maxRetries})`)
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
                    const key = `${row.provider.toLowerCase()}:${row.post_id}`
                    if (!accumulated.has(key)) {
                      accumulated.set(key, cachedRowToBooruPost(row))
                      cacheHits++
                    }
                  }
                }
              }
            }
            if (cacheHits > 0) {
              console.log(`[useFavoritePosts] Supabase cache hit: ${cacheHits} posts (${toFetch.length - cacheHits} remaining)`)
              loadedCount += cacheHits
              startTransition(() => {
                setProgress({ loaded: loadedCount, total: favorites.length })
              })
              // Recompute toFetch after cache population
              toFetch.length = 0
              effectiveFavorites.forEach(f => {
                if (!accumulated.has(`${f.provider}:${f.id}`)) {
                  toFetch.push(f)
                }
              })
            }
          } catch (e) {
            // Supabase unavailable or user not authenticated — fall through to booru API fetch
            console.warn('[useFavoritePosts] Supabase cache query failed, falling back to booru API:', e)
          }
        }

        // If everything was cached (localStorage + Supabase), we're done
        if (toFetch.length === 0) return getSortedPosts(favorites, accumulated)

        const aibooruFavs = toFetch.filter(f => f.provider === 'aibooru')
        const e621Favs = toFetch.filter(f => f.provider === 'e621')
        const serverFavs = toFetch.filter(f => f.provider !== 'aibooru' && f.provider !== 'e621')

        // Separate Danbooru (needs sequential rate-limited batching) from others
        const danbooruFavs = serverFavs.filter(f => f.provider === 'danbooru')
        const otherServerFavs = serverFavs.filter(f => f.provider !== 'danbooru')

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

        // 1. Non-Danbooru server favorites — fire and forget, updates progress when done
        if (otherServerFavs.length > 0) {
          const task = (async () => {
            if (signal?.aborted) return
            try {
              const res = await fetchWithRetry(apiUrl('/api/favorites'), { favorites: otherServerFavs })
              if (signal?.aborted) return
              const responseTime = Date.now() - startTime
              if (!res.ok) {
                if (res.status === 429) {
                  rateLimitHits++
                  consecutive429Hits++
                  if (consecutive429Hits >= MAX_CONSECUTIVE_429 && !circuitBroken) {
                    circuitBroken = true
                    rateLimitCooldownUntilRef.current = Date.now() + CIRCUIT_COOLDOWN_MS
                    reportError(new Error('Rate limit reached — pausing 30s. Some favorites may not load.'))
                    console.warn(`[useFavoritePosts] Circuit breaker tripped after ${consecutive429Hits} consecutive 429s`)
                  }
                } else {
                  consecutive429Hits = 0
                }
                console.warn(`[useFavoritePosts] Fetch error for other servers (${res.status}) after ${responseTime}ms`)
                addProgress(otherServerFavs.length)
                return
              }
              consecutive429Hits = 0
              const posts: any[] = await res.json()
              if (signal?.aborted) return
              let loaded = 0
              posts.forEach((p: any) => {
                if (p && p.id) {
                  accumulated.set(`${(p._provider || '').toLowerCase()}:${p.id}`, p)
                  loaded++
                }
              })
              addProgress(loaded)
            } catch (err) {
              if (signal?.aborted) return
              console.warn("[useFavoritePosts] Other server favs fetch error:", err)
              addProgress(otherServerFavs.length)
            }
          })()
          parallelTasks.push(task)
        }

        // 2. Aibooru — direct client fetch, parallel with everything
        if (aibooruFavs.length > 0) {
          const task = (async () => {
            if (signal?.aborted) return
            try {
              const aibooruIds = aibooruFavs.map(f => f.id).join(',')
              const params = new URLSearchParams({
                limit: "500",
                only: "id,file_url,large_file_url,preview_file_url,tag_string,tag_string_artist,tag_string_character,tag_string_copyright,rating,score,ai_metadata,image_width,image_height",
                tags: `id:${aibooruIds}`
              })
              const res = await fetch(`${PROVIDER_URLS.AIBOORU}/posts.json?${params.toString()}`, { signal })
              if (res.ok) {
                const data = await res.json()
                if (Array.isArray(data)) {
                  data
                    .filter((post: any) => post && post.id)
                    .forEach((post: any) => {
                      accumulated.set(`aibooru:${post.id}`, {
                        ...transformAibooruPost(post),
                        _provider: 'aibooru' as const
                      } as BooruPost)
                    })
                }
              }
            } catch (err) {
              if (signal?.aborted) return
              console.warn("[useFavoritePosts] Aibooru client fetch error:", err)
            }
            addProgress(aibooruFavs.length)
          })()
          parallelTasks.push(task)
        }

        // 3. E621 — direct client fetch, parallel with everything
        // ponytail: same pattern as Aibooru. E621 CORS *, no auth needed.
        if (e621Favs.length > 0) {
          const task = (async () => {
            if (signal?.aborted) return
            try {
              const e621Ids = e621Favs.map(f => f.id).join(',')
              const params = new URLSearchParams({
                limit: "500",
                tags: `id:${e621Ids}`,
                _client: 'Boorugallery/9.2',
              })
              const res = await fetch(`https://e621.net/posts.json?${params.toString()}`, { signal })
              if (res.ok) {
                const data = await res.json()
                const posts = data?.posts
                if (Array.isArray(posts)) {
                  posts
                    .filter((post: any) => post && post.id)
                    .forEach((post: any) => {
                      accumulated.set(`e621:${post.id}`, {
                        ...transformE621Post(post),
                        _provider: 'e621' as const
                      } as BooruPost)
                    })
                }
              }
            } catch (err) {
              if (signal?.aborted) return
              console.warn("[useFavoritePosts] E621 client fetch error:", err)
            }
            addProgress(e621Favs.length)
          })()
          parallelTasks.push(task)
        }

        // 4. Danbooru server favorites — batch sequentially to respect rate limits
        if (danbooruFavs.length > 0) {
          const task = (async () => {
            const batches: FavoriteItem[][] = []
            for (let i = 0; i < danbooruFavs.length; i += BATCH_SIZE) {
              batches.push(danbooruFavs.slice(i, i + BATCH_SIZE))
            }

            for (let i = 0; i < batches.length; i++) {
              if (signal?.aborted) return
              if (circuitBroken) {
                addProgress(batches[i].length)
                continue
              }
              try {
                const res = await fetchWithRetry(apiUrl('/api/favorites'), { favorites: batches[i] })
                if (signal?.aborted) return
                const responseTime = Date.now() - startTime
                if (res.ok) {
                  consecutive429Hits = 0
                  const posts: any[] = await res.json()
                  if (signal?.aborted) return
                  let loaded = 0
                  posts.forEach((p: any) => {
                    if (p && p.id) {
                      accumulated.set(`${(p._provider || '').toLowerCase()}:${p.id}`, p)
                      loaded++
                    }
                  })
                  addProgress(loaded)
                } else {
                  if (res.status === 429) {
                    rateLimitHits++
                    consecutive429Hits++
                    if (consecutive429Hits >= MAX_CONSECUTIVE_429 && !circuitBroken) {
                      circuitBroken = true
                      rateLimitCooldownUntilRef.current = Date.now() + CIRCUIT_COOLDOWN_MS
                      reportError(new Error('Rate limit reached — pausing 30s. Some favorites may not load.'))
                      console.warn(`[useFavoritePosts] Circuit breaker tripped after ${consecutive429Hits} consecutive 429s`)
                    }
                  } else {
                    consecutive429Hits = 0
                  }
                  console.warn(`[useFavoritePosts] Fetch error for Danbooru (${res.status}) after ${responseTime}ms`)
                  addProgress(batches[i].length)
                }
              } catch (err) {
                if (signal?.aborted) return
                console.warn(`[useFavoritePosts] Danbooru batch ${i} fetch error:`, err)
                addProgress(batches[i].length)
              }

              // Respect Danbooru rate limit (max 2 req/sec)
              if (i < batches.length - 1) {
                if (signal?.aborted) return
                await new Promise(resolve => setTimeout(resolve, DANBOORU_DELAY))
              }
            }
          })()
          parallelTasks.push(task)
        }

        // Wait for parallel tasks to settle before returning final sorted list
        await Promise.allSettled(parallelTasks)

        // Log rate-limit hits for observability
        if (rateLimitHits > 0) {
          console.warn(`[useFavoritePosts] ${rateLimitHits} batch(es) hit rate limit (429)${circuitBroken ? ' — circuit breaker tripped' : ''}`)
        }

        const finalPosts = getSortedPosts(effectiveFavorites, accumulated)
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
