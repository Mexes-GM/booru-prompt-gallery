import { Env } from '../types'
import { getSupabase } from '../lib/supabase'
import { getRedis } from '../lib/redis'
import { PROVIDER_URLS, getDanbooruUserAgent } from '../lib/constants'
import { jsonResponse, errorResponse, getClientIp } from '../utils'
import type { Redis } from '../lib/redis'

async function checkRateLimit(redis: Redis | null, clientIp: string): Promise<boolean> {
  if (!redis) return true
  const key = `ratelimit:booru-tags:${clientIp}`
  const count = await redis.incrWithExpire(key, 60)
  return count <= 30 // 30 req/min — this route hits external APIs
}

async function fetchWithRetry(url: string, headers: Record<string, string>, retries = 2): Promise<Response> {
  let lastError: Error | null = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, { headers })
      return resp
    } catch (error: any) {
      lastError = error
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
      }
    }
  }
  throw lastError || new Error('Fetch failed')
}

export async function booruTagsHandler(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url)
  const provider = url.searchParams.get('provider') || 'danbooru'
  const tagsParam = url.searchParams.get('tags')

  if (!tagsParam) {
    return errorResponse('Missing tags parameter', 400)
  }

  // Rate limit
  const redis = getRedis(env)
  const clientIp = getClientIp(request)
  const allowed = await checkRateLimit(redis, clientIp)
  if (!allowed) {
    return errorResponse(
      'Too many tag search requests. Please wait a moment.',
      429,
      { 'Retry-After': '10', 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' }
    )
  }

  if (provider !== 'danbooru' && provider !== 'aibooru') {
    return jsonResponse({}, 200)
  }

  const requestedTags = tagsParam
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)

  if (requestedTags.length === 0) {
    return jsonResponse({}, 200)
  }

  // Normalize
  const normalizedToOriginal = new Map<string, string[]>()
  requestedTags.forEach((tag) => {
    const normalized = tag.replace(/_/g, ' ').replace(/\s{2,}/g, ' ')
    if (!normalizedToOriginal.has(normalized)) {
      normalizedToOriginal.set(normalized, [])
    }
    normalizedToOriginal.get(normalized)!.push(tag)
  })

  const uniqueNormalizedTags = Array.from(normalizedToOriginal.keys())
  const supabase = getSupabase(env)
  const tagCounts: Record<string, number> = {}

  // 1. Fetch from Supabase cache
  if (supabase) {
    const { data: dbTags, error: dbError } = await supabase
      .from('provider_tag_counts')
      .select('tag_name, post_count')
      .eq('provider', provider)
      .in('tag_name', uniqueNormalizedTags)

    if (!dbError && dbTags) {
      dbTags.forEach((row: any) => {
        const originals = normalizedToOriginal.get(row.tag_name) || []
        originals.forEach((orig) => {
          tagCounts[orig] = row.post_count
        })
      })
    }
  }

  // 2. Identify missing tags
  const missingTags = requestedTags.filter((tag) => tagCounts[tag] === undefined)

  if (missingTags.length > 0) {
    const baseUrl =
      provider === 'aibooru' ? PROVIDER_URLS.AIBOORU : PROVIDER_URLS.DANBOORU
    const authHeaders: Record<string, string> = {
      'User-Agent': getDanbooruUserAgent(env.DANBOORU_USERNAME),
      'Accept': 'application/json',
      'Referer': 'https://danbooru.donmai.us/',
    }

    if (env.DANBOORU_USERNAME && env.DANBOORU_API_KEY) {
      const credentials = btoa(`${env.DANBOORU_USERNAME}:${env.DANBOORU_API_KEY}`)
      authHeaders['Authorization'] = `Basic ${credentials}`
    }

    const CHUNK_SIZE = 50
    for (let i = 0; i < missingTags.length; i += CHUNK_SIZE) {
      const chunk = missingTags.slice(i, i + CHUNK_SIZE)
      const apiUrl = new URL(`${baseUrl}/tags.json`)
      apiUrl.searchParams.set('search[category]', '4')
      apiUrl.searchParams.set('search[name_comma]', chunk.join(','))
      apiUrl.searchParams.set('limit', '100')

      try {
        const response = await fetchWithRetry(apiUrl.toString(), authHeaders)

        if (response.ok) {
          const data = await response.json() as any

          if (Array.isArray(data)) {
            const fetchedMap: Record<string, number> = {}
            data.forEach((tag: any) => {
              if (tag.name && typeof tag.post_count === 'number') {
                fetchedMap[tag.name.toLowerCase()] = tag.post_count
              }
            })

            const rowsToUpsert = chunk.map((tag) => {
              const normalizedTag = tag.trim().toLowerCase().replace(/_/g, ' ').replace(/\s{2,}/g, ' ')
              const count =
                fetchedMap[tag] !== undefined
                  ? fetchedMap[tag]
                  : fetchedMap[normalizedTag] !== undefined
                    ? fetchedMap[normalizedTag]
                    : 0

              tagCounts[tag] = count
              return { provider, tag_name: normalizedTag, post_count: count }
            })

            // Save to Supabase
            if (supabase) {
              const { error: upsertError } = await supabase
                .from('provider_tag_counts')
                .upsert(rowsToUpsert, { onConflict: 'provider,tag_name' })

              if (upsertError) {
                console.error(
                  `[booru-tags] Failed to upsert: ${upsertError.message}`
                )
              }
            }
          }
        } else {
          console.error(
            `[booru-tags] Fetch failed: ${response.status}`
          )
        }
      } catch (err) {
        console.error(`[booru-tags] Error fetching chunk:`, err)
      }
    }
  }

  return jsonResponse(tagCounts, 200, {
    'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    'CDN-Cache-Control': 'public, s-maxage=3600',
  })
}
