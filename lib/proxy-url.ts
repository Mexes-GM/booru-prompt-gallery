const CLOUDFLARE_WORKER_URL = 'https://booru-image-proxy.mexesmexecution.workers.dev'

export function getDanbooruProxyUrl(imageUrl: string): string {
  return `${CLOUDFLARE_WORKER_URL}?url=${encodeURIComponent(imageUrl)}`
}

export function getVercelProxyUrl(imageUrl: string): string {
  return `/api/image-proxy?url=${encodeURIComponent(imageUrl)}`
}
