// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'https://booru-prompt-gallery.com',
  'https://www.booru-prompt-gallery.com',
  'https://booru-prompt-gallery.netlify.app',
  'https://booru-prompt-gallery.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
]

// Security headers applied to all responses
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
}

export function getCorsHeaders(origin: string | null): Record<string, string> {
  // Check if origin is allowed
  const isAllowed = origin && (ALLOWED_ORIGINS.some(allowed => {
    try { return new URL(allowed).origin === new URL(origin).origin } catch { return false }
  }) || origin.endsWith('.vercel.app') || origin.endsWith('.netlify.app') || origin.startsWith('http://localhost:') || origin.startsWith('https://localhost:'))

  const allowOrigin = isAllowed && origin ? origin : ALLOWED_ORIGINS[0]

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    // F4 (rate-limit-antiabuse plan): Authorization carries the Supabase access
    // token so the worker can resolve authed identity for adaptive limits.
    // Additive — anonymous callers that never send this header are unaffected.
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, User-Agent',
    'Access-Control-Expose-Headers': 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-RateLimit-Type, X-RateLimit-Daily-Remaining',
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
