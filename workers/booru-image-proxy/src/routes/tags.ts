import { Env } from '../types'
import { getSupabase } from '../lib/supabase'
import { jsonResponse, getClientIp } from '../utils'
import { memoryRateLimit } from '../lib/rate-limit-cache'

interface TagData {
  name: string
  category: number
}

let tagsCache: TagData[] | null = null
let cacheTimestamp = 0
const CACHE_DURATION = 24 * 60 * 60 * 1000

// Row ceiling for a category-filtered request — same as the unfiltered cache
// limit below, so the response size never regresses.
const FILTERED_LIMIT = 3000

function checkRateLimit(clientIp: string): boolean {
  // This route serves a 24h-cached static list — it never touches donmai,
  // so a pure in-memory limiter is enough (Fase 5, redis-optimization-plan.md).
  return memoryRateLimit(`tags:${clientIp}`, 60, 60_000)
}

export async function tagsHandler(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url)
  const category = url.searchParams.get('category')

  // Rate limit — pure in-memory, no Redis (Fase 5).
  const clientIp = getClientIp(request)
  const allowed = checkRateLimit(clientIp)
  if (!allowed) {
    return jsonResponse(
      { error: 'Too many requests. Please wait a moment.' },
      429,
      { 'Retry-After': '10', 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' }
    )
  }

  try {
    const now = Date.now()

    // A category filter has to be pushed down into the query, not applied to
    // the cache. The cache holds an arbitrary, unordered 3000-row slice of
    // ~145k rows, so filtering it in memory returned a near-random handful of
    // the matching tags instead of all of them (category=5 has 460 rows
    // upstream). Filtered requests bypass the shared cache and query directly,
    // keeping the same 3000-row ceiling and ordering by post_count so the
    // truncation drops the long tail instead of an arbitrary slice.
    // Mirrors app/api/tags/route.ts — keep both in sync.
    const categoryNum = category !== null ? parseInt(category) : NaN
    if (!isNaN(categoryNum)) {
      const supabase = getSupabase(env)
      if (supabase) {
        const { data, error } = await supabase
          .from('auto_suggest_tags')
          .select('name, category')
          .eq('category', categoryNum)
          .order('post_count', { ascending: false })
          .limit(FILTERED_LIMIT)

        if (error) throw error

        const filtered: TagData[] = (data ?? []).map((t: any) => ({
          name: t.name,
          category: parseInt(t.category) || 0,
        }))

        return jsonResponse(filtered, 200, {
          'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400',
          'CDN-Cache-Control': 'public, s-maxage=86400',
          'X-Total-Count': String(filtered.length),
        })
      }
      // No Supabase binding: fall through to the hardcoded fallback list below,
      // which the in-memory filter at the end still narrows by category.
    }

    if (!tagsCache || now - cacheTimestamp > CACHE_DURATION) {
      const supabase = getSupabase(env)

      if (!supabase) {
        tagsCache = [
          { name: 'signature', category: 5 },
          { name: 'twitter username', category: 5 },
          { name: 'artist name', category: 1 },
          { name: 'watermark', category: 5 },
          { name: 'copyright', category: 5 },
          { name: 'artist', category: 1 },
          { name: 'unknown artist', category: 1 },
          { name: 'official art', category: 5 },
          { name: 'fan art', category: 5 },
          { name: 'commission', category: 5 },
        ]
        cacheTimestamp = now
      } else {
        try {
          const { data, error } = await supabase
            .from('auto_suggest_tags')
            .select('name, category')
            .limit(3000)

          if (error) throw error

          if (data && data.length > 0) {
            tagsCache = data.map((t: any) => ({
              name: t.name,
              category: parseInt(t.category) || 0,
            }))
          } else {
            throw new Error('No tags in database')
          }
          cacheTimestamp = now
        } catch (error) {
          console.error('[tags] Supabase fetch failed, using fallback:', error)
          tagsCache = [
            { name: 'signature', category: 5 },
            { name: 'twitter username', category: 5 },
            { name: 'artist name', category: 1 },
            { name: 'watermark', category: 5 },
            { name: 'copyright', category: 5 },
            { name: 'artist', category: 1 },
            { name: 'unknown artist', category: 1 },
            { name: 'official art', category: 5 },
            { name: 'fan art', category: 5 },
            { name: 'commission', category: 5 },
          ]
          cacheTimestamp = now
        }
      }
    }

    let filteredTags = tagsCache
    if (category) {
      const catNum = parseInt(category)
      if (!isNaN(catNum)) {
        filteredTags = tagsCache.filter((tag) => tag.category === catNum)
      }
    }

    return jsonResponse(filteredTags, 200, {
      'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400',
      'CDN-Cache-Control': 'public, s-maxage=86400',
      'X-Total-Count': String(filteredTags.length),
    })
  } catch (error) {
    return jsonResponse({ error: 'Internal server error' }, 500, {
      'Cache-Control': 'no-cache',
    })
  }
}
