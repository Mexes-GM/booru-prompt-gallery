import { BaseBooruProvider } from '../base'
import { BooruPost, SearchOptions } from '../types'

export class E621Provider extends BaseBooruProvider {
  protected baseUrl = 'https://e621.net'
  protected defaultParams = {
    limit: '20'
  }

  async search(options: SearchOptions): Promise<BooruPost[]> {
    const params = new URLSearchParams(this.defaultParams)
    params.set('page', options.page || '1')
    // E621 requests a descriptive User-Agent or client parameter
    params.set('_client', 'BooruPromptGallery/1.0')

    let tags = (options.tags || '').trim()
    
    // Handle ordering options
    if (options.order === 'popular') {
      tags += ' order:score'
    } else if (options.order === 'random') {
      tags += ' order:random'
    }
    // 'recent' implies default order (id desc)

    if (tags) {
      params.set('tags', tags.trim())
    }

    try {
      // E621 returns { posts: [...] }
      const data = await this.fetchJson<{ posts: any[] }>(
        `${this.baseUrl}/posts.json`, 
        params
      )

      if (!data || !data.posts) {
        return []
      }

      const mappedPosts = data.posts.map((post: any) => {
        // Collect all content tags into a single list for tag_string
        // We explicitly EXCLUDE 'meta' and 'invalid' categories to act like a pre-cleaned Danbooru
        // We INCLUDE 'species' as they are important content tags
        const contentCategories = ['general', 'species', 'character', 'copyright', 'artist', 'lore']
        const allTags: string[] = []
        
        const tagsObj = post.tags || {}
        contentCategories.forEach(cat => {
            if (tagsObj[cat]) {
                allTags.push(...tagsObj[cat])
            }
        })
        
        return {
          id: post.id,
          file_url: post.file?.url || '',
          large_file_url: post.sample?.url || post.file?.url || '',
          preview_file_url: post.preview?.url || post.file?.url || '',
          tag_string: allTags.join(' '),
          tag_string_artist: (post.tags?.artist || []).join(' '),
          tag_string_character: (post.tags?.character || []).join(' '),
          tag_string_copyright: (post.tags?.copyright || []).join(' '),
          rating: post.rating,
          score: post.score?.total ?? 0,
          width: post.file?.width ?? 0,
          height: post.file?.height ?? 0,
          source: post.sources?.[0] || ''
        } as BooruPost
      })
      
      return this.filterValidPosts(mappedPosts)
    } catch (error) {
      console.error('E621 Data Fetch Error:', error)
      throw error
    }
  }
}
