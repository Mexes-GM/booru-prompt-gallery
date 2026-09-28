import { BaseBooruProvider } from '../base'
import { BooruPost, SearchOptions } from '../types'
import { PROVIDER_URLS, danbooruApiHeaders } from '../../constants'
import type { ProviderEnv } from '../factory'

interface DanbooruPost {
  id: number
  file_url: string
  large_file_url: string
  preview_file_url: string
  tag_string: string
  tag_string_artist: string
  tag_string_character: string
  tag_string_copyright: string
  tag_string_meta?: string
  rating: string
  score: number
  image_width: number
  image_height: number
}

const DANBOORU_PAGE_SIZE = '30'

export class DanbooruProvider extends BaseBooruProvider {
  protected baseUrl = PROVIDER_URLS.DANBOORU
  protected defaultParams = {
    limit: DANBOORU_PAGE_SIZE,
    only: 'id,file_url,large_file_url,preview_file_url,tag_string,tag_string_artist,tag_string_character,tag_string_copyright,tag_string_meta,rating,score,image_width,image_height',
  }

  private env: ProviderEnv

  constructor(env?: ProviderEnv) {
    super()
    this.env = env ?? {}
  }

  async search(options: SearchOptions): Promise<BooruPost[]> {
    const { tags, page, order } = options

    let finalTags: string
    if (order === 'recent') {
      finalTags = tags || ''
    } else if (order === 'random') {
      const randomCount = DANBOORU_PAGE_SIZE
      const cleanTags = tags
        ? tags.replace(/order:random|random:\d+/gi, '').trim()
        : ''
      finalTags = cleanTags ? `${cleanTags} random:${randomCount}` : `random:${randomCount}`
    } else {
      finalTags = tags ? `${tags} order:rank` : 'order:rank'
    }

    const params = new URLSearchParams({
      ...this.defaultParams,
      page,
      tags: finalTags,
    })
    // Batch lookups (favorites: `id:1,2,…`) ask for up to 100 posts in one call.
    if (options.limit) params.set('limit', options.limit)

    const data = await this.fetchJson<DanbooruPost[]>(
      `${this.baseUrl}/posts.json`,
      params,
      danbooruApiHeaders(this.env)
    )

    const validPosts = this.filterValidPosts<DanbooruPost>(data)

    return validPosts.map((post) => ({
      id: post.id,
      file_url: post.file_url,
      large_file_url: post.large_file_url || post.file_url,
      preview_file_url: post.preview_file_url || post.file_url,
      tag_string: post.tag_string,
      tag_string_artist: post.tag_string_artist,
      tag_string_character: post.tag_string_character,
      tag_string_copyright: post.tag_string_copyright,
      tag_string_meta: post.tag_string_meta,
      rating: post.rating,
      score: post.score,
      width: post.image_width,
      height: post.image_height,
    }))
  }
}
