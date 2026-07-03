// ---------------------------------------------------------------------------
// Rate-limit identity resolution — WORKER side (F4, rate-limit-antiabuse plan)
//
// Mirror of `lib/rate-limit-identity.ts` on the Next.js side, adapted for the
// Worker's transport: the Worker is called cross-origin (a separate
// `*.workers.dev`/custom domain), so the browser never sends the app's
// Supabase cookies here. Instead the frontend attaches the access token as a
// standard `Authorization: Bearer <jwt>` header (see lib/booru/urls.ts /
// api-client changes), and this module verifies it LOCALLY (HS256 HMAC, no
// network round-trip) exactly like the Next.js side does with the cookie.
//
// Same three safety properties as the Next.js mirror:
//  1. Flag-gated: only resolves an identity when ADAPTIVE_LIMITS === '1'.
//     Off → every route keys by IP exactly as before this file existed.
//  2. Non-spoofable: verified with HS256 + SUPABASE_JWT_SECRET (Supabase's
//     JWT signing secret). A forged/absent/expired token fails verification.
//  3. Fail-open to anon: ANY failure (no header, malformed JWT, wrong alg,
//     expired, no secret configured) returns null → caller uses the
//     anonymous IP key + anonymous limits. Purely additive.
//
// No new dependencies — uses the Workers runtime's built-in Web Crypto.
// ---------------------------------------------------------------------------

import { Env } from '../types'

/** Whether adaptive (anon vs. authed) rate limiting is enabled. Default OFF. */
export function isAdaptiveLimitsEnabled(env: Env): boolean {
  return env.ADAPTIVE_LIMITS === '1'
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** Extract the bearer token from a standard `Authorization: Bearer <jwt>` header. */
function extractBearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') || request.headers.get('authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1] : null
}

/** Verify a Supabase HS256 JWT locally and return its `sub` (user id), else null. */
async function verifyHs256(jwt: string, secret: string): Promise<string | null> {
  const parts = jwt.split('.')
  if (parts.length !== 3) return null
  const [headerB64, payloadB64, sigB64] = parts

  let header: { alg?: string }
  let payload: { sub?: string; exp?: number }
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(headerB64)))
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64)))
  } catch {
    return null
  }

  // Only HS256 is supported here; asymmetric keys → fail-open to anon.
  if (header.alg !== 'HS256') return null
  if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) return null
  if (!payload.sub) return null

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )
    const ok = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlToBytes(sigB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    )
    return ok ? payload.sub : null
  } catch {
    return null
  }
}

/**
 * Resolve the authenticated user id for rate-limit keying, or null (anonymous).
 * Returns null unless ADAPTIVE_LIMITS is enabled AND the request carries a
 * valid, unexpired, correctly-signed Supabase access token in Authorization.
 * Never throws.
 */
export async function resolveRateLimitUserId(request: Request, env: Env): Promise<string | null> {
  if (!isAdaptiveLimitsEnabled(env)) return null
  const secret = env.SUPABASE_JWT_SECRET
  if (!secret) return null
  try {
    const token = extractBearerToken(request)
    if (!token) return null
    return await verifyHs256(token, secret)
  } catch {
    return null
  }
}
