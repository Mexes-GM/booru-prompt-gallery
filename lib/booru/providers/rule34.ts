
import { BaseBooruProvider } from '../base'
import { BooruPost, SearchOptions } from '../types'
import { PROVIDER_URLS, PROVIDER_REFERERS } from '@/lib/constants'

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
  protected defaultParams = {
    limit: "20",
    page: "dapi",
    s: "post",
    q: "index",
    json: "1"
  }
  
  private apiKey = process.env.RULE34_API_KEY || ''
  private userId = process.env.RULE34_USER_ID || ''
  
  private userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ]

  async search(options: SearchOptions): Promise<BooruPost[]> {
    const { tags, page, order } = options
    
    const pageNum = parseInt(page, 10)
    const pid = Math.max(0, pageNum - 1).toString()

    let finalTags = tags
    if (order === 'popular') {
      finalTags = tags ? `${tags} sort:score` : 'sort:score'
    } else if (order === 'random') {
      // Rule34 uses sort:random, but we should also ensure limit is respected if needed
      // Rule34 default limit is 20 (set in defaultParams)
      finalTags = tags ? `${tags} sort:random` : 'sort:random'
    }

    const params: Record<string, string> = {
      ...this.defaultParams,
      pid,
      tags: finalTags,
    }

    if (this.apiKey && this.userId) {
      params.api_key = this.apiKey
      params.user_id = this.userId
    }

    const randomUserAgent = this.userAgents[Math.floor(Math.random() * this.userAgents.length)]
    
    let rawPosts: unknown = []
    
    try {
        const urlParams = new URLSearchParams(params)
        rawPosts = await this.fetchJson<unknown>(`${this.baseUrl}/index.php`, urlParams, {
            'User-Agent': randomUserAgent,
            'Referer': PROVIDER_REFERERS.RULE34,
            'Origin': PROVIDER_REFERERS.RULE34.replace(/\/$/, ''),
        })
    } catch (e) {
        console.error("Rule34 JSON fetch failed", e)
        return []
    }

    let postsList: Rule34PostResponse[] = []
    if (Array.isArray(rawPosts)) {
        postsList = rawPosts as Rule34PostResponse[]
    } else if (rawPosts && typeof rawPosts === 'object' && 'post' in rawPosts) {
        const postProp = (rawPosts as { post: unknown }).post
        postsList = Array.isArray(postProp) ? (postProp as Rule34PostResponse[]) : [postProp as Rule34PostResponse]
    }

    const validPosts = this.filterValidPosts<Rule34PostResponse>(postsList)

    const finalPosts = validPosts.map((post: Rule34PostResponse) => ({
      id: parseInt(String(post.id)),
      file_url: post.file_url,
      large_file_url: post.sample_url || post.file_url,
      preview_file_url: post.preview_url || post.preview_file_url || post.file_url,
      tag_string: post.tags,
      tag_string_artist: '',
      tag_string_character: '',
      tag_string_copyright: '',
      rating: post.rating,
      score: parseInt(String(post.score)),
      width: parseInt(String(post.width)),
      height: parseInt(String(post.height)),
    }))

    return this.enrichPostsWithCategories(finalPosts)
  }
}
