const CLOUDFLARE_WORKER_URL = process.env.NEXT_PUBLIC_IMAGE_PROXY_URL || ''

const PROXY_AVAILABLE = Boolean(CLOUDFLARE_WORKER_URL)

const proxyUrlCache = new Map<string, string>()

export function getDanbooruProxyUrl(imageUrl: string): string {
  if (!PROXY_AVAILABLE) return imageUrl

  const cached = proxyUrlCache.get(imageUrl)
  if (cached) return cached
  const url = `${CLOUDFLARE_WORKER_URL}?url=${encodeURIComponent(imageUrl)}`
  proxyUrlCache.set(imageUrl, url)
  return url
}

export function getGelbooruProxyUrl(imageUrl: string): string {
  if (!PROXY_AVAILABLE) return imageUrl

  const cached = proxyUrlCache.get(imageUrl)
  if (cached) return cached
  const url = `${CLOUDFLARE_WORKER_URL}?url=${encodeURIComponent(imageUrl)}`
  proxyUrlCache.set(imageUrl, url)
  return url
}

export function getVercelProxyUrl(imageUrl: string): string {
  return `/api/image-proxy?url=${encodeURIComponent(imageUrl)}`
}
