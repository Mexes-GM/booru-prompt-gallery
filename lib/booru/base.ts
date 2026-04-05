
import { smartFetch } from '../network/smart-fetch'
import { BooruPost, IBooruProvider, SearchOptions } from './types'
import { supabaseAdmin } from '../supabase-admin'

interface TagCategoryRow {
  name: string
  category: number
}

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
        return [] as unknown as T
    }

    try {
        return JSON.parse(text) as T
    } catch (e) {
        console.error('JSON Parse Error:', text.substring(0, 100))
        throw new Error('Invalid JSON response from provider')
    }
  }

  protected filterValidPosts<T>(posts: T[]): T[] {
    return posts.filter(post => {
      if (!post || typeof post !== 'object') return false
      const p = post as Record<string, unknown>
      const fileUrl = p.file_url || p.sample_url || ''
      const tagString = p.tag_string || p.tags || ''
      return (
        fileUrl &&
        typeof fileUrl === 'string' &&
        !fileUrl.includes("deleted") && 
        p.id && 
        tagString &&
        !fileUrl.match(/\.(mp4|webm|avi|mov|mkv)$/i)
      )
    })
  }

  /**
    * Enriches posts from providers like Gelbooru and Rule34 that return flat tags.
    * It queries the Supabase `auto_suggest_tags` table to classify tags into artist/character/copyright correctly.
    */
  protected async enrichPostsWithCategories(posts: BooruPost[]): Promise<BooruPost[]> {
    if (!posts || posts.length === 0) return posts

    // Collect all unique tags
    const allTags = new Set<string>()
    posts.forEach(p => {
        if (p.tag_string) {
            p.tag_string.split(/\s+/).forEach(t => {
                if (t) allTags.add(t)
            })
        }
    })

    if (allTags.size === 0) return posts

    try {
        const uniqueTagsArray = Array.from(allTags)
        const CHUNK_SIZE = 100
        const tagMap = new Map<string, number>()

        // Fetch categories in chunks to avoid URL too long or PostgREST limits
        for (let i = 0; i < uniqueTagsArray.length; i += CHUNK_SIZE) {
            const chunk = uniqueTagsArray.slice(i, i + CHUNK_SIZE)
            const { data } = await supabaseAdmin
                .from('auto_suggest_tags')
                .select('name, category')
                .in('name', chunk)
            
            if (data) {
                data.forEach((row: TagCategoryRow) => tagMap.set(row.name, row.category))
            }
        }

        // Modifica posts en place o crea nuevos arrays
        return posts.map(post => {
            if (!post.tag_string) return post

            const tags = post.tag_string.split(/\s+/).filter(Boolean)
            const artistTags: string[] = []
            const characterTags: string[] = []
            const copyrightTags: string[] = []
            const metaTags: string[] = []

            tags.forEach(t => {
                const category = tagMap.get(t)
                if (category === 1) artistTags.push(t)
                else if (category === 3) copyrightTags.push(t)
                else if (category === 4) characterTags.push(t)
                else if (category === 5) metaTags.push(t)
            })

            return {
                ...post,
                tag_string_artist: artistTags.length > 0 ? artistTags.join(' ') : post.tag_string_artist,
                tag_string_character: characterTags.length > 0 ? characterTags.join(' ') : post.tag_string_character,
                tag_string_copyright: copyrightTags.length > 0 ? copyrightTags.join(' ') : post.tag_string_copyright,
                tag_string_meta: metaTags.length > 0 ? metaTags.join(' ') : post.tag_string_meta
            }
        })
    } catch (e) {
        console.error('Error enriching posts with categories:', e)
        return posts
    }
  }
}
