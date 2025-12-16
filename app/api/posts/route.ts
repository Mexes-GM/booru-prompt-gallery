
import { NextRequest, NextResponse } from 'next/server'
import { BooruFactory } from '@/lib/booru/factory'

export const runtime = 'edge'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const page = searchParams.get('page') || '1'
  const tags = searchParams.get('tags') || ''
  const order = (searchParams.get('order') || 'popular') as 'popular' | 'recent' | 'random'
  
  const cacheKey = `danbooru-${tags}-${page}-${order}`
  const cacheDuration = 600
  
  try {
    const provider = BooruFactory.getProvider('danbooru')
    const posts = await provider.search({ tags, page, order })

    return NextResponse.json(posts, {
      headers: {
        'Cache-Control': `public, s-maxage=${cacheDuration}, stale-while-revalidate=${cacheDuration * 2}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheDuration}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheDuration * 2}`,
        'ETag': `"${cacheKey}"`,
        'X-Content-Type-Options': 'nosniff',
        'X-API-Version': '2.0',
        'X-Total-Count': posts.length.toString(),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })

  } catch (error: any) {
    console.error('API Error:', error)
    const status = error.status || 500
    
    if (status === 429) {
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    return NextResponse.json(
      { error: error.message || 'Internal server error', timestamp: new Date().toISOString() },
      { status: status, headers: { 'Cache-Control': 'no-cache' } }
    )
  }
}
