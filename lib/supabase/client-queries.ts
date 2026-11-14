import { createClient } from './client'
import { PROVIDER_SLOT_CHUNK, chunked, slotRowsToOverrides, type ProviderSlotRow } from '@/lib/prompt/provider-slots'
import pkg from '@/package.json'

/**
 * The snapshot is cached for a week over HTTP and a day in localStorage. Keying
 * both to the site version lets a release that changes it reach returning
 * visitors right away.
 */
const TAGS_CORE_URL = `/tags-core.json?v=${pkg.version}`

/** Danbooru's tag category number for characters. */
const DANBOORU_CHARACTER = 4

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
  try {
    return await searchTagsOrThrow(query)
  } catch (error) {
    console.error('Error searching tags client-side:', error)
    return []
  }
}

/**
 * searchTags, but a failed lookup (timeout, network) throws instead of looking
 * like "no tag matches", for callers that need to tell the two apart. `limit`
 caps the results (of the 20 the lookup returns), best matches first.
 */
export async function searchTagsOrThrow(query: string, limit = 5): Promise<TagResult[]> {
  if (!query || query.trim().length < 2) {
    return []
  }

  const normalizedQuery = query.trim().toLowerCase().replace(/ /g, '_')

  {
    const supabase = createClient()
    if (!supabase) return []

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
    }).slice(0, limit)

    return finalResults
  }
}

/**
 * Fetches tag overrides for fast client-side synchronous classification.
 * Prioritizes the static /tags-core.json snapshot (fast, CDN-cached, zero Supabase load).
 * Falls back to querying auto_suggest_tags in Supabase directly if fetch fails.
 */
export async function getAllTagOverridesClient(): Promise<Record<string, string>> {
  // 1. Try static CDN snapshot (/tags-core.json)
  if (typeof window !== 'undefined') {
    try {
      const res = await fetch(TAGS_CORE_URL, { cache: 'default' })
      if (res.ok) {
        const data = await res.json()
        if (data && typeof data === 'object' && Object.keys(data).length > 0) {
          return data
        }
      }
    } catch (fetchErr) {
      console.warn('Failed to load /tags-core.json snapshot, falling back to Supabase:', fetchErr)
    }
  }

  // 2. Fallback to querying public.auto_suggest_tags in Supabase directly
  const overrides: Record<string, string> = {}
  try {
    const supabase = createClient()
    if (!supabase) return overrides
    const { data, error } = await supabase
      .from('auto_suggest_tags')
      .select('name, category_name, subcategory')
      .eq('status', 'approved')
      .gte('post_count', 5000)
      .limit(5000)

    if (!error && data) {
      data.forEach((tag: { name: string; category_name: string; subcategory?: string | null }) => {
        if (tag.name && tag.category_name) {
          const val = tag.subcategory ? `${tag.category_name}:${tag.subcategory}` : tag.category_name
          overrides[tag.name] = val
          if (tag.name.includes('_')) {
            overrides[tag.name.replace(/_/g, ' ')] = val
          }
        }
      })
      return overrides
    }
  } catch (error) {
    console.error('Error fetching tag overrides from auto_suggest_tags:', error)
  }

  return overrides
}

/**
 * Looks up approved category/subcategory for specific tags (names with spaces
 * or underscores). Complements the static snapshot, which only covers the most
 * popular tags: Pack Mode calls this for the tags actually present in its pool.
 * Returns the same key shapes as getAllTagOverridesClient (underscore + space).
 *
 * A tag only counts as a character name when Danbooru files it as one: some
 * general tags (species, groups, weapons) were classified other:character, and
 * would otherwise be named as characters. Those are left unclassified.
 */
export async function fetchTagOverridesForNames(
  names: string[],
  /** Called with the names whose lookup failed (after one retry), so a caller can ask again later. */
  onFailed?: (names: string[]) => void
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(names.map((n) => n.trim().toLowerCase().replace(/ /g, '_')).filter(Boolean)))
  const overrides: Record<string, string> = {}
  if (unique.length === 0) return overrides

  const CHUNK = 150
  // A large pool sends many chunks at once; a few at a time keeps them from failing together.
  const PARALLEL = 4
  const supabase = createClient()
  if (!supabase) return overrides
  const chunks: string[][] = []
  for (let i = 0; i < unique.length; i += CHUNK) chunks.push(unique.slice(i, i + CHUNK))

  const failed: string[] = []
  const fetchChunk = async (chunk: string[], retried = false): Promise<void> => {
    const { data, error } = await supabase
      .from('auto_suggest_tags')
      .select('name, category, category_name, subcategory')
      .eq('status', 'approved')
      .in('name', chunk)
    if (error || !data) {
      if (!retried) return fetchChunk(chunk, true)
      if (error) console.warn('fetchTagOverridesForNames chunk failed:', error.message)
      failed.push(...chunk)
      return
    }
    data.forEach((tag: { name: string; category: number | null; category_name: string | null; subcategory?: string | null }) => {
      if (!tag.name || !tag.category_name) return
      const val = tag.subcategory ? `${tag.category_name}:${tag.subcategory}` : tag.category_name
      if (val === 'other:character' && tag.category != null && tag.category !== DANBOORU_CHARACTER) return
      overrides[tag.name] = val
      if (tag.name.includes('_')) overrides[tag.name.replace(/_/g, ' ')] = val
    })
  }

  for (let i = 0; i < chunks.length; i += PARALLEL) {
    await Promise.all(chunks.slice(i, i + PARALLEL).map((chunk) => fetchChunk(chunk)))
  }
  if (failed.length > 0) onFailed?.(failed)
  return overrides
}

