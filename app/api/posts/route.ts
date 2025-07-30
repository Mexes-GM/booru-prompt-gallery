import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'edge'

const API_CONFIG = {
  baseUrl: "https://danbooru.donmai.us",
  defaultParams: {
    limit: "20",
    only: "id,file_url,large_file_url,preview_file_url,tag_string,tag_string_artist,tag_string_character,tag_string_copyright,rating,score",
  },
  timeout: 10000,
}

interface DanbooruPost {
  id: number
  file_url: string
  large_file_url: string
  preview_file_url: string
  tag_string: string
  tag_string_artist: string
  tag_string_character: string
  tag_string_copyright: string
  rating: string
  score: number
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const page = searchParams.get('page') || '1'
  const tags = searchParams.get('tags') || 'rating:safe'
  const order = searchParams.get('order') || 'popular'
  
  // Cache configuration
  const cacheKey = `danbooru-${tags}-${page}-${order}`
  const cacheDuration = 300 // 5 minutes in seconds
  
  try {
    // Build optimized URL
    const orderParam = order === 'recent' ? 'id:desc' : 'rank'
    const finalTags = tags ? `${tags} order:${orderParam}` : `order:${orderParam}`
    
    const params = new URLSearchParams({
      ...API_CONFIG.defaultParams,
      page,
      tags: finalTags,
    })

    const url = `${API_CONFIG.baseUrl}/posts.json?${params}`

    // Make request with timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.timeout)

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'DanbooruPromptGenerator/1.0',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
      },
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      if (response.status === 429) {
        return NextResponse.json(
          { error: 'Rate limit exceeded' },
          { status: 429, headers: { 'Retry-After': '60' } }
        )
      }
      
      return NextResponse.json(
        { error: 'Failed to fetch from Danbooru' },
        { status: response.status }
      )
    }

    const data = await response.json()
    
    // Filter valid posts (exclude video files)
    const validPosts: DanbooruPost[] = data.filter((post: any) => 
      post && 
      post.file_url && 
      !post.file_url.includes("deleted") && 
      post.id && 
      post.tag_string &&
      !post.file_url.match(/\.(mp4|webm|avi|mov|mkv)$/i)
    )

    // Return response with aggressive caching
    return NextResponse.json(validPosts, {
      headers: {
        'Cache-Control': `public, s-maxage=${cacheDuration}, stale-while-revalidate=${cacheDuration * 2}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheDuration}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheDuration * 2}`,
        'ETag': `"${cacheKey}"`,
      },
    })

  } catch (error) {
    console.error('Error fetching posts:', error)
    
    let errorMessage = 'Internal server error'
    if (error instanceof Error) {
      errorMessage = error.message
    }
    
    return NextResponse.json(
      { error: errorMessage, timestamp: new Date().toISOString() },
      { status: 500, headers: { 'Cache-Control': 'no-cache' } }
    )
  }
}