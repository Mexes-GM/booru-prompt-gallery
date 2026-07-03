import type { BooruPost } from "@/lib/booru/types"
import { createClient } from "@/lib/supabase/client"

// ── LocalStorage cache for favorites posts ──
// Extracted from lib/api-client.ts (Fase 2b del refactor de sostenibilidad):
// pure cache helpers with no React dependency, so they can be imported from
// anywhere (including the useFavoritePosts hook) without pulling in SWR/React.

export interface FavoriteItem {
  id: number
  provider: string
}

const FAV_CACHE_PREFIX = 'booru_fav_cache_'
const MAX_CACHE_ENTRIES = 5
const MAX_CACHE_SIZE = 2_000_000 // 2MB per entry

export function getFavoritesCacheKey(favorites: FavoriteItem[]) {
  if (favorites.length === 0) return null
  const sorted = favorites
    .slice()
    .sort((a, b) => {
      const pDiff = a.provider.localeCompare(b.provider)
      return pDiff !== 0 ? pDiff : a.id - b.id
    })

  let hash = 5381
  for (const f of sorted) {
    const s = `${f.provider}:${f.id}`
    for (let i = 0; i < s.length; i++) {
      hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0
    }
  }
  return `favorites-${favorites.length}-${(hash >>> 0).toString(36)}`
}

export function getCachedFavorites(key: string): BooruPost[] | null {
  if (typeof window === 'undefined') return null
  try {
    const allKeys = Object.keys(localStorage).filter(k => k.startsWith(FAV_CACHE_PREFIX) && k.endsWith(key))
    // Pick the most recent entry by sorting keys (timestamps are lexicographically sortable)
    allKeys.sort()
    const raw = allKeys.length > 0 ? localStorage.getItem(allKeys[allKeys.length - 1]) : null
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as BooruPost[]
  } catch { /* corrupt entry */ }
  return null
}

export function setCachedFavorites(key: string, data: BooruPost[]): void {
  if (typeof window === 'undefined' || data.length === 0) return
  try {
    const serialized = JSON.stringify(data)
    if (serialized.length > MAX_CACHE_SIZE) return // too large, skip
    localStorage.setItem(`${FAV_CACHE_PREFIX}${Date.now()}_${key}`, serialized)
    // Prune old entries, keep only the most recent MAX_CACHE_ENTRIES
    const allKeys = Object.keys(localStorage)
      .filter(k => k.startsWith(FAV_CACHE_PREFIX))
      .sort()
    if (allKeys.length > MAX_CACHE_ENTRIES) {
      // Remove oldest entries (first in alphabetical = oldest timestamp prefix)
      const toRemove = allKeys.slice(0, allKeys.length - MAX_CACHE_ENTRIES)
      toRemove.forEach(k => localStorage.removeItem(k))
    }
  } catch {
    // localStorage full — clear all favorites cache
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith(FAV_CACHE_PREFIX))
        .forEach(k => localStorage.removeItem(k))
    } catch { /* hopeless */ }
  }
}

/**
 * Merge cached posts from ALL previous cache entries.
 * When adding/removing a single favorite, the exact cache key changes,
 * but individual posts are still valid. This avoids re-fetching 87 posts
 * just because 1 new favorite was added.
 */
export function getMergedCachedFavorites(favorites: FavoriteItem[]): BooruPost[] {
  if (typeof window === 'undefined') return []
  const postMap = new Map<string, BooruPost>()
  const allKeys = Object.keys(localStorage)
    .filter(k => k.startsWith(FAV_CACHE_PREFIX))
    // Process newest entries LAST so they overwrite older ones
    .sort()

  for (const key of allKeys) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const posts = JSON.parse(raw)
      if (!Array.isArray(posts)) continue
      for (const post of posts) {
        if (post && post._provider && post.id) {
          const entryKey = `${(post._provider as string).toLowerCase()}:${post.id}`
          // Let newer entries overwrite older (no has() check)
          postMap.set(entryKey, post as BooruPost)
        }
      }
    } catch { /* corrupt entry, skip */ }
  }

  return favorites
    .map(f => postMap.get(`${f.provider}:${f.id}`))
    .filter((p): p is BooruPost => p !== undefined)
}

