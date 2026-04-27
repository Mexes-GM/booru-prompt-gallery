const ALLOWED_DOMAINS = [
  'gelbooru.com',
  'img1.gelbooru.com',
  'img2.gelbooru.com',
  'img3.gelbooru.com',
  'danbooru.donmai.us',
  'cdn.donmai.us',
]

export default {
  async fetch(request, env, ctx) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400',
        },
      })
    }

    const url = new URL(request.url)
    const imageUrl = url.searchParams.get('url')

    if (!imageUrl) {
      return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    let parsedUrl
    try {
      parsedUrl = new URL(imageUrl)
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid URL' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    if (!ALLOWED_DOMAINS.some(d => parsedUrl.hostname === d || parsedUrl.hostname.endsWith(`.${d}`))) {
      return new Response(JSON.stringify({ error: 'Domain not allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    // Check Cloudflare cache first
    const cache = caches.default
    const cacheKey = new Request(request.url, request)
    let cached = await cache.match(cacheKey)
    if (cached) return cached

    try {
      const headers = {
        'User-Agent': 'boorugallery/9.2.1 (Danbooru user: Momon312)',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      }

      const isDanbooru = parsedUrl.hostname.includes('danbooru') || parsedUrl.hostname.includes('donmai.us')

      if (isDanbooru) {
        const username = env.DANBOORU_USERNAME || 'Momon312'
        const apiKey = env.DANBOORU_API_KEY

        if (username && apiKey) {
          const credentials = btoa(`${username}:${apiKey}`)
          headers['Authorization'] = `Basic ${credentials}`
        }

        headers['Referer'] = 'https://danbooru.donmai.us/'
      } else {
        headers['Referer'] = 'https://gelbooru.com/'
      }

      let response = await fetch(imageUrl, { headers, redirect: 'follow' })

      // Fallback: /samples/ → /images/
      if (!response.ok && imageUrl.includes('/samples/')) {
        const fallbackUrl = imageUrl
          .replace('/samples/', '/images/')
          .replace(/\/sample_([^/]+)$/, '/$1')
        response = await fetch(fallbackUrl, { headers, redirect: 'follow' })
      }

      if (!response.ok) {
        return new Response(JSON.stringify({ error: `Upstream error: ${response.status}` }), {
          status: response.status,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        })
      }

      const contentType = response.headers.get('content-type') || 'image/jpeg'

      const proxyResponse = new Response(response.body, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400, immutable',
          'Access-Control-Allow-Origin': '*',
        },
      })

      // Store in Cloudflare cache (async, doesn't block response)
      ctx.waitUntil(cache.put(cacheKey, proxyResponse.clone()))

      return proxyResponse
    } catch {
      return new Response(JSON.stringify({ error: 'Failed to fetch image' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }
  },
}
