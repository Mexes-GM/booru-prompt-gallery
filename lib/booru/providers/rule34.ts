
import { BaseBooruProvider } from '../base'
import { BooruPost, SearchOptions } from '../types'

export class Rule34Provider extends BaseBooruProvider {
  protected baseUrl = "https://api.rule34.xxx"
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
    
    let rawPosts: any[] = []
    
    try {
        const urlParams = new URLSearchParams(params)
        rawPosts = await this.fetchJson<any[]>(`${this.baseUrl}/index.php`, urlParams, {
            'User-Agent': randomUserAgent,
            'Referer': 'https://rule34.xxx/',
            'Origin': 'https://rule34.xxx',
        })
    } catch (e) {
        console.error("Rule34 JSON fetch failed", e)
        return []
    }

    let postsList = rawPosts
    // @ts-ignore
    if (rawPosts && !Array.isArray(rawPosts) && rawPosts.post) {
        // @ts-ignore
        postsList = Array.isArray(rawPosts.post) ? rawPosts.post : [rawPosts.post]
    } else if (!Array.isArray(rawPosts)) {
        postsList = []
    }

    const validPosts = this.filterValidPosts(postsList)

    return validPosts.map((post: any) => ({
      id: parseInt(post.id),
      file_url: post.file_url,
      large_file_url: post.sample_url || post.file_url,
      preview_file_url: post.preview_url || post.preview_file_url || post.file_url,
      tag_string: post.tags,
      tag_string_artist: '',
      tag_string_character: '',
      tag_string_copyright: '',
      rating: post.rating,
      score: parseInt(post.score),
    }))
  }
}
