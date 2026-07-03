import { Env } from '../types'
import { BooruFactory } from '../lib/booru/factory'
import { Redis, getRedis } from '../lib/redis'
import { checkCircuitOpen, recordSuccess, recordFailure } from '../lib/circuit-breaker'
import { coalesce, peekCache } from '../lib/coalesce'
import { MERGED_RATELIMIT_SCRIPT } from '../lib/constants'
import { jsonResponse, errorResponse, getClientIp } from '../utils'
import { getSupabase } from '../lib/supabase'
import { isBlocked, markBlocked, clearBlocked } from '../lib/rate-limit-cache'
import type { BooruPost } from '../lib/booru/types'
import { logRateLimitBlock } from '../logger'
import { WORKER_LIMITS } from '../lib/limits'
import { resolveRateLimitUserId } from '../lib/rate-limit-identity'

export async function postsHandler(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url)
  const page = url.searchParams.get('page') || '1'
  const tags = url.searchParams.get('tags') || ''
  const order = (url.searchParams.get('order') || 'popular') as 'popular' | 'recent' | 'random'
  const providerType = (url.searchParams.get('provider') || 'danbooru') as
    | 'danbooru'
    | 'rule34'
    | 'aibooru'
    | 'e621'
    | 'gelbooru'
  const seed = url.searchParams.get('seed') || ''

  const redis = getRedis(env)
  const cacheKey = `${providerType}-${tags}-${page}-${order}${seed ? `-${seed}` : ''}`
  const cacheDuration = 600

  // Fase 3 (redis-optimization-plan.md): a cache HIT never reaches the
  // origin, so it doesn't need to spend rate-limit/circuit-breaker commands.
  // Peek the cache before any Redis protection check.
  const cachedPosts = await peekCache<BooruPost[]>(redis, `posts:${cacheKey}`)
  if (cachedPosts) {
    return jsonResponse(cachedPosts, 200, {
      'Cache-Control': `public, s-maxage=${cacheDuration}, stale-while-revalidate=${cacheDuration * 2}`,
      'CDN-Cache-Control': `public, s-maxage=${cacheDuration * 2}`,
      'ETag': `"${cacheKey}"`,
      'X-Total-Count': String(cachedPosts.length),
    })
  }

  // Rate limiting — applies to ALL providers that hit external APIs.
  // Danbooru has extra global limits; other providers get per-IP only.
  if (redis) {
    const clientIp = getClientIp(request)
    const isDanbooru = providerType === 'danbooru'
    // F4 (flag-gated): resolves authed:<userId> when ADAPTIVE_LIMITS is on and
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
          { 'Retry-After': '10', 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' }
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
          {
            'Retry-After': '10',
            'Cache-Control': 'no-store',
            'CDN-Cache-Control': 'no-store',
          }
        )
      }
      clearBlocked(userKey)

      if (globalCount > WORKER_LIMITS.postsDanbooru.global.max) {
        logRateLimitBlock(request, { surface: 'posts', keyType, scope: 'global', origin: 'danbooru' })
        return errorResponse(
          'Danbooru requests are temporarily throttled. Please wait a moment.',
          429,
          { 'Retry-After': '2', 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' }
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
          {
            'Retry-After': '10',
            'Cache-Control': 'no-store',
            'CDN-Cache-Control': 'no-store',
          }
        )
      }

      const userCount = await redis.incrWithExpire(userKey, WORKER_LIMITS.postsOther.perIp.windowS)
      if (userCount > perIpMax) {
        markBlocked(userKey, WORKER_LIMITS.postsOther.perIp.windowS)
        logRateLimitBlock(request, { surface: 'posts', keyType, scope: 'per-ip', origin: providerType })
        return errorResponse(
          'Too many requests. Please wait before loading more posts.',
          429,
          {
            'Retry-After': '10',
            'Cache-Control': 'no-store',
            'CDN-Cache-Control': 'no-store',
          }
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
    const envRecord: Record<string, string | undefined> = {
      DANBOORU_USERNAME: env.DANBOORU_USERNAME,
      DANBOORU_API_KEY: env.DANBOORU_API_KEY,
      GELBOORU_API_KEY: env.GELBOORU_API_KEY,
      GELBOORU_USER_ID: env.GELBOORU_USER_ID,
      RULE34_API_KEY: env.RULE34_API_KEY,
      RULE34_USER_ID: env.RULE34_USER_ID,
    }
    const provider = BooruFactory.getProvider(providerType, envRecord, getSupabase(env))

    const fetcher = () => provider.search({ tags, page, order })
    const posts = redis
      ? await coalesce(redis, `posts:${cacheKey}`, fetcher, cacheDuration)
      : await fetcher()

    // Fase 3: only spend the recordSuccess EVAL when the circuit wasn't
    // already closed — a healthy circuit doesn't need to be re-confirmed
    // closed on every single successful request.
    if (providerType === 'danbooru' && redis && observedCircuitState !== 'closed') {
      await recordSuccess(redis, 'danbooru-api')
    }

    return jsonResponse(posts, 200, {
      'Cache-Control': `public, s-maxage=${cacheDuration}, stale-while-revalidate=${cacheDuration * 2}`,
      'CDN-Cache-Control': `public, s-maxage=${cacheDuration * 2}`,
      'ETag': `"${cacheKey}"`,
      'X-Total-Count': String(posts.length),
    })
  } catch (error: any) {
    console.error(
      JSON.stringify({
        layer: 'api',
        event: 'error',
        status: error.status || 500,
        message: error.message?.substring(0, 200),
        cacheKey,
      })
    )

    // Record circuit breaker failure
    if (providerType === 'danbooru' && redis) {
      await recordFailure(redis, 'danbooru-api')
    }

    const status = error.status || 500
    if (status === 429) {
      const retryAfter = error.retryAfter || 60
      return errorResponse(
        error.message || 'Danbooru is temporarily busy. Please try again in a moment.',
        429,
        {
          'Retry-After': String(retryAfter),
          'Cache-Control': 'no-store',
          'CDN-Cache-Control': 'no-store',
        }
      )
    }

    return errorResponse(
      error.message || 'Internal server error',
      status,
      { 'Cache-Control': 'no-cache' }
    )
  }
}
