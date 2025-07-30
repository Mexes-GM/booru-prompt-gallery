import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'edge'

interface TagData {
  name: string
  category: number
  aliases?: string[]
}

// In-memory cache for tags
let tagsCache: TagData[] | null = null
let cacheTimestamp = 0
const CACHE_DURATION = 24 * 60 * 60 * 1000 // 24 hours

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const category = searchParams.get('category')
  
  try {
    // Check if we have cached tags
    const now = Date.now()
    if (!tagsCache || now - cacheTimestamp > CACHE_DURATION) {
      try {
        // Try to load from local tags.json
        const tagsModule = await import('../../../tags.json')
        tagsCache = tagsModule.default || tagsModule
        cacheTimestamp = now
      } catch (error) {
        // Fallback to basic tags if file doesn't exist
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

    // Filter by category if specified
    let filteredTags = tagsCache
    if (category) {
      const catNum = parseInt(category)
      if (!isNaN(catNum)) {
        filteredTags = tagsCache.filter(tag => tag.category === catNum)
      }
    }

    return NextResponse.json(filteredTags, {
      headers: {
        'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400',
        'CDN-Cache-Control': 'public, s-maxage=86400',
        'Vercel-CDN-Cache-Control': 'public, s-maxage=86400',
      },
    })

  } catch (error) {
    console.error('Error fetching tags:', error)
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: { 'Cache-Control': 'no-cache' } }
    )
  }
}
