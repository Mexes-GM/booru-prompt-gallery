
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'edge'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const imageUrl = searchParams.get('url')
  
  if (!imageUrl) {
    return NextResponse.json({ error: 'Missing image URL' }, { status: 400 })
  }

  const allowedDomains = [
    'danbooru.donmai.us', 'cdn.donmai.us',
    'aibooru.online',
    'rule34.xxx', 'api-cdn.rule34.xxx', 'us.rule34.xxx', 'wimg.rule34.xxx'
  ]

  let urlDomain: string
  try {
    const url = new URL(imageUrl)
    urlDomain = url.hostname
  } catch (error) {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  const isAllowedDomain = allowedDomains.some(domain => 
    urlDomain === domain || urlDomain.endsWith(`.${domain}`)
  )

  if (!isAllowedDomain) {
    return NextResponse.json({ error: 'URL domain not allowed' }, { status: 403 })
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 60000)

    const response = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Referer': urlDomain.includes('rule34') ? 'https://rule34.xxx/' : 
                   urlDomain.includes('aibooru') ? 'https://aibooru.online/' : 
                   'https://danbooru.donmai.us/',
      },
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch image: ${response.status} ${response.statusText}` },
        { status: response.status }
      )
    }

    if (!response.body) {
      return NextResponse.json({ error: 'Empty response body' }, { status: 500 })
    }

    const urlPath = imageUrl.split('?')[0]
    const filename = urlPath.split('/').pop() || 'download.jpg'
    
    const headers = new Headers()
    headers.set('Content-Type', response.headers.get('content-type') || 'application/octet-stream')
    headers.set('Content-Disposition', `attachment; filename="${filename}"`)
    headers.set('Cache-Control', 'public, max-age=31536000, immutable')
    
    const contentLength = response.headers.get('content-length')
    if (contentLength) {
      headers.set('Content-Length', contentLength)
    }

    return new NextResponse(response.body, {
      status: 200,
      headers,
    })

  } catch (error) {
    console.error('Download proxy error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to download image'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
