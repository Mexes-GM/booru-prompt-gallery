import { Env } from '../types'
import { BooruFactory, isBooruProvider, providerEnv } from '../lib/booru/factory'
import { getRedis } from '../lib/redis'
import { checkCircuitOpen, recordOutcome } from '../lib/circuit-breaker'
import { coalesce, peekCache } from '../lib/coalesce'
import { MERGED_RATELIMIT_SCRIPT } from '../lib/constants'
import { jsonResponse, errorResponse, getClientIp } from '../utils'
import { getSupabase } from '../lib/supabase'
import { isBlocked, markBlocked, clearBlocked } from '../lib/rate-limit-cache'
import type { BooruPost } from '../lib/booru/types'
import { logger, logRateLimitBlock } from '../logger'
import { UpstreamError, toClientError } from '../lib/upstream'
import { WORKER_LIMITS } from '../lib/limits'
import { resolveRateLimitUserId } from '../lib/rate-limit-identity'

const ORDERS = ['popular', 'recent', 'random'] as const
type Order = (typeof ORDERS)[number]

// The client stops at 35 pages per session; Gelbooru/Rule34 reject deep pids
// (pid * limit > 20000) and Danbooru caps non-Gold users at page 1000.
const MAX_PAGE = 200
const MAX_TAGS_LENGTH = 500
const SEED_RE = /^[\w-]{1,40}$/

