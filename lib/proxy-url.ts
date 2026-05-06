const CLOUDFLARE_WORKER_URL = process.env.NEXT_PUBLIC_IMAGE_PROXY_URL || 'https://booru-image-proxy.example.workers.dev'

const proxyUrlCache = new Map<string, string>()

export function getDanbooruProxyUrl(imageUrl: string): string {
  const cached = proxyUrlCache.get(imageUrl)
  if (cached) return cached
  const url = `${CLOUDFLARE_WORKER_URL}?url=${encodeURIComponent(imageUrl)}`
  proxyUrlCache.set(imageUrl, url)
  return url
}

export function getGelbooruProxyUrl(imageUrl: string): string {
  // Uses same Cloudflare Worker as Danbooru — worker already handles Gelbooru domains.
  // This avoids consuming Netlify/Vercel bandwidth and CPU for image proxying.
  const cached = proxyUrlCache.get(imageUrl)
  if (cached) return cached
  const url = `${CLOUDFLARE_WORKER_URL}?url=${encodeURIComponent(imageUrl)}`
  proxyUrlCache.set(imageUrl, url)
  return url
}

export function getVercelProxyUrl(imageUrl: string): string {
  return `/api/image-proxy?url=${encodeURIComponent(imageUrl)}`
}
