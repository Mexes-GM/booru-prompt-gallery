import { Env } from '../types'
import { Redis, getRedis } from '../lib/redis'
import { checkCircuitOpen } from '../lib/circuit-breaker'
import { PROVIDER_REFERERS, USER_AGENT, getDanbooruUserAgent, MERGED_RATELIMIT_SCRIPT } from '../lib/constants'
import { errorResponse, getClientIp } from '../utils'
import { isBlocked, markBlocked, clearBlocked } from '../lib/rate-limit-cache'
import { logRateLimitBlock } from '../logger'
import { WORKER_LIMITS } from '../lib/limits'

const ALLOWED_DOMAINS = [
  'danbooru.donmai.us', 'cdn.donmai.us', 'donmai.us',
  'aibooru.online', 'cdn.aibooru.download', 'aibooru.download',
  'rule34.xxx', 'api-cdn.rule34.xxx', 'us.rule34.xxx', 'wimg.rule34.xxx',
  'e621.net', 'static1.e621.net',
  'gelbooru.com', 'img1.gelbooru.com', 'img2.gelbooru.com', 'img3.gelbooru.com', 'img4.gelbooru.com', 'img5.gelbooru.com',
]

export async function downloadHandler(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url)
  const imageUrl = url.searchParams.get('url')

  if (!imageUrl) {
    return errorResponse('Missing image URL', 400)
  }

  let urlDomain: string
  let isDanbooru: boolean
  try {
    const parsed = new URL(imageUrl)
    urlDomain = parsed.hostname
    isDanbooru = urlDomain.includes('danbooru') || urlDomain.includes('donmai.us')
  } catch {
    return errorResponse('Invalid URL', 400)
  }

  const isAllowed = ALLOWED_DOMAINS.some(
    (d) => urlDomain === d || urlDomain.endsWith(`.${d}`)
  )
  if (!isAllowed) {
    return errorResponse('URL domain not allowed', 403)
  }

  const redis = getRedis(env)

  // Rate limit + circuit breaker — applies to ALL providers hitting external APIs
  if (redis) {
    const clientIp = getClientIp(request)

    if (isDanbooru) {
      const userKey = `ratelimit:booru:${clientIp}`
      const globalKey = 'ratelimit:danbooru:global:download'

      // Fase 1: already-known-blocked IP — reject without touching Redis.
      if (isBlocked(userKey)) {
        return errorResponse(
          'Too many downloads. Please wait before downloading another image.',
          429,
          { 'Retry-After': '10', 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' }
        )
      }

      // Single EVAL: atomically INCR+EXPIRE both per-IP and global keys
      const result = await redis.eval(MERGED_RATELIMIT_SCRIPT, [userKey, globalKey], [String(WORKER_LIMITS.downloadDanbooru.perIp.windowS)]) as number[]
      const userCount = result?.[0] ?? 0
      const globalCount = result?.[1] ?? 0

      if (userCount > WORKER_LIMITS.downloadDanbooru.perIp.max) {
        markBlocked(userKey, WORKER_LIMITS.downloadDanbooru.perIp.windowS)
        logRateLimitBlock(request, { surface: 'download', keyType: 'anon', scope: 'per-ip', origin: 'danbooru' })
        return errorResponse(
          'Too many downloads. Please wait before downloading another image.',
          429,
          { 'Retry-After': '10', 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' }
        )
      }
      clearBlocked(userKey)

      if (globalCount > WORKER_LIMITS.downloadDanbooru.global.max) {
        logRateLimitBlock(request, { surface: 'download', keyType: 'anon', scope: 'global', origin: 'danbooru' })
        return errorResponse(
          'Danbooru requests are temporarily throttled. Please wait a moment.',
          429,
          { 'Retry-After': '2', 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' }
        )
      }
    } else {
      const userKey = `ratelimit:booru:${clientIp}`

      // Fase 1: already-known-blocked IP — reject without touching Redis.
      if (isBlocked(userKey)) {
        return errorResponse(
          'Too many downloads. Please wait before downloading another image.',
          429,
          { 'Retry-After': '10', 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' }
        )
      }

      const userCount = await redis.incrWithExpire(userKey, WORKER_LIMITS.downloadOther.perIp.windowS)
      if (userCount > WORKER_LIMITS.downloadOther.perIp.max) {
        markBlocked(userKey, WORKER_LIMITS.downloadOther.perIp.windowS)
        logRateLimitBlock(request, { surface: 'download', keyType: 'anon', scope: 'per-ip', origin: urlDomain })
        return errorResponse(
          'Too many downloads. Please wait before downloading another image.',
          429,
          { 'Retry-After': '10', 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' }
        )
      }
      clearBlocked(userKey)
    }

    if (isDanbooru) {
      const circuit = await checkCircuitOpen(redis, 'danbooru-api')
      if (circuit.open) {
        logRateLimitBlock(request, { surface: 'download', keyType: 'anon', scope: 'circuit', origin: 'danbooru' })
        return errorResponse(
          'Danbooru is saturated. Please wait before downloading.',
          429,
          { 'Retry-After': String(circuit.retryAfter), 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' }
        )
      }
    }
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 60000)

    // Determine appropriate Referer
    let referer = PROVIDER_REFERERS.DANBOORU
    if (urlDomain.includes('rule34')) referer = PROVIDER_REFERERS.RULE34
    else if (urlDomain.includes('aibooru')) referer = PROVIDER_REFERERS.AIBOORU
    else if (urlDomain.includes('e621')) referer = PROVIDER_REFERERS.E621
    else if (urlDomain.includes('gelbooru')) referer = PROVIDER_REFERERS.GELBOORU

    const fetchHeaders: Record<string, string> = {
      'User-Agent': isDanbooru ? getDanbooruUserAgent(env.DANBOORU_USERNAME) : USER_AGENT,
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    }

    if (isDanbooru) {
      const username = env.DANBOORU_USERNAME
      const apiKey = env.DANBOORU_API_KEY
      if (username && apiKey) {
        fetchHeaders['Authorization'] = `Basic ${btoa(`${username}:${apiKey}`)}`
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
      return errorResponse(
        `Failed to fetch image: ${response.status} ${response.statusText}`,
        response.status
      )
    }

    if (!response.body) {
      return errorResponse('Empty response body', 500)
    }

    const urlPath = imageUrl.split('?')[0]
    const filename = urlPath.split('/').pop() || 'download.jpg'
    const contentType = response.headers.get('content-type') || 'application/octet-stream'
    const contentLength = response.headers.get('content-length')

    const headers = new Headers()
    headers.set('Content-Type', contentType)
    headers.set('Content-Disposition', `attachment; filename="${filename}"`)
    headers.set('Cache-Control', 'public, max-age=31536000, immutable')
    headers.set('CDN-Cache-Control', 'public, s-maxage=31536000, immutable')
    headers.set('Access-Control-Allow-Origin', '*')
    if (contentLength) headers.set('Content-Length', contentLength)

    return new Response(response.body, { status: 200, headers })
  } catch (error: any) {
    console.error('[download] proxy error:', error)
    return errorResponse(error.message || 'Failed to download image', 500)
  }
}
