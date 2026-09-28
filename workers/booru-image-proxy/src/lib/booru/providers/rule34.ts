import { BaseBooruProvider } from '../base'
import { BooruPost, SearchOptions } from '../types'
import { PROVIDER_URLS, PROVIDER_REFERERS } from '../../constants'
import type { ProviderEnv } from '../factory'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '../../../logger'
import { decodeTagEntities } from '../tag-lookup'
import { UpstreamError } from '../../upstream'

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
}

export class Rule34Provider extends BaseBooruProvider {
  protected baseUrl = PROVIDER_URLS.RULE34
  protected defaultParams = { limit: '100', page: 'dapi', s: 'post', q: 'index', json: '1' }

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

    return this.enrichPostsWithCategories(finalPosts, this.supabase, 'rule34')
  }
}
