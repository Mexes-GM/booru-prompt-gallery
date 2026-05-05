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

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const category = searchParams.get('category')

  try {
    const now = Date.now()
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
				'Netlify-CDN-Cache-Control': 'public, s-maxage=86400',
				'Vercel-CDN-Cache-Control': 'public, s-maxage=86400',
        'X-Content-Type-Options': 'nosniff',
        'X-API-Version': '1.1',
        'X-Total-Count': filteredTags.length.toString(),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })

  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: { 'Cache-Control': 'no-cache' } }
    )
  }
}