// ── Supabase booru_posts_cache row <-> BooruPost conversion ──
// NOTE: this is a DIFFERENT cache layer than lib/cache-utils.ts's
// booruPostToCacheRow (which targets the same `booru_posts_cache` table but
// returns a strongly-typed `CachedPost`). Both exist; do not merge them in
// this pass — that would be a separate, riskier unification.

export interface CachedPostRow {
  provider: string
  post_id: number
  file_url: string | null
  large_file_url: string | null
  preview_file_url: string | null
  rating: string
  score: number
  image_width: number
  image_height: number
  tag_string: { general: string[]; artist: string[]; character: string[]; copyright: string[] } | string | null
  tag_string_artist: string | null
  tag_string_character: string | null
  tag_string_copyright: string | null
  tag_string_meta: string | null
  ai_metadata: Record<string, unknown> | null
}

export function cachedRowToBooruPost(row: CachedPostRow): BooruPost {
  let tagStr = ''
  if (row.tag_string) {
    if (typeof row.tag_string === 'string') {
      tagStr = row.tag_string
    } else {
      const all: string[] = []
      Object.values(row.tag_string).forEach(arr => { if (Array.isArray(arr)) all.push(...arr) })
      tagStr = all.join(' ')
    }
  }
  return {
    id: row.post_id,
    file_url: row.file_url || '',
    large_file_url: row.large_file_url || row.file_url || '',
    preview_file_url: row.preview_file_url || row.file_url || '',
    tag_string: tagStr,
    tag_string_artist: row.tag_string_artist || '',
    tag_string_character: row.tag_string_character || '',
    tag_string_copyright: row.tag_string_copyright || '',
    tag_string_meta: row.tag_string_meta || undefined,
    rating: row.rating || 'q',
    score: row.score || 0,
    width: row.image_width || 0,
    height: row.image_height || 0,
    _provider: row.provider,
    ai_metadata: row.ai_metadata as BooruPost['ai_metadata'] || undefined,
  }
}

// Convert a BooruPost to a booru_posts_cache row for upsert.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function booruPostToCacheRow(post: BooruPost, provider: string): any {
  const tags = (post.tag_string || '').split(/\s+/).filter(Boolean)
  const artistTags = (post.tag_string_artist || '').split(/\s+/).filter(Boolean)
  const charTags = (post.tag_string_character || '').split(/\s+/).filter(Boolean)
  const copyTags = (post.tag_string_copyright || '').split(/\s+/).filter(Boolean)
  return {
    provider,
    post_id: post.id,
    file_url: post.file_url || null,
    large_file_url: post.large_file_url || null,
    preview_file_url: post.preview_file_url || null,
    rating: post.rating || 'q',
    score: post.score || 0,
    image_width: post.width || 0,
    image_height: post.height || 0,
    tag_string: {
      general: tags.filter(t => !artistTags.includes(t) && !charTags.includes(t) && !copyTags.includes(t)),
      artist: artistTags,
      character: charTags,
      copyright: copyTags,
    },
    tag_string_artist: post.tag_string_artist || null,
    tag_string_character: post.tag_string_character || null,
    tag_string_copyright: post.tag_string_copyright || null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tag_string_meta: (post as any).tag_string_meta || null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ai_metadata: (post as any).ai_metadata || null,
    stale_at: null,
  }
}

// Persist fetched posts to Supabase booru_posts_cache for future visits.
export async function persistToCache(posts: BooruPost[]): Promise<void> {
  if (posts.length === 0) return
  try {
    const supabase = createClient()
    const rows = posts.map(p => booruPostToCacheRow(p, p._provider || 'danbooru'))
    const { error } = await supabase.from('booru_posts_cache').upsert(rows, {
      onConflict: 'provider,post_id',
      ignoreDuplicates: false,
    })
    if (error) console.warn('[persistToCache] Upsert failed:', error.message)
  } catch (e) {
    console.warn('[persistToCache] Failed:', e)
  }
}
