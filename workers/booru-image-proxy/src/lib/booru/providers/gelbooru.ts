import { BaseBooruProvider } from '../base'
import { BooruPost, SearchOptions } from '../types'
import { PROVIDER_URLS, PROVIDER_REFERERS } from '../../constants'
import type { ProviderEnv } from '../factory'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '../../../logger'
import { decodeTagEntities } from '../tag-lookup'
import { UpstreamError } from '../../upstream'

// ── Direct / relay switch ───────────────────────────────────────────────
// Gelbooru sometimes throttles or blocks the Worker's network (every request
// answered with 429/403) while the same call from elsewhere works. When the
// relay (the app's /api/gelbooru-relay route) is configured, a blocked direct
// call is retried through it and the isolate stays on the relay for
// DIRECT_RETRY_MS; after that the next search tries direct again, so traffic
// moves back on its own once Gelbooru lets the Worker through.
// State is per isolate on purpose: a stale isolate costs one failed direct
// call every DIRECT_RETRY_MS, and no Redis command is spent on it.
export const DIRECT_RETRY_MS = 10 * 60_000
let directBlockedUntil = 0

/** True when a failed direct call means "use the relay", not a bad query. */
export function isDirectBlock(error: unknown): boolean {
  if (!(error instanceof UpstreamError)) return true
  return error.status === 403 || error.status === 429 || error.status >= 500
}

/** Test hook: forget a previous block. */
export function resetGelbooruRoute(): void {
  directBlockedUntil = 0
}

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
  private relayUrl: string
  private relaySecret: string
  private supabase: SupabaseClient | null

  constructor(env?: ProviderEnv, supabase?: SupabaseClient | null) {
    super()
    this.apiKey = env?.GELBOORU_API_KEY || ''
    this.userId = env?.GELBOORU_USER_ID || ''
    this.relayUrl = env?.GELBOORU_RELAY_URL || ''
    this.relaySecret = env?.GELBOORU_RELAY_SECRET || ''
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
      rawResponse = await this.fetchPosts(new URLSearchParams(params))
    } catch (e) {
      // Rethrow: returning [] here used to be cached for 10 min by the posts
      // route and read by the client as "no more results", which stopped
      // infinite scroll for everyone on a transient Gelbooru hiccup.
      logger.warn('gelbooru_fetch_error', {
        error: e instanceof Error ? e.message : String(e),
      })
      throw e
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
      tag_string: decodeTagEntities(post.tags),
      tag_string_artist: '',
      tag_string_character: '',
      tag_string_copyright: '',
      rating: post.rating,
      score: parseInt(String(post.score)),
      width: parseInt(String(post.width)),
      height: parseInt(String(post.height)),
      source: post.source || '',
    }))

    return options.enrich === false ? finalPosts : this.enrich(finalPosts)
  }

  private async fetchPosts(params: URLSearchParams): Promise<GelbooruResponse> {
    const hasRelay = Boolean(this.relayUrl && this.relaySecret)
    const viaRelay = () =>
      this.fetchJson<GelbooruResponse>(this.relayUrl, params, { 'x-relay-secret': this.relaySecret })

    if (hasRelay && Date.now() < directBlockedUntil) return viaRelay()

    try {
      const data = await this.fetchJson<GelbooruResponse>(
        `${this.baseUrl}/index.php`,
        params,
        { Referer: PROVIDER_REFERERS.GELBOORU },
        // With a relay to fall back on, don't spend a retry on a blocked call.
        hasRelay ? 0 : undefined
      )
      if (directBlockedUntil !== 0) {
        directBlockedUntil = 0
        logger.info('gelbooru_direct_recovered', {})
      }
      return data
    } catch (error) {
      if (!hasRelay || !isDirectBlock(error)) throw error
      directBlockedUntil = Date.now() + DIRECT_RETRY_MS
      logger.warn('gelbooru_direct_blocked', {
        status: error instanceof UpstreamError ? error.status : undefined,
        retryInMs: DIRECT_RETRY_MS,
      })
      return viaRelay()
    }
  }

  override async enrich(posts: BooruPost[]): Promise<BooruPost[]> {
    return this.enrichPostsWithCategories(posts, this.supabase)
  }
}
