import { BaseBooruProvider } from '../base'
import { BooruPost, SearchOptions } from '../types'
import { PROVIDER_URLS, USER_AGENT } from '../../constants'

interface E621FileData {
  url?: string
  width?: number
  height?: number
}

interface E621TagsData {
  general?: string[]
  species?: string[]
  character?: string[]
  copyright?: string[]
  artist?: string[]
  lore?: string[]
}

interface E621PostData {
  id: number
  file?: E621FileData
  sample?: E621FileData
  preview?: E621FileData
  tags?: E621TagsData
  rating: string
  score?: { total: number }
  sources?: string[]
}

interface E621Response {
  posts: E621PostData[]
}

export class E621Provider extends BaseBooruProvider {
  protected baseUrl = PROVIDER_URLS.E621
  protected defaultParams = { limit: '100' }

  async search(options: SearchOptions): Promise<BooruPost[]> {
    const params = new URLSearchParams(this.defaultParams)
    params.set('page', options.page || '1')
    if (options.limit) {
      params.set('limit', options.limit)
    }
    params.set('_client', USER_AGENT)

    let tags = (options.tags || '').trim()
    if (options.order === 'popular') tags += ' order:score'
    else if (options.order === 'random') tags += ' order:random'
    if (tags) params.set('tags', tags.trim())

    try {
      const data = await this.fetchJson<E621Response>(`${this.baseUrl}/posts.json`, params)

      if (!data?.posts) return []

      const contentCategories: (keyof E621TagsData)[] = [
        'general', 'species', 'character', 'copyright', 'artist', 'lore',
      ]

      const mappedPosts: BooruPost[] = data.posts.map((post) => {
        const tagsObj = post.tags || {}
        const allTags: string[] = []
        contentCategories.forEach((cat) => {
          if (tagsObj[cat]) allTags.push(...tagsObj[cat])
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
          source: post.sources?.[0] || '',
        }
      })

      return this.filterValidPosts(mappedPosts)
    } catch (error) {
      console.error('[E621] fetch error:', error)
      throw error
    }
  }
}
