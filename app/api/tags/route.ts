import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'edge'

interface TagData {
  name: string
  category: number
  aliases?: string[]
}

let tagsCache: TagData[] | null = null
let cacheTimestamp = 0
const CACHE_DURATION = 24 * 60 * 60 * 1000 // 24 hours

// Row ceiling for a category-filtered request. Same number as the unfiltered
// cache below, so the response size never regresses; comfortably covers the
// only small category (5 = meta, 460 rows). The bigger ones (0/1/3/4 range from
// ~10k to ~60k) get truncated by post_count, most-used first.
const FILTERED_LIMIT = 3000

function jsonResponse(tags: TagData[]) {
  return NextResponse.json(tags, {
    headers: {
      'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400',
      'CDN-Cache-Control': 'public, s-maxage=86400',
      'Netlify-CDN-Cache-Control': 'public, s-maxage=86400',
      'Vercel-CDN-Cache-Control': 'public, s-maxage=86400',
      'Vary': 'Accept, Accept-Encoding',
      'X-Content-Type-Options': 'nosniff',
      'X-API-Version': '1.1',
      'X-Total-Count': tags.length.toString(),
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const category = searchParams.get('category')
  const categoryNum = category !== null ? parseInt(category) : NaN
  const hasCategoryFilter = !isNaN(categoryNum)

  try {
    const now = Date.now()

    // A category filter has to be pushed down into the query, not applied to
    // the cache. The cache holds an arbitrary, unordered 3000-row slice of
    // ~145k rows, so filtering it in memory returned a near-random handful of
    // the matching tags instead of all of them (category=5 has 460 rows
    // upstream, and this endpoint used to answer with whatever few happened to
    // land in the slice). Filtered requests bypass the shared cache and query
    // directly, keeping the same 3000-row ceiling — strictly better than
    // before, since the rows returned are now actually the matching ones.
    //
    // Ordered by post_count so the ceiling truncates the long tail rather than
    // an arbitrary slice. Uses idx_auto_suggest_tags_category (verified with
    // EXPLAIN ANALYZE against production: Index Scan, ~154ms for category=5),
    // and the CDN headers keep the response cached for 24h.
    if (hasCategoryFilter) {
      const { data, error } = await supabaseAdmin
        .from('auto_suggest_tags')
        .select('name, category')
        .eq('category', categoryNum)
        .order('post_count', { ascending: false })
        .limit(FILTERED_LIMIT)

      if (error) throw error

      return jsonResponse(
        (data ?? []).map(t => ({
          name: t.name,
          category: parseInt(t.category) || 0,
        }))
      )
    }

    if (!tagsCache || now - cacheTimestamp > CACHE_DURATION) {
      try {
        // Try to load from Supabase instead of local JSON
        const { data, error } = await supabaseAdmin
          .from('auto_suggest_tags')
          .select('name, category')
          .limit(3000) // Reduced from 10K to save CPU/bandwidth on cold starts

        if (error) throw error

        if (data && data.length > 0) {
          tagsCache = data.map(t => ({
            name: t.name,
            category: parseInt(t.category) || 0
          }))
        } else {
          throw new Error('No tags in database')
        }

        cacheTimestamp = now
      } catch (error) {
        console.error('Error fetching tags from Supabase, using fallback:', error)
        // Fallback to basic tags
        tagsCache = [
          { name: "signature", category: 5 },
          { name: "twitter username", category: 5 },
          { name: "artist name", category: 1 },
          { name: "watermark", category: 5 },
          { name: "copyright", category: 5 },
          { name: "artist", category: 1 },
          { name: "unknown artist", category: 1 },
          { name: "official art", category: 5 },
          { name: "fan art", category: 5 },
          { name: "commission", category: 5 }
        ]
        cacheTimestamp = now
      }
    }

    // Unfiltered requests serve the shared cache. Category-filtered ones were
    // already answered above with a pushed-down query.
    return jsonResponse(tagsCache)

  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: { 'Cache-Control': 'no-cache' } }
    )
  }
}
