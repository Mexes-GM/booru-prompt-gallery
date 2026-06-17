import { BaseBooruProvider } from '../base'
import { BooruPost, SearchOptions, TrendItem } from '../types'
import { PROVIDER_URLS } from '../../constants'
import type { ProviderEnv } from '../factory'
import { logger } from '../../../logger'

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const DANBOORU_PAGE_SIZE = '30'

export class DanbooruProvider extends BaseBooruProvider {
  protected baseUrl = PROVIDER_URLS.DANBOORU
  protected defaultParams = {
    limit: DANBOORU_PAGE_SIZE,
    only: 'id,file_url,large_file_url,preview_file_url,tag_string,tag_string_artist,tag_string_character,tag_string_copyright,tag_string_meta,rating,image_width,image_height',
  }

  private username: string | undefined
  private apiKey: string | undefined

  constructor(env?: ProviderEnv) {
    super()
    this.username = env?.DANBOORU_USERNAME
    this.apiKey = env?.DANBOORU_API_KEY
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': `Boorugallery/9.2${this.username ? ` (Danbooru user: ${this.username})` : ''}`,
      'Accept': 'application/json',
      'Referer': 'https://danbooru.donmai.us/',
    }
    if (this.username && this.apiKey) {
      const credentials = btoa(`${this.username}:${this.apiKey}`)
      headers['Authorization'] = `Basic ${credentials}`
    }
    return headers
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

    const data = await this.fetchJson<DanbooruPost[]>(
      `${this.baseUrl}/posts.json`,
      params,
      this.getAuthHeaders()
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

  async getTrending(): Promise<TrendItem[]> {
    try {
      const pagesToFetch = 2
      const limitPerPage = "200"

      const fetchPromises = Array.from({ length: pagesToFetch }, (_, i) => {
        const params = new URLSearchParams({
          limit: limitPerPage,
          page: (i + 1).toString(),
          tags: "order:rank status:active",
          only: "id,file_url,tag_string,tag_string_character,tag_string_copyright"
        })
        return this.fetchJson<DanbooruPost[]>(`${this.baseUrl}/posts.json`, params, this.getAuthHeaders())
      })

      const results = await Promise.all(fetchPromises)
      const allRawPosts = results.flat()
      const validPosts = this.filterValidPosts<DanbooruPost>(allRawPosts)

      const charStats = new Map<string, number>()
      const copyStats = new Map<string, number>()

      validPosts.forEach(post => {
        if (post.tag_string_character) {
          post.tag_string_character.split(/\s+/).forEach((tag: string) => {
            if (tag) charStats.set(tag, (charStats.get(tag) || 0) + 1)
          })
        }
        if (post.tag_string_copyright) {
          post.tag_string_copyright.split(/\s+/).forEach((tag: string) => {
            if (tag && tag !== 'original') copyStats.set(tag, (copyStats.get(tag) || 0) + 1)
          })
        }
      })

      const dedupChars = this._deduplicateTags(charStats, 'character')
      const dedupCopies = this._deduplicateTags(copyStats, 'copyright')

      const topChars = dedupChars.slice(0, 10).map(item => ({ name: item.tag, count: item.totalCount, type: 'character' as const }))
      const topCopies = dedupCopies.slice(0, 10).map(item => ({ name: item.tag, count: item.totalCount, type: 'copyright' as const }))

      const combinedTrends = [...topChars, ...topCopies]

      if (combinedTrends.length === 0) return []

      let phase2Count = 0
      const trendsWithImages: (TrendItem | null)[] = []

      for (const item of combinedTrends) {
        phase2Count++
        try {
          const searchTags = item.type === 'character'
            ? `${item.name} rating:g solo status:active`
            : `${item.name} rating:g status:active`

          const imageParams = new URLSearchParams({
            limit: "1",
            tags: searchTags,
            only: "preview_file_url,file_url,large_file_url"
          })

          let imageData = await this.fetchJson<DanbooruPost[]>(`${this.baseUrl}/posts.json`, imageParams, this.getAuthHeaders())

          if ((!imageData || imageData.length === 0) && item.type === 'character') {
            await sleep(1100)
            imageParams.set('tags', `${item.name} rating:g status:active`)
            imageData = await this.fetchJson<DanbooruPost[]>(`${this.baseUrl}/posts.json`, imageParams, this.getAuthHeaders())
          }

          if (imageData && imageData.length > 0) {
            const post = imageData[0]
            trendsWithImages.push({
              name: item.name,
              type: item.type,
              count: item.count,
              imageUrl: post.large_file_url || post.preview_file_url || post.file_url,
              postUrl: post.file_url
            } as TrendItem)
          } else {
            trendsWithImages.push(null)
          }
        } catch (e) {
          trendsWithImages.push(null)
        }

        await sleep(1100)
      }

      const validTrends = trendsWithImages.filter((t): t is TrendItem => t !== null)

      const finalChars = validTrends
        .filter(t => t.type === 'character')
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)

      const finalCopies = validTrends
        .filter(t => t.type === 'copyright')
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)

      return [...finalChars, ...finalCopies].sort((a, b) => b.count - a.count)

    } catch (error) {
      logger.warn('danbooru_trending_error', {
        error: error instanceof Error ? error.message : String(error),
      })
      return []
    }
  }

  private _deduplicateTags(stats: Map<string, number>, type: 'character' | 'copyright') {
    const groups = new Map<string, { tag: string, maxCount: number, totalCount: number }>()

    stats.forEach((count, tag) => {
      let key = tag.toLowerCase()
      if (type === 'copyright') {
        key = tag.split(':')[0]
      } else {
        key = tag.split(/(_\(|\()/)[0]
      }

      const existing = groups.get(key)
      if (!existing) {
        groups.set(key, { tag, maxCount: count, totalCount: count })
      } else {
        existing.totalCount += count
        if (count > existing.maxCount) {
          existing.tag = tag
          existing.maxCount = count
        }
      }
    })

    if (type === 'copyright') {
      const keys = Array.from(groups.keys()).sort((a, b) => a.length - b.length)

      for (const parentKey of keys) {
        if (!groups.has(parentKey)) continue

        for (const childKey of keys) {
          if (parentKey === childKey) continue
          if (!groups.has(childKey)) continue

          if (childKey.startsWith(parentKey + '_')) {
            groups.delete(childKey)
          }
        }
      }
    }

    return Array.from(groups.values())
      .sort((a, b) => b.totalCount - a.totalCount)
  }
}
