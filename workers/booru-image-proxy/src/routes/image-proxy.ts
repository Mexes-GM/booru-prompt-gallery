// Image proxy — adapted from original workers/image-proxy/index.js
// Handles Danbooru/Gelbooru image proxying with CF edge caching
import { getRedis } from '../lib/redis'
import { isBlocked, markBlocked, clearBlocked } from '../lib/rate-limit-cache'
import { MERGED_RATELIMIT_SCRIPT_2TTL } from '../lib/constants'
import { logRateLimitBlock } from '../logger'
import { WORKER_LIMITS } from '../lib/limits'


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
  'http://localhost:3001',
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
    }) || host.endsWith('.vercel.app') || host.endsWith('.netlify.app') || host.startsWith('localhost')
  }
  return check(origin) || check(referer)
}

const RATE_LIMIT_MAX = WORKER_LIMITS.image.perIp.max
const GLOBAL_RATE_LIMIT_MAX = WORKER_LIMITS.image.global.max
const GLOBAL_RATE_WINDOW = WORKER_LIMITS.image.global.windowS
const PER_IP_RATE_WINDOW = WORKER_LIMITS.image.perIp.windowS

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

  // No url param = health check (always allowed, no origin check needed)
  if (!imageUrl) {
    return new Response(JSON.stringify({ status: 'ok', worker: 'booru-image-proxy' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }

  // ponytail: Sec-Fetch-Dest: image replaces the old isDirect bypass.
  // <img> tags with referrerPolicy="no-referrer" (used by the gallery frontend)
  // don't send Origin or Referer, but browsers ALWAYS send Sec-Fetch-Dest.
  // This header cannot be spoofed by fetch()/XHR — only real browser image loads.
  const origin = request.headers.get('Origin') || ''
  const referer = request.headers.get('Referer') || ''
  const secFetchDest = request.headers.get('Sec-Fetch-Dest') || ''
  const isBrowserImg = secFetchDest === 'image'
  const isAllowed = isOriginAllowed(origin, referer) || isBrowserImg
  const allowedOrigin = origin && isOriginAllowed(origin, referer) ? origin : ALLOWED_ORIGINS[0]

  if (!isAllowed) {
    return new Response(JSON.stringify({ error: 'Unauthorized origin' }), {
      status: 403,
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
  let remaining: number = RATE_LIMIT_MAX
  let reset = Date.now() + 10000

  if (redis) {
    const globalKey = 'ratelimit:imageproxy:global'
    const key = `ratelimit:imageproxy:${clientId}`

    // Fase 1: already-known-blocked → reject without touching Redis at all.
    if (isBlocked(globalKey)) {
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
    if (isBlocked(key)) {
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

    // Fase 2: 1 eval instead of 2 incrWithExpire round-trips — independent
    // TTLs (global=60s, per-IP=10s).
    const result = await redis.eval(
      MERGED_RATELIMIT_SCRIPT_2TTL,
      [globalKey, key],
      [String(GLOBAL_RATE_WINDOW), String(PER_IP_RATE_WINDOW)]
    ) as number[]
    const globalCount = result?.[0] ?? 0
    const count = result?.[1] ?? 0

    if (globalCount > GLOBAL_RATE_LIMIT_MAX) {
      markBlocked(globalKey, GLOBAL_RATE_WINDOW)
      logRateLimitBlock(request, { surface: 'image', keyType: 'anon', scope: 'global', origin: parsedUrl.hostname })
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
    clearBlocked(globalKey)

    remaining = Math.max(0, RATE_LIMIT_MAX - count)

    if (count > RATE_LIMIT_MAX) {
      markBlocked(key, PER_IP_RATE_WINDOW)
      logRateLimitBlock(request, { surface: 'image', keyType: 'anon', scope: 'per-ip', origin: parsedUrl.hostname })
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
    clearBlocked(key)
  }

  try {
    const isDanbooru = parsedUrl.hostname.includes('danbooru') || parsedUrl.hostname.includes('donmai')

    const headers: Record<string, string> = {
      'User-Agent': isDanbooru
        ? `Boorugallery/9.2 (Danbooru user: ${env.DANBOORU_USERNAME || 'anonymous'})`
        : 'Boorugallery/9.2',
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Referer': isDanbooru ? 'https://danbooru.donmai.us/' : 'https://gelbooru.com/',
      // CDN-Loop tells Cloudflare to NOT process this request through its CDN
      // stack and pass it directly to the origin. This prevents cross-Cloudflare
      // WAF blocking when the Worker (Cloudflare IP) fetches cdn.donmai.us (also
      // Cloudflare). Without this, Cloudflare sees "internal" traffic and blocks.
      // ponytail: one header to skip the CDN layer. Add when: Cloudflare Workers
      // get a first-class way to tag internal-to-internal fetches as safe.
      'CDN-Loop': 'cloudflare',
      // Sec-Fetch headers: belt-and-suspenders with CDN-Loop. Makes the request
      // look like a same-origin browser image load for origin-level WAF rules.
      'Sec-Fetch-Dest': 'image',
      'Sec-Fetch-Mode': 'no-cors',
      'Sec-Fetch-Site': 'same-origin',
    }

    if (isDanbooru && env.DANBOORU_USERNAME && env.DANBOORU_API_KEY) {
      headers['Authorization'] = `Basic ${btoa(`${env.DANBOORU_USERNAME}:${env.DANBOORU_API_KEY}`)}`
    }

    let response = await fetch(imageUrl, {
      headers,
      redirect: 'follow',
      // cf options: attempt to bypass Cloudflare's CDN layer for the upstream.
      // cdn.donmai.us is behind Cloudflare, and Worker fetches from Cloudflare
      // IPs get 403'd by the upstream's WAF (cross-Cloudflare blocking).
      // cacheTtl: 0 + cacheEverything: false tells the runtime to fetch from
      // origin, potentially using a different egress path.
      // ponytail: best-effort bypass. Add when: Workers support explicit
      // origin-only egress for Cloudflare-proxied upstreams.
      cf: {
        cacheEverything: false,
        cacheTtl: 0,
      },
    })

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
        // Booru thumbnails are content-addressed (hashed filenames) and never
        // change, so cache aggressively. Browser TTL was 1 day (flagged by
        // Lighthouse as an inefficient cache lifetime); bumped to 30 days.
        'Cache-Control': 'public, max-age=2592000, s-maxage=2592000, stale-while-revalidate=86400, immutable',
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
