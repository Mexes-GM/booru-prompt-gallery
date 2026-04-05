
import { BaseBooruProvider } from '../base'
import { BooruPost, SearchOptions, TrendItem } from '../types'
import { PROVIDER_URLS } from '@/lib/constants'

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

export class DanbooruProvider extends BaseBooruProvider {
  protected baseUrl = PROVIDER_URLS.DANBOORU
  protected defaultParams = {
    limit: "20",
    only: "id,file_url,large_file_url,preview_file_url,tag_string,tag_string_artist,tag_string_character,tag_string_copyright,tag_string_meta,rating,score,image_width,image_height",
  }

  async getTrending(): Promise<TrendItem[]> {
    try {
      // Phase 1: Fetch larger sample of popular posts for better statistics
      // Parallel fetch for multiple pages
      const pagesToFetch = 2
      const limitPerPage = "200"

      const fetchPromises = Array.from({ length: pagesToFetch }, (_, i) => {
        const params = new URLSearchParams({
          limit: limitPerPage,
          page: (i + 1).toString(),
          tags: "order:rank status:active",
          only: "id,file_url,tag_string,tag_string_character,tag_string_copyright"
        })
        return this.fetchJson<DanbooruPost[]>(`${this.baseUrl}/posts.json`, params)
      })

      const results = await Promise.all(fetchPromises)
      const allRawPosts = results.flat()
      const validPosts = this.filterValidPosts<DanbooruPost>(allRawPosts)

      // Aggregation
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

      // Get Top Candidates (20 of each to have buffer for image failures)
      const topChars = dedupChars.slice(0, 20).map(item => ({ name: item.tag, count: item.totalCount, type: 'character' as const }))
      const topCopies = dedupCopies.slice(0, 20).map(item => ({ name: item.tag, count: item.totalCount, type: 'copyright' as const }))

      const combinedTrends = [...topChars, ...topCopies]

      if (combinedTrends.length === 0) return []

      // Phase 2: Fetch specific SFW images for each trend
      const trendsWithImages = await Promise.all(combinedTrends.map(async (item) => {
        try {
          // Specific search criteria based on type
          // For characters: try 'solo' first for cleaner images
          const searchTags = item.type === 'character'
            ? `${item.name} rating:g solo status:active`
            : `${item.name} rating:g status:active`

          const imageParams = new URLSearchParams({
            limit: "1",
            tags: searchTags,
            only: "preview_file_url,file_url,large_file_url"
          })

           let imageData = await this.fetchJson<DanbooruPost[]>(`${this.baseUrl}/posts.json`, imageParams)

          // Fallback for character if 'solo' returns nothing
          if ((!imageData || imageData.length === 0) && item.type === 'character') {
            imageParams.set('tags', `${item.name} rating:g status:active`)
            imageData = await this.fetchJson<any[]>(`${this.baseUrl}/posts.json`, imageParams)
          }

          if (imageData && imageData.length > 0) {
            const post = imageData[0]
            return {
              name: item.name,
              type: item.type,
              count: item.count,
              imageUrl: post.large_file_url || post.preview_file_url || post.file_url,
              postUrl: post.file_url
            } as TrendItem
          }
        } catch (e) {
          // Silent fail for individual image fetch
        }
        return null
      }))

      // Filter nulls and ensure we have Top 10 of each category
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
      console.error("Error in getTrending:", error)
      return []
    }
  }

  private _deduplicateTags(stats: Map<string, number>, type: 'character' | 'copyright') {
    const groups = new Map<string, { tag: string, maxCount: number, totalCount: number }>()

    // Pass 1: Basic normalization
    stats.forEach((count, tag) => {
      // Normalization strategy
      let key = tag.toLowerCase()
      if (type === 'copyright') {
        key = tag.split(':')[0]
      } else {
        // Remove everything starting from the first underscore-parenthesis or just parenthesis
        key = tag.split(/(_\(|\()/)[0]
      }

      const existing = groups.get(key)
      if (!existing) {
        groups.set(key, { tag, maxCount: count, totalCount: count })
      } else {
        existing.totalCount += count
        // Keep the tag variant that appears most often as the "canonical" display name
        if (count > existing.maxCount) {
          existing.tag = tag
          existing.maxCount = count
        }
      }
    })

    // Pass 2: Merge sub-franchises for copyrights (e.g., 'hololive_english' -> 'hololive')
    if (type === 'copyright') {
      const keys = Array.from(groups.keys()).sort((a, b) => a.length - b.length)

      for (const parentKey of keys) {
        if (!groups.has(parentKey)) continue // Already merged into someone else

        // Look for children to merge into this parent
        for (const childKey of keys) {
          if (parentKey === childKey) continue
          if (!groups.has(childKey)) continue

          // Check if childKey is a sub-tag of parentKey (e.g., "hololive" vs "hololive_english")
          if (childKey.startsWith(parentKey + '_')) {
            const parent = groups.get(parentKey)!
            const child = groups.get(childKey)!

            // Merge counts
            // Note: We don't simply add them because the same post might have both tags.
            // Since we don't have per-post granularity here easily without re-scanning,
            // taking the MAX of the two totals is safer to avoid double-counting the same posts,
            // OR we assume they are distinct enough. 
            // However, the user said "same amount of posts", implying redundancy.
            // If we assume they are the SAME posts, max is better.
            // If we assume they are different posts (e.g. general hololive art vs specific hololive_en art), sum is better.
            // For 'trends', sum is usually better to show franchise power, but let's stick to a safe accumulation.
            // Given the user report "same amount of posts", it's likely double counting.
            // Let's take the larger totalCount to be safe against double-counting identical sets,
            // but add a small buffer if they differ? No, let's just sum them but be aware.
            // Actually, if it's the SAME posts, summing them doubles the count artificially.
            // Correct approach for 'Trend' aggregation from stats:
            // We can't know if they overlap perfectly without the post IDs.
            // But usually, specific tag implies general tag.
            // So 'hololive_english' posts ALSO have 'hololive'.
            // So 'hololive' count usually INCLUDES 'hololive_english' count.
            // So we should NOT add them. We should just swallow the child group.
            // The parent group ('hololive') already counted these posts.

            // So we just remove the child entry so it doesn't show up as a duplicate row.
            groups.delete(childKey)
          }
        }
      }
    }

    return Array.from(groups.values())
      .sort((a, b) => b.totalCount - a.totalCount)
  }

  async search(options: SearchOptions): Promise<BooruPost[]> {
    const { tags, page, order } = options

    let finalTags: string
    let effectiveOrder = order

    // Check if tags contain order:random and switch mode if needed
    if (tags && (tags.includes('order:random') || tags.includes('random:'))) {
      effectiveOrder = 'random'
    }

    if (effectiveOrder === 'recent') {
      finalTags = tags || ''
    } else if (effectiveOrder === 'random') {
      const randomCount = "20"
      // Remove existing random/order tags to avoid conflicts
      const cleanTags = tags ? tags.replace(/order:random|random:\d+/gi, '').trim() : ''
      finalTags = cleanTags ? `${cleanTags} random:${randomCount}` : `random:${randomCount}`
    } else {
      finalTags = tags ? `${tags} order:rank` : 'order:rank'
    }

    const params = new URLSearchParams({
      ...this.defaultParams,
      ...(effectiveOrder === 'random' ? { limit: "20" } : {}),
      page,
      tags: finalTags,
    })

    const data = await this.fetchJson<DanbooruPost[]>(`${this.baseUrl}/posts.json`, params)
    const validPosts = this.filterValidPosts<DanbooruPost>(data)

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
      width: post.image_width,
      height: post.image_height,
    }))
  }
}