const NO_STORE = { 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' }

export async function postsHandler(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url)
  const rawProvider = url.searchParams.get('provider') || 'danbooru'
  const rawOrder = url.searchParams.get('order') || 'popular'
  const rawPage = url.searchParams.get('page') || '1'
  const tags = (url.searchParams.get('tags') || '').trim()
  const seed = url.searchParams.get('seed') || ''

  // Validate before anything else: unvalidated values used to reach the
  // provider (`pid=NaN`), throw inside the factory (500) and mint unbounded
  // distinct cache keys.
  if (!isBooruProvider(rawProvider)) {
    return errorResponse('Unknown provider', 400, NO_STORE)
  }
  if (!(ORDERS as readonly string[]).includes(rawOrder)) {
    return errorResponse('Unknown order', 400, NO_STORE)
  }
  const pageNum = Number(rawPage)
  if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > MAX_PAGE) {
    return errorResponse(`page must be an integer between 1 and ${MAX_PAGE}`, 400, NO_STORE)
  }
  if (tags.length > MAX_TAGS_LENGTH) {
    return errorResponse('Search is too long', 400, NO_STORE)
  }
  if (seed && !SEED_RE.test(seed)) {
    return errorResponse('Invalid seed', 400, NO_STORE)
  }
  const providerType = rawProvider
  const order = rawOrder as Order
  const page = String(pageNum)

  const redis = getRedis(env)
  const cacheKey = `${providerType}-${tags}-${page}-${order}${seed ? `-${seed}` : ''}`
  const cacheDuration = 600

  // Layer 0: this colo's Cache API — free, and answers repeat requests without
  // spending a single Upstash command. Keyed on the validated params only, so
  // junk query params cannot bust it.
  const edgeCacheKey = new Request(
    new URL(`/__cache/posts?${new URLSearchParams({ provider: providerType, tags, page, order, seed })}`, request.url).toString()
  )
  const edgeCached = await caches.default.match(edgeCacheKey)
  if (edgeCached) return edgeCached

  // No ETag: it used to embed the raw tags, and a non-Latin-1 tag (e.g. a
  // Japanese character name) made the Headers constructor throw → 500.
  const respondAndCache = (posts: BooruPost[]): Response => {
    const response = jsonResponse(posts, 200, {
      'Cache-Control': `public, s-maxage=${cacheDuration}, stale-while-revalidate=${cacheDuration * 2}`,
      'CDN-Cache-Control': `public, s-maxage=${cacheDuration * 2}`,
      'X-Total-Count': String(posts.length),
    })
    ctx.waitUntil(caches.default.put(edgeCacheKey, response.clone()))
    return response
  }

  // Fase 3 (redis-optimization-plan.md): a cache HIT never reaches the
  // origin, so it doesn't need to spend rate-limit/circuit-breaker commands.
  // Peek the cache before any Redis protection check.
  const cachedPosts = await peekCache<BooruPost[]>(redis, `posts:${cacheKey}`)
  if (cachedPosts) {
    return respondAndCache(cachedPosts)
  }

  // Rate limiting — applies to ALL providers that hit external APIs.
  // Danbooru has extra global limits; other providers get per-IP only.
  if (redis) {
    const clientIp = getClientIp(request)
    const isDanbooru = providerType === 'danbooru'
    // Flag-gated: resolves authed:<userId> when ADAPTIVE_LIMITS is on and
    // the request carries a valid Supabase access token (Authorization: Bearer
    // <jwt>); otherwise null and the key/limit are identical to before this
    // existed. The `global` cap is NEVER scaled — it's the shared-origin budget.
    const userId = await resolveRateLimitUserId(request, env)
    const authed = Boolean(userId)
    const keyType: 'authed' | 'anon' = authed ? 'authed' : 'anon'

    if (isDanbooru) {
      const perIpMax = authed
        ? WORKER_LIMITS.postsDanbooru.perIp.max * (WORKER_LIMITS.postsDanbooru.authedMultiplier ?? 1)
        : WORKER_LIMITS.postsDanbooru.perIp.max
      const userKey = authed ? `ratelimit:booru:authed:${userId}` : `ratelimit:booru:${clientIp}`
      const globalKey = 'ratelimit:danbooru:global:posts'

      // Fase 1: already-known-blocked IP — reject without touching Redis.
      if (isBlocked(userKey)) {
        return errorResponse(
          'Too many requests. Please wait before loading more posts.',
          429,
          { 'Retry-After': '10', ...NO_STORE }
        )
      }

      // Single EVAL: atomically INCR+EXPIRE both per-IP and global keys
      const result = await redis.eval(MERGED_RATELIMIT_SCRIPT, [userKey, globalKey], [String(WORKER_LIMITS.postsDanbooru.perIp.windowS)]) as number[]
      const userCount = result?.[0] ?? 0
      const globalCount = result?.[1] ?? 0

      if (userCount > perIpMax) {
        markBlocked(userKey, WORKER_LIMITS.postsDanbooru.perIp.windowS)
        logRateLimitBlock(request, { surface: 'posts', keyType, scope: 'per-ip', origin: 'danbooru' })
        return errorResponse(
          'Too many requests. Please wait before loading more posts.',
          429,
          { 'Retry-After': '10', ...NO_STORE }
        )
      }
      clearBlocked(userKey)

      if (globalCount > WORKER_LIMITS.postsDanbooru.global.max) {
        logRateLimitBlock(request, { surface: 'posts', keyType, scope: 'global', origin: 'danbooru' })
        return errorResponse(
          'Danbooru requests are temporarily throttled. Please wait a moment.',
          429,
          { 'Retry-After': '2', ...NO_STORE }
        )
      }
    } else {
      const perIpMax = authed
        ? WORKER_LIMITS.postsOther.perIp.max * (WORKER_LIMITS.postsOther.authedMultiplier ?? 1)
        : WORKER_LIMITS.postsOther.perIp.max
      const userKey = authed ? `ratelimit:booru:authed:${userId}` : `ratelimit:booru:${clientIp}`

      // Fase 1: already-known-blocked IP — reject without touching Redis.
      if (isBlocked(userKey)) {
        return errorResponse(
          'Too many requests. Please wait before loading more posts.',
          429,
          { 'Retry-After': '10', ...NO_STORE }
        )
      }

      const userCount = await redis.incrWithExpire(userKey, WORKER_LIMITS.postsOther.perIp.windowS)
      if (userCount > perIpMax) {
        markBlocked(userKey, WORKER_LIMITS.postsOther.perIp.windowS)
        logRateLimitBlock(request, { surface: 'posts', keyType, scope: 'per-ip', origin: providerType })
        return errorResponse(
          'Too many requests. Please wait before loading more posts.',
          429,
          { 'Retry-After': '10', ...NO_STORE }
        )
      }
      clearBlocked(userKey)
    }
  }

  // Circuit breaker — Danbooru only (most sensitive to overload)
  let observedCircuitState: 'closed' | 'open' | 'half-open' = 'closed'
  if (providerType === 'danbooru' && redis) {
    const circuit = await checkCircuitOpen(redis, 'danbooru-api')
    observedCircuitState = circuit.state
    if (circuit.open) {
      logRateLimitBlock(request, { surface: 'posts', keyType: 'anon', scope: 'circuit', origin: 'danbooru' })
      return errorResponse(
        'Danbooru is saturated. Please wait before retrying.',
        429,
        {
          'Retry-After': String(circuit.retryAfter),
          'Cache-Control': 'no-store',
          'CDN-Cache-Control': 'no-store',
        }
      )
    }
  }

  try {
    const provider = BooruFactory.getProvider(providerType, providerEnv(env), getSupabase(env))

    const fetcher = () => provider.search({ tags, page, order })
    const posts = redis
      ? await coalesce(redis, `posts:${cacheKey}`, fetcher, cacheDuration)
      : await fetcher()

    if (providerType === 'danbooru' && redis) {
      await recordOutcome(redis, 'danbooru-api', observedCircuitState)
    }

    return respondAndCache(posts)
  } catch (error) {
    logger.error('provider_fetch_error', {
      provider: providerType,
      status: error instanceof UpstreamError ? error.status : undefined,
      message: error instanceof Error ? error.message.substring(0, 200) : String(error),
    })

    // Only provider-side failures (5xx/429/timeout) count toward the breaker.
    if (providerType === 'danbooru' && redis) {
      await recordOutcome(redis, 'danbooru-api', observedCircuitState, error)
    }

    const clientError = toClientError(error)
    return errorResponse(clientError.message, clientError.status, {
      ...NO_STORE,
      ...(clientError.retryAfter ? { 'Retry-After': String(clientError.retryAfter) } : {}),
    })
  }
}
