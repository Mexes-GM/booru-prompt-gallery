// Image proxy — adapted from original workers/image-proxy/index.js
// Handles Danbooru/Gelbooru image proxying with CF edge caching

const ALLOWED_DOMAINS = [
  'gelbooru.com',
  'img1.gelbooru.com', 'img2.gelbooru.com', 'img3.gelbooru.com',
  'danbooru.donmai.us',
  'cdn.donmai.us',
]

const ALLOWED_ORIGINS = [
  'https://booru-prompt-gallery.com',
  'https://www.booru-prompt-gallery.com',
  'https://booru-prompt-gallery.netlify.app',
  'http://localhost:3000',
]

function isOriginAllowed(origin: string, referer: string): boolean {
  const extractHost = (url: string): string => {
    if (!url) return ''
    try { return new URL(url).hostname } catch { return url }
  }
  const check = (url: string) => {
    const host = extractHost(url)
    if (!host) return false
    return ALLOWED_ORIGINS.some(allowed => {
      try { return new URL(allowed).hostname === host } catch { return false }
    }) || host.endsWith('.vercel.app') || host.endsWith('.netlify.app')
  }
  return check(origin) || check(referer)
}

const RATE_LIMIT_WINDOW_MS = 10_000
const RATE_LIMIT_MAX = 60
const requestLog = new Map<string, { count: number; windowStart: number }>()
let lastCleanup = Date.now()

function cleanupStale(now: number) {
  if (now - lastCleanup < 60_000) return
  lastCleanup = now
  for (const [key, entry] of requestLog) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      requestLog.delete(key)
    }
  }
}

function getClientId(request: Request): string {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown'
  const origin = request.headers.get('Origin') || 'no-origin'
  return `${ip}::${origin}`
}

function checkRateLimit(clientId: string) {
  const now = Date.now()
  const entry = requestLog.get(clientId)
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    requestLog.set(clientId, { count: 1, windowStart: now })
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1, reset: now + RATE_LIMIT_WINDOW_MS }
  }
  entry.count++
  return {
    allowed: entry.count <= RATE_LIMIT_MAX,
    remaining: Math.max(0, RATE_LIMIT_MAX - entry.count),
    reset: entry.windowStart + RATE_LIMIT_WINDOW_MS,
  }
}

export async function imageProxyHandler(
  request: Request,
  env: Record<string, string | undefined>,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url)
  const imageUrl = url.searchParams.get('url')

  // No url param = not an image proxy request (could be root health check)
  if (!imageUrl) {
    return new Response(JSON.stringify({ status: 'ok', worker: 'booru-api' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }

  let parsedUrl: URL
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

  // Origin validation
  const origin = request.headers.get('Origin') || ''
  const referer = request.headers.get('Referer') || ''
  const isAllowed = isOriginAllowed(origin, referer)
  const isDirect = !origin && !referer

  if (!isAllowed && !isDirect) {
    return new Response(JSON.stringify({ error: 'Unauthorized origin' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }

  // Cache check
  const cache = caches.default
  const cacheKey = new URL(request.url).toString()
  const cached = await cache.match(cacheKey)
  if (cached) return cached

  // Rate limit (cache misses only)
  cleanupStale(Date.now())
  const clientId = getClientId(request)
  const rl = checkRateLimit(clientId)
  if (!rl.allowed) {
    const retryAfter = Math.ceil((rl.reset - Date.now()) / 1000)
    return new Response(JSON.stringify({ error: 'Too many image requests. Please wait a moment.', retryAfter }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin || ALLOWED_ORIGINS[0],
        'Retry-After': String(retryAfter),
        'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
        'X-RateLimit-Remaining': String(rl.remaining),
        'X-RateLimit-Reset': String(rl.reset),
      },
    })
  }

  try {
    const isDanbooru = parsedUrl.hostname.includes('danbooru') || parsedUrl.hostname.includes('donmai')

    const headers: Record<string, string> = {
      'User-Agent': isDanbooru
        ? `Boorugallery/9.2 (Danbooru user: ${env.DANBOORU_USERNAME || 'anonymous'})`
        : 'Boorugallery/9.2',
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Referer': isDanbooru ? 'https://danbooru.donmai.us/' : 'https://gelbooru.com/',
    }

    if (isDanbooru && env.DANBOORU_USERNAME && env.DANBOORU_API_KEY) {
      headers['Authorization'] = `Basic ${btoa(`${env.DANBOORU_USERNAME}:${env.DANBOORU_API_KEY}`)}`
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
      return new Response(JSON.stringify({ error: `Upstream error: ${response.status}` }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg'
    const allowedOrigin = origin && isAllowed ? origin : ALLOWED_ORIGINS[0]

    const proxyResponse = new Response(response.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400, immutable',
        'Access-Control-Allow-Origin': allowedOrigin,
        'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
        'X-RateLimit-Remaining': String(rl.remaining),
        'X-RateLimit-Reset': String(rl.reset),
      },
    })

    ctx.waitUntil(cache.put(cacheKey, proxyResponse.clone()))
    return proxyResponse
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Failed to fetch image' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
}
