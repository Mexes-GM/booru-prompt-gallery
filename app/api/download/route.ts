
import { NextRequest, NextResponse } from 'next/server'
import {
  PROVIDER_REFERERS,
  USER_AGENT,
  getDanbooruUserAgent,
  isAllowedImageHost,
  isMediaContentType,
} from '@/lib/constants'
import { getDanbooruApiRateLimit, getCombinedLimit } from '@/lib/rate-limit'
import { logRateLimitBlock } from '@/lib/observability'
import { resolveRateLimitUserId } from '@/lib/rate-limit-identity'
import { getClientIp } from '@/lib/client-ip'

// Use Node.js runtime for better stability with outgoing requests
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const imageUrl = searchParams.get('url')
  const isInline = searchParams.get('inline') === '1'

  if (!imageUrl) {
    return NextResponse.json({ error: 'Missing image URL' }, { status: 400 })
  }

  let url: URL
  try {
    url = new URL(imageUrl)
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }
  const urlDomain = url.hostname
  const isDanbooru = urlDomain === 'donmai.us' || urlDomain.endsWith('.donmai.us')

  // Image CDN hosts only — never an API/site host (danbooru.donmai.us,
  // gelbooru.com…), so this route cannot relay provider API pages.
  if (url.protocol !== 'https:' || !isAllowedImageHost(urlDomain)) {
    return NextResponse.json({ error: 'URL domain not allowed' }, { status: 403 })
  }

  // Fase 2 (redis-optimization-plan.md): per-IP + global rate-limit in a
  // single Redis EVAL. Inline <img> fallbacks from the gallery grid get their
  // own, much larger `image` bucket; explicit Danbooru downloads keep the
  // tight Danbooru budget.
  if (isInline || isDanbooru) {
    const profile = isInline ? 'image' : 'danbooruApi'
    const surface = isInline ? 'image' : 'download'
    const clientIp = getClientIp(request.headers)
    const userId = await resolveRateLimitUserId(request)
    const combined = await getCombinedLimit(profile, clientIp, userId)
    const keyType = userId ? 'authed' : 'anon'
    const requestId = request.headers.get('x-request-id') ?? undefined

    if (combined.userCount > combined.userMax) {
      logRateLimitBlock({ surface, keyType, scope: 'per-ip', origin: urlDomain, requestId })
      return NextResponse.json(
        { error: isInline ? 'Too many image requests. Please wait a moment.' : 'Too many downloads. Please wait before downloading another image.', retryAfter: combined.retryAfterS },
        { status: 429, headers: { 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store', 'Netlify-CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store', 'Retry-After': String(combined.retryAfterS) } }
      )
    }

    if (combined.globalCount > combined.globalMax) {
      logRateLimitBlock({ surface, keyType, scope: 'global', origin: urlDomain, requestId })
      return NextResponse.json(
        { error: 'Image requests are temporarily throttled. Please wait a moment.', retryAfter: 2 },
        { status: 429, headers: { 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store', 'Netlify-CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store', 'Retry-After': '2' } }
      )
    }
  } else {
    // Non-Danbooru providers only need the general per-IP limiter.
    const ratelimit = getDanbooruApiRateLimit()
    if (ratelimit) {
      const clientIp = getClientIp(request.headers)
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

    // Anti-hotlink Referer per CDN. Image files need no credentials, so the
    // Danbooru API key is never sent from this route.
    let referer: string = PROVIDER_REFERERS.DANBOORU
    if (urlDomain.endsWith('rule34.xxx')) referer = PROVIDER_REFERERS.RULE34
    else if (urlDomain.endsWith('aibooru.download')) referer = PROVIDER_REFERERS.AIBOORU
    else if (urlDomain.endsWith('e621.net') || urlDomain.endsWith('e926.net')) referer = PROVIDER_REFERERS.E621
    else if (urlDomain.endsWith('gelbooru.com')) referer = PROVIDER_REFERERS.GELBOORU

    const fetchHeaders: HeadersInit = {
      'User-Agent': isDanbooru ? getDanbooruUserAgent() : USER_AGENT,
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,video/*;q=0.9,*/*;q=0.8',
      'Referer': referer,
    }

    const response = await fetch(url.toString(), {
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

    const contentType = response.headers.get('content-type')
    if (!isMediaContentType(contentType)) {
      await response.body?.cancel()
      return NextResponse.json(
        { error: 'Upstream did not return an image' },
        {
          status: 502,
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

    // Sanitized so a crafted path cannot break the Content-Disposition header.
    const lastSegment = url.pathname.split('/').pop() || ''
    let rawName = lastSegment
    try { rawName = decodeURIComponent(lastSegment) } catch { /* malformed escape: keep raw */ }
    const filename = rawName.replace(/[^\w.\-]+/g, '_').slice(0, 150) || 'download.jpg'

    const headers = new Headers()
    headers.set('Content-Type', contentType!)
    headers.set('X-Content-Type-Options', 'nosniff')
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
