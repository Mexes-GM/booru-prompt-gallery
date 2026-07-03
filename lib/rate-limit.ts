import { Ratelimit } from "@upstash/ratelimit"
import { redis } from "./redis"
import { NEXT_LIMITS } from "./limits"

// ---------------------------------------------------------------------------
// In-memory fallback rate limiter
//
// If Upstash Redis is unreachable, we fall back to an in-memory sliding
// window so the app can continue operating without saturating Danbooru.
// The limits are intentionally stricter than the Redis-backed defaults to
// provide a safety margin while Redis is degraded.
// ---------------------------------------------------------------------------

interface RateLimitResult {
  success: boolean
  limit: number
  remaining: number
  reset: number
}

class InMemoryRatelimit {
  private counters = new Map<string, { count: number; windowStart: number }>()
  private maxRequests: number
  private windowMs: number

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests
    this.windowMs = windowMs
  }

  limit(key: string): RateLimitResult {
    const now = Date.now()
    let entry = this.counters.get(key)

    if (!entry || now - entry.windowStart > this.windowMs) {
      entry = { count: 1, windowStart: now }
      this.counters.set(key, entry)
      return {
        success: true,
        limit: this.maxRequests,
        remaining: this.maxRequests - 1,
        reset: now + this.windowMs,
      }
    }

    entry.count++
    const remaining = Math.max(0, this.maxRequests - entry.count)
    return {
      success: entry.count <= this.maxRequests,
      limit: this.maxRequests,
      remaining,
      reset: entry.windowStart + this.windowMs,
    }
  }

  // Periodic cleanup of stale entries
  cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.counters) {
      if (now - entry.windowStart > this.windowMs * 3) {
        this.counters.delete(key)
      }
    }
  }
}

// Singleton instances for fallback — shared across invocations on same instance
const fallbackGeneral = new InMemoryRatelimit(10, 10_000)
const fallbackAuth = new InMemoryRatelimit(5, 900_000)
const fallbackMagicLink = new InMemoryRatelimit(3, 600_000)
const fallbackDanbooruApi = new InMemoryRatelimit(10, 10_000) // stricter than Redis 15/10s

function logFallback(layer: string, reason: string): void {
  console.log(JSON.stringify({
    layer: 'rate-limit',
    event: 'upstash_fallback',
    target: layer,
    reason,
    timestamp: Date.now(),
  }))
}

// ---------------------------------------------------------------------------
// Short-circuit for already-blocked keys (Fase 1 — redis-optimization-plan.md)
//
// Upstash charges per command, even for rejected requests: a hammering IP
// (incident: ~4,000 req/hour from one user) costs the same 1-2 commands per
// request whether it's allowed or rejected. Once a key has been rejected by
// Upstash, we remember it in memory until its reset time and short-circuit
// all further checks locally — no Upstash call at all. This only ever makes
// rejection cheaper; it never lets a request through that Upstash would have
// blocked (fail-closed).
//
// Per-instance/isolate memory is best-effort (not shared across Vercel
// function instances), but a hammering abuser keeps hitting the same warm
// instance, so this captures the bulk of the amplification in practice.
// ---------------------------------------------------------------------------

const blockedUntil = new Map<string, number>()

function isShortCircuited(key: string): RateLimitResult | null {
  const reset = blockedUntil.get(key)
  if (reset === undefined) return null
  if (Date.now() >= reset) {
    blockedUntil.delete(key)
    return null
  }
  return { success: false, limit: 0, remaining: 0, reset }
}

function rememberIfBlocked(key: string, result: RateLimitResult): void {
  if (!result.success) {
    blockedUntil.set(key, result.reset)
  } else {
    blockedUntil.delete(key)
  }
}

function cleanupBlocked(): void {
  const now = Date.now()
  for (const [key, reset] of blockedUntil) {
    if (now >= reset) blockedUntil.delete(key)
  }
}

// ---------------------------------------------------------------------------
// Rate limiter factory with automatic Upstash → in-memory fallback
// ---------------------------------------------------------------------------