/** Gelbooru's own tag types (`gelbooru_tags`), by Gelbooru spelling; null = not in the table. Kept for the session. */
const gelbooruTagCache = new Map<string, number | null>()
const GELBOORU_TAG_CHUNK = 150
const GELBOORU_TAG_PARALLEL = 4

/** A PostgREST `in` list with every value quoted, so commas, parentheses and quotes in names are safe. */
export function postgrestInList(values: readonly string[]): string {
  return `(${values.map((v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')})`
}

/**
 * Gelbooru's type for each tag (0 general, 1 artist, 3 copyright, 4 character, 5 meta,
 * 6 deprecated) from the public `gelbooru_tags` table, a full list of Gelbooru's tags
 * with enough posts. `names` in any spelling ("pokemon scarlet and violet" or with
 * underscores); the result is keyed by the spaced form, with null for a tag the table
 * doesn't have. Answers are kept for the session. Throws when a chunk can't be read,
 * so the caller can fall back instead of reading "no row" for "unknown".
 */
export async function fetchGelbooruTagCategories(names: readonly string[]): Promise<Map<string, number | null>> {
  const spaced = (name: string) => name.trim().toLowerCase().replace(/_/g, ' ')
  const wanted = Array.from(new Set(names.map(spaced).filter(Boolean)))
  const missing = wanted.filter((name) => !gelbooruTagCache.has(name))
  if (missing.length > 0) {
    const supabase = createClient()
    if (!supabase) throw new Error('Supabase is not configured')
    const chunks = chunked(missing, GELBOORU_TAG_CHUNK)
    for (let i = 0; i < chunks.length; i += GELBOORU_TAG_PARALLEL) {
      await Promise.all(chunks.slice(i, i + GELBOORU_TAG_PARALLEL).map(async (chunk) => {
        const { data, error } = await supabase
          .from('gelbooru_tags')
          .select('name, category')
          .filter('name', 'in', postgrestInList(chunk.map((name) => name.replace(/ /g, '_'))))
        if (error || !Array.isArray(data)) throw new Error(error?.message ?? 'gelbooru_tags lookup failed')
        const found = new Map((data as { name: string; category: number }[]).map((row) => [spaced(row.name), Number(row.category)]))
        chunk.forEach((name) => gelbooruTagCache.set(name, found.get(name) ?? null))
      }))
    }
  }
  return new Map(wanted.map((name) => [name, gelbooruTagCache.get(name) ?? null]))
}

/**
 * Approved taxonomy slots for a booru's own tag spellings (`lookup_provider_tag_slots`),
 * as overrides under both key shapes. `names` use the provider spelling (see
 * providerSlotNames). Sent in chunks the RPC accepts; a failed chunk is skipped.
 */
export async function fetchProviderTagSlots(provider: string, names: string[]): Promise<Record<string, string>> {
  if (names.length === 0) return {}
  const supabase = createClient()
  if (!supabase) return {}
  const results = await Promise.all(chunked(names, PROVIDER_SLOT_CHUNK).map(async (chunk) => {
    const { data, error } = await supabase.rpc('lookup_provider_tag_slots', { p_provider: provider, p_names: chunk })
    if (error || !Array.isArray(data)) {
      if (error) console.warn('fetchProviderTagSlots chunk failed:', error.message)
      return {}
    }
    return slotRowsToOverrides(data as ProviderSlotRow[])
  }))
  return Object.assign({}, ...results)
}

/**
 * Fetches tag overrides from localStorage if valid, otherwise queries getAllTagOverridesClient and caches them.
 */
export async function getCachedTagOverrides(): Promise<Record<string, string>> {
  const CACHE_KEY = 'booru-tag-overrides'
  const CACHE_TIME_KEY = 'booru-tag-overrides-timestamp'
  const CACHE_VERSION_KEY = 'booru-tag-overrides-version'
  const CACHE_DURATION = 24 * 60 * 60 * 1000 // 24 hours

  if (typeof window !== 'undefined') {
    try {
      const cached = localStorage.getItem(CACHE_KEY)
      const timestamp = localStorage.getItem(CACHE_TIME_KEY)
      if (cached && timestamp && localStorage.getItem(CACHE_VERSION_KEY) === pkg.version) {
        const age = Date.now() - parseInt(timestamp, 10)
        if (age < CACHE_DURATION) {
          return JSON.parse(cached)
        }
      }
    } catch (e) {
      console.warn('Failed to read tag overrides cache from localStorage:', e)
    }
  }

  // Fallback to fetching snapshot / Supabase
  const overrides = await getAllTagOverridesClient()

  if (typeof window !== 'undefined' && Object.keys(overrides).length > 0) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(overrides))
      localStorage.setItem(CACHE_TIME_KEY, Date.now().toString())
      localStorage.setItem(CACHE_VERSION_KEY, pkg.version)
    } catch (e) {
      console.warn('Failed to save tag overrides cache to localStorage:', e)
    }
  }

  return overrides
}
