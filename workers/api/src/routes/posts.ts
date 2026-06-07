import { Env } from '../types'
import { BooruFactory } from '../lib/booru/factory'
import { Redis, getRedis } from '../lib/redis'
import { isCircuitOpen, recordSuccess, recordFailure, getRetryAfter } from '../lib/circuit-breaker'
import { coalesce } from '../lib/coalesce'
import { jsonResponse, errorResponse, getClientIp } from '../utils'

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

  // Rate limiting (Danbooru only — use Upstash Ratelimit via Redis primitive)
  if (providerType === 'danbooru' && redis) {
    const clientIp = getClientIp(request)

    // Per-user: sliding window, 30 req/60s
    const userKey = `ratelimit:danbooru:${clientIp}`
    const userCount = await redis.incr(userKey)
    if (userCount === 1) await redis.expire(userKey, 60)
    if (userCount > 30) {
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

    // Global rate limit
    const globalKey = 'ratelimit:danbooru:global'
    const globalCount = await redis.incr(globalKey)
    if (globalCount === 1) await redis.expire(globalKey, 60)
    if (globalCount > 100) {
      return errorResponse(
        'Danbooru requests are temporarily throttled. Please wait a moment.',
        429,
        { 'Retry-After': '2', 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' }
      )
    }
  }

  // Circuit breaker
  if (providerType === 'danbooru' && redis) {
    const open = await isCircuitOpen(redis, 'danbooru-api')
    if (open) {
      const retryAfter = await getRetryAfter(redis, 'danbooru-api')
      return errorResponse(
        'Danbooru is saturated. Please wait before retrying.',
        429,
        {
          'Retry-After': String(retryAfter),
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
    }
    const provider = BooruFactory.getProvider(providerType, envRecord)

    const fetcher = () => provider.search({ tags, page, order })
    const posts = redis
      ? await coalesce(redis, `posts:${cacheKey}`, fetcher, 5)
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
