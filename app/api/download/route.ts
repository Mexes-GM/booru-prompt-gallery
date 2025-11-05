import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'edge'

/**
 * Download Proxy Endpoint
 * 
 * This endpoint acts as a proxy to download images from Booru sites,
 * bypassing CORS restrictions that prevent direct downloads from the browser.
 */

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const imageUrl = searchParams.get('url')
  
  if (!imageUrl) {
    return NextResponse.json(
      { error: 'Missing image URL' },
      { status: 400 }
    )
  }

  // Validate that the URL is from a trusted Booru domain
  const allowedDomains = [
    'danbooru.donmai.us',
    'cdn.donmai.us',
    'aibooru.online',
    'rule34.xxx',
    'api-cdn.rule34.xxx',
    'us.rule34.xxx',
    'wimg.rule34.xxx',
  ]

  let urlDomain: string
  try {
    const url = new URL(imageUrl)
    urlDomain = url.hostname
  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid URL' },
      { status: 400 }
    )
  }

  const isAllowedDomain = allowedDomains.some(domain => 
    urlDomain === domain || urlDomain.endsWith(`.${domain}`)
  )

  if (!isAllowedDomain) {
    return NextResponse.json(
      { error: 'URL domain not allowed' },
      { status: 403 }
    )
  }

  try {
    // Fetch the image with appropriate headers
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000) // 30 second timeout

    const response = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': urlDomain.includes('rule34') 
          ? 'https://rule34.xxx/' 
          : urlDomain.includes('aibooru') 
            ? 'https://aibooru.online/' 
            : 'https://danbooru.donmai.us/',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'image',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'same-origin',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch image: ${response.status} ${response.statusText}` },
        { status: response.status }
      )
    }

    // Get the image data
    const imageData = await response.arrayBuffer()
    
    // Get the content type from the response or infer from URL
    const contentType = response.headers.get('content-type') || 'image/jpeg'
    
    // Extract filename from URL
    const urlPath = imageUrl.split('?')[0]
    const filename = urlPath.split('/').pop() || 'download.jpg'

    // Return the image with appropriate headers
    return new NextResponse(imageData, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })

  } catch (error) {
    console.error('Download proxy error:', error)
    
    let errorMessage = 'Failed to download image'
    if (error instanceof Error) {
      errorMessage = error.message
    }
    
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}
