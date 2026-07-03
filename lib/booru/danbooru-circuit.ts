/**
 * Session-scoped circuit breaker for Danbooru direct-CDN image loads.
 *
 * If any Danbooru direct CDN image fails with 403 (Cloudflare WAF blocking the
 * user's IP), we skip direct attempts for the rest of the session and fall back
 * to the proxy. This prevents doubling image requests on every card when the
 * user's IP is blocked. State lives in `sessionStorage`, so it resets on page
 * reload and auto-expires after 30 minutes of inactivity.
 */

const DANBOORU_CB_KEY = "danbooru_direct_blocked"
const DANBOORU_CB_TTL_MS = 30 * 60 * 1000 // 30 min

/** True if the breaker is currently open (skip direct Danbooru CDN attempts). */
export function isDanbooruCircuitOpen(): boolean {
  if (typeof window === "undefined") return false
  try {
    const entry = sessionStorage.getItem(DANBOORU_CB_KEY)
    if (!entry) return false
    const { ts } = JSON.parse(entry)
    return Date.now() - ts < DANBOORU_CB_TTL_MS
  } catch {
    return false
  }
}

/** Open the breaker after a direct-CDN 403 so subsequent loads use the proxy. */
export function openDanbooruCircuit(): void {
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(DANBOORU_CB_KEY, JSON.stringify({ ts: Date.now() }))
  } catch {
    /* noop — storage may be unavailable in private mode */
  }
}
