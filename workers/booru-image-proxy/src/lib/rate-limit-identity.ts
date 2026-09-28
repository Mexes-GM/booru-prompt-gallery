// ---------------------------------------------------------------------------
// Rate-limit identity resolution — WORKER side
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
//  2. Non-spoofable: verified with HS256 + SUPABASE_JWT_SECRET, or with
//     ES256/RS256 against the project's cached JWKS (./jwt-verify.ts). A forged/absent/expired token fails verification.
//  3. Fail-open to anon: ANY failure (no header, malformed JWT, wrong alg,
//     expired, no secret configured) returns null → caller uses the
//     anonymous IP key + anonymous limits. Purely additive.
//
// No new dependencies — uses the Workers runtime's built-in Web Crypto.
// ---------------------------------------------------------------------------

import { Env } from '../types'
import { verifySupabaseJwt } from './jwt-verify'

/** Whether adaptive (anon vs. authed) rate limiting is enabled. Default OFF. */
export function isAdaptiveLimitsEnabled(env: Env): boolean {
  return env.ADAPTIVE_LIMITS === '1'
}

/** Extract the bearer token from a standard `Authorization: Bearer <jwt>` header. */
function extractBearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') || request.headers.get('authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1] : null
}

/**
 * Resolve the authenticated user id for rate-limit keying, or null (anonymous).
 * Returns null unless ADAPTIVE_LIMITS is enabled AND the request carries a
 * valid, unexpired, correctly-signed Supabase access token in Authorization.
 * Never throws.
 */
export async function resolveRateLimitUserId(request: Request, env: Env): Promise<string | null> {
  if (!isAdaptiveLimitsEnabled(env)) return null
  const hsSecret = env.SUPABASE_JWT_SECRET
  const supabaseUrl = env.SUPABASE_URL
  if (!hsSecret && !supabaseUrl) return null
  try {
    const token = extractBearerToken(request)
    if (!token) return null
    return await verifySupabaseJwt(token, { hsSecret, supabaseUrl })
  } catch {
    return null
  }
}
