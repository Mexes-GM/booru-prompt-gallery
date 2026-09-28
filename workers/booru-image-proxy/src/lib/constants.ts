// Provider base URLs
export const PROVIDER_URLS = {
  DANBOORU: 'https://danbooru.donmai.us',
  AIBOORU: 'https://aibooru.online',
  RULE34: 'https://api.rule34.xxx',
  RULE34_WEB: 'https://rule34.xxx',
  E621: 'https://e621.net',
  E926: 'https://e926.net',
  GELBOORU: 'https://gelbooru.com',
} as const

// ---------------------------------------------------------------------------
// Outbound identity — SINGLE place every booru request gets its User-Agent.
//
// Danbooru asks API clients to send a descriptive User-Agent, and e621 requires
// one with a way to contact the operator. The contact URL lets admins reach us
// instead of blanket-blocking the traffic. Mirror of lib/constants.ts (Next).
// ---------------------------------------------------------------------------
export const APP_CONTACT_URL = 'https://booru-prompt-gallery.com'
export const USER_AGENT = `Boorugallery/10.0 (+${APP_CONTACT_URL})`

export function getDanbooruUserAgent(username?: string): string {
  return username
    ? `Boorugallery/10.0 (+${APP_CONTACT_URL}; Danbooru user: ${username})`
    : USER_AGENT
}

/** Hosts that belong to Danbooru itself (API + CDN). */
export function isDanbooruHost(hostname: string): boolean {
  return hostname === 'donmai.us' || hostname.endsWith('.donmai.us')
}

/**
 * Headers for a Danbooru **API** request. The Basic auth credentials are only
 * attached here, so they can never leak to another host (Aibooru, image CDNs):
 * callers that talk to anything but danbooru.donmai.us must not use this.
 */
export function danbooruApiHeaders(env: {
  DANBOORU_USERNAME?: string
  DANBOORU_API_KEY?: string
}): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': getDanbooruUserAgent(env.DANBOORU_USERNAME),
    Accept: 'application/json',
  }
  if (env.DANBOORU_USERNAME && env.DANBOORU_API_KEY) {
    headers['Authorization'] = `Basic ${btoa(`${env.DANBOORU_USERNAME}:${env.DANBOORU_API_KEY}`)}`
  }
  return headers
}

// ---------------------------------------------------------------------------
// Image hosts — the ONLY hosts the image proxy and the download route fetch.
//
// Deliberately CDN/file hosts only: API/site hosts (danbooru.donmai.us,
// gelbooru.com, e621.net, api.rule34.xxx) are excluded so neither route can be
// turned into a generic proxy for provider API pages (which would also relay
// our Danbooru credentials). Hosts match exactly, except Rule34's file
// subdomains which match by suffix.
// ---------------------------------------------------------------------------
const IMAGE_HOSTS = [
  'cdn.donmai.us',
  'cdn.aibooru.download',
  'static1.e621.net',
  'static1.e926.net',
  'img1.gelbooru.com', 'img2.gelbooru.com', 'img3.gelbooru.com',
  'img4.gelbooru.com', 'img5.gelbooru.com', 'video-cdn1.gelbooru.com',
  'video-cdn2.gelbooru.com', 'video-cdn3.gelbooru.com', 'video-cdn4.gelbooru.com',
]
// Rule34 serves files from a rotating set of subdomains (wimg., us., api-cdn.,
// ws-cdn-video., ...) — the suffix is kept, but the API host is excluded below.
const IMAGE_HOST_SUFFIXES = ['.rule34.xxx']
const NON_IMAGE_HOSTS = new Set(['api.rule34.xxx', 'rule34.xxx', 'www.rule34.xxx'])

export function isAllowedImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (NON_IMAGE_HOSTS.has(host)) return false
  if (IMAGE_HOSTS.includes(host)) return true
  return IMAGE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
}

/** True for a Content-Type the image/download routes may relay. */
export function isMediaContentType(contentType: string | null): boolean {
  if (!contentType) return false
  const type = contentType.split(';')[0].trim().toLowerCase()
  return type.startsWith('image/') || type.startsWith('video/')
}

