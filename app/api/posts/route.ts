
import { NextRequest, NextResponse } from 'next/server'
import { BooruFactory } from '@/lib/booru/factory'
import { getDanbooruApiRateLimit, getDanbooruGlobalRateLimit } from '@/lib/rate-limit'
import { coalesce } from '@/lib/request-coalescer'
import { isCircuitOpenShared, getCircuitRetryAfter } from '@/lib/circuit-breaker'

export const runtime = 'edge'

function getClientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anonymous'
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const page = searchParams.get('page') || '1'
  const tags = searchParams.get('tags') || ''
  const order = (searchParams.get('order') || 'popular') as 'popular' | 'recent' | 'random'
  const providerType = (searchParams.get('provider') || 'danbooru') as 'danbooru' | 'rule34' | 'aibooru' | 'e621' | 'gelbooru'
  const seed = searchParams.get('seed') || ''

  // Rate limit check — only for Danbooru which hits the external API
  if (providerType === 'danbooru') {
    const ratelimit = getDanbooruApiRateLimit()
    if (ratelimit) {
      const clientIp = getClientIp(request)
      const { success, limit, remaining, reset } = await ratelimit.limit(clientIp)

      if (!success) {
        return NextResponse.json(
          { error: 'Too many requests. Please wait before loading more posts.', retryAfter: Math.ceil((reset - Date.now()) / 1000) },
          {
            status: 429,
            headers: {
              'Retry-After': String(Math.ceil((reset - Date.now()) / 1000)),
              'X-RateLimit-Limit': String(limit),
              'X-RateLimit-Remaining': String(remaining),
              'X-RateLimit-Reset': String(reset),
            },
          }
        )
      }
    }

    // Global rate limit — caps total outbound requests from ALL users
    const globalLimit = getDanbooruGlobalRateLimit()
    if (globalLimit) {
      const { success } = await globalLimit.limit('danbooru-outbound')
      if (!success) {
        return NextResponse.json(
          { error: 'Danbooru requests are temporarily throttled. Please wait a moment.' },
          { status: 429, headers: { 'Retry-After': '2' } }
        )
      }
    }
  }

  // Include seed in the cache key so random-mode pagination (which always
  // sends page=1 and differentiates pages via the seed) doesn't collapse
  // multiple distinct requests into a single coalesced/cached response.
  const cacheKey = `${providerType}-${tags}-${page}-${order}${seed ? `-${seed}` : ''}`
  const cacheDuration = 600

  // Circuit breaker check — fail fast if Danbooru circuit is open
  if (providerType === 'danbooru' && await isCircuitOpenShared('danbooru-api')) {
    const retryAfter = Math.ceil(getCircuitRetryAfter('danbooru-api') / 1000)
    return NextResponse.json(
      { error: 'Danbooru is saturated. Please wait before retrying.', retryAfter },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfter),
        },
      }
    )
  }

  try {
    const provider = BooruFactory.getProvider(providerType)
    const posts = await coalesce(
      `posts:${cacheKey}`,
      () => provider.search({ tags, page, order }),
      5000
    )

    // Propagate circuit state even on success — if half-open and succeeded, recordSuccess already called in provider

    return NextResponse.json(posts, {
      headers: {
        'Cache-Control': `public, s-maxage=${cacheDuration}, stale-while-revalidate=${cacheDuration * 2}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheDuration}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheDuration * 2}`,
        'ETag': `"${cacheKey}"`,
        'X-Content-Type-Options': 'nosniff',
        'X-API-Version': '2.0',
        'X-Total-Count': posts.length.toString(),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })

  } catch (error: any) {
    console.error(JSON.stringify({
      layer: 'api',
      event: 'error',
      status: error.status || 500,
      message: error.message?.substring(0, 200),
      cacheKey,
    }))
    const status = error.status || 500

    if (status === 429) {
      const retryAfter = error.retryAfter || getCircuitRetryAfter('danbooru-api')
        ? Math.ceil(getCircuitRetryAfter('danbooru-api') / 1000)
        : 60
      return NextResponse.json(
        {
          error: error.message || 'Danbooru is temporarily busy. Please try again in a moment.',
          retryAfter,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfter),
          },
        }
      )
    }

    return NextResponse.json(
      { error: error.message || 'Internal server error', timestamp: new Date().toISOString() },
      { status: status, headers: { 'Cache-Control': 'no-cache' } }
    )
  }
}
