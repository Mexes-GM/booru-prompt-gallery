import { NextResponse } from 'next/server'
import { smartFetch } from '@/lib/network/smart-fetch'
import { PROVIDER_URLS, getDanbooruUserAgent } from '@/lib/constants'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getDanbooruApiRateLimit, getDanbooruGlobalRateLimit } from '@/lib/rate-limit'

// Vercel Edge Runtime for faster performance
export const runtime = 'edge'

// Very cacheable route
export const revalidate = 3600 // 1 hour

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const provider = searchParams.get('provider') || 'danbooru'
    const tagsParam = searchParams.get('tags')

    if (!tagsParam) {
      return NextResponse.json({ error: 'Missing tags parameter' }, { status: 400 })
    }

    if (provider !== 'danbooru' && provider !== 'aibooru') {
      // Tags count API is specific to Danbooru-like APIs
      return NextResponse.json({}, { status: 200 })
    }

    const requestedTags = tagsParam.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
    if (requestedTags.length === 0) {
      return NextResponse.json({}, { status: 200 })
    }

    const normalizedToOriginal = new Map<string, string[]>()
    requestedTags.forEach(tag => {
      const normalized = tag.replace(/_/g, ' ').replace(/\s{2,}/g, ' ')
      if (!normalizedToOriginal.has(normalized)) {
        normalizedToOriginal.set(normalized, [])
      }
      normalizedToOriginal.get(normalized)!.push(tag)
    })
    
    const uniqueNormalizedTags = Array.from(normalizedToOriginal.keys())

    // 1. Fetch tags from Supabase first
    const { data: dbTags, error: dbError } = await supabaseAdmin
      .from('provider_tag_counts')
      .select('tag_name, post_count')
      .eq('provider', provider)
      .in('tag_name', uniqueNormalizedTags)

    if (dbError) {
      console.error(`[DB Error] fetching from supabase in edge:`, dbError)
    }

    const tagCounts: Record<string, number> = {}
    
    // Populate cached tags from DB
    if (dbTags) {
      dbTags.forEach(row => {
        const originals = normalizedToOriginal.get(row.tag_name) || []
        originals.forEach(orig => {
          tagCounts[orig] = row.post_count
        })
      })
    }

    // 2. Identify requested tags completely missing from our local DB cache using original names
    const missingTags = requestedTags.filter(tag => tagCounts[tag] === undefined)

    if (missingTags.length === 0) {
      // All tags found in local cache — no external call needed
    }

    // 3. If there are missing tags, fetch them from the external provider
    if (missingTags.length > 0) {
      // Rate limit check before calling external API
      const ratelimit = getDanbooruApiRateLimit()
      if (ratelimit) {
        const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anonymous'
        const { success } = await ratelimit.limit(clientIp)

        if (!success) {
		return NextResponse.json(
				{ error: 'Too many requests. Please wait before searching tags.' },
				{ status: 429, headers: { 'Retry-After': '10', 'Cache-Control': 'no-store', 'Netlify-CDN-Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store' } }
			)
        }
      }

      // Global rate limit — caps total outbound Danbooru requests from ALL users
      const globalLimit = getDanbooruGlobalRateLimit()
      if (globalLimit) {
        const { success } = await globalLimit.limit('danbooru-outbound')
        if (!success) {
		return NextResponse.json(
					{ error: 'Danbooru requests are temporarily throttled. Please wait a moment.' },
					{ status: 429, headers: { 'Retry-After': '2', 'Cache-Control': 'no-store', 'Netlify-CDN-Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store' } }
				)
        }
      }

      // Create smaller chunks to avoid URI too long errors in external providers
      const CHUNK_SIZE = 50
      
      for (let i = 0; i < missingTags.length; i += CHUNK_SIZE) {
        const chunk = missingTags.slice(i, i + CHUNK_SIZE)
        const baseUrl = provider === 'aibooru' ? PROVIDER_URLS.AIBOORU : PROVIDER_URLS.DANBOORU
        const url = new URL(`${baseUrl}/tags.json`)
        url.searchParams.set('search[category]', '4') // 4 = character
        url.searchParams.set('search[name_comma]', chunk.join(','))
        url.searchParams.set('limit', '100')

        const response = await smartFetch(url.toString(), {
          headers: {
            'User-Agent': getDanbooruUserAgent(),
            ...(process.env.DANBOORU_USERNAME && process.env.DANBOORU_API_KEY
              ? { 'Authorization': `Basic ${btoa(`${process.env.DANBOORU_USERNAME}:${process.env.DANBOORU_API_KEY}`)}` }
              : {}),
          },
          retries: 2,
          retryDelay: 1000,
        })

        if (response.ok) {
          const data = await response.json()
          
          if (Array.isArray(data)) {
            const fetchedMap: Record<string, number> = {}
            data.forEach((tag: any) => {
              if (tag.name && typeof tag.post_count === 'number') {
                fetchedMap[tag.name.toLowerCase()] = tag.post_count
              }
            })

            const rowsToUpsert = chunk.map(tag => {
               // Normalizar la etiqueta usando el estándar de la app.
               const normalizedTag = tag.trim().toLowerCase().replace(/_/g, ' ').replace(/\s{2,}/g, ' ')
               
               // Danbooru omits invalid/deleted tags, mark them as 0 to avoid refetching.
               const count = fetchedMap[tag] !== undefined 
                           ? fetchedMap[tag] 
                           : (fetchedMap[normalizedTag] !== undefined ? fetchedMap[normalizedTag] : 0)

               tagCounts[tag] = count // add to response payload using original tag
               return { provider, tag_name: normalizedTag, post_count: count }
            })

            // Save to database
            const { error: upsertError } = await supabaseAdmin
               .from('provider_tag_counts')
               .upsert(rowsToUpsert, { onConflict: 'provider,tag_name' })

            if (upsertError) {
               const failedTags = chunk.join(', ')
               console.error(`[DB Error] Failed to upsert provider_tag_counts for provider "${provider}" and tags [${failedTags}]: ${upsertError.message}`)
            }
          } else {
            console.error(`Invalid non-array response from ${provider}:`, data)
          }
        } else {
          console.error(`Failed to fetch missing tags from ${provider}: ${response.status}`)
        }
      }
    }

	return NextResponse.json(tagCounts, {
		headers: {
			'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
			'Vary': 'Accept, Accept-Encoding',
		},
	})
  } catch (error) {
    console.error('Error fetching batch tag counts:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
