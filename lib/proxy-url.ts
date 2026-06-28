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

// ── weserv.nl image optimization (resize + AVIF/WebP) ──
//
// weserv (images.weserv.nl) is a free, no-signup image cache & resize service.
// It fetches the source image from its own servers, so it can ONLY be applied
// to publicly-fetchable origins. Danbooru (Cloudflare WAF) and Gelbooru
// (Referer-based hotlink protection) would fail if wrapped, so they are never
// routed through weserv — only DIRECT_DOMAINS (Aibooru, e621) are eligible.
//
// Opt-in: set NEXT_PUBLIC_WESERV_ENABLED=1. When disabled (default), every URL
// is returned untouched, so this is a zero-risk addition until you turn it on.
const WESERV_ENABLED = process.env.NEXT_PUBLIC_WESERV_ENABLED === '1'
const WESERV_BASE = 'https://images.weserv.nl/'

export interface ImageOptimizeOptions {
  /** Target width in px. Images are never upscaled (`we` flag). */
  width?: number
  /** Target height in px. */
  height?: number
  /** Output format. AVIF/WebP are far smaller than the original JPEG/PNG. */
  format?: 'webp' | 'avif' | 'jpg' | 'png' | 'original'
  /** Quality 1-100 (ignored for png). Default 80. */
  quality?: number
  /** Resize fit mode. Default 'inside' (preserve aspect ratio, no crop). */
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside'
}

function canUseWeserv(url: string): boolean {
  if (!WESERV_ENABLED) return false
  // Only absolute http(s) URLs from publicly-fetchable origins.
  if (!/^https?:\/\//i.test(url)) return false
  return isDomain(url, DIRECT_DOMAINS)
}

/**
 * Route a publicly-fetchable image URL through weserv.nl for on-the-fly
 * resizing and modern-format (WebP/AVIF) conversion.
 *
 * Returns the input unchanged when weserv is disabled or the origin is not
 * safely fetchable by weserv (Danbooru/Gelbooru), so it is always safe to call.
 */
export function optimizeImageUrl(url: string, opts: ImageOptimizeOptions = {}): string {
  if (!url || !canUseWeserv(url)) return url

  // weserv canonical form: drop the scheme, prefix https sources with `ssl:`.
  const stripped = url.replace(/^https:\/\//i, 'ssl:').replace(/^http:\/\//i, '')

  const params = new URLSearchParams()
  params.set('url', stripped)
  if (opts.width) params.set('w', String(opts.width))
  if (opts.height) params.set('h', String(opts.height))
  params.set('fit', opts.fit ?? 'inside')
  if ((opts.format ?? 'webp') !== 'original') {
    params.set('output', opts.format ?? 'webp')
  }
  params.set('q', String(opts.quality ?? 80))
  // `we` = without enlargement (never upscale smaller source images).
  params.set('we', '')

  return `${WESERV_BASE}?${params.toString()}`
}

function proxyUrl(imageUrl: string): string {
  if (!PROXY_AVAILABLE) return optimizeImageUrl(imageUrl)
  // Direct — no Referer/WAF concerns, so safe to optimize via weserv.
  if (isDomain(imageUrl, DIRECT_DOMAINS)) return optimizeImageUrl(imageUrl)
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
