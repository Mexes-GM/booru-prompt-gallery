
import { NextResponse } from 'next/server'
import { BooruFactory } from '@/lib/booru/factory'

export async function GET() {
  try {
    // Specifically request Danbooru for trends as it has the best ranking data
    const provider = BooruFactory.getProvider('danbooru')
    
    if (!provider.getTrending) {
      return NextResponse.json({ error: 'Provider does not support trending' }, { status: 501 })
    }

    const trends = await provider.getTrending()
    
    // Add cache headers - cache for 1 hour as trends don't change by the second
    return NextResponse.json(trends, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600',
      },
    })
  } catch (error) {
    console.error('Trend API Error:', error)
    return NextResponse.json({ error: 'Failed to fetch trends' }, { status: 500 })
  }
}
