import { NextResponse } from 'next/server'
import { smartFetch } from '@/lib/network/smart-fetch'
import { PROVIDER_URLS } from '@/lib/constants'
import { supabaseAdmin } from '@/lib/supabase-admin'

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

    // 1. Fetch tags from Supabase first
    const { data: dbTags, error: dbError } = await supabaseAdmin
      .from('provider_tag_counts')
      .select('tag_name, post_count')
      .eq('provider', provider)
      .in('tag_name', requestedTags)

    if (dbError) {
      console.error(`[DB Error] fetching from supabase in edge:`, dbError)
      return NextResponse.json(
        { error: 'Tag cache is temporarily unavailable' },
        { status: 503 }
      )
    }

    const tagCounts: Record<string, number> = {}
    
    // Populate cached tags from DB
    if (dbTags) {
      dbTags.forEach(row => {
        tagCounts[row.tag_name] = row.post_count
      })
    }

    // 2. Identify requested tags completely missing from our local DB cache
    const missingTags = requestedTags.filter(tag => tagCounts[tag] === undefined)

    // 3. If there are missing tags, fetch them from the external provider
    if (missingTags.length > 0) {
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
               const count = fetchedMap[tag] !== undefined ? fetchedMap[tag] : 0
               tagCounts[normalizedTag] = count // add to response payload
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
      },
    })
  } catch (error) {
    console.error('Error fetching batch tag counts:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
