
import { smartFetch } from '../network/smart-fetch'
import { BooruPost, IBooruProvider, SearchOptions } from './types'

export abstract class BaseBooruProvider implements IBooruProvider {
  protected abstract baseUrl: string
  protected abstract defaultParams: Record<string, string>

  abstract search(options: SearchOptions): Promise<BooruPost[]>

  protected async fetchJson<T>(url: string, params: URLSearchParams, headers: HeadersInit = {}): Promise<T> {
    const finalUrl = new URL(url)
    finalUrl.search = params.toString()

    const response = await smartFetch(finalUrl.toString(), {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'BooruPromptGallery/1.0',
        ...headers
      },
      retries: 2,
      timeout: 12000 // 12s timeout
    })

    if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`)
    }
    
    const text = await response.text()
    if (!text || text.trim().length === 0) {
        return [] as any
    }

    try {
        return JSON.parse(text)
    } catch (e) {
        console.error('JSON Parse Error:', text.substring(0, 100))
        throw new Error('Invalid JSON response from provider')
    }
  }

  protected filterValidPosts(posts: any[]): any[] {
    return posts.filter(post => 
      post && 
      post.file_url && 
      !post.file_url.includes("deleted") && 
      post.id && 
      (post.tag_string || post.tags) &&
      !post.file_url.match(/\.(mp4|webm|avi|mov|mkv)$/i)
    )
  }
}
