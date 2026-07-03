import { Env } from '../types'
import { BooruFactory } from '../lib/booru/factory'
import { getSupabase } from '../lib/supabase'
import { getRedis } from '../lib/redis'
import { errorResponse, getClientIp } from '../utils'
import { corsHeaders } from '../utils'
import { isBlocked, markBlocked, clearBlocked } from '../lib/rate-limit-cache'

const TABLE = 'trend_cache'
const FETCH_LOCK_TTL_SECONDS = 180

const CACHE_HEADERS = {
  ...corsHeaders,
  'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600',
  'Content-Type': 'application/json'
}

/**
 * Refresh the trends cache unconditionally — used by the scheduled (cron)
 * handler to keep `trend_cache` warm so users never pay the cold-fetch latency
 * and Danbooru is hit on a predictable schedule instead of on user demand.
 *
 * Safe to call from `scheduled()`; it ignores the per-IP rate limiter (there is
 * no client IP) and does not hold the HTTP fetch-lock semantics.
 */
export async function refreshTrendsCache(env: Env): Promise<void> {
  const supabase = getSupabase(env)
  if (!supabase) {
    console.warn('[trends:cron] Supabase not configured, skipping refresh')
    return
  }

  const provider = BooruFactory.getProvider('danbooru')
  if (!provider.getTrending) {
    console.warn('[trends:cron] Provider does not support trending')
    return
  }

  let trends
  try {
    trends = await provider.getTrending(env as any)
  } catch (err) {
    console.error('[trends:cron] Failed to fetch from Danbooru:', err)
    return
  }

  if (!trends || (Array.isArray(trends) && trends.length === 0)) {
    console.warn('[trends:cron] Empty trends payload, not overwriting cache')
    return
  }

  const now = new Date()
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)

  try {
    const { data: existing } = await supabase
      .from(TABLE)
      .select('id')
      .limit(1)
      .single()

    if (existing?.id) {
      await supabase
        .from(TABLE)
        .update({
          data: trends,
          fetched_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
          fetching_since: null,
        })
        .eq('id', existing.id)
    } else {
      await supabase.from(TABLE).insert({
        data: trends,
        fetched_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        fetching_since: null,
      })
    }
    console.log('[trends:cron] Cache refreshed successfully')
  } catch (err) {
    console.error('[trends:cron] Failed to write cache:', err)
  }
}

