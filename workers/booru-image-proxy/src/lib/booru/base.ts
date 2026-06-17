import { BooruPost, SearchOptions } from './types'
import { getDanbooruUserAgent, USER_AGENT } from '../constants'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '../../logger'

interface TagCategoryRow {
  name: string
  category: number
}

export abstract class BaseBooruProvider {
  protected abstract baseUrl: string
  protected abstract defaultParams: Record<string, string>

  abstract search(options: SearchOptions): Promise<BooruPost[]>

  // Simple fetch with retry — replaces smartFetch for Workers
  protected async fetchJson<T>(
    url: string,
    params: URLSearchParams,
    headers: Record<string, string> = {},
    retries = 2
  ): Promise<T> {
    const finalUrl = new URL(url)
    finalUrl.search = params.toString()

    let lastError: Error | null = null
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 12000)

        const requestHeaders: Record<string, string> = {
          'Accept': 'application/json',
          'User-Agent': 'Boorugallery/9.2',
          ...headers,
        }

        const response = await fetch(finalUrl.toString(), {
          headers: requestHeaders,
          signal: controller.signal,
        })
        clearTimeout(timeoutId)

        if (!response.ok) {
          throw new Error(`API Error: ${response.status} ${response.statusText}`)
        }

        const text = await response.text()
        if (!text || text.trim().length === 0) {
          return [] as unknown as T
        }

        try {
          return JSON.parse(text) as T
        } catch {
          throw new Error('Invalid JSON response from provider')
        }
      } catch (error: any) {
        lastError = error
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
        }
      }
    }
    throw lastError || new Error('Fetch failed')
  }

  protected filterValidPosts<T>(posts: T[]): T[] {
    return posts.filter((post) => {
      if (!post || typeof post !== 'object') return false
      const p = post as Record<string, unknown>
      const fileUrl = p.file_url || p.sample_url || ''
      const tagString = p.tag_string || p.tags || ''
      return (
        fileUrl &&
        typeof fileUrl === 'string' &&
        !fileUrl.includes('deleted') &&
        p.id &&
        tagString &&
        !(typeof fileUrl === 'string' && fileUrl.match(/\.(mp4|webm|avi|mov|mkv)$/i))
      )
    })
  }

  protected async enrichPostsWithCategories(
    posts: BooruPost[],
    supabase: SupabaseClient | null
  ): Promise<BooruPost[]> {
    if (!posts || posts.length === 0) return posts
    if (!supabase) return posts

    const allTags = new Set<string>()
    posts.forEach((p) => {
      if (p.tag_string) {
        p.tag_string.split(/\s+/).forEach((t) => {
          if (t) allTags.add(t)
        })
      }
    })

    if (allTags.size === 0) return posts

    try {
      const uniqueTagsArray = Array.from(allTags)
      const CHUNK_SIZE = 100
      const tagMap = new Map<string, number>()

      for (let i = 0; i < uniqueTagsArray.length; i += CHUNK_SIZE) {
        const chunk = uniqueTagsArray.slice(i, i + CHUNK_SIZE)
        const { data } = await supabase
          .from('auto_suggest_tags')
          .select('name, category')
          .in('name', chunk)

        if (data) {
          data.forEach((row: TagCategoryRow) => tagMap.set(row.name, row.category))
        }
      }

      return posts.map((post) => {
        if (!post.tag_string) return post

        const tags = post.tag_string.split(/\s+/).filter(Boolean)
        const artistTags: string[] = []
        const characterTags: string[] = []
        const copyrightTags: string[] = []
        const metaTags: string[] = []

        tags.forEach((t) => {
          const category = tagMap.get(t)
          if (category === 1) artistTags.push(t)
          else if (category === 3) copyrightTags.push(t)
          else if (category === 4) characterTags.push(t)
          else if (category === 5) metaTags.push(t)
        })

        return {
          ...post,
          tag_string_artist: artistTags.length > 0 ? artistTags.join(' ') : post.tag_string_artist,
          tag_string_character:
            characterTags.length > 0 ? characterTags.join(' ') : post.tag_string_character,
          tag_string_copyright:
            copyrightTags.length > 0 ? copyrightTags.join(' ') : post.tag_string_copyright,
          tag_string_meta: metaTags.length > 0 ? metaTags.join(' ') : post.tag_string_meta,
        }
      })
    } catch (e) {
      logger.warn('booru_enrich_error', {
        error: e instanceof Error ? e.message : String(e),
      })
      return posts
    }
  }
}
