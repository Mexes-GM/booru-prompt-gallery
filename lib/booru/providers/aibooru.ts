
import { BaseBooruProvider } from '../base'
import { BooruPost, SearchOptions } from '../types'
import { PROVIDER_URLS, PROVIDER_REFERERS } from '@/lib/constants'

interface AibooruPost {
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
  ai_metadata?: {
    prompt?: string
    negative_prompt?: string
    model?: string
    steps?: number
    cfg_scale?: number
    sampler?: string
    seed?: number
  }
  image_width: number
  image_height: number
}

export class AibooruProvider extends BaseBooruProvider {
  protected baseUrl = PROVIDER_URLS.AIBOORU
  protected defaultParams = {
    limit: "20",
    only: "id,file_url,large_file_url,preview_file_url,tag_string,tag_string_artist,tag_string_character,tag_string_copyright,tag_string_meta,rating,score,ai_metadata,image_width,image_height",
  }

  async search(options: SearchOptions): Promise<BooruPost[]> {
    const { tags, page, order, hasPrompt } = options
    
    const promptFilter = hasPrompt ? 'has:prompt' : ''
    
    let finalTags: string
    if (order === 'recent') {
      finalTags = [tags, promptFilter].filter(Boolean).join(' ').trim()
    } else if (order === 'random') {
      const randomCount = "20"
      finalTags = [tags, promptFilter, `random:${randomCount}`].filter(Boolean).join(' ')
    } else {
      finalTags = [tags, promptFilter, 'order:rank'].filter(Boolean).join(' ')
    }

    const params = new URLSearchParams({
      ...this.defaultParams,
      ...(order === 'random' ? { limit: "20" } : {}),
      page,
      tags: finalTags,
    })

    const data = await this.fetchJson<AibooruPost[]>(`${this.baseUrl}/posts.json`, params, {
      'Referer': PROVIDER_REFERERS.AIBOORU,
      // Aibooru often blocks requests without a valid Referer or specific headers
    })
    const validPosts = this.filterValidPosts<AibooruPost>(data)

    return validPosts.map(post => ({
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
      ai_metadata: post.ai_metadata,
      width: post.image_width,
      height: post.image_height,
    }))
  }
}
