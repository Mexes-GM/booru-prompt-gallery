
import { NextResponse } from 'next/server'
import { BooruFactory } from '@/lib/booru/factory'
import { getCachedTrends, setCachedTrends, tryAcquireTrendFetchLock } from '@/lib/trend-cache'

// Cache-Control: serve cached for 24h, allow stale for 1h while revalidating
const CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600',
}

export async function GET() {
  try {
    // 1. Try to serve from Supabase cache first
    const cached = await getCachedTrends()

    if (cached && cached.length > 0) {
      return NextResponse.json(cached, { headers: CACHE_HEADERS })
    }

    // 2. Cache miss or expired — try to acquire fetch lock
    const acquired = await tryAcquireTrendFetchLock()

    if (!acquired) {
      return NextResponse.json(
        { message: 'Trends refresh in progress, please retry', retryAfter: 30 },
        {
          status: 202,
          headers: {
            ...CACHE_HEADERS,
            'Retry-After': '30',
          },
        }
      )
    }

    // 3. We hold the lock — fetch fresh data from Danbooru
    const provider = BooruFactory.getProvider('danbooru')

    if (!provider.getTrending) {
      return NextResponse.json(
        { error: 'Provider does not support trending' },
        { status: 501 }
      )
    }

    const trends = await provider.getTrending()

    // 4. Store in Supabase cache (fire-and-forget, don't block response)
    setCachedTrends(trends).catch((err) =>
      console.error('[trends] Failed to persist cache:', err)
    )

    return NextResponse.json(trends, { headers: CACHE_HEADERS })
  } catch (error) {
    console.error('Trend API Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch trends' },
      { status: 500 }
    )
  }
}
