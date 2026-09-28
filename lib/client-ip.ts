// ---------------------------------------------------------------------------
// Trusted client-IP resolution for rate limiting and abuse controls.
//
// The raw `x-forwarded-for` header is NOT trustworthy on every host: Vercel
// overwrites it at the edge, but Netlify appends to whatever the client sent,
// so a caller could rotate a fake left-most value on every request and get a
// fresh rate-limit bucket each time. Each platform exposes a header its edge
// sets itself — read that one, and only fall back to x-forwarded-for where the
// platform guarantees it.
//
// The platform is detected from the runtime environment (VERCEL=1 is set on
// Vercel functions) rather than from request headers, because a client can
// send any header name — e.g. a forged `x-nf-client-connection-ip` would pass
// straight through Vercel.
// ---------------------------------------------------------------------------

interface HeaderSource {
  get(name: string): string | null
}

function firstForwarded(headers: HeaderSource): string | null {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null
}

export function getClientIp(headers: HeaderSource, fallback = "anonymous"): string {
  if (process.env.VERCEL === "1") {
    // Vercel sets both from the real TCP peer and discards client values.
    return headers.get("x-real-ip")?.trim() || firstForwarded(headers) || fallback
  }

  // Netlify (and anything else): prefer the edge-set connection IP. Only
  // Netlify's edge writes this header; when it's absent we're on a host where
  // x-forwarded-for is the best signal available (local dev, self-hosting).
  return headers.get("x-nf-client-connection-ip")?.trim() || firstForwarded(headers) || fallback
}
