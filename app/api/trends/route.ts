import { NextRequest, NextResponse } from 'next/server'
import { BooruFactory } from '@/lib/booru/factory'
import { getCachedTrends, tryAcquireTrendFetchLock, setCachedTrends } from '@/lib/trend-cache'
import { coalesce } from '@/lib/request-coalescer'

// Node runtime: getTrending() takes ~20s+ (sequential Danbooru calls with
// rate-limit delays), well past the Edge runtime's execution budget.
export const runtime = 'nodejs'

const CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600',
}

/**
 * Same-origin fallback for the /api/trends endpoint the Cloudflare Worker
 * normally serves (workers/booru-image-proxy/src/routes/trends.ts). Used
 * whenever NEXT_PUBLIC_IMAGE_PROXY_URL is unset — local dev, or production
 * without the Worker configured — so the Trending panel isn't a dead end.
 *
 * Mirrors the Worker's cache-first + fetch-lock strategy, but backed by
 * lib/trend-cache.ts (Supabase `trend_cache` table) instead of duplicating
 * the read/lock/write logic inline.
 */
export async function GET(_request: NextRequest) {
  try {
    // 1. Serve from cache if fresh
    const cached = await getCachedTrends()
    if (cached && cached.length > 0) {
      return NextResponse.json(cached, { headers: CACHE_HEADERS })
    }

    // 2. Cache miss/expired — try to acquire the fetch lock
    const acquired = await tryAcquireTrendFetchLock()
    if (!acquired) {
      return NextResponse.json(
        { message: 'Trends refresh in progress, please retry', retryAfter: 30 },
        { status: 202, headers: { ...CACHE_HEADERS, 'Retry-After': '30' } }
      )
    }

    // 3. We hold the lock — fetch fresh data from Danbooru (deduped across
    // concurrent requests that raced past the lock check in the same tick)
    const provider = BooruFactory.getProvider('danbooru')
    if (!provider.getTrending) {
      return NextResponse.json(
        { error: 'Provider does not support trending' },
        { status: 501 }
      )
    }

    const trends = await coalesce('trends:danbooru', () => provider.getTrending!(), 5000)
    const gotTrends = Array.isArray(trends) && trends.length > 0

    if (gotTrends) {
      await setCachedTrends(trends)
    }

    // Don't let the browser/CDN cache an empty result for 24h — allow a quick retry.
    return NextResponse.json(trends ?? [], {
      headers: gotTrends ? CACHE_HEADERS : { 'Cache-Control': 'no-store' },
    })
  } catch (error: any) {
    console.error('[API /trends] Error:', error?.message || error)
    return NextResponse.json(
      { error: 'Failed to fetch trends' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
