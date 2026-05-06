const ALLOWED_DOMAINS = [
  'gelbooru.com',
  'img1.gelbooru.com',
  'img2.gelbooru.com',
  'img3.gelbooru.com',
  'danbooru.donmai.us',
  'cdn.donmai.us',
]

const ALLOWED_ORIGINS = [
  'https://booru-prompt-gallery.com',
  'https://www.booru-prompt-gallery.com',
  'http://localhost:3000',
]

// Rate limiting: in-memory sliding window per IP
// Cloudflare anycast routes the same IP to the same edge node,
// so this provides reasonable isolation for preventing abuse.
const RATE_LIMIT_WINDOW_MS = 10_000
const RATE_LIMIT_MAX_REQUESTS = 60
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 60_000

const requestLog = new Map()

let lastCleanup = Date.now()
function cleanupStaleEntries(now) {
  if (now - lastCleanup < RATE_LIMIT_CLEANUP_INTERVAL_MS) return
  lastCleanup = now
  for (const [key, entry] of requestLog) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      requestLog.delete(key)
    }
  }
}

function getClientIdentifier(request) {
  const ip = request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'unknown'
  const origin = request.headers.get('Origin') || 'no-origin'
  return `${ip}::${origin}`
}

function checkRateLimit(clientId) {
  const now = Date.now()
  const entry = requestLog.get(clientId)

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    requestLog.set(clientId, { count: 1, windowStart: now })
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1, reset: now + RATE_LIMIT_WINDOW_MS }
  }

  entry.count++
  const remaining = Math.max(0, RATE_LIMIT_MAX_REQUESTS - entry.count)
  const allowed = entry.count <= RATE_LIMIT_MAX_REQUESTS

  return {
    allowed,
    remaining,
    reset: entry.windowStart + RATE_LIMIT_WINDOW_MS,
  }
}

export default {
  async fetch(request, env, ctx) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      const origin = request.headers.get('Origin') || ''
      const allowOrigin = ALLOWED_ORIGINS.some(o => origin.startsWith(o))
        ? origin
        : ALLOWED_ORIGINS[0]

      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': allowOrigin,
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400',
        },
      })
    }

    const url = new URL(request.url)
    const imageUrl = url.searchParams.get('url')

    if (!imageUrl) {
      return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    let parsedUrl
    try {
      parsedUrl = new URL(imageUrl)
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid URL' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    if (!ALLOWED_DOMAINS.some(d => parsedUrl.hostname === d || parsedUrl.hostname.endsWith(`.${d}`))) {
      return new Response(JSON.stringify({ error: 'Domain not allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    // Validate origin to prevent open proxy abuse
    const origin = request.headers.get('Origin') || ''
    const referer = request.headers.get('Referer') || ''
    const isAllowedOrigin = ALLOWED_ORIGINS.some(o => origin.startsWith(o) || referer.startsWith(o))
    const isDirectRequest = !origin && !referer // allow direct browser access (no Origin/Referer)

    if (!isAllowedOrigin && !isDirectRequest) {
      console.log(JSON.stringify({
        layer: 'worker',
        event: 'origin_blocked',
        origin,
        referer,
        url: imageUrl.substring(0, 100),
      }))
      return new Response(JSON.stringify({ error: 'Unauthorized origin' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    // Check Cloudflare cache first (before rate limiting)
    const cache = caches.default
    const cacheKey = new Request(request.url, request)
    let cached = await cache.match(cacheKey)
    if (cached) return cached

    // Rate limiting — only on cache misses
    cleanupStaleEntries(Date.now())
    const clientId = getClientIdentifier(request)
    const rateLimitResult = checkRateLimit(clientId)

    if (!rateLimitResult.allowed) {
      const retryAfter = Math.ceil((rateLimitResult.reset - Date.now()) / 1000)
      console.log(JSON.stringify({
        layer: 'worker',
        event: 'rate_limited',
        clientId,
        retryAfter,
      }))
      return new Response(
        JSON.stringify({
          error: 'Too many image requests. Please wait a moment.',
          retryAfter,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': origin && isAllowedOrigin ? origin : ALLOWED_ORIGINS[0],
            'Retry-After': String(retryAfter),
            'X-RateLimit-Limit': String(RATE_LIMIT_MAX_REQUESTS),
            'X-RateLimit-Remaining': String(rateLimitResult.remaining),
            'X-RateLimit-Reset': String(rateLimitResult.reset),
          },
        }
      )
    }

    try {
      const isDanbooru = parsedUrl.hostname.includes('danbooru') || parsedUrl.hostname.includes('donmai')

      const headers = {
        'User-Agent': isDanbooru
          ? `Boorugallery/9.2 (Danbooru user: ${env.DANBOORU_USERNAME || 'anonymous'})`
          : 'Boorugallery/9.2',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      }

      if (isDanbooru) {
        const username = env.DANBOORU_USERNAME
        const apiKey = env.DANBOORU_API_KEY

        if (username && apiKey) {
          const credentials = btoa(`${username}:${apiKey}`)
          headers['Authorization'] = `Basic ${credentials}`
        }

        headers['Referer'] = 'https://danbooru.donmai.us/'
      } else {
        headers['Referer'] = 'https://gelbooru.com/'
      }

      let response = await fetch(imageUrl, { headers, redirect: 'follow' })

      // Fallback: /samples/ → /images/
      if (!response.ok && imageUrl.includes('/samples/')) {
        const fallbackUrl = imageUrl
          .replace('/samples/', '/images/')
          .replace(/\/sample_([^/]+)$/, '/$1')
        response = await fetch(fallbackUrl, { headers, redirect: 'follow' })
      }

      if (!response.ok) {
        console.log(JSON.stringify({
          layer: 'worker',
          event: 'upstream_error',
          status: response.status,
          url: imageUrl.substring(0, 100),
        }))
        return new Response(JSON.stringify({ error: `Upstream error: ${response.status}` }), {
          status: response.status,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        })
      }

      const contentType = response.headers.get('content-type') || 'image/jpeg'

      const allowedOrigin = origin && isAllowedOrigin ? origin : ALLOWED_ORIGINS[0]

      const proxyResponse = new Response(response.body, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400, immutable',
          'Access-Control-Allow-Origin': allowedOrigin,
          'X-RateLimit-Limit': String(RATE_LIMIT_MAX_REQUESTS),
          'X-RateLimit-Remaining': String(rateLimitResult.remaining),
          'X-RateLimit-Reset': String(rateLimitResult.reset),
        },
      })

      // Store in Cloudflare cache (async, doesn't block response)
      ctx.waitUntil(cache.put(cacheKey, proxyResponse.clone()))

      return proxyResponse
    } catch (err) {
      console.log(JSON.stringify({
        layer: 'worker',
        event: 'fetch_error',
        message: err.message,
        url: imageUrl?.substring(0, 100),
      }))
      return new Response(JSON.stringify({ error: 'Failed to fetch image' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }
  },
}
