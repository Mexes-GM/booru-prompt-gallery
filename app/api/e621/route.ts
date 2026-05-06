import { NextRequest, NextResponse } from 'next/server'
import { BooruFactory } from '@/lib/booru/factory'

export const runtime = 'edge'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const page = searchParams.get('page') || '1'
  const tags = searchParams.get('tags') || ''
  const order = (searchParams.get('order') || 'popular') as 'popular' | 'recent' | 'random'
  
  // Cache key specific to e621
  const cacheKey = `e621-${tags}-${page}-${order}`
  const cacheDuration = 300 // 5 minutes
  
  try {
    const provider = BooruFactory.getProvider('e621')
    const posts = await provider.search({ tags, page, order })

    return NextResponse.json(posts, {
      headers: {
        'Cache-Control': `public, s-maxage=${cacheDuration}, stale-while-revalidate=${cacheDuration * 2}`,
'CDN-Cache-Control': `public, s-maxage=${cacheDuration}`,
				'Netlify-CDN-Cache-Control': `public, s-maxage=${cacheDuration * 2}`,
				'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheDuration * 2}`,
        'ETag': `"${cacheKey}"`,
        'X-Content-Type-Options': 'nosniff',
        'X-API-Version': '1.0',
        'X-Total-Count': posts.length.toString(),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
'Access-Control-Allow-Headers': 'Content-Type',
				'Vary': 'Accept, Accept-Encoding',
			},
    })

  } catch (error: any) {
    console.error('API Error:', error)
    const status = error.status || 500
    
	if (status === 429 || status === 503) {
		return NextResponse.json(
			{ error: 'Rate limit exceeded or service unavailable' },
			{ status: 503, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store', 'Netlify-CDN-Cache-Control': 'no-store' } }
		)
	}

	return NextResponse.json(
		{ error: error.message || 'Internal server error', timestamp: new Date().toISOString() },
		{ status: status, headers: { 'Cache-Control': 'no-store', 'Netlify-CDN-Cache-Control': 'no-store' } }
	)
  }
}
