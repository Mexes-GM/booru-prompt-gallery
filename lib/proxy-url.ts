const CLOUDFLARE_WORKER_URL = process.env.NEXT_PUBLIC_IMAGE_PROXY_URL || ''

const PROXY_AVAILABLE = Boolean(CLOUDFLARE_WORKER_URL)

export function getProxyUrl(imageUrl: string): string {
  if (!PROXY_AVAILABLE) return imageUrl
  return `${CLOUDFLARE_WORKER_URL}?url=${encodeURIComponent(imageUrl)}`
}

// Aliased for backwards compatibility in existing components
export const getDanbooruProxyUrl = getProxyUrl
export const getGelbooruProxyUrl = getProxyUrl
