import { Env } from '../types'
import { getSupabase } from '../lib/supabase'
import { getRedis } from '../lib/redis'
import { checkCircuitOpen, recordOutcome } from '../lib/circuit-breaker'
import { PROVIDER_URLS, USER_AGENT, danbooruApiHeaders } from '../lib/constants'
import { jsonResponse, errorResponse, getClientIp } from '../utils'
import type { Redis } from '../lib/redis'
import { isBlocked, markBlocked, clearBlocked } from '../lib/rate-limit-cache'
import { logger, logRateLimitBlock } from '../logger'
import { WORKER_LIMITS } from '../lib/limits'
import { resolveRateLimitUserId } from '../lib/rate-limit-identity'
import { fetchUpstream } from '../lib/upstream'

/** The client sends ≤ 50 tags per call; anything far above is not our frontend. */
const MAX_TAGS_PER_REQUEST = 100
const CHUNK_SIZE = 50

/** Cached counts are re-fetched after this long (zeros sooner: often a miss). */
const COUNT_TTL_MS = 30 * 24 * 60 * 60 * 1000
const ZERO_COUNT_TTL_MS = 7 * 24 * 60 * 60 * 1000

const NO_STORE = { 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' }

// Set to false the first time Postgres reports `updated_at` missing (migration
// 20260930000000 not applied yet) so this isolate stops asking for it.
let hasUpdatedAtColumn = true

interface TagCountRow {
  tag_name: string
  post_count: number
  updated_at?: string
}

async function checkRateLimit(redis: Redis | null, clientIp: string, userId: string | null): Promise<boolean> {
  if (!redis) return true
  const authed = Boolean(userId)
  const max = authed
    ? WORKER_LIMITS.tags.perIp.max * (WORKER_LIMITS.tags.authedMultiplier ?? 1)
    : WORKER_LIMITS.tags.perIp.max
  const key = authed ? `ratelimit:booru-tags:authed:${userId}` : `ratelimit:booru-tags:${clientIp}`
  if (isBlocked(key)) return false
  const count = await redis.incrWithExpire(key, WORKER_LIMITS.tags.perIp.windowS)
  const allowed = count <= max // hits external booru APIs
  if (!allowed) {
    markBlocked(key, WORKER_LIMITS.tags.perIp.windowS)
  } else {
    clearBlocked(key)
  }
  return allowed
}

function normalizeTagName(tag: string): string {
  return tag.trim().toLowerCase().replace(/_/g, ' ').replace(/\s{2,}/g, ' ')
}

function isFresh(row: TagCountRow): boolean {
  if (!row.updated_at) return true // column not migrated yet: keep old behavior
  const age = Date.now() - Date.parse(row.updated_at)
  return age < (row.post_count > 0 ? COUNT_TTL_MS : ZERO_COUNT_TTL_MS)
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

  if (provider !== 'danbooru' && provider !== 'aibooru') {
    return jsonResponse({}, 200)
  }

  const requestedTags = Array.from(
    new Set(
      tagsParam
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
    )
  )

  if (requestedTags.length === 0) {
    return jsonResponse({}, 200)
  }
  if (requestedTags.length > MAX_TAGS_PER_REQUEST) {
    return errorResponse(`At most ${MAX_TAGS_PER_REQUEST} tags per request`, 400, NO_STORE)
  }

  // Rate limit
  const redis = getRedis(env)
  const clientIp = getClientIp(request)
  // Flag-gated: resolves authed:<userId> when ADAPTIVE_LIMITS is on and
  // the request carries a valid Supabase access token; otherwise null and
  // behavior is identical to before this existed.
  const userId = await resolveRateLimitUserId(request, env)
  const allowed = await checkRateLimit(redis, clientIp, userId)
  if (!allowed) {
    logRateLimitBlock(request, { surface: 'tags', keyType: userId ? 'authed' : 'anon', scope: 'per-ip', origin: provider })
    return errorResponse(
      'Too many tag search requests. Please wait a moment.',
      429,
      { 'Retry-After': '10', ...NO_STORE }
    )
  }

  // Circuit breaker for Danbooru — fail fast instead of waiting for timeout.
  // Aibooru doesn't need one (lower traffic, less likely to be saturated).
  let observedCircuitState: 'closed' | 'open' | 'half-open' = 'closed'
  if (provider === 'danbooru' && redis) {
    const circuit = await checkCircuitOpen(redis, 'danbooru-api')
    observedCircuitState = circuit.state
    if (circuit.open) {
      logRateLimitBlock(request, { surface: 'tags', keyType: 'anon', scope: 'circuit', origin: 'danbooru' })
      return errorResponse(
        'Danbooru is saturated. Please wait before searching tags.',
        429,
        { 'Retry-After': String(circuit.retryAfter), ...NO_STORE }
      )
    }
  }

  // Normalize
  const normalizedToOriginal = new Map<string, string[]>()
  requestedTags.forEach((tag) => {
    const normalized = normalizeTagName(tag)
    if (!normalizedToOriginal.has(normalized)) {
      normalizedToOriginal.set(normalized, [])
    }
    normalizedToOriginal.get(normalized)!.push(tag)
  })

  const uniqueNormalizedTags = Array.from(normalizedToOriginal.keys())
  const supabase = getSupabase(env)
  const tagCounts: Record<string, number> = {}

  // 1. Fetch from Supabase cache (stale rows count as missing)
  if (supabase) {
    const selectRows = (columns: string) =>
      supabase
        .from('provider_tag_counts')
        .select(columns)
        .eq('provider', provider)
        .in('tag_name', uniqueNormalizedTags)

    let { data: dbTags, error: dbError } = await selectRows(
      hasUpdatedAtColumn ? 'tag_name, post_count, updated_at' : 'tag_name, post_count'
    )
    if (dbError?.code === '42703' && hasUpdatedAtColumn) {
      hasUpdatedAtColumn = false
      ;({ data: dbTags, error: dbError } = await selectRows('tag_name, post_count'))
    }

    if (!dbError && dbTags) {
      ;(dbTags as unknown as TagCountRow[]).forEach((row) => {
        if (!isFresh(row)) return
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
    // Danbooru credentials are only ever sent to Danbooru — Aibooru is a
    // different site and must never receive them.
    const baseUrl = provider === 'aibooru' ? PROVIDER_URLS.AIBOORU : PROVIDER_URLS.DANBOORU
    const headers =
      provider === 'danbooru'
        ? danbooruApiHeaders(env)
        : { 'User-Agent': USER_AGENT, Accept: 'application/json' }

    const chunks: string[][] = []
    for (let i = 0; i < missingTags.length; i += CHUNK_SIZE) {
      chunks.push(missingTags.slice(i, i + CHUNK_SIZE))
    }

    // Each chunk is an independent request + its own DB upsert (chunking here is
    // only to stay under a safe URL length); at most 2 chunks by the cap above.
    await Promise.all(chunks.map(async (chunk) => {
      const apiUrl = new URL(`${baseUrl}/tags.json`)
      apiUrl.searchParams.set('search[category]', '4')
      apiUrl.searchParams.set('search[name_comma]', chunk.join(','))
      apiUrl.searchParams.set('limit', '100')
      apiUrl.searchParams.set('only', 'name,post_count')

      try {
        const response = await fetchUpstream(apiUrl.toString(), { headers, timeoutMs: 8000 })
        const data = (await response.json()) as unknown
        if (provider === 'danbooru' && redis) {
          await recordOutcome(redis, 'danbooru-api', observedCircuitState)
        }
        if (!Array.isArray(data)) return

        const fetchedMap: Record<string, number> = {}
        data.forEach((tag: { name?: unknown; post_count?: unknown }) => {
          if (typeof tag.name === 'string' && typeof tag.post_count === 'number') {
            fetchedMap[tag.name.toLowerCase()] = tag.post_count
          }
        })

        const now = new Date().toISOString()
        const rowsToUpsert = chunk.map((tag) => {
          const normalizedTag = normalizeTagName(tag)
          const count = fetchedMap[tag] ?? fetchedMap[normalizedTag] ?? 0
          tagCounts[tag] = count
          return hasUpdatedAtColumn
            ? { provider, tag_name: normalizedTag, post_count: count, updated_at: now }
            : { provider, tag_name: normalizedTag, post_count: count }
        })

        if (supabase) {
          const { error: upsertError } = await supabase
            .from('provider_tag_counts')
            .upsert(rowsToUpsert, { onConflict: 'provider,tag_name' })
          if (upsertError) {
            logger.warn('booru_tags_upsert_error', { error: upsertError.message })
          }
        }
      } catch (err) {
        logger.warn('booru_tags_fetch_error', { provider, error: String(err) })
        if (provider === 'danbooru' && redis) {
          await recordOutcome(redis, 'danbooru-api', observedCircuitState, err)
        }
      }
    }))
  }

  return jsonResponse(tagCounts, 200, {
    'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    'CDN-Cache-Control': 'public, s-maxage=3600',
  })
}
