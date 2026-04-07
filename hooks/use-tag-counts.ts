import { useState, useEffect, useRef } from 'react'
import { BooruPost, BooruProvider } from '@/lib/booru/types'
import { fetchBatchTagCounts } from '@/lib/api-client'
import { chunkArray } from '@/lib/utils'

const CACHE_KEY = 'booru_gallery_char_counts'
const CHUNK_SIZE = 100 // API Limit for Danbooru search[name_comma]

/**
 * Custom hook to fetch and cache character tag post counts in the background.
 * Optimized with batching, deduplication, and localStorage persistence.
 */
export function useTagCounts(posts: BooruPost[], provider: BooruProvider) {
  const [counts, setCounts] = useState<Record<string, number>>({})
  // Track which tags are already being fetched to prevent duplicate inflight requests
  const fetchingRef = useRef<Set<string>>(new Set())
  const hasLoadedCache = useRef(false)

  // Load initial cache from localStorage once on mount
  useEffect(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY)
      if (cached) {
        setCounts(JSON.parse(cached))
      }
    } catch (e) {
      console.error('Failed to parse tag counts cache:', e)
    }
    hasLoadedCache.current = true
  }, [])

  useEffect(() => {
    if (!hasLoadedCache.current || !posts.length || (provider !== 'danbooru' && provider !== 'aibooru')) {
      return
    }

    const tagsToFetch = new Set<string>()

    // 1. Determine missing character tags based on our current state
    for (const post of posts) {
      if (!post.tag_string_character) continue
      
      const charTags = post.tag_string_character.split(' ').filter(Boolean)
      for (const tag of charTags) {
        // Enqueue if we don't have it and it's not currently being fetched
        if (typeof counts[tag] === 'undefined' && !fetchingRef.current.has(tag)) {
          tagsToFetch.add(tag)
        }
      }
    }

    if (tagsToFetch.size === 0) return

    // 2. Mark these tags as being fetched immediately
    tagsToFetch.forEach(tag => fetchingRef.current.add(tag))

    // 3. Batch fetch missing tags
    const fetchMissingCounts = async () => {
      const chunks = chunkArray(Array.from(tagsToFetch), CHUNK_SIZE)
      
      for (const chunk of chunks) {
        try {
          const result = await fetchBatchTagCounts(chunk, provider)
          if (Object.keys(result).length > 0) {
            setCounts(prev => {
              const updated = { ...prev, ...result }
              try {
                localStorage.setItem(CACHE_KEY, JSON.stringify(updated))
              } catch (e) {
                // Ignore quota exceeded gracefully
              }
              return updated
            })
          }
        } catch (e) {
          console.error('Failed to fetch tag counts chunk:', e)
        }
      }
    }

    fetchMissingCounts()
  }, [posts, provider, counts])

  return counts
}
