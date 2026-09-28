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

// Builds the "view original post" URL for a post. The provider is the source of
// truth; `isAiPost` (ai_metadata presence) is only a fallback for Danbooru-shaped
// posts that actually live on Aibooru. Shared by the web card and the Pocket card.
export function getPostUrl(provider: string, id: number | string, isAiPost = false): string {
  switch (provider) {
    case 'aibooru': return PROVIDER_POST_URLS.AIBOORU(id)
    case 'rule34': return PROVIDER_POST_URLS.RULE34(id)
    case 'e621': return PROVIDER_POST_URLS.E621(id)
    case 'gelbooru': return PROVIDER_POST_URLS.GELBOORU(id)
    case 'danbooru': return isAiPost ? PROVIDER_POST_URLS.AIBOORU(id) : PROVIDER_POST_URLS.DANBOORU(id)
    default: return PROVIDER_POST_URLS.DANBOORU(id)
  }
}

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

// Builds an external URL to a tag's wiki page on the provider's website — the
// human-written definition/description of what the tag means, as opposed to
// getProviderSearchUrl (which browses posts carrying the tag). Useful for
// disambiguating an unfamiliar tag before classifying it.
export function getProviderWikiUrl(provider: string, tag: string): string {
  // Wiki page paths use underscores (Danbooru/Gelbooru/e621 wiki slugs mirror
  // the tag's underscore form), unlike the query-string search URLs above.
  const slug = encodeURIComponent(tag.trim().replace(/\s+/g, '_'))
  switch (provider.toLowerCase()) {
    case 'danbooru':
      return `${PROVIDER_URLS.DANBOORU}/wiki_pages/${slug}`
    case 'aibooru':
      return `${PROVIDER_URLS.AIBOORU}/wiki_pages/${slug}`
    case 'rule34':
      // Rule34 has no first-party wiki; Gelbooru's wiki is the closest common
      // reference for the same tag vocabulary across gelbooru-engine boorus.
      return `${PROVIDER_URLS.GELBOORU}/index.php?page=wiki&s=view&title=${slug}`
    case 'e621':
      return `${PROVIDER_URLS.E621}/wiki_pages/${slug}`
    case 'gelbooru':
      return `${PROVIDER_URLS.GELBOORU}/index.php?page=wiki&s=view&title=${slug}`
    default:
      return `${PROVIDER_URLS.DANBOORU}/wiki_pages/${slug}`
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

// Centralized outbound identity for every booru request. Danbooru asks API
// clients for a descriptive User-Agent and e621 requires a way to contact the
// operator (browsers cannot set User-Agent, so direct e621 calls send it as the
// `_client` param instead). Mirror of workers/booru-image-proxy/src/lib/constants.ts.
export const APP_CONTACT_URL = 'https://booru-prompt-gallery.com'
export const USER_AGENT = `Boorugallery/10.0 (+${APP_CONTACT_URL})`

// Danbooru-specific User-Agent — identifies the Danbooru account so admins can contact us.
// Set DANBOORU_USERNAME env var to include your account name in the User-Agent.
export function getDanbooruUserAgent(): string {
  const username = process.env.DANBOORU_USERNAME
  return username
    ? `Boorugallery/10.0 (+${APP_CONTACT_URL}; Danbooru user: ${username})`
    : USER_AGENT
}

/**
 * Headers for a server-side Danbooru **API** request. The only place the
 * Danbooru API key is attached, so it can never reach another host.
 */
export function danbooruApiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': getDanbooruUserAgent(),
    Accept: 'application/json',
  }
  const username = process.env.DANBOORU_USERNAME
  const apiKey = process.env.DANBOORU_API_KEY
  if (username && apiKey) {
    headers['Authorization'] = `Basic ${btoa(`${username}:${apiKey}`)}`
  }
  return headers
}

// Image/file CDN hosts the download proxy may fetch — never API/site hosts, so
// the proxy cannot be used to read provider API pages. Mirror of the Worker's
// isAllowedImageHost (workers/booru-image-proxy/src/lib/constants.ts).
const IMAGE_HOSTS = new Set([
  'cdn.donmai.us',
  'cdn.aibooru.download',
  'static1.e621.net',
  'static1.e926.net',
  'img1.gelbooru.com', 'img2.gelbooru.com', 'img3.gelbooru.com',
  'img4.gelbooru.com', 'img5.gelbooru.com', 'video-cdn1.gelbooru.com',
  'video-cdn2.gelbooru.com', 'video-cdn3.gelbooru.com', 'video-cdn4.gelbooru.com',
])
const NON_IMAGE_RULE34_HOSTS = new Set(['api.rule34.xxx', 'rule34.xxx', 'www.rule34.xxx'])

export function isAllowedImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (NON_IMAGE_RULE34_HOSTS.has(host)) return false
  return IMAGE_HOSTS.has(host) || host.endsWith('.rule34.xxx')
}

/** True for a Content-Type the download proxy may relay. */
export function isMediaContentType(contentType: string | null): boolean {
  if (!contentType) return false
  const type = contentType.split(';')[0].trim().toLowerCase()
  return type.startsWith('image/') || type.startsWith('video/')
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
  BUY_ME_A_COFFEE: 'https://buymeacoffee.com/Mexes',
  GITHUB: 'https://github.com/Mexes-GM/booru-prompt-gallery',
  NETLIFY: 'https://booru-prompt-gallery.netlify.app',
  // Primary Vercel deployment (default vercel.app domain — always resolvable).
  VERCEL: 'https://booru-prompt-gallery.vercel.app',
} as const

// Site URL
export const SITE_URL = 'https://booru-prompt-gallery.com'