async function safeLimit(
  upstashLimiter: Ratelimit | null,
  fallbackLimiter: InMemoryRatelimit,
  key: string,
  label: string
): Promise<RateLimitResult> {
  // Fase 1: reject already-known-blocked keys without touching Upstash.
  const shortCircuited = isShortCircuited(key)
  if (shortCircuited) return shortCircuited

  if (!upstashLimiter) {
    // Development mode or no Redis configured — use in-memory directly
    return fallbackLimiter.limit(key)
  }

  try {
    const result = await upstashLimiter.limit(key)
    rememberIfBlocked(key, result)
    fallbackLimiter.cleanup()
    cleanupBlocked()
    return result
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err)
    logFallback(label, reason)
    return fallbackLimiter.limit(key)
  }
}

// ---------------------------------------------------------------------------
// Public rate limiters
//
// Si Upstash Redis NO está configurado (variables de entorno faltantes),
// se usa el fallback en memoria directamente. Esto garantiza que el rate
// limiting funcione incluso sin cuenta de Upstash.
// ---------------------------------------------------------------------------

export interface SafeRatelimit {
  limit(key: string): Promise<RateLimitResult>
}

export function getRateLimit(): SafeRatelimit | null {
  if (process.env.NODE_ENV === 'development') return null

  if (!redis) {
    return { limit: (key: string) => Promise.resolve(fallbackGeneral.limit(key)) }
  }

  const upstash = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, "10 s"),
    analytics: false,
    prefix: "@upstash/ratelimit",
  })

  return {
    limit: (key: string) => safeLimit(upstash, fallbackGeneral, key, 'general'),
  }
}

export function getAuthRateLimit(): SafeRatelimit | null {
  if (process.env.NODE_ENV === 'development') return null

  if (!redis) {
    return { limit: (key: string) => Promise.resolve(fallbackAuth.limit(key)) }
  }

  const upstash = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, "15 m"),
    analytics: false,
    prefix: "@upstash/ratelimit/auth",
  })

  return {
    limit: (key: string) => safeLimit(upstash, fallbackAuth, key, 'auth'),
  }
}

export function getMagicLinkRateLimit(): SafeRatelimit | null {
  if (process.env.NODE_ENV === 'development') return null

  if (!redis) {
    return { limit: (key: string) => Promise.resolve(fallbackMagicLink.limit(key)) }
  }

  const upstash = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(3, "10 m"),
    analytics: false,
    prefix: "@upstash/ratelimit/magiclink",
  })

  return {
    limit: (key: string) => safeLimit(upstash, fallbackMagicLink, key, 'magiclink'),
  }
}

// Protects Danbooru-bound API endpoints from excessive calls.
// Danbooru has a global 10 req/s limit shared per IP address.
// All Vercel functions share the same outbound IP, so we must
// throttle our own users to avoid exhausting the shared bucket.
export function getDanbooruApiRateLimit(): SafeRatelimit | null {
  if (process.env.NODE_ENV === 'development') return null

  if (!redis) {
    return { limit: (key: string) => Promise.resolve(fallbackDanbooruApi.limit(key)) }
  }

  const upstash = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(NEXT_LIMITS.danbooruApi.max, `${NEXT_LIMITS.danbooruApi.windowS} s`),
    analytics: false,
    prefix: "@upstash/ratelimit/danbooru-api",
  })

  return {
    limit: (key: string) => safeLimit(upstash, fallbackDanbooruApi, key, 'danbooru-api'),
  }
}

// Global Danbooru rate limiter — caps total outbound requests from ALL users.
// Danbooru enforces 10 req/s per IP. All Vercel functions share the same
// outbound IP, so we must cap total throughput regardless of user count.
// Call with a fixed key like "danbooru-outbound" (NOT per-user IP).
//
// Superseded by getDanbooruCombinedLimit() below (Fase 2 —
// redis-optimization-plan.md), which folds this check into the same EVAL as
// the per-IP limit and circuit-breaker read. Removed to avoid dead code.

