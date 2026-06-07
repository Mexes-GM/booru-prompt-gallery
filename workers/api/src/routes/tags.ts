import { Env } from '../types'
import { getSupabase } from '../lib/supabase'
import { getRedis, Redis } from '../lib/redis'
import { jsonResponse, getClientIp } from '../utils'

interface TagData {
  name: string
  category: number
}

let tagsCache: TagData[] | null = null
let cacheTimestamp = 0
const CACHE_DURATION = 24 * 60 * 60 * 1000

async function checkRateLimit(redis: Redis | null, clientIp: string): Promise<boolean> {
  if (!redis) return true
  const key = `ratelimit:tags:${clientIp}`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, 60)
  return count <= 60
}

export async function tagsHandler(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url)
  const category = url.searchParams.get('category')

  // Rate limit
  const redis = getRedis(env)
  const clientIp = getClientIp(request)
  const allowed = await checkRateLimit(redis, clientIp)
  if (!allowed) {
    return jsonResponse(
      { error: 'Too many requests. Please wait a moment.' },
      429,
      { 'Retry-After': '10', 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' }
    )
  }

  try {
    const now = Date.now()
    if (!tagsCache || now - cacheTimestamp > CACHE_DURATION) {
      const supabase = getSupabase(env)

      if (!supabase) {
        tagsCache = [
          { name: 'signature', category: 5 },
          { name: 'twitter username', category: 5 },
          { name: 'artist name', category: 1 },
          { name: 'watermark', category: 5 },
          { name: 'copyright', category: 5 },
          { name: 'artist', category: 1 },
          { name: 'unknown artist', category: 1 },
          { name: 'official art', category: 5 },
          { name: 'fan art', category: 5 },
          { name: 'commission', category: 5 },
        ]
        cacheTimestamp = now
      } else {
        try {
          const { data, error } = await supabase
            .from('auto_suggest_tags')
            .select('name, category')
            .limit(3000)

          if (error) throw error

          if (data && data.length > 0) {
            tagsCache = data.map((t: any) => ({
              name: t.name,
              category: parseInt(t.category) || 0,
            }))
          } else {
            throw new Error('No tags in database')
          }
          cacheTimestamp = now
        } catch (error) {
          console.error('[tags] Supabase fetch failed, using fallback:', error)
          tagsCache = [
            { name: 'signature', category: 5 },
            { name: 'twitter username', category: 5 },
            { name: 'artist name', category: 1 },
            { name: 'watermark', category: 5 },
            { name: 'copyright', category: 5 },
            { name: 'artist', category: 1 },
            { name: 'unknown artist', category: 1 },
            { name: 'official art', category: 5 },
            { name: 'fan art', category: 5 },
            { name: 'commission', category: 5 },
          ]
          cacheTimestamp = now
        }
      }
    }

    let filteredTags = tagsCache
    if (category) {
      const catNum = parseInt(category)
      if (!isNaN(catNum)) {
        filteredTags = tagsCache.filter((tag) => tag.category === catNum)
      }
    }

    return jsonResponse(filteredTags, 200, {
      'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400',
      'CDN-Cache-Control': 'public, s-maxage=86400',
      'X-Total-Count': String(filteredTags.length),
    })
  } catch (error) {
    return jsonResponse({ error: 'Internal server error' }, 500, {
      'Cache-Control': 'no-cache',
    })
  }
}
