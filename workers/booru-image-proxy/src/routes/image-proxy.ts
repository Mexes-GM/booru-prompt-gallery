// Image proxy — adapted from original workers/image-proxy/index.js
// Handles Danbooru/Gelbooru image proxying with CF edge caching
import { getRedis } from '../lib/redis'


const ALLOWED_DOMAINS = [
  // Gelbooru
  'gelbooru.com',
  'img1.gelbooru.com', 'img2.gelbooru.com', 'img3.gelbooru.com',
  'img4.gelbooru.com', 'img5.gelbooru.com',
  // Danbooru
  'danbooru.donmai.us',
  'cdn.donmai.us',
  // Aibooru
  'aibooru.online',
  'cdn.aibooru.download',
  // Rule34
  'rule34.xxx',
  'api.rule34.xxx',
  // E621 / E926
  'e621.net',
  'static1.e621.net',
  'e926.net',
]

const ALLOWED_ORIGINS = [
  'https://booru-prompt-gallery.com',
  'https://www.booru-prompt-gallery.com',
  'https://booru-prompt-gallery.netlify.app',
  'https://booru-prompt-gallery.vercel.app',
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

const RATE_LIMIT_MAX = 15
const GLOBAL_RATE_LIMIT_MAX = 600
const GLOBAL_RATE_WINDOW = 60

function getClientId(request: Request): string {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown'
  const origin = request.headers.get('Origin') || 'no-origin'
  return `${ip}::${origin}`
}

export async function imageProxyHandler(
  request: Request,
  env: Record<string, string | undefined>,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url)
  const imageUrl = url.searchParams.get('url')

  // Origin validation
  const origin = request.headers.get('Origin') || ''
  const referer = request.headers.get('Referer') || ''
  const isAllowed = isOriginAllowed(origin, referer)
  const isDirect = !origin && !referer

  const allowedOrigin = origin && isAllowed ? origin : ALLOWED_ORIGINS[0]

  if (!isAllowed && !isDirect) {
    return new Response(JSON.stringify({ error: 'Unauthorized origin' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': allowedOrigin },
    })
  }

  // No url param = not an image proxy request (could be root health check)
  if (!imageUrl) {
    return new Response(JSON.stringify({ status: 'ok', worker: 'booru-image-proxy' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': allowedOrigin },
    })
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(imageUrl)
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid URL' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': allowedOrigin },
    })
  }

  if (!ALLOWED_DOMAINS.some(d => parsedUrl.hostname === d || parsedUrl.hostname.endsWith(`.${d}`))) {
    return new Response(JSON.stringify({ error: 'Domain not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': allowedOrigin },
    })
  }

  // Cache check
  const cache = caches.default
  const cacheKey = new URL(request.url).toString()
  const cached = await cache.match(cacheKey)
  if (cached) return cached

  // Rate limit (cache misses only)
  const clientId = getClientId(request)
  const redis = getRedis(env as any)
  let remaining = RATE_LIMIT_MAX
  let reset = Date.now() + 10000

  if (redis) {
    // Global rate limit — protects against aggregate abuse across IPs
    const globalKey = 'ratelimit:imageproxy:global'
    const globalCount = await redis.incrWithExpire(globalKey, GLOBAL_RATE_WINDOW)
    if (globalCount > GLOBAL_RATE_LIMIT_MAX) {
      return new Response(JSON.stringify({
        error: 'Image proxy is temporarily under heavy load. Please try again in a moment.',
        retryAfter: GLOBAL_RATE_WINDOW,
      }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': allowedOrigin,
          'Retry-After': String(GLOBAL_RATE_WINDOW),
          'X-RateLimit-Limit': String(GLOBAL_RATE_LIMIT_MAX),
          'X-RateLimit-Remaining': '0',
        },
      })
    }

    // Per-IP rate limit
    const key = `ratelimit:imageproxy:${clientId}`
    const count = await redis.incrWithExpire(key, 10)
    
    remaining = Math.max(0, RATE_LIMIT_MAX - count)
    
    if (count > RATE_LIMIT_MAX) {
      return new Response(JSON.stringify({ error: 'Too many image requests. Please wait a moment.', retryAfter: 10 }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': allowedOrigin,
          'Retry-After': '10',
          'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
          'X-RateLimit-Remaining': '0',
        },
      })
    }
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
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': allowedOrigin },
      })
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg'

    const proxyResponse = new Response(response.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400, immutable',
        'Access-Control-Allow-Origin': allowedOrigin,
        'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
        'X-RateLimit-Remaining': String(remaining),
      },
    })

    ctx.waitUntil(cache.put(cacheKey, proxyResponse.clone()))
    return proxyResponse
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Failed to fetch image' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': allowedOrigin },
    })
  }
}
