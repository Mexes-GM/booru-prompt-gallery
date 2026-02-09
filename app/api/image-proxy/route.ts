import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'edge'

const ALLOWED_DOMAINS = [
    'gelbooru.com',
    'img1.gelbooru.com',
    'img2.gelbooru.com',
    'img3.gelbooru.com',
]

export async function GET(request: NextRequest) {
    const url = request.nextUrl.searchParams.get('url')

    if (!url) {
        return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 })
    }

    let parsedUrl: URL
    try {
        parsedUrl = new URL(url)
    } catch {
        return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
    }

    // Security: only proxy from allowed domains
    if (!ALLOWED_DOMAINS.some(d => parsedUrl.hostname === d || parsedUrl.hostname.endsWith(`.${d}`))) {
        return NextResponse.json({ error: 'Domain not allowed' }, { status: 403 })
    }

    try {
        const fetchHeaders = {
            'Referer': 'https://gelbooru.com/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        }

        let response = await fetch(url, { headers: fetchHeaders, redirect: 'follow' })

        // Fallback: if a /samples/ URL returns non-OK, try the original /images/ URL
        if (!response.ok && url.includes('/samples/')) {
            const fallbackUrl = url
                .replace('/samples/', '/images/')
                .replace(/\/sample_([^/]+)$/, '/$1')
            response = await fetch(fallbackUrl, { headers: fetchHeaders, redirect: 'follow' })
        }

        if (!response.ok) {
            return NextResponse.json({ error: `Upstream error: ${response.status}` }, { status: response.status })
        }

        const contentType = response.headers.get('content-type') || 'image/jpeg'
        const body = response.body

        return new NextResponse(body, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=86400, s-maxage=86400',
                'Access-Control-Allow-Origin': '*',
            },
        })
    } catch (error) {
        console.error('Image proxy error:', error)
        return NextResponse.json({ error: 'Failed to fetch image' }, { status: 502 })
    }
}
