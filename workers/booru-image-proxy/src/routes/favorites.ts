import { Env } from '../types'
import { BooruFactory, isBooruProvider, providerEnv, type BooruProviderType } from '../lib/booru/factory'
import { BooruPost } from '../lib/booru/types'
import { getRedis } from '../lib/redis'
import { checkCircuitOpen, recordOutcome } from '../lib/circuit-breaker'
import { COST_RATELIMIT_SCRIPT } from '../lib/constants'
import { WORKER_LIMITS } from '../lib/limits'
import { jsonResponse, errorResponse, getClientIp, mapWithConcurrency, sleep } from '../utils'
import { getSupabase } from '../lib/supabase'
import { isBlocked, markBlocked, clearBlocked } from '../lib/rate-limit-cache'
import { logger, logRateLimitBlock } from '../logger'

/** Hard cap per request — callers batch (the frontend sends ≤ 100 at a time). */
const MAX_FAVORITES_PER_REQUEST = 100
/**
 * Gelbooru costs one provider call per id, and Cloudflare caps a Worker
 * invocation at 50 subrequests (provider + Supabase + Upstash all count), so a
 * request may carry at most this many Gelbooru ids. The frontend sends 20.
 */
const MAX_GELBOORU_IDS_PER_REQUEST = 30

/**
 * Ids per `id:a,b,c` lookup. Danbooru-family and e621 accept long id lists
 * (bounded by `limit`, max 200/320); Rule34's support is only known to hold
 * for short lists, so it keeps the historical 20. Gelbooru is looked up one
 * id per call (see GELBOORU_CONCURRENCY).
 */
const ID_LIST_BATCH: Partial<Record<BooruProviderType, number>> = {
  danbooru: 100,
  aibooru: 100,
  e621: 100,
  rule34: 20,
}
const DANBOORU_BATCH_DELAY_MS = 1100
const ID_LIST_CONCURRENCY = 2
const GELBOORU_CONCURRENCY = 4

const NO_STORE = { 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' }

type FavoritePost = BooruPost & { _provider?: string }

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

/**
 * Parses `{ favorites: [{id, provider}] }` or the legacy `{ ids, provider }`
 * body into provider → ids. Ids must be positive integers: they are spliced
 * into an `id:` search, so a string like "1 rating:e" would otherwise turn
 * this endpoint into an unmetered general-purpose search proxy.
 */
function parseFavorites(body: unknown): Map<BooruProviderType, number[]> | null {
  if (!body || typeof body !== 'object') return null
  const { ids, provider, favorites } = body as Record<string, unknown>

  let raw: unknown[] = []
  if (Array.isArray(ids)) raw = ids.map((id) => ({ id, provider: provider ?? 'danbooru' }))
  else if (Array.isArray(favorites)) raw = favorites

  const groups = new Map<BooruProviderType, Set<number>>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null
    const { id, provider: itemProvider } = item as Record<string, unknown>
    const numericId = typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : id
    if (typeof numericId !== 'number' || !Number.isSafeInteger(numericId) || numericId <= 0) return null
    if (!isBooruProvider(itemProvider)) continue // unknown provider: ignore, as before
    if (!groups.has(itemProvider)) groups.set(itemProvider, new Set())
    groups.get(itemProvider)!.add(numericId)
  }

  return new Map(Array.from(groups, ([p, idSet]) => [p, Array.from(idSet)]))
}

