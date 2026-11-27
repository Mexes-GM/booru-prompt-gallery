import { BaseBooruProvider } from '../base'
import { BooruPost, SearchOptions } from '../types'
import { PROVIDER_URLS, USER_AGENT } from '../../constants'
import { logger } from '../../../logger'
import { E621_POSTS_MODE, extractE621Posts, parseE621Post } from './e621-format'

export class E621Provider extends BaseBooruProvider {
  protected baseUrl: string = PROVIDER_URLS.E621
  protected defaultParams = { limit: '100' }

  async search(options: SearchOptions): Promise<BooruPost[]> {
    const params = new URLSearchParams(this.defaultParams)
    params.set('page', options.page || '1')
    if (options.limit) {
      params.set('limit', options.limit)
    }
    // Tags grouped by category, so artist names and meta tags stay out of prompts.
    params.set('mode', E621_POSTS_MODE)
    params.set('_client', USER_AGENT)

    let tags = (options.tags || '').trim()
    if (options.order === 'popular') tags += ' order:score'
    else if (options.order === 'random') tags += ' order:random'
    if (tags) params.set('tags', tags.trim())

    try {
      const data = await this.fetchJson<unknown>(`${this.baseUrl}/posts.json`, params)

      const mappedPosts: BooruPost[] = []
      for (const raw of extractE621Posts(data)) {
        const post = parseE621Post(raw)
        if (post) mappedPosts.push(post)
      }

      return this.filterValidPosts(mappedPosts)
    } catch (error) {
      logger.warn('e621_fetch_error', {
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }
}

/** floofgens.net: e621's engine and API, AI-generated posts only. */
export class FloofgensProvider extends E621Provider {
  protected baseUrl: string = PROVIDER_URLS.FLOOFGENS
}
