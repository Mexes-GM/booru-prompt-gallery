import { BaseBooruProvider } from '../base'
import { BooruPost, SearchOptions } from '../types'
import { PROVIDER_URLS, PROVIDER_REFERERS } from '@/lib/constants'

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
    protected defaultParams = {
        limit: "20",
        page: "dapi",
        s: "post",
        q: "index",
        json: "1"
    }

    private apiKey = process.env.GELBOORU_API_KEY || ''
    private userId = process.env.GELBOORU_USER_ID || ''

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

        let rawResponse: GelbooruResponse

        try {
            const urlParams = new URLSearchParams(params)
            const requestUrl = `${this.baseUrl}/index.php?${urlParams.toString()}`
            rawResponse = await this.fetchJson<GelbooruResponse>(`${this.baseUrl}/index.php`, urlParams, {
                'Referer': PROVIDER_REFERERS.GELBOORU,
            })
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e))
            console.error("[Gelbooru] JSON fetch failed for tags:", tags, "Error:", error.message)
            if (error.cause) console.error("[Gelbooru] Cause:", error.cause)
            return []
        }

        // Gelbooru wraps results in { "@attributes": {...}, "post": [...] }
        let postsList: GelbooruPostResponse[] = []
        if (rawResponse && rawResponse.post) {
            postsList = Array.isArray(rawResponse.post) ? rawResponse.post : [rawResponse.post]
        } else if (Array.isArray(rawResponse)) {
            postsList = rawResponse as GelbooruPostResponse[]
        }

        const validPosts = this.filterValidPosts<GelbooruPostResponse>(postsList)

        const finalPosts = validPosts.map((post: GelbooruPostResponse) => ({
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
        
        return this.enrichPostsWithCategories(finalPosts)
    }
}
