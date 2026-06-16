// ── Image proxy routing ──
//
// Direct <img> (no proxy):
//   Aibooru (cdn.aibooru.download) — permissive CORS, no Referer needed
//   E621 (static1.e621.net)        — permissive CORS, no Referer needed
//
// Via /api/download (Netlify → origin, no cross-Cloudflare):
//   Danbooru (cdn.donmai.us)       — Cloudflare WAF blocks cross-origin browser
//                                     requests AND cross-Cloudflare Worker fetches.
//                                     Netlify's AWS IP reaches it fine.
//
// Via CF Worker (anti-hotlink Referer injection):
//   Gelbooru (img1-5.gelbooru.com) — requires Referer: https://gelbooru.com/
//                                     Worker injects it. Gelbooru CDN is NOT
//                                     behind Cloudflare so no cross-blocking.
//   Rule34                          — untested, keep proxied via Worker

const CLOUDFLARE_WORKER_URL = process.env.NEXT_PUBLIC_IMAGE_PROXY_URL || ''

const PROXY_AVAILABLE = Boolean(CLOUDFLARE_WORKER_URL)

// Domains that can be loaded directly (no Referer requirement, permissive CORS)
const DIRECT_DOMAINS = [
  'aibooru.online',
  'cdn.aibooru.download',
  'e621.net',
  'static1.e621.net',
]

// Domains that must go through the Netlify server proxy (/api/download?inline=1)
// because both the browser AND the CF Worker are blocked by Cloudflare WAF.
const NETLIFY_PROXY_DOMAINS = [
  'cdn.donmai.us',
  'danbooru.donmai.us',
]

function isDomain(url: string, domains: string[]): boolean {
  try {
    const hostname = new URL(url).hostname
    return domains.some(d => hostname === d || hostname.endsWith(`.${d}`))
  } catch {
    return false
  }
}

function proxyUrl(imageUrl: string): string {
  if (!PROXY_AVAILABLE) return imageUrl
  // Direct — no proxy needed
  if (isDomain(imageUrl, DIRECT_DOMAINS)) return imageUrl
  // Netlify server proxy — avoids cross-Cloudflare blocking
  if (isDomain(imageUrl, NETLIFY_PROXY_DOMAINS)) {
    return `/api/download?url=${encodeURIComponent(imageUrl)}&inline=1`
  }
  // CF Worker — for Gelbooru/Rule34 (Referer injection, non-Cloudflare CDNs)
  return `${CLOUDFLARE_WORKER_URL}?url=${encodeURIComponent(imageUrl)}`
}

export function getDanbooruProxyUrl(imageUrl: string): string {
  return proxyUrl(imageUrl)
}

export function getGelbooruProxyUrl(imageUrl: string): string {
  return proxyUrl(imageUrl)
}
