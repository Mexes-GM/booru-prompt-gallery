
import { BaseBooruProvider } from '../base'
import { BooruPost, SearchOptions } from '../types'

export class AibooruProvider extends BaseBooruProvider {
  protected baseUrl = "https://aibooru.online"
  protected defaultParams = {
    limit: "20",
    only: "id,file_url,large_file_url,preview_file_url,tag_string,tag_string_artist,tag_string_character,tag_string_copyright,rating,score,ai_metadata,image_width,image_height",
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

    const data = await this.fetchJson<any[]>(`${this.baseUrl}/posts.json`, params, {
      'Referer': 'https://aibooru.online/',
      // Aibooru often blocks requests without a valid Referer or specific headers
    })
    const validPosts = this.filterValidPosts(data)

    return validPosts.map(post => ({
      id: post.id,
      file_url: post.file_url,
      large_file_url: post.large_file_url || post.file_url,
      preview_file_url: post.preview_file_url || post.file_url,
      tag_string: post.tag_string,
      tag_string_artist: post.tag_string_artist,
      tag_string_character: post.tag_string_character,
      tag_string_copyright: post.tag_string_copyright,
      rating: post.rating,
      score: post.score,
      ai_metadata: post.ai_metadata,
      width: post.image_width,
      height: post.image_height,
    }))
  }
}
