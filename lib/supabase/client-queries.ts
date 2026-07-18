import { createClient } from './client'

export type TagResult = {
  name: string
  postCount: number
  category: number
  displayName?: string
  /** The alias the user's query matched, if the match came from an alias rather than the canonical name (e.g. an alternate/informal name resolving to its canonical Danbooru tag). */
  matchedAlias?: string | null
}

/**
 * Searches tags directly on the client side using the public Supabase client.
 *
 * Matches against both the canonical tag `name` and its `aliases` (Danbooru
 * resolves many alternate/informal names as aliases of a canonical tag —
 * without alias matching, typing one of those names would never surface a
 * suggestion even though the canonical tag itself is searchable). Delegates
 * to the `search_auto_suggest_tags` RPC (see
 * supabase/migrations/20260717000000_auto_suggest_tags_aliases.sql and
 * .../20260718000000_auto_suggest_tags_alias_match.sql) because PostgREST's
 * client filters can't ILIKE an expression like array_to_string(aliases, ' ')
 * — only plain columns — and because surfacing WHICH alias matched (for the
 * "alias -> tag" UI hint) requires a per-row subquery, not a filter.
 */
export async function searchTags(query: string): Promise<TagResult[]> {
  if (!query || query.trim().length < 2) {
    return []
  }

  const normalizedQuery = query.trim().toLowerCase().replace(/ /g, '_')

  try {
    const supabase = createClient()

    const { data, error } = await supabase
      .rpc('search_auto_suggest_tags', { query: normalizedQuery, result_limit: 20 })

    if (error) throw error
    if (!data) return []

    const results: TagResult[] = data.map((tag: { name: string; category: string | number; post_count: number; matched_alias: string | null }) => ({
      name: tag.name,
      postCount: Number(tag.post_count) || 0,
      category: Number(tag.category) || 0,
      displayName: tag.name,
      matchedAlias: tag.matched_alias || null,
    }))

    // Sort by exact match (on name OR the matched alias — a query that's an
    // exact alias is just as strong a signal as an exact tag name match),
    // then starts-with, then post_count. The RPC already orders by
    // (exact-match, post_count desc), so this only reorders prefix matches
    // that would otherwise be buried under a more popular substring match.
    const finalResults = results.sort((a, b) => {
      const aExact = a.name.toLowerCase() === normalizedQuery || a.matchedAlias?.toLowerCase() === normalizedQuery
      const bExact = b.name.toLowerCase() === normalizedQuery || b.matchedAlias?.toLowerCase() === normalizedQuery
      if (aExact && !bExact) return -1
      if (!aExact && bExact) return 1

      const aStarts = a.name.toLowerCase().startsWith(normalizedQuery) || a.matchedAlias?.toLowerCase().startsWith(normalizedQuery)
      const bStarts = b.name.toLowerCase().startsWith(normalizedQuery) || b.matchedAlias?.toLowerCase().startsWith(normalizedQuery)
      if (aStarts && !bStarts) return -1
      if (!aStarts && bStarts) return 1

      return b.postCount - a.postCount
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
