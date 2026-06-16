import { Env } from '../types'
import { BooruFactory } from '../lib/booru/factory'
import { Redis, getRedis } from '../lib/redis'
import { checkCircuitOpen, recordSuccess, recordFailure } from '../lib/circuit-breaker'
import { coalesce } from '../lib/coalesce'
import { jsonResponse, errorResponse, getClientIp } from '../utils'
import { getSupabase } from '../lib/supabase'

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

  // Rate limiting — applies to ALL providers that hit external APIs.
  // Danbooru has extra global limits; other providers get per-IP only.
  if (redis) {
    const clientIp = getClientIp(request)

    // Per-IP: 90 req/60s for Danbooru, 60 req/60s for others
    const isDanbooru = providerType === 'danbooru'
    const perIpMax = isDanbooru ? 90 : 60
    const userKey = `ratelimit:booru:${clientIp}`
    const userCount = await redis.incrWithExpire(userKey, 60)
    if (userCount > perIpMax) {
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

    // Danbooru-specific global limit (protects shared CF egress IP)
    if (isDanbooru) {
      const globalKey = 'ratelimit:danbooru:global:posts'
      const globalCount = await redis.incrWithExpire(globalKey, 60)
      if (globalCount > 480) {
        return errorResponse(
          'Danbooru requests are temporarily throttled. Please wait a moment.',
          429,
          { 'Retry-After': '2', 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' }
        )
      }
    }
  }

  // Circuit breaker — Danbooru only (most sensitive to overload)
  if (providerType === 'danbooru' && redis) {
    const circuit = await checkCircuitOpen(redis, 'danbooru-api')
    if (circuit.open) {
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

    // Record circuit breaker success
    if (providerType === 'danbooru' && redis) {
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