export async function favoritesHandler(request: Request, env: Env): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse('Invalid JSON body', 400, NO_STORE)
  }

  const groups = parseFavorites(body)
  if (!groups) return errorResponse('Favorites must be {id: positive integer, provider}', 400, NO_STORE)

  const total = Array.from(groups.values()).reduce((sum, ids) => sum + ids.length, 0)
  if (total === 0) return jsonResponse([], 200, NO_STORE)
  if (total > MAX_FAVORITES_PER_REQUEST) {
    return errorResponse(`At most ${MAX_FAVORITES_PER_REQUEST} favorites per request`, 400, NO_STORE)
  }
  if ((groups.get('gelbooru')?.length ?? 0) > MAX_GELBOORU_IDS_PER_REQUEST) {
    return errorResponse(`At most ${MAX_GELBOORU_IDS_PER_REQUEST} Gelbooru favorites per request`, 400, NO_STORE)
  }

  // Upstream cost of this request, in provider calls.
  const danbooruCalls = Math.ceil((groups.get('danbooru')?.length ?? 0) / ID_LIST_BATCH.danbooru!)
  let upstreamCalls = 0
  for (const [provider, ids] of groups) {
    upstreamCalls += provider === 'gelbooru' ? ids.length : Math.ceil(ids.length / ID_LIST_BATCH[provider]!)
  }

  const redis = getRedis(env)
  let observedCircuitState: 'closed' | 'open' | 'half-open' = 'closed'

  if (redis) {
    const clientIp = getClientIp(request)
    const userKey = `ratelimit:booru:fav:${clientIp}`
    const limits = WORKER_LIMITS.favorites

    if (isBlocked(userKey)) {
      return errorResponse('Too many requests. Please wait before loading favorites.', 429, { 'Retry-After': '10', ...NO_STORE })
    }

    const result = (await redis.eval(
      COST_RATELIMIT_SCRIPT,
      [userKey, 'ratelimit:danbooru:global:favorites'],
      [String(limits.perIp.windowS), String(upstreamCalls), String(danbooruCalls)]
    )) as number[] | null
    const userCount = result?.[0] ?? 0
    const globalCount = result?.[1] ?? 0

    if (userCount > limits.perIp.max) {
      markBlocked(userKey, limits.perIp.windowS)
      logRateLimitBlock(request, { surface: 'favorites', keyType: 'anon', scope: 'per-ip' })
      return errorResponse('Too many requests. Please wait before loading favorites.', 429, { 'Retry-After': '10', ...NO_STORE })
    }
    clearBlocked(userKey)

    if (danbooruCalls > 0) {
      if (globalCount > limits.global.max) {
        logRateLimitBlock(request, { surface: 'favorites', keyType: 'anon', scope: 'global', origin: 'danbooru' })
        return errorResponse('Danbooru requests are temporarily throttled. Please wait a moment.', 429, { 'Retry-After': '5', ...NO_STORE })
      }

      const circuit = await checkCircuitOpen(redis, 'danbooru-api')
      observedCircuitState = circuit.state
      if (circuit.open) {
        logRateLimitBlock(request, { surface: 'favorites', keyType: 'anon', scope: 'circuit', origin: 'danbooru' })
        return errorResponse('Danbooru is saturated. Please wait before retrying.', 429, {
          'Retry-After': String(circuit.retryAfter),
          ...NO_STORE,
        })
      }
    }
  }

  // Rule34/Gelbooru return flat tags and need the Supabase client to resolve
  // categories (see BaseBooruProvider.enrichPostsWithCategories).
  const supabase = getSupabase(env)
  const credentials = providerEnv(env)
  const allPosts: FavoritePost[] = []

  for (const [providerName, ids] of groups) {
    const provider = BooruFactory.getProvider(providerName, credentials, supabase)
    const tag = (posts: BooruPost[]) => posts.map((post) => ({ ...post, _provider: providerName }))

    if (providerName === 'gelbooru') {
      // Fetch raw, then classify the whole batch once: enriching per id cost
      // two Supabase calls per favorite on top of the provider call.
      const results = await mapWithConcurrency(ids, GELBOORU_CONCURRENCY, async (id) => {
        try {
          const posts = await provider.search({ tags: `id:${id}`, page: '1', order: 'recent', enrich: false })
          return posts.slice(0, 1)
        } catch (error) {
          logger.warn('favorites_batch_error', { provider: providerName, error: String(error) })
          return []
        }
      })
      allPosts.push(...tag(await provider.enrich(results.flat())))
      continue
    }

    const batchSize = ID_LIST_BATCH[providerName]!
    const batches = chunk(ids, batchSize)
    const fetchBatch = async (batch: number[]): Promise<FavoritePost[]> => {
      try {
        const posts = await provider.search({
          tags: `id:${batch.join(',')}`,
          page: '1',
          order: 'recent',
          limit: String(batch.length),
        })
        if (providerName === 'danbooru' && redis) await recordOutcome(redis, 'danbooru-api', observedCircuitState)
        return tag(posts)
      } catch (error) {
        logger.warn('favorites_batch_error', { provider: providerName, error: String(error) })
        if (providerName === 'danbooru' && redis) await recordOutcome(redis, 'danbooru-api', observedCircuitState, error)
        return []
      }
    }

    if (providerName === 'danbooru') {
      // Sequential and spaced: Danbooru is the most rate-sensitive origin.
      for (let i = 0; i < batches.length; i++) {
        allPosts.push(...(await fetchBatch(batches[i])))
        if (i < batches.length - 1) await sleep(DANBOORU_BATCH_DELAY_MS)
      }
    } else {
      const results = await mapWithConcurrency(batches, ID_LIST_CONCURRENCY, fetchBatch)
      results.forEach((posts) => allPosts.push(...posts))
    }
  }

  // POST responses are never shared-cacheable; say so explicitly.
  return jsonResponse(allPosts, 200, NO_STORE)
}
