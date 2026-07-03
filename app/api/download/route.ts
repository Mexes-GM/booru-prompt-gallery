
import { NextRequest, NextResponse } from 'next/server'
import { PROVIDER_REFERERS, USER_AGENT, getDanbooruUserAgent } from '@/lib/constants'
import { getDanbooruApiRateLimit, getDanbooruCombinedLimit } from '@/lib/rate-limit'
import { logRateLimitBlock } from '@/lib/observability'
import { NEXT_LIMITS } from '@/lib/limits'
import { resolveRateLimitUserId } from '@/lib/rate-limit-identity'

// Use Node.js runtime for better stability with outgoing requests
export const runtime = 'nodejs'

function getClientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anonymous'
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const imageUrl = searchParams.get('url')
  const isInline = searchParams.get('inline') === '1'

  if (!imageUrl) {
    return NextResponse.json({ error: 'Missing image URL' }, { status: 400 })
  }

  const allowedDomains = [
    'danbooru.donmai.us', 'cdn.donmai.us', 'donmai.us',
    'aibooru.online', 'cdn.aibooru.download', 'aibooru.download',
    'rule34.xxx', 'api-cdn.rule34.xxx', 'us.rule34.xxx', 'wimg.rule34.xxx',
    'e621.net', 'static1.e621.net',
    'gelbooru.com'
  ]

  let urlDomain: string
  let isDanbooru: boolean
  try {
    const url = new URL(imageUrl)
    urlDomain = url.hostname
    isDanbooru = urlDomain.includes('danbooru') || urlDomain.includes('donmai.us')
  } catch (error) {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  const isAllowedDomain = allowedDomains.some(domain =>
    urlDomain === domain || urlDomain.endsWith(`.${domain}`)
  )

  if (!isAllowedDomain) {
    return NextResponse.json({ error: 'URL domain not allowed' }, { status: 403 })
  }

  // Fase 2 (redis-optimization-plan.md): for Danbooru, per-IP + global
  // rate-limit + circuit-breaker state are fetched in a single Redis EVAL
  // instead of 3 separate round-trips.
  if (isDanbooru) {
    const clientIp = getClientIp(request)
    const userId = await resolveRateLimitUserId(request)
    const combined = await getDanbooruCombinedLimit(clientIp, userId)
    const keyType = userId ? 'authed' : 'anon'

    if (combined.userCount > combined.userMax && !combined.degraded) {
      logRateLimitBlock({ surface: 'download', keyType, scope: 'per-ip', origin: 'danbooru', requestId: request.headers.get('x-request-id') ?? undefined })
      return NextResponse.json(
        { error: 'Too many downloads. Please wait before downloading another image.' },
        {
          status: 429,
          headers: {
            'Cache-Control': 'no-store',
            'CDN-Cache-Control': 'no-store',
            'Netlify-CDN-Cache-Control': 'no-store',
            'Vercel-CDN-Cache-Control': 'no-store',
            'Retry-After': '10',
          },
        }
      )
    }

    if (combined.globalCount > NEXT_LIMITS.danbooruCombined.global.max && !combined.degraded) {
      logRateLimitBlock({ surface: 'download', keyType, scope: 'global', origin: 'danbooru', requestId: request.headers.get('x-request-id') ?? undefined })
      return NextResponse.json(
        { error: 'Danbooru requests are temporarily throttled. Please wait a moment.' },
        { status: 429, headers: { 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store', 'Netlify-CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store', 'Retry-After': '2' } }
      )
    }

    if (combined.circuitOpen) {
      logRateLimitBlock({ surface: 'download', keyType, scope: 'circuit', origin: 'danbooru', requestId: request.headers.get('x-request-id') ?? undefined })
      return NextResponse.json(
        { error: 'Danbooru is saturated. Please wait before downloading.', retryAfter: 60 },
        { status: 429, headers: { 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store', 'Netlify-CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store', 'Retry-After': '60' } }
      )
    }
  } else {
    // Non-Danbooru providers only need the general per-IP limiter.
    const ratelimit = getDanbooruApiRateLimit()
    if (ratelimit) {
      const clientIp = getClientIp(request)
      const { success, limit, remaining, reset } = await ratelimit.limit(clientIp)

      if (!success) {
        logRateLimitBlock({ surface: 'download', keyType: 'anon', scope: 'per-ip', origin: urlDomain, requestId: request.headers.get('x-request-id') ?? undefined })
        return NextResponse.json(
          { error: 'Too many downloads. Please wait before downloading another image.' },
          {
            status: 429,
            headers: {
              'Cache-Control': 'no-store',
              'CDN-Cache-Control': 'no-store',
              'Netlify-CDN-Cache-Control': 'no-store',
              'Vercel-CDN-Cache-Control': 'no-store',
              'Retry-After': String(Math.ceil((reset - Date.now()) / 1000)),
              'X-RateLimit-Limit': String(limit),
              'X-RateLimit-Remaining': String(remaining),
              'X-RateLimit-Reset': String(reset),
            },
          }
        )
      }
    }
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 60000)

    // Determine appropriate Referer based on domain
    // Danbooru and Aibooru can be sensitive to Referer, or sometimes block if referer is set
    // Rule34 fails if referer is wrong.
    let referer: string = PROVIDER_REFERERS.DANBOORU
    if (urlDomain.includes('rule34')) referer = PROVIDER_REFERERS.RULE34
    else if (urlDomain.includes('aibooru')) referer = PROVIDER_REFERERS.AIBOORU
    else if (urlDomain.includes('e621')) referer = PROVIDER_REFERERS.E621
    else if (urlDomain.includes('gelbooru')) referer = PROVIDER_REFERERS.GELBOORU

    const fetchHeaders: HeadersInit = {
      'User-Agent': isDanbooru ? getDanbooruUserAgent() : USER_AGENT,
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    }

    // Add Danbooru authentication for CDN images if credentials are available
    if (isDanbooru) {
      const username = process.env.DANBOORU_USERNAME
      const apiKey = process.env.DANBOORU_API_KEY

      if (username && apiKey) {
        const credentials = btoa(`${username}:${apiKey}`)
        fetchHeaders['Authorization'] = `Basic ${credentials}`
      }
      fetchHeaders['Referer'] = 'https://danbooru.donmai.us/'
    } else if (referer) {
      fetchHeaders['Referer'] = referer
    }

    const response = await fetch(imageUrl, {
      signal: controller.signal,
      headers: fetchHeaders,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch image: ${response.status} ${response.statusText}` },
        { 
          status: response.status,
          headers: {
            'Cache-Control': 'no-store',
            'CDN-Cache-Control': 'no-store',
            'Netlify-CDN-Cache-Control': 'no-store',
            'Vercel-CDN-Cache-Control': 'no-store',
          }
        }
      )
    }

    if (!response.body) {
      return NextResponse.json(
        { error: 'Empty response body' },
        { 
          status: 500,
          headers: {
            'Cache-Control': 'no-store',
            'CDN-Cache-Control': 'no-store',
            'Netlify-CDN-Cache-Control': 'no-store',
            'Vercel-CDN-Cache-Control': 'no-store',
          }
        }
      )
    }

    const urlPath = imageUrl.split('?')[0]
    const filename = urlPath.split('/').pop() || 'download.jpg'

    const headers = new Headers()
    headers.set('Content-Type', response.headers.get('content-type') || 'application/octet-stream')
    // ponytail: inline mode for <img> display vs attachment for downloads.
    if (!isInline) {
      headers.set('Content-Disposition', `attachment; filename="${filename}"`)
    }
	headers.set('Cache-Control', 'public, max-age=31536000, immutable')
	headers.set('CDN-Cache-Control', 'public, s-maxage=31536000, immutable')
			headers.set('Netlify-CDN-Cache-Control', 'public, s-maxage=31536000, immutable')
			headers.set('Vercel-CDN-Cache-Control', 'public, s-maxage=31536000, immutable')
			headers.set('Vary', 'Accept, Accept-Encoding')

    const contentLength = response.headers.get('content-length')
    if (contentLength) {
      headers.set('Content-Length', contentLength)
    }

    return new NextResponse(response.body, {
      status: 200,
      headers,
    })

  } catch (error) {
    console.error('Download proxy error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to download image'
    return NextResponse.json(
      { error: errorMessage },
      {
        status: 500,
        headers: {
          'Cache-Control': 'no-store',
          'CDN-Cache-Control': 'no-store',
          'Netlify-CDN-Cache-Control': 'no-store',
          'Vercel-CDN-Cache-Control': 'no-store',
        }
      }
    )
  }
}
