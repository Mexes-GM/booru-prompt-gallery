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
} as const

// Site URL
export const SITE_URL = 'https://booru-prompt-gallery.com'
