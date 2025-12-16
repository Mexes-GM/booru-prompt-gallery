
import { BaseBooruProvider } from '../base'
import { BooruPost, SearchOptions } from '../types'

export class DanbooruProvider extends BaseBooruProvider {
  protected baseUrl = "https://danbooru.donmai.us"
  protected defaultParams = {
    limit: "20",
    only: "id,file_url,large_file_url,preview_file_url,tag_string,tag_string_artist,tag_string_character,tag_string_copyright,rating,score",
  }

  async search(options: SearchOptions): Promise<BooruPost[]> {
    const { tags, page, order } = options
    
    let finalTags: string
    if (order === 'recent') {
      finalTags = tags || ''
    } else if (order === 'random') {
      const randomCount = "15"
      finalTags = tags ? `${tags} random:${randomCount}` : `random:${randomCount}`
    } else {
      finalTags = tags ? `${tags} order:rank` : 'order:rank'
    }

    const params = new URLSearchParams({
      ...this.defaultParams,
      ...(order === 'random' ? { limit: "15" } : {}),
      page,
      tags: finalTags,
    })

    const data = await this.fetchJson<any[]>(`${this.baseUrl}/posts.json`, params)
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
    }))
  }
}