/** Anti-hotlink Referer to send with an image fetch from `hostname`. */
export function refererForImageHost(hostname: string): string | undefined {
  if (isDanbooruHost(hostname)) return PROVIDER_REFERERS.DANBOORU
  if (hostname.endsWith('rule34.xxx')) return PROVIDER_REFERERS.RULE34
  if (hostname.endsWith('aibooru.download')) return PROVIDER_REFERERS.AIBOORU
  if (hostname.endsWith('e621.net') || hostname.endsWith('e926.net')) return PROVIDER_REFERERS.E621
  if (hostname.endsWith('gelbooru.com')) return PROVIDER_REFERERS.GELBOORU
  return undefined
}

// Single EVAL that atomically INCR+EXPIRE both per-IP and global rate-limit keys.
// Replaces two separate incrWithExpire() calls → ~30% fewer Redis commands on the Danbooru hot path.
//
// Fixed window: the TTL is set only when the counter is created (count == 1),
// or repaired if a key somehow lost it (TTL == -1). Re-running EXPIRE on every
// hit would slide the expiry forward forever, so under steady traffic the
// counter never reset and a shared global key blocked everyone indefinitely.
export const MERGED_RATELIMIT_SCRIPT = `
  local user = redis.call('INCR', KEYS[1])
  if user == 1 or redis.call('TTL', KEYS[1]) == -1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  local global = redis.call('INCR', KEYS[2])
  if global == 1 or redis.call('TTL', KEYS[2]) == -1 then redis.call('EXPIRE', KEYS[2], ARGV[1]) end
  return {user, global}
`

// Same as MERGED_RATELIMIT_SCRIPT but with independent TTLs per key — used
// when the global and per-IP windows differ (e.g. image-proxy: global=60s,
// per-IP=10s). ARGV[1] = TTL for KEYS[1] (global), ARGV[2] = TTL for KEYS[2] (per-IP).
// See docs/redis-optimization-plan.md — Fase 2.
export const MERGED_RATELIMIT_SCRIPT_2TTL = `
  local global = redis.call('INCR', KEYS[1])
  if global == 1 or redis.call('TTL', KEYS[1]) == -1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  local user = redis.call('INCR', KEYS[2])
  if user == 1 or redis.call('TTL', KEYS[2]) == -1 then redis.call('EXPIRE', KEYS[2], ARGV[2]) end
  return {global, user}
`

// Cost-weighted variant: INCRBY instead of INCR, for surfaces where one
// request fans out to several upstream calls (favorites hydration). Charging
// the real upstream cost is what makes the per-IP/global caps actually bound
// the load on the provider. ARGV[1] = window TTL, ARGV[2] = cost charged to
// KEYS[1] (per-client), ARGV[3] = cost charged to KEYS[2] (global; skipped
// when 0, e.g. a batch with no Danbooru calls).
export const COST_RATELIMIT_SCRIPT = `
  local userCost = tonumber(ARGV[2])
  local user = redis.call('INCRBY', KEYS[1], userCost)
  if user == userCost or redis.call('TTL', KEYS[1]) == -1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  local globalCost = tonumber(ARGV[3])
  local global = 0
  if globalCost > 0 then
    global = redis.call('INCRBY', KEYS[2], globalCost)
    if global == globalCost or redis.call('TTL', KEYS[2]) == -1 then redis.call('EXPIRE', KEYS[2], ARGV[1]) end
  end
  return {user, global}
`

export const PROVIDER_REFERERS: Record<string, string> = {
  DANBOORU: `${PROVIDER_URLS.DANBOORU}/`,
  AIBOORU: `${PROVIDER_URLS.AIBOORU}/`,
  RULE34: `${PROVIDER_URLS.RULE34_WEB}/`,
  E621: `${PROVIDER_URLS.E621}/`,
  GELBOORU: `${PROVIDER_URLS.GELBOORU}/`,
}
