import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'edge'

const API_CONFIG = {
  baseUrl: "https://aibooru.online",
  defaultParams: {
    limit: "20",
    only: "id,file_url,large_file_url,preview_file_url,tag_string,tag_string_artist,tag_string_character,tag_string_copyright,rating,score,ai_metadata",
  },
  randomParams: {
    limit: "15",
  },
  timeout: 8000,
}

interface AibooruPost {
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
  ai_metadata?: {
    prompt?: string
    negative_prompt?: string
    model?: string
    steps?: number
    cfg_scale?: number
    sampler?: string
    seed?: number
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const page = searchParams.get('page') || '1'
  const tags = searchParams.get('tags') || ''
  const order = searchParams.get('order') || 'popular'
  const hasPrompt = searchParams.get('hasPrompt') === 'true'
  
  const cacheKey = `aibooru-${tags}-${page}-${order}-${hasPrompt}`
  const cacheDuration = 600
  
  try {
    let finalTags: string
    
    // Add has:prompt filter if requested
    const promptFilter = hasPrompt ? 'has:prompt' : ''
    
    if (order === 'recent') {
      finalTags = [tags, promptFilter].filter(Boolean).join(' ').trim()
    } else if (order === 'random') {
      const randomCount = API_CONFIG.randomParams.limit
      const baseRandomTags = [tags, promptFilter, `random:${randomCount}`].filter(Boolean).join(' ')
      finalTags = baseRandomTags
    } else {
      // For popular posts, use order:rank
      const basePopularTags = [tags, promptFilter, 'order:rank'].filter(Boolean).join(' ')
      finalTags = basePopularTags
    }
    
    const params = new URLSearchParams({
      ...API_CONFIG.defaultParams,
      ...(order === 'random' ? API_CONFIG.randomParams : {}),
      page,
      tags: finalTags,
    })

    const url = new URL('https://aibooru.online/posts.json')
    url.search = params.toString()

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.timeout)

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://aibooru.online/',
        'Origin': 'https://aibooru.online',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
      },
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      // Log detailed error information for debugging
      const errorText = await response.text().catch(() => 'No error body')
      console.error(`Aibooru API Error ${response.status}:`, {
        status: response.status,
        statusText: response.statusText,
        url: url.toString(),
        headers: Object.fromEntries(response.headers.entries()),
        body: errorText.substring(0, 500), // First 500 chars
      })
      
      if (response.status === 429) {
        return NextResponse.json(
          { error: 'Rate limit exceeded' },
          { status: 429, headers: { 'Retry-After': '60' } }
        )
      }
      
      if (response.status === 403) {
        return NextResponse.json(
          { 
            error: 'Access forbidden by Aibooru',
            message: 'Aibooru is blocking requests from this server. This is a known issue with their API.',
            suggestion: 'Try using Danbooru or Rule34 instead, or access Aibooru directly at https://aibooru.online',
            statusCode: 403
          },
          { status: 403 }
        )
      }
      
      if (response.status === 422 && order === 'random') {
        return NextResponse.json(
          { 
            error: 'Search timeout - try a more specific search or different tags',
            suggestion: 'Random searches work better with specific tags or recent content'
          },
          { status: 422 }
        )
      }
      
      return NextResponse.json(
        { 
          error: 'Failed to fetch from Aibooru',
          statusCode: response.status,
          statusText: response.statusText,
          details: errorText.substring(0, 200)
        },
        { status: response.status }
      )
    }

    const data = await response.json()
    
    // Filter valid posts (exclude video files and deleted)
    const validPosts: AibooruPost[] = data.filter((post: AibooruPost) => 
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
        'X-Content-Type-Options': 'nosniff',
        'X-API-Version': '1.0',
        'X-Total-Count': validPosts.length.toString(),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
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