import { BaseBooruProvider } from '../base'
import { BooruPost, SearchOptions } from '../types'
import { PROVIDER_URLS, PROVIDER_REFERERS } from '../../constants'
import type { ProviderEnv } from '../factory'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '../../../logger'
import { decodeTagEntities, toTagLookupKey } from '../tag-lookup'
import { UpstreamError } from '../../upstream'

interface Rule34TagInfo {
  tag: string
  /** Rule34's own type: tag, artist, character, copyright, metadata... */
  type: string
}

interface Rule34PostResponse {
  id: string | number
  file_url: string
  sample_url?: string
  preview_url?: string
  preview_file_url?: string
  tags: string
  rating: string
  score: string | number
  width: string | number
  height: string | number
  /** Present with `fields=tag_info`. */
  tag_info?: Rule34TagInfo[]
}

// ---------------------------------------------------------------------------
// Rule34's own tag types.
//
// With `fields=tag_info` every post carries the type Rule34 gives each of its
// tags, at no extra request. They file the names neither category table knows
// yet: a new artist (`zynox`) or a character tagged "name_(series)"
// (`sugar_(fortnite)`), which otherwise reached the prompt as content. Only the
// name types are taken: Rule34's `metadata` also holds visual tags (`pinup`,
// `jack-o_pose`), so meta stays with the curated tables. Kept per isolate for
// an hour, so a later enrich() of the same posts (the favorites batch) still
// has them.
// ---------------------------------------------------------------------------
const RULE34_NAME_CATEGORIES: Record<string, number> = { artist: 1, copyright: 3, character: 4 }
const TYPE_CACHE_TTL_MS = 60 * 60 * 1000
const TYPE_CACHE_MAX = 50_000
const typeCache = new Map<string, { category: number; at: number }>()

/** Remembers the name types the posts' `tag_info` gives (and forgets tags Rule34 now types as content). */
export function rememberRule34Types(posts: Pick<Rule34PostResponse, 'tag_info'>[], now = Date.now()): void {
  for (const post of posts) {
    for (const info of post.tag_info ?? []) {
      if (!info?.tag) continue
      const key = toTagLookupKey(info.tag)
      const category = RULE34_NAME_CATEGORIES[String(info.type)]
      typeCache.delete(key) // re-insert at the end so eviction stays oldest-first
      if (category !== undefined) typeCache.set(key, { category, at: now })
    }
  }
  if (typeCache.size > TYPE_CACHE_MAX) {
    let excess = typeCache.size - TYPE_CACHE_MAX
    for (const key of typeCache.keys()) {
      if (excess-- <= 0) break
      typeCache.delete(key)
    }
  }
}

/** The remembered Rule34 name types of the posts' tags, keyed by `toTagLookupKey`. */
export function rule34TypesFor(posts: BooruPost[], now = Date.now()): Map<string, number> {
  const types = new Map<string, number>()
  for (const post of posts) {
    for (const tag of post.tag_string?.split(/\s+/) ?? []) {
      const key = toTagLookupKey(tag)
      const entry = key ? typeCache.get(key) : undefined
      if (entry && now - entry.at < TYPE_CACHE_TTL_MS) types.set(key, entry.category)
    }
  }
  return types
}

export class Rule34Provider extends BaseBooruProvider {
  protected baseUrl = PROVIDER_URLS.RULE34
  protected defaultParams = { limit: '100', page: 'dapi', s: 'post', q: 'index', json: '1', fields: 'tag_info' }

  private apiKey: string
  private userId: string
  private supabase: SupabaseClient | null

  constructor(env?: ProviderEnv, supabase?: SupabaseClient | null) {
    super()
    this.apiKey = env?.RULE34_API_KEY || ''
    this.userId = env?.RULE34_USER_ID || ''
    this.supabase = supabase || null
  }

  async search(options: SearchOptions): Promise<BooruPost[]> {
    const { tags, page, order } = options

    const pageNum = parseInt(page, 10)
    const pid = Math.max(0, pageNum - 1).toString()

    let finalTags = tags ? tags.trim() : ''
    if (!finalTags.includes('-video')) {
      finalTags = finalTags ? `${finalTags} -video` : '-video'
    }

    if (order === 'popular') {
      finalTags = `${finalTags} sort:score`
    } else if (order === 'random') {
      finalTags = `${finalTags} sort:random`
    }

    const params: Record<string, string> = { ...this.defaultParams, pid, tags: finalTags }
    if (options.limit) {
      params.limit = options.limit
    }
    if (this.apiKey && this.userId) {
      params.api_key = this.apiKey
      params.user_id = this.userId
    }

    let rawPosts: unknown = []
    try {
      const urlParams = new URLSearchParams(params)
      rawPosts = await this.fetchJson<unknown>(`${this.baseUrl}/index.php`, urlParams, {
        Referer: PROVIDER_REFERERS.RULE34,
        Origin: PROVIDER_REFERERS.RULE34.replace(/\/$/, ''),
      })
    } catch (e) {
      // Rethrow (see gelbooru.ts): an empty array would be cached and read by
      // the client as "no more results".
      logger.warn('rule34_fetch_error', {
        error: e instanceof Error ? e.message : String(e),
      })
      throw e
    }

    // Rule34 reports auth/quota problems as a 200 with a bare JSON string
    // ("Missing authentication. …") — treat it as a failure, not an empty page.
    if (typeof rawPosts === 'string') {
      logger.warn('rule34_fetch_error', { error: rawPosts.slice(0, 200) })
      throw new UpstreamError('Rule34 rejected the request', 401)
    }

    let postsList: Rule34PostResponse[] = []
    if (Array.isArray(rawPosts)) {
      postsList = rawPosts as Rule34PostResponse[]
    } else if (rawPosts && typeof rawPosts === 'object' && 'post' in rawPosts) {
      const postProp = (rawPosts as { post: unknown }).post
      postsList = Array.isArray(postProp)
        ? (postProp as Rule34PostResponse[])
        : [postProp as Rule34PostResponse]
    }

    const validPosts = this.filterValidPosts<Rule34PostResponse>(postsList)
    rememberRule34Types(validPosts)
    // `tag_info` is only read here: the posts handed on (and cached) stay as small as before.
    const finalPosts: BooruPost[] = validPosts.map((post) => ({
      id: parseInt(String(post.id)),
      file_url: post.file_url,
      large_file_url: post.sample_url || post.file_url,
      preview_file_url: post.preview_url || post.preview_file_url || post.file_url,
      tag_string: decodeTagEntities(post.tags),
      tag_string_artist: '',
      tag_string_character: '',
      tag_string_copyright: '',
      rating: post.rating,
      score: parseInt(String(post.score)),
      width: parseInt(String(post.width)),
      height: parseInt(String(post.height)),
    }))

    return options.enrich === false ? finalPosts : this.enrich(finalPosts)
  }

  override async enrich(posts: BooruPost[]): Promise<BooruPost[]> {
    return this.enrichPostsWithCategories(posts, this.supabase, 'rule34', rule34TypesFor(posts))
  }
}
