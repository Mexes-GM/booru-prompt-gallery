import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'edge'

const API_CONFIG = {
  baseUrl: "https://danbooru.donmai.us",
  defaultParams: {
    limit: "20",
    only: "id,file_url,large_file_url,preview_file_url,tag_string,tag_string_artist,tag_string_character,tag_string_copyright,rating,score",
  },
  randomParams: {
    limit: "15", // Reduced limit for random searches to improve performance
  },
  timeout: 8000,
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
  const tags = searchParams.get('tags') || ''
  const order = searchParams.get('order') || 'popular'
  
  const cacheKey = `danbooru-${tags}-${page}-${order}`
  const cacheDuration = 600
  
  try {
    let finalTags: string
    if (order === 'recent') {
      // For recent posts, don't use any order tag
      finalTags = tags || ''
    } else if (order === 'random') {
      // For random posts, use random:N which is faster and more reliable than order:random
      // This generates N random results without the database load issues of order:random
      const randomCount = API_CONFIG.randomParams.limit
      const baseRandomTags = tags ? `${tags} random:${randomCount}` : `random:${randomCount}`
      finalTags = baseRandomTags
    } else {
      // For popular posts, use order:rank
      finalTags = tags ? `${tags} order:rank` : 'order:rank'
    }
    
    const params = new URLSearchParams({
      ...API_CONFIG.defaultParams,
      ...(order === 'random' ? API_CONFIG.randomParams : {}),
      page,
      tags: finalTags,
    })

    const url = new URL('https://danbooru.donmai.us/posts.json')
    url.search = params.toString()

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.timeout)

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'BooruPromptGallery/1.0',
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
      
      if (response.status === 422 && order === 'random') {
        // Handle search timeout for random searches
        return NextResponse.json(
          { 
            error: 'Search timeout - try a more specific search or different tags',
            suggestion: 'Random searches work better with specific tags or recent content'
          },
          { status: 422 }
        )
      }
      
      return NextResponse.json(
        { error: 'Failed to fetch from Danbooru' },
        { status: response.status }
      )
    }

    const data = await response.json()
    
    // Filter valid posts (exclude video files and deleted)
    const validPosts: DanbooruPost[] = data.filter((post: DanbooruPost) => 
      post && 
      post.file_url && 
      !post.file_url.includes("deleted") && 
      post.id && 
      post.tag_string &&
      !post.file_url.match(/\.(mp4|webm|avi|mov|mkv)$/i)
    )

    return NextResponse.json(validPosts, {
      headers: {
        'Cache-Control': `public, s-maxage=${cacheDuration}, stale-while-revalidate=${cacheDuration * 2}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheDuration}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheDuration * 2}`,
        'ETag': `"${cacheKey}"`,
      },
    })

  } catch (error) {
    
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
