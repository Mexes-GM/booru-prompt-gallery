// Allowed origins for CORS
export const ALLOWED_ORIGINS = [
  'https://booru-prompt-gallery.com',
  'https://www.booru-prompt-gallery.com',
  'https://booru-prompt-gallery.netlify.app',
  'https://booru-prompt-gallery.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
]

// Preview deployments of THIS project only. Vercel preview hosts end with the
// team slug and Netlify deploy previews end with "--<site>", both unique to our
// accounts — unlike a bare ".vercel.app"/".netlify.app" suffix, which any third
// party could deploy under and then spend our API/AI quota cross-origin.
const VERCEL_PREVIEW_PREFIX = 'danbooru-prompt-gallery-'
const VERCEL_PREVIEW_SUFFIX = '-mexecution3-1312s-projects.vercel.app'
const NETLIFY_PREVIEW_SUFFIX = '--booru-prompt-gallery.netlify.app'

/** True when the Origin/Referer URL belongs to one of our deployments or localhost. */
export function isAllowedOrigin(url: string | null): boolean {
  if (!url) return false
  let host: string
  try { host = new URL(url).hostname } catch { return false }
  if (ALLOWED_ORIGINS.some(allowed => new URL(allowed).hostname === host)) return true
  if (host.startsWith(VERCEL_PREVIEW_PREFIX) && host.endsWith(VERCEL_PREVIEW_SUFFIX)) return true
  if (host.endsWith(NETLIFY_PREVIEW_SUFFIX)) return true
  return host === 'localhost' || host === '127.0.0.1'
}

// Security headers applied to all responses
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
}

export function getCorsHeaders(origin: string | null): Record<string, string> {
  const isAllowed = isAllowedOrigin(origin)
  const allowOrigin = isAllowed && origin ? origin : ALLOWED_ORIGINS[0]

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    // NOTE: 'User-Agent' is a forbidden request header per the Fetch spec;
    // no browser JS can ever send it, so it must NOT be listed here.
    // Listing it causes Firefox to include it in preflight checks and then
    // fail CORS validation. The worker sets User-Agent on its own outbound
    // requests to booru APIs server-side, which is completely separate.
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Expose-Headers': 'Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-RateLimit-Type, X-RateLimit-Daily-Remaining',
    'Access-Control-Max-Age': '86400', // Cache preflight for 24h
    ...securityHeaders,
  }
}

export const corsHeaders = getCorsHeaders(null)

export function errorResponse(
  message: string,
  status: number,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
      ...extraHeaders,
    },
  })
}

export function jsonResponse(
  data: unknown,
  status: number,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
      ...extraHeaders,
    },
  })
}

export function getClientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') || 'anonymous'
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Maps `items` through `fn` with at most `limit` calls in flight — used to
 * keep fan-out to a provider polite instead of firing everything at once.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index])
    }
  })
  await Promise.all(workers)
  return results
}