export async function trendsHandler(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  // ponytail: per-IP rate limit — 10 req/min. Trends hits Danbooru 20+ times;
  // without a limit it's a DoS vector for both Supabase and Danbooru.
  const redis = getRedis(env)
  if (redis) {
    const clientIp = getClientIp(request)
    const key = `ratelimit:trends:${clientIp}`
    if (isBlocked(key)) {
      return errorResponse('Too many trends requests', 429, {
        'Retry-After': '30',
        'Cache-Control': 'no-store',
        'CDN-Cache-Control': 'no-store',
      })
    }
    const count = await redis.incrWithExpire(key, 60)
    if (count > 10) {
      markBlocked(key, 60)
      return errorResponse('Too many trends requests', 429, {
        'Retry-After': '30',
        'Cache-Control': 'no-store',
        'CDN-Cache-Control': 'no-store',
      })
    }
    clearBlocked(key)
  }

  try {
    const supabase = getSupabase(env)

    // 1. Try to serve from Supabase cache first
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from(TABLE)
          .select('data, expires_at')
          .limit(1)
          .single()

        if (!error && data) {
          const expiresAt = new Date(data.expires_at)
          if (expiresAt > new Date() && data.data && data.data.length > 0) {
            return new Response(JSON.stringify(data.data), { 
              status: 200, 
              headers: CACHE_HEADERS 
            })
          }
        }
      } catch (err) {
        console.error('[trends] Cache read error:', err)
      }
    }

    // 2. Cache miss or expired — try to acquire fetch lock
    let acquired = false
    let existingId: string | number | null = null

    if (supabase) {
      try {
        const { data: existing } = await supabase
          .from(TABLE)
          .select('id, fetching_since')
          .limit(1)
          .single()

        if (!existing) {
          // No row exists yet — create one with a fetching lock
          const { data: insertData, error: insertError } = await supabase
            .from(TABLE)
            .insert({
              data: [],
              fetched_at: new Date().toISOString(),
              expires_at: new Date(Date.now() - 1000).toISOString(),
              fetching_since: new Date().toISOString(),
            })
            .select('id')
            .single()
            
          if (insertData) existingId = insertData.id
          acquired = !insertError
        } else {
          existingId = existing.id
          if (existing.fetching_since) {
            const lockTime = new Date(existing.fetching_since).getTime()
            const lockAge = (Date.now() - lockTime) / 1000

            if (lockAge < FETCH_LOCK_TTL_SECONDS) {
              // Someone else is fetching
              return new Response(
                JSON.stringify({ message: 'Trends refresh in progress, please retry', retryAfter: 30 }),
                {
                  status: 202,
                  headers: {
                    ...CACHE_HEADERS,
                    'Retry-After': '30',
                  },
                }
              )
            }
          }
          
          // Lock is free or stale, claim it
          const { error: updateError } = await supabase
            .from(TABLE)
            .update({ fetching_since: new Date().toISOString() })
            .eq('id', existing.id)
            
          acquired = !updateError
        }
      } catch (err) {
        console.error('[trends] Failed to acquire fetch lock:', err)
        acquired = false // Do not fallback to hammering Danbooru if DB fails
      }
    } else {
      acquired = true // No supabase configured, just fetch directly
    }

    if (!acquired) {
      return new Response(
        JSON.stringify({ message: 'Trends refresh in progress, please retry', retryAfter: 30 }),
        { status: 202, headers: { ...CACHE_HEADERS, 'Retry-After': '30' } }
      )
    }

    // 3. We hold the lock — fetch fresh data from Danbooru
    const provider = BooruFactory.getProvider('danbooru')

    if (!provider.getTrending) {
      if (supabase && existingId) {
        ctx.waitUntil((async () => { await supabase.from(TABLE).update({ fetching_since: null }).eq('id', existingId) })())
      }
      return new Response(
        JSON.stringify({ error: 'Provider does not support trending' }),
        { status: 501, headers: corsHeaders }
      )
    }

    let trends;
    try {
      trends = await provider.getTrending(env as any)
    } catch (err) {
      console.error('[trends] Failed to fetch from Danbooru:', err)
      if (supabase && existingId) {
        ctx.waitUntil((async () => { await supabase.from(TABLE).update({ fetching_since: null }).eq('id', existingId) })())
      }
      return new Response(
        JSON.stringify({ error: 'Failed to fetch trending data' }),
        { status: 500, headers: corsHeaders }
      )
    }

    const gotTrends = Array.isArray(trends) && trends.length > 0

    // 4. Store in Supabase cache (background) — only persist non-empty results
    // with the long 24h TTL. An empty/failed fetch just releases the lock so
    // the NEXT request retries against Danbooru instead of being stuck behind
    // a 24h cache of `[]` (this previously poisoned the cache for a full day
    // whenever getTrending() swallowed an error and returned []).
    if (supabase) {
      ctx.waitUntil(
        (async () => {
          try {
            const now = new Date()

            if (gotTrends) {
              const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)
              if (existingId) {
                await supabase
                  .from(TABLE)
                  .update({
                    data: trends,
                    fetched_at: now.toISOString(),
                    expires_at: expiresAt.toISOString(),
                    fetching_since: null, // release lock
                  })
                  .eq('id', existingId)
              } else {
                // Fallback: just insert a new fresh row if we somehow lost the ID
                await supabase
                  .from(TABLE)
                  .insert({
                    data: trends,
                    fetched_at: now.toISOString(),
                    expires_at: expiresAt.toISOString(),
                    fetching_since: null,
                  })
              }
            } else if (existingId) {
              // Empty result — just release the lock, keep expires_at as-is
              // (already expired, so the next request will retry the fetch).
              await supabase
                .from(TABLE)
                .update({ fetching_since: null })
                .eq('id', existingId)
            }
          } catch (error) {
            console.error('[trends] Failed to write cache:', error)
          }
        })()
      )
    }

    // Don't let the CDN cache an empty result for 24h — allow a quick retry.
    const responseHeaders = gotTrends
      ? CACHE_HEADERS
      : { ...corsHeaders, 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }

    return new Response(JSON.stringify(trends), { status: 200, headers: responseHeaders })
  } catch (error) {
    console.error('Trend API Error:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to fetch trends' }),
      { status: 500, headers: corsHeaders }
    )
  }
}
