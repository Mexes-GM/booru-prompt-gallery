// ---------------------------------------------------------------------------
// Rate-limit identity resolution (F4 — rate-limit-antiabuse plan)
//
// Resolves the identity used to KEY rate limits: an authenticated Supabase
// user (higher, adaptive limits) or an anonymous IP (current behavior).
//
// DESIGN — three safety properties make this OK to ship behind a flag:
//  1. Flag-gated: only runs when ADAPTIVE_LIMITS is enabled. Off → callers key
//     by IP exactly as before.
//  2. Non-spoofable: the Supabase access token (a JWT) is verified LOCALLY with
//     HS256 + SUPABASE_JWT_SECRET (no network call). A forged "authed" cookie
//     fails verification, so an abuser cannot claim the higher tier.
//  3. Fail-open to anon: ANY failure (no cookie, chunked-cookie parse error,
//     wrong signing alg, expired, no secret) returns null → the caller falls
//     back to the anonymous IP key + anonymous limits. So the authed tier is a
//     pure bonus when it works and a no-op otherwise — nobody is ever worse off
//     than today.
//
// No network calls, no new dependencies (uses global Web Crypto), no per-request
// Supabase round-trip.
// ---------------------------------------------------------------------------

/** Whether adaptive (anon vs. authed) rate limiting is enabled. Default OFF. */
export function isAdaptiveLimitsEnabled(): boolean {
  return process.env.ADAPTIVE_LIMITS === "1" || process.env.NEXT_PUBLIC_ADAPTIVE_LIMITS === "1"
}

interface HasCookies {
  cookies: { getAll(): { name: string; value: string }[] }
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64url.length / 4) * 4, "=")
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/**
 * Reassemble the Supabase auth cookie (which @supabase/ssr may split into
 * `sb-<ref>-auth-token.0`, `.1`, …) and extract the access_token JWT.
 */
function extractAccessToken(req: HasCookies): string | null {
  const chunks = req.cookies
    .getAll()
    .filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
  if (chunks.length === 0) return null

  chunks.sort((a, b) => {
    const ai = a.name.includes(".") ? parseInt(a.name.split(".").pop() || "0", 10) : 0
    const bi = b.name.includes(".") ? parseInt(b.name.split(".").pop() || "0", 10) : 0
    return ai - bi
  })

  let raw = chunks.map((c) => c.value).join("")
  if (raw.startsWith("base64-")) {
    try {
      raw = new TextDecoder().decode(base64UrlToBytes(raw.slice("base64-".length)))
    } catch {
      return null
    }
  }

  try {
    const parsed = JSON.parse(raw)
    // Newer SSR format: { access_token, ... }. Older: [access_token, refresh, …].
    if (Array.isArray(parsed)) return typeof parsed[0] === "string" ? parsed[0] : null
    if (parsed && typeof parsed.access_token === "string") return parsed.access_token
    return null
  } catch {
    return null
  }
}

/** Verify a Supabase HS256 JWT locally and return its `sub` (user id), else null. */
async function verifyHs256(jwt: string, secret: string): Promise<string | null> {
  const parts = jwt.split(".")
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
  if (header.alg !== "HS256") return null
  if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()) return null
  if (!payload.sub) return null

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    )
    const ok = await crypto.subtle.verify(
      "HMAC",
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
 * Returns null unless adaptive limits are enabled AND a valid, unexpired,
 * correctly-signed Supabase session cookie is present. Never throws.
 */
export async function resolveRateLimitUserId(req: HasCookies): Promise<string | null> {
  if (!isAdaptiveLimitsEnabled()) return null
  const secret = process.env.SUPABASE_JWT_SECRET
  if (!secret) return null
  try {
    const token = extractAccessToken(req)
    if (!token) return null
    return await verifyHs256(token, secret)
  } catch {
    return null
  }
}
