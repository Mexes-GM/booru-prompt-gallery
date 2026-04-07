import { NextResponse } from 'next/server'
import { smartFetch } from '@/lib/network/smart-fetch'
import { PROVIDER_URLS } from '@/lib/constants'

// Vercel Edge Runtime for faster performance
export const runtime = 'edge'

// Very cacheable route
export const revalidate = 3600 // 1 hour

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const provider = searchParams.get('provider') || 'danbooru'
    const tagsParam = searchParams.get('tags')

    if (!tagsParam) {
      return NextResponse.json({ error: 'Missing tags parameter' }, { status: 400 })
    }

    if (provider !== 'danbooru' && provider !== 'aibooru') {
      // Tags count API is specific to Danbooru-like APIs
      return NextResponse.json({}, { status: 200 })
    }

    const baseUrl = provider === 'aibooru' ? PROVIDER_URLS.AIBOORU : PROVIDER_URLS.DANBOORU
    
    // API Route for Danbooru: https://danbooru.donmai.us/tags.json?search[category]=4&search[name_comma]=tag1,tag2&limit=100
    const url = new URL(`${baseUrl}/tags.json`)
    url.searchParams.set('search[category]', '4') // 4 = character
    url.searchParams.set('search[name_comma]', tagsParam)
    url.searchParams.set('limit', '100')

    const response = await smartFetch(url.toString(), {
      retries: 2,
      retryDelay: 1000,
    })

    if (!response.ok) {
      console.error(`Failed to fetch tags from ${provider}: ${response.status}`)
      return NextResponse.json({ error: 'Failed to fetch tags' }, { status: response.status })
    }

    const data = await response.json()
    
    // Transform into { tag_name: count } map
    const tagCounts: Record<string, number> = {}
    
    if (Array.isArray(data)) {
      data.forEach((tag: any) => {
        if (tag.name && typeof tag.post_count === 'number') {
          tagCounts[tag.name] = tag.post_count
        }
      })
    }

    return NextResponse.json(tagCounts, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    })
  } catch (error) {
    console.error('Error fetching batch tag counts:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
