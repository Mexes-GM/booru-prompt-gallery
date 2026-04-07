import { useState, useEffect } from 'react'
import { BooruPost, BooruProvider } from '@/lib/booru/types'
import { fetchBatchTagCounts } from '@/lib/api-client'
import { chunkArray } from '@/lib/utils'

const CACHE_KEY = 'booru_gallery_char_counts_v3'
const CHUNK_SIZE = 50 // Safe limit to avoid URI too long errors

let globalCountsCache: Record<string, number> | null = null
const globalFetchingSet = new Set<string>()
const listeners = new Set<(counts: Record<string, number>) => void>()

export function loadGlobalCache() {
  if (globalCountsCache) return globalCountsCache
  try {
    if (typeof window !== 'undefined') {
      const cached = localStorage.getItem(CACHE_KEY)
      globalCountsCache = cached ? JSON.parse(cached) : {}
    } else {
      globalCountsCache = {}
    }
  } catch (e) {
    globalCountsCache = {}
  }
  return globalCountsCache!
}

export function updateGlobalCache(updates: Record<string, number>) {
  if (!globalCountsCache) loadGlobalCache()
  
  Object.assign(globalCountsCache!, updates)
  
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(CACHE_KEY, JSON.stringify(globalCountsCache))
    }
  } catch (e) {
    // Ignore quota exceeded
  }
  
  const currentCache = { ...globalCountsCache }
  for (const fn of Array.from(listeners)) {
    try {
      fn(currentCache)
    } catch (e) {
      console.warn('Failed to notify tag count listener', e)
    }
  }
}

/**
 * Headless function to prefetch missing character tags from a list of posts independently of React renders.
 */
export function prefetchTagCounts(posts: BooruPost[], provider: BooruProvider) {
  if (!posts.length || (provider !== 'danbooru' && provider !== 'aibooru')) {
    return
  }

  const cache = loadGlobalCache()
  const tagsToFetch = new Set<string>()

  // 1. Determine missing character tags based on our current state
  for (const post of posts) {
    if (!post.tag_string_character) continue
    
    const charTags = post.tag_string_character.split(' ').filter(Boolean)
    for (const tag of charTags) {
      if (typeof cache[tag] === 'undefined' && !globalFetchingSet.has(tag)) {
        tagsToFetch.add(tag)
      }
    }
  }

  if (tagsToFetch.size === 0) return

  // 2. Mark as being fetched immediately
  tagsToFetch.forEach(tag => globalFetchingSet.add(tag))

  // 3. Batch fetch missing tags async without blocking anything
  const fetchMissingCounts = async () => {
    const chunks = chunkArray(Array.from(tagsToFetch), CHUNK_SIZE)
    
    for (const chunk of chunks) {
      try {
        const result = await fetchBatchTagCounts(chunk, provider)
        
        if (!result) {
          // Re-enable for future retry on network failure
          chunk.forEach(tag => globalFetchingSet.delete(tag))
          continue
        }
        
        const updates: Record<string, number> = {}
        for (const tag of chunk) {
           updates[tag] = result[tag] || 0
        }
        
        updateGlobalCache(updates)
      } catch (e) {
        console.error('Failed to fetch tag counts chunk:', e)
        chunk.forEach(tag => globalFetchingSet.delete(tag))
      }
    }
  }

  fetchMissingCounts()
}

/**
 * Custom hook to subscribe to the global background-fetched tag counts context.
 */
export function useTagCounts(posts: BooruPost[], provider: BooruProvider) {
  const [counts, setCounts] = useState<Record<string, number>>({})

  useEffect(() => {
    const cache = loadGlobalCache()
    setCounts({ ...cache })
    
    const listener = (newCounts: Record<string, number>) => setCounts(newCounts)
    listeners.add(listener)
    
    return () => {
      listeners.delete(listener)
    }
  }, [])

  // Trigger prefetch passively, usually already triggered sooner by api-client.ts 
  useEffect(() => {
    prefetchTagCounts(posts, provider)
  }, [posts, provider])

  return counts
}