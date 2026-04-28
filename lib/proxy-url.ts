const CLOUDFLARE_WORKER_URL = 'https://booru-image-proxy.mexesmexecution.workers.dev'

const proxyUrlCache = new Map<string, string>()

export function getDanbooruProxyUrl(imageUrl: string): string {
  const cached = proxyUrlCache.get(imageUrl)
  if (cached) return cached
  const url = `${CLOUDFLARE_WORKER_URL}?url=${encodeURIComponent(imageUrl)}`
  proxyUrlCache.set(imageUrl, url)
  return url
}

export function getVercelProxyUrl(imageUrl: string): string {
  return `/api/image-proxy?url=${encodeURIComponent(imageUrl)}`
}
