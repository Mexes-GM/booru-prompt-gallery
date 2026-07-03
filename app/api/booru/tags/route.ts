import { NextRequest, NextResponse } from 'next/server'
import { smartFetch } from '@/lib/network/smart-fetch'
import { PROVIDER_URLS, getDanbooruUserAgent } from '@/lib/constants'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getDanbooruApiRateLimit, getDanbooruCombinedLimit } from '@/lib/rate-limit'
import { coalesce } from '@/lib/request-coalescer'
import { resolveRateLimitUserId } from '@/lib/rate-limit-identity'

// Vercel Edge Runtime for faster performance
export const runtime = 'edge'

// Very cacheable route
export const revalidate = 3600 // 1 hour

export async function GET(request: NextRequest) {
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
      const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anonymous'

      if (provider === 'danbooru') {
        // Fase 2 (redis-optimization-plan.md): 1 Redis EVAL instead of 2
        // separate rate-limit round-trips (per-IP + global).
        // F4 (flag-gated): resolves authed:<userId> when ADAPTIVE_LIMITS is on
        // and the request carries a valid Supabase session; otherwise null and
        // the key/limit are identical to before.
        const userId = await resolveRateLimitUserId(request)
        const combined = await getDanbooruCombinedLimit(clientIp, userId)

        if (combined.userCount > combined.userMax && !combined.degraded) {
          return NextResponse.json(
            { error: 'Too many requests. Please wait before searching tags.' },
            { status: 429, headers: { 'Retry-After': '10', 'Cache-Control': 'no-store', 'Netlify-CDN-Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store' } }
          )
        }

        if (combined.globalCount > 8 && !combined.degraded) {
          return NextResponse.json(
            { error: 'Danbooru requests are temporarily throttled. Please wait a moment.' },
            { status: 429, headers: { 'Retry-After': '2', 'Cache-Control': 'no-store', 'Netlify-CDN-Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store' } }
          )
        }
      } else {
        // Aibooru: general per-IP limiter only (no shared circuit-breaker for this provider).
        const ratelimit = getDanbooruApiRateLimit()
        if (ratelimit) {
          const { success } = await ratelimit.limit(clientIp)
          if (!success) {
            return NextResponse.json(
              { error: 'Too many requests. Please wait before searching tags.' },
              { status: 429, headers: { 'Retry-After': '10', 'Cache-Control': 'no-store', 'Netlify-CDN-Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store' } }
            )
          }
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

        const response = await coalesce(
          `tags:${provider}:${chunk.sort().join(',')}`,
          () => {
            const headers: Record<string, string> = {
              'User-Agent': provider === 'danbooru' ? getDanbooruUserAgent() : 'Boorugallery/9.2',
              'Referer': provider === 'aibooru' ? 'https://aibooru.online/' : 'https://danbooru.donmai.us/',
            }
            // Only send Danbooru credentials to Danbooru — Aibooru rejects them
            if (provider === 'danbooru' && process.env.DANBOORU_USERNAME && process.env.DANBOORU_API_KEY) {
              headers['Authorization'] = `Basic ${btoa(`${process.env.DANBOORU_USERNAME}:${process.env.DANBOORU_API_KEY}`)}`
            }
            return smartFetch(url.toString(), {
              headers,
              retries: 2,
              retryDelay: 1000,
            })
          },
          5000
        )

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
			'CDN-Cache-Control': 'public, s-maxage=3600',
			'Netlify-CDN-Cache-Control': 'public, s-maxage=3600',
			'Vercel-CDN-Cache-Control': 'public, s-maxage=7200',
			'Vary': 'Accept, Accept-Encoding',
		},
	})
  } catch (error) {
    console.error('Error fetching batch tag counts:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
