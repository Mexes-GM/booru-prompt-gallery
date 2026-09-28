import { Env } from '../types'
import { getRedis } from '../lib/redis'
import { checkCircuitOpen } from '../lib/circuit-breaker'
import {
  USER_AGENT,
  getDanbooruUserAgent,
  MERGED_RATELIMIT_SCRIPT,
  isAllowedImageHost,
  isDanbooruHost,
  isMediaContentType,
  refererForImageHost,
} from '../lib/constants'
import { errorResponse, getClientIp } from '../utils'
import { isBlocked, markBlocked, clearBlocked } from '../lib/rate-limit-cache'
import { logger, logRateLimitBlock } from '../logger'
import { WORKER_LIMITS } from '../lib/limits'

const NO_STORE = { 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' }

/** Keeps the Content-Disposition header well-formed whatever the URL holds. */
function safeFilename(imageUrl: URL): string {
  const lastSegment = imageUrl.pathname.split('/').pop() || ''
  let name = lastSegment
  try { name = decodeURIComponent(lastSegment) } catch { /* malformed escape: keep raw */ }
  const cleaned = name.replace(/[^\w.\-]+/g, '_').slice(0, 150)
  return cleaned || 'download.jpg'
}

export async function downloadHandler(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url)
  const imageUrl = url.searchParams.get('url')

  if (!imageUrl) {
    return errorResponse('Missing image URL', 400)
  }

  let parsed: URL
  try {
    parsed = new URL(imageUrl)
  } catch {
    return errorResponse('Invalid URL', 400)
  }
  const urlDomain = parsed.hostname
  const isDanbooru = isDanbooruHost(urlDomain)

  // Image CDN hosts only — never an API/site host, so this route cannot be used
  // to read provider API pages through our Worker.
  if (parsed.protocol !== 'https:' || !isAllowedImageHost(urlDomain)) {
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
          { 'Retry-After': '10', ...NO_STORE }
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
          { 'Retry-After': '10', ...NO_STORE }
        )
      }
      clearBlocked(userKey)

      if (globalCount > WORKER_LIMITS.downloadDanbooru.global.max) {
        logRateLimitBlock(request, { surface: 'download', keyType: 'anon', scope: 'global', origin: 'danbooru' })
        return errorResponse(
          'Danbooru requests are temporarily throttled. Please wait a moment.',
          429,
          { 'Retry-After': '2', ...NO_STORE }
        )
      }
    } else {
      const userKey = `ratelimit:booru:${clientIp}`

      // Fase 1: already-known-blocked IP — reject without touching Redis.
      if (isBlocked(userKey)) {
        return errorResponse(
          'Too many downloads. Please wait before downloading another image.',
          429,
          { 'Retry-After': '10', ...NO_STORE }
        )
      }

      const userCount = await redis.incrWithExpire(userKey, WORKER_LIMITS.downloadOther.perIp.windowS)
      if (userCount > WORKER_LIMITS.downloadOther.perIp.max) {
        markBlocked(userKey, WORKER_LIMITS.downloadOther.perIp.windowS)
        logRateLimitBlock(request, { surface: 'download', keyType: 'anon', scope: 'per-ip', origin: urlDomain })
        return errorResponse(
          'Too many downloads. Please wait before downloading another image.',
          429,
          { 'Retry-After': '10', ...NO_STORE }
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
          { 'Retry-After': String(circuit.retryAfter), ...NO_STORE }
        )
      }
    }
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 60000)

    // Image files need no credentials: the Danbooru API key is never sent here.
    const fetchHeaders: Record<string, string> = {
      'User-Agent': isDanbooru ? getDanbooruUserAgent(env.DANBOORU_USERNAME) : USER_AGENT,
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,video/*;q=0.9,*/*;q=0.8',
    }
    const referer = refererForImageHost(urlDomain)
    if (referer) fetchHeaders['Referer'] = referer

    const response = await fetch(parsed.toString(), {
      signal: controller.signal,
      headers: fetchHeaders,
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      await response.body?.cancel()
      return errorResponse(`Failed to fetch image: ${response.status}`, response.status >= 500 ? 502 : response.status, NO_STORE)
    }

    const contentType = response.headers.get('content-type')
    if (!isMediaContentType(contentType)) {
      await response.body?.cancel()
      return errorResponse('Upstream did not return an image', 502, NO_STORE)
    }
    if (!response.body) {
      return errorResponse('Empty response body', 502, NO_STORE)
    }

    const contentLength = response.headers.get('content-length')

    const headers = new Headers()
    headers.set('Content-Type', contentType!)
    headers.set('Content-Disposition', `attachment; filename="${safeFilename(parsed)}"`)
    headers.set('Cache-Control', 'public, max-age=31536000, immutable')
    headers.set('CDN-Cache-Control', 'public, s-maxage=31536000, immutable')
    headers.set('X-Content-Type-Options', 'nosniff')
    if (contentLength) headers.set('Content-Length', contentLength)

    return new Response(response.body, { status: 200, headers })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError'
    logger.warn('download_proxy_error', { host: urlDomain, error: String(error) })
    return errorResponse(timedOut ? 'Image download timed out' : 'Failed to download image', timedOut ? 504 : 502, NO_STORE)
  }
}
