import { BaseBooruProvider } from '../base'
import { BooruPost, SearchOptions } from '../types'
import { PROVIDER_URLS, PROVIDER_REFERERS } from '../../constants'
import type { ProviderEnv } from '../factory'
import type { SupabaseClient } from '@supabase/supabase-js'

interface GelbooruPostResponse {
  id: string | number
  file_url: string
  sample_url?: string
  preview_url?: string
  tags: string
  rating: string
  score: string | number
  width: string | number
  height: string | number
  source?: string
}

interface GelbooruResponse {
  post?: GelbooruPostResponse | GelbooruPostResponse[]
  [key: string]: unknown
}

export class GelbooruProvider extends BaseBooruProvider {
  protected baseUrl = PROVIDER_URLS.GELBOORU
  protected defaultParams = { limit: '100', page: 'dapi', s: 'post', q: 'index', json: '1' }

  private apiKey: string
  private userId: string
  private supabase: SupabaseClient | null

  constructor(env?: ProviderEnv, supabase?: SupabaseClient | null) {
    super()
    this.apiKey = env?.GELBOORU_API_KEY || ''
    this.userId = env?.GELBOORU_USER_ID || ''
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

    let rawResponse: GelbooruResponse
    try {
      const urlParams = new URLSearchParams(params)
      rawResponse = await this.fetchJson<GelbooruResponse>(
        `${this.baseUrl}/index.php`,
        urlParams,
        { Referer: PROVIDER_REFERERS.GELBOORU }
      )
    } catch (e) {
      console.error('[Gelbooru] fetch failed:', e)
      return []
    }

    let postsList: GelbooruPostResponse[] = []
    if (rawResponse?.post) {
      postsList = Array.isArray(rawResponse.post) ? rawResponse.post : [rawResponse.post]
    } else if (Array.isArray(rawResponse)) {
      postsList = rawResponse as GelbooruPostResponse[]
    }

    const validPosts = this.filterValidPosts<GelbooruPostResponse>(postsList)
    const finalPosts: BooruPost[] = validPosts.map((post) => ({
      id: parseInt(String(post.id)),
      file_url: post.file_url,
      large_file_url: post.sample_url || post.file_url,
      preview_file_url: post.preview_url || post.file_url,
      tag_string: post.tags,
      tag_string_artist: '',
      tag_string_character: '',
      tag_string_copyright: '',
      rating: post.rating,
      score: parseInt(String(post.score)),
      width: parseInt(String(post.width)),
      height: parseInt(String(post.height)),
      source: post.source || '',
    }))

    return this.enrichPostsWithCategories(finalPosts, this.supabase)
  }
}
