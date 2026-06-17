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

export const USER_AGENT = 'Boorugallery/9.2'

export function getDanbooruUserAgent(username?: string): string {
  return username
    ? `Boorugallery/9.2 (Danbooru user: ${username})`
    : 'Boorugallery/9.2'
}

// Single EVAL that atomically INCR+EXPIRE both per-IP and global rate-limit keys.
// Replaces two separate incrWithExpire() calls → ~30% fewer Redis commands on the Danbooru hot path.
export const MERGED_RATELIMIT_SCRIPT = `
  local user = redis.call('INCR', KEYS[1])
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  local global = redis.call('INCR', KEYS[2])
  redis.call('EXPIRE', KEYS[2], ARGV[1])
  return {user, global}
`

export const PROVIDER_REFERERS: Record<string, string> = {
  DANBOORU: `${PROVIDER_URLS.DANBOORU}/`,
  AIBOORU: `${PROVIDER_URLS.AIBOORU}/`,
  RULE34: `${PROVIDER_URLS.RULE34_WEB}/`,
  E621: `${PROVIDER_URLS.E621}/`,
  GELBOORU: `${PROVIDER_URLS.GELBOORU}/`,
}
