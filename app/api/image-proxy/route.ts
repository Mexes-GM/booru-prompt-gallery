import { NextRequest, NextResponse } from 'next/server'
import { PROVIDER_REFERERS, USER_AGENT, USER_AGENT_DANBOORU } from '@/lib/constants'

export const runtime = 'nodejs'

const ALLOWED_DOMAINS = [
    'gelbooru.com',
    'img1.gelbooru.com',
    'img2.gelbooru.com',
    'img3.gelbooru.com',
    // Danbooru images go through the Cloudflare Worker (proxy-url.ts),
    // NOT through this Vercel proxy. Allowing them here would bypass
    // all rate limiting and circuit breaker protections.
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
        const isDanbooru = parsedUrl.hostname.includes('danbooru') || parsedUrl.hostname.includes('donmai.us')

        const fetchHeaders: HeadersInit = {
            'User-Agent': isDanbooru ? USER_AGENT_DANBOORU : USER_AGENT,
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        }

        // Add Danbooru authentication if credentials are available
        if (isDanbooru) {
            const username = process.env.DANBOORU_USERNAME
            const apiKey = process.env.DANBOORU_API_KEY

            if (username && apiKey) {
                // HTTP Basic Auth: base64(username:api_key)
                const credentials = Buffer.from(`${username}:${apiKey}`).toString('base64')
                fetchHeaders['Authorization'] = `Basic ${credentials}`
            }

            // Use Danbooru's own referer to bypass hotlink protection
            fetchHeaders['Referer'] = 'https://danbooru.donmai.us/'
        } else {
            // Add referer for other providers
            fetchHeaders['Referer'] = PROVIDER_REFERERS.GELBOORU
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
                'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400, immutable',
                'CDN-Cache-Control': 'public, s-maxage=604800, stale-while-revalidate=86400',
                'Vercel-CDN-Cache-Control': 'public, s-maxage=604800, stale-while-revalidate=86400',
                'Access-Control-Allow-Origin': '*',
            },
        })
    } catch (error) {
        console.error('Image proxy error:', error)
        return NextResponse.json({ error: 'Failed to fetch image' }, { status: 502 })
    }
}
