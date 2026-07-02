// Centralized constants for the Booru Prompt Gallery application

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

// Provider post URL patterns
export const PROVIDER_POST_URLS = {
  DANBOORU: (id: number | string) => `${PROVIDER_URLS.DANBOORU}/posts/${id}`,
  AIBOORU: (id: number | string) => `${PROVIDER_URLS.AIBOORU}/posts/${id}`,
  RULE34: (id: number | string) => `${PROVIDER_URLS.RULE34_WEB}/index.php?page=post&s=view&id=${id}`,
  E621: (id: number | string) => `${PROVIDER_URLS.E621}/posts/${id}`,
  GELBOORU: (id: number | string) => `${PROVIDER_URLS.GELBOORU}/index.php?page=post&s=view&id=${id}`,
} as const

// Builds an external URL to browse posts tagged with a specific tag on the provider's website
export function getProviderSearchUrl(provider: string, tag: string): string {
  const encoded = encodeURIComponent(tag)
  switch (provider.toLowerCase()) {
    case 'danbooru':
      return `${PROVIDER_URLS.DANBOORU}/posts?tags=${encoded}`
    case 'aibooru':
      return `${PROVIDER_URLS.AIBOORU}/posts?tags=${encoded}`
    case 'rule34':
      return `${PROVIDER_URLS.RULE34_WEB}/index.php?page=post&s=list&tags=${encoded}`
    case 'e621':
      return `${PROVIDER_URLS.E621}/posts?tags=${encoded}`
    case 'gelbooru':
      return `${PROVIDER_URLS.GELBOORU}/index.php?page=post&s=list&tags=${encoded}`
    default:
      return `${PROVIDER_URLS.DANBOORU}/posts?tags=${encoded}`
  }
}

// Generic artist tags that aren't useful to save as specific artists
const GENERIC_ARTIST_TAGS = new Set([
  'unknown_artist',
  'artist_request',
  'anonymous',
  'anonymous_artist',
  'third-party_edit',
  'third_party_edit',
  'artist_name',
  'banned_artist',
])

// Splits a provider's artist tag string into individual tags, filtering out empty/generic ones
export function parseArtistTags(tagStringArtist: string | null | undefined): string[] {
  if (!tagStringArtist) return []
  return tagStringArtist
    .split(/\s+/)
    .map(t => t.trim())
    .filter(Boolean)
    .filter(t => !GENERIC_ARTIST_TAGS.has(t.toLowerCase()))
}

export function isValidArtistTag(tag: string): boolean {
  if (!tag || !tag.trim()) return false
  return !GENERIC_ARTIST_TAGS.has(tag.trim().toLowerCase())
}

// Centralized User-Agent for all API requests
export const USER_AGENT = 'Boorugallery/9.2'

// Danbooru-specific User-Agent — identifies the Danbooru account so admins can contact us.
// Set DANBOORU_USERNAME env var to include your account name in the User-Agent.
export function getDanbooruUserAgent(): string {
  const username = process.env.DANBOORU_USERNAME
  return username
    ? `Boorugallery/9.2 (Danbooru user: ${username})`
    : 'Boorugallery/9.2'
}

// Provider referer URLs (for API requests)
export const PROVIDER_REFERERS: Record<string, string> = {
  DANBOORU: `${PROVIDER_URLS.DANBOORU}/`,
  AIBOORU: `${PROVIDER_URLS.AIBOORU}/`,
  RULE34: `${PROVIDER_URLS.RULE34_WEB}/`,
  E621: `${PROVIDER_URLS.E621}/`,
  GELBOORU: `${PROVIDER_URLS.GELBOORU}/`,
}

// Default blacklist tags
export const DEFAULT_BLACKLIST = ['guro', 'scat'] as const

// Support and social URLs
export const SOCIAL_URLS = {
  CIVITAI_PROFILE: 'https://civitai.com/user/Mexes',
  CIVITAI_ARTICLE: 'https://civitai.com/articles/17747',
  TENSOR_ART: 'https://tensor.art/u/616420638671868313',
  SEAART: 'https://www.seaart.ai/user/e9f2dc73eaf4495fce59838fea87187c?u_code=EUY1AJ3T',
  KO_FI: 'https://ko-fi.com/mexes',
  GITHUB: 'https://github.com/Mexes-GM/booru-prompt-gallery',
  NETLIFY: 'https://booru-prompt-gallery.netlify.app',
  // Primary Vercel deployment (default vercel.app domain — always resolvable).
  VERCEL: 'https://booru-prompt-gallery.vercel.app',
} as const

// Site URL
export const SITE_URL = 'https://booru-prompt-gallery.com'
