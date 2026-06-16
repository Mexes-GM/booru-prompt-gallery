
import { NextRequest, NextResponse } from 'next/server'
import { PROVIDER_REFERERS, USER_AGENT, getDanbooruUserAgent } from '@/lib/constants'
import { getDanbooruApiRateLimit, getDanbooruGlobalRateLimit } from '@/lib/rate-limit'
import { isCircuitOpenShared, getCircuitRetryAfter } from '@/lib/circuit-breaker'

// Use Node.js runtime for better stability with outgoing requests
export const runtime = 'nodejs'

function getClientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anonymous'
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const imageUrl = searchParams.get('url')

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

  // Rate limit check — applies to ALL providers hitting external APIs
  const ratelimit = getDanbooruApiRateLimit()
  if (ratelimit) {
    const clientIp = getClientIp(request)
    const { success, limit, remaining, reset } = await ratelimit.limit(clientIp)

    if (!success) {
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

  // Global rate limit + circuit breaker — Danbooru only
  if (isDanbooru) {
    const globalLimit = getDanbooruGlobalRateLimit()
    if (globalLimit) {
      const { success } = await globalLimit.limit('danbooru-outbound')
      if (!success) {
        return NextResponse.json(
          { error: 'Danbooru requests are temporarily throttled. Please wait a moment.' },
          { status: 429, headers: { 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store', 'Netlify-CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store', 'Retry-After': '2' } }
        )
      }
    }

    if (await isCircuitOpenShared('danbooru-api')) {
      const retryAfter = Math.ceil(getCircuitRetryAfter('danbooru-api') / 1000)
      return NextResponse.json(
        { error: 'Danbooru is saturated. Please wait before downloading.', retryAfter },
        { status: 429, headers: { 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store', 'Netlify-CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store', 'Retry-After': String(retryAfter) } }
      )
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
    headers.set('Content-Disposition', `attachment; filename="${filename}"`)
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
