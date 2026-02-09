import { BaseBooruProvider } from '../base'
import { BooruPost, SearchOptions } from '../types'

export class GelbooruProvider extends BaseBooruProvider {
    protected baseUrl = "https://gelbooru.com"
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

        let rawResponse: any

        try {
            const urlParams = new URLSearchParams(params)
            rawResponse = await this.fetchJson<any>(`${this.baseUrl}/index.php`, urlParams, {
                'Referer': 'https://gelbooru.com/',
            })
        } catch (e) {
            console.error("Gelbooru JSON fetch failed", e)
            return []
        }

        // Gelbooru wraps results in { "@attributes": {...}, "post": [...] }
        let postsList: any[] = []
        if (rawResponse && rawResponse.post) {
            postsList = Array.isArray(rawResponse.post) ? rawResponse.post : [rawResponse.post]
        } else if (Array.isArray(rawResponse)) {
            postsList = rawResponse
        }

        const validPosts = this.filterValidPosts(postsList)

        return validPosts.map((post: any) => ({
            id: parseInt(post.id),
            file_url: post.file_url,
            large_file_url: post.sample_url || post.file_url,
            preview_file_url: post.preview_url || post.file_url,
            tag_string: post.tags,
            tag_string_artist: '',
            tag_string_character: '',
            tag_string_copyright: '',
            rating: post.rating,
            score: parseInt(post.score),
            width: parseInt(post.width),
            height: parseInt(post.height),
            source: post.source || '',
        }))
    }
}
