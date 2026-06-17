import { createClient } from './client'

export type TagResult = {
  name: string
  postCount: number
  category: number
  displayName?: string
}

/**
 * Searches tags directly on the client side using the public Supabase client.
 */
export async function searchTags(query: string): Promise<TagResult[]> {
  if (!query || query.trim().length < 2) {
    return []
  }

  const normalizedQuery = query.trim().toLowerCase().replace(/ /g, '_')

  try {
    const supabase = createClient()
    
    // Search tags in Supabase using ILIKE for case-insensitive search
    const { data, error } = await supabase
      .from('auto_suggest_tags')
      .select('name, category')
      .ilike('name', `%${normalizedQuery}%`)
      .limit(20)

    if (error) throw error
    if (!data) return []

    const results: TagResult[] = data.map((tag: { name: string; category: string | number }) => ({
      name: tag.name,
      postCount: 0,
      category: Number(tag.category) || 0,
      displayName: tag.name
    }))

    // Sort by exact match, then starts with match
    const finalResults = results.sort((a, b) => {
      const aExact = a.name.toLowerCase() === normalizedQuery
      const bExact = b.name.toLowerCase() === normalizedQuery
      if (aExact && !bExact) return -1
      if (!aExact && bExact) return 1

      const aStarts = a.name.toLowerCase().startsWith(normalizedQuery)
      const bStarts = b.name.toLowerCase().startsWith(normalizedQuery)
      if (aStarts && !bStarts) return -1
      if (!aStarts && bStarts) return 1

      return 0
    }).slice(0, 5)
    
    return finalResults

  } catch (error) {
    console.error('Error searching tags client-side:', error)
    return []
  }
}

/**
 * Fetches all tag overrides page-by-page from the client side.
 */
export async function getAllTagOverridesClient(): Promise<Record<string, string>> {
  const overrides: Record<string, string> = {}
  
  try {
    const supabase = createClient()
    let page = 0
    const pageSize = 1000
    let hasMore = true

    while (hasMore) {
      const { data, error } = await supabase
        .from('tags')
        .select('name, category')
        .range(page * pageSize, (page + 1) * pageSize - 1)

      if (error) {
        console.error('Error fetching tag overrides client-side:', error)
        break
      }

      if (data && data.length > 0) {
        data.forEach((tag: { name: string; category: string }) => {
          overrides[tag.name] = tag.category
        })

        if (data.length < pageSize) {
          hasMore = false
        } else {
          page++
        }
      } else {
        hasMore = false
      }
    }
  } catch (error) {
    console.error('Error in getAllTagOverridesClient:', error)
  }

  return overrides
}

/**
 * Fetches tag overrides from localStorage if valid, otherwise queries Supabase and caches them.
 */
export async function getCachedTagOverrides(): Promise<Record<string, string>> {
  const CACHE_KEY = 'booru-tag-overrides'
  const CACHE_TIME_KEY = 'booru-tag-overrides-timestamp'
  const CACHE_DURATION = 60 * 60 * 1000 // 1 hour

  if (typeof window !== 'undefined') {
    try {
      const cached = localStorage.getItem(CACHE_KEY)
      const timestamp = localStorage.getItem(CACHE_TIME_KEY)
      if (cached && timestamp) {
        const age = Date.now() - parseInt(timestamp, 10)
        if (age < CACHE_DURATION) {
          return JSON.parse(cached)
        }
      }
    } catch (e) {
      console.warn('Failed to read tag overrides cache from localStorage:', e)
    }
  }

  // Fallback to fetching from Supabase directly
  const overrides = await getAllTagOverridesClient()

  if (typeof window !== 'undefined' && Object.keys(overrides).length > 0) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(overrides))
      localStorage.setItem(CACHE_TIME_KEY, Date.now().toString())
    } catch (e) {
      console.warn('Failed to save tag overrides cache to localStorage:', e)
    }
  }

  return overrides
}