// ---------------------------------------------------------------------------
// Merged Danbooru check — Fase 2 (redis-optimization-plan.md)
//
// /api/posts, /api/download and /api/favorites each made 3 separate Redis
// round-trips per request: per-IP rate-limit, global rate-limit, and a GET
// for the shared circuit-breaker state. This combines all three into a
// single EVAL (fixed-window INCR+EXPIRE for both counters + GET for the
// circuit key), cutting Redis commands ~66% on this hot path.
//
// Trade-off: fixed window instead of the sliding window `@upstash/ratelimit`
// used before. Slightly burstier at window boundaries, but same order-of-
// magnitude protection, and it's the same fixed-window approach already used
// by the Cloudflare Worker (MERGED_RATELIMIT_SCRIPT).
// ---------------------------------------------------------------------------

const MERGED_DANBOORU_SCRIPT = `
  local user = redis.call('INCR', KEYS[1])
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  local global = redis.call('INCR', KEYS[2])
  redis.call('EXPIRE', KEYS[2], ARGV[2])
  local circuit = redis.call('GET', KEYS[3])
  return {user, global, circuit or false}
`

export interface DanbooruCombinedResult {
  userCount: number
  globalCount: number
  circuitOpen: boolean
  /** true when this result came from the in-memory fallback (Redis unavailable/dev) */
  degraded: boolean
  /** Effective per-key limit for this request (scaled up for authed users). */
  userMax: number
}

const fallbackDanbooruUser = new InMemoryRatelimit(NEXT_LIMITS.danbooruCombined.perIp.max, NEXT_LIMITS.danbooruCombined.perIp.windowS * 1000)
const combinedBlockKeyPrefix = 'danbooru-combined:'

/**
 * Single Redis round-trip for the Danbooru hot path: per-IP window (10s),
 * global window (1s), and shared circuit-breaker state, all in one EVAL.
 * Falls back to local in-memory limiting if Redis is unavailable/dev mode.
 */
export async function getDanbooruCombinedLimit(clientIp: string, userId?: string | null): Promise<DanbooruCombinedResult> {
  // F4 (flag-gated, default off): an authenticated user is keyed by user id and
  // gets `authedMultiplier`× the per-IP allowance. When userId is null (flag off
  // or anonymous), the key and limit are IDENTICAL to the pre-F4 behavior.
  const authed = Boolean(userId)
  const userMax = authed
    ? NEXT_LIMITS.danbooruCombined.perIp.max * NEXT_LIMITS.danbooruCombined.authedMultiplier
    : NEXT_LIMITS.danbooruCombined.perIp.max
  const userKey = authed
    ? `${combinedBlockKeyPrefix}user:authed:${userId}`
    : `${combinedBlockKeyPrefix}user:${clientIp}`

  if (process.env.NODE_ENV === 'development' || !redis) {
    const result = fallbackDanbooruUser.limit(userKey)
    return { userCount: result.success ? 0 : 999, globalCount: 0, circuitOpen: false, degraded: true, userMax }
  }

  // Fase 1: already-known-blocked key — skip Redis entirely.
  if (isShortCircuited(userKey)) {
    return { userCount: 9999, globalCount: 0, circuitOpen: false, degraded: false, userMax }
  }

  try {
    const result = await redis.eval(
      MERGED_DANBOORU_SCRIPT,
      [userKey, 'danbooru-combined:global', 'circuit:danbooru-api'],
      [String(NEXT_LIMITS.danbooruCombined.perIp.windowS), String(NEXT_LIMITS.danbooruCombined.global.windowS)]
    ) as [number, number, string | false]

    const [userCount, globalCount, circuitVal] = result
    const blocked = userCount > userMax || globalCount > NEXT_LIMITS.danbooruCombined.global.max
    rememberIfBlocked(userKey, {
      success: !blocked,
      limit: userMax,
      remaining: Math.max(0, userMax - userCount),
      reset: Date.now() + NEXT_LIMITS.danbooruCombined.perIp.windowS * 1000,
    })

    return { userCount, globalCount, circuitOpen: circuitVal === 'open', degraded: false, userMax }
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err)
    logFallback('danbooru-combined', reason)
    const result = fallbackDanbooruUser.limit(userKey)
    return { userCount: result.success ? 0 : 999, globalCount: 0, circuitOpen: false, degraded: true, userMax }
  }
}
