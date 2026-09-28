// ---------------------------------------------------------------------------
// Local Supabase access-token verification (Web Crypto, no dependencies).
//
// Supports both signing schemes a Supabase project can use:
//  - Legacy shared secret (HS256) — verified with SUPABASE_JWT_SECRET.
//  - Asymmetric signing keys (ES256 / RS256) — verified against the project's
//    public JWKS (`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`), fetched once
//    and cached in module scope.
//
// Before this existed, only HS256 was accepted, so rotating the project to
// asymmetric keys would have silently dropped every signed-in user to the
// anonymous rate-limit tier. Mirrored in
// workers/booru-image-proxy/src/lib/jwt-verify.ts (the Worker can't import
// from the app's lib/).
//
// Returns the token's `sub` (user id) or null. Never throws.
// ---------------------------------------------------------------------------

interface JwtHeader { alg?: string; kid?: string }
interface JwtPayload { sub?: string; exp?: number }
interface Jwk extends JsonWebKey { kid?: string; alg?: string }

const JWKS_TTL_MS = 10 * 60 * 1000

let jwksCache: { url: string; keys: Jwk[]; fetchedAt: number } | null = null

export function base64UrlToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64url.length / 4) * 4, "=")
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function getJwks(supabaseUrl: string, forceRefresh = false): Promise<Jwk[]> {
  const url = `${supabaseUrl.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`
  if (!forceRefresh && jwksCache && jwksCache.url === url && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys
  }
  const res = await fetch(url)
  if (!res.ok) return jwksCache?.url === url ? jwksCache.keys : []
  const body = (await res.json()) as { keys?: Jwk[] }
  const keys = Array.isArray(body.keys) ? body.keys : []
  jwksCache = { url, keys, fetchedAt: Date.now() }
  return keys
}

async function verifyAsymmetric(
  header: JwtHeader,
  signingInput: BufferSource,
  signature: BufferSource,
  supabaseUrl: string
): Promise<boolean> {
  let keys = await getJwks(supabaseUrl)
  let jwk = keys.find((k) => k.kid === header.kid)
  if (!jwk) {
    // Unknown kid → the project may have rotated keys since the last fetch.
    keys = await getJwks(supabaseUrl, true)
    jwk = keys.find((k) => k.kid === header.kid)
  }
  if (!jwk) return false

  if (header.alg === "ES256") {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])
    return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, signingInput)
  }
  if (header.alg === "RS256") {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"])
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signingInput)
  }
  return false
}

/**
 * Verify a Supabase access token and return its `sub`, or null.
 * `hsSecret` enables HS256; `supabaseUrl` enables ES256/RS256 via JWKS.
 */
export async function verifySupabaseJwt(
  jwt: string,
  opts: { hsSecret?: string; supabaseUrl?: string }
): Promise<string | null> {
  const parts = jwt.split(".")
  if (parts.length !== 3) return null
  const [headerB64, payloadB64, sigB64] = parts

  let header: JwtHeader
  let payload: JwtPayload
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(headerB64)))
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64)))
  } catch {
    return null
  }

  if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()) return null
  if (!payload.sub) return null

  try {
    const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    const signature = base64UrlToBytes(sigB64)

    if (header.alg === "HS256") {
      if (!opts.hsSecret) return null
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(opts.hsSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"]
      )
      return (await crypto.subtle.verify("HMAC", key, signature, signingInput)) ? payload.sub : null
    }

    if ((header.alg === "ES256" || header.alg === "RS256") && opts.supabaseUrl) {
      return (await verifyAsymmetric(header, signingInput, signature, opts.supabaseUrl)) ? payload.sub : null
    }

    return null
  } catch {
    return null
  }
}
