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
const fallbackDanbooruApi = new InMemoryRatelimit(NEXT_LIMITS.danbooruApiFallback.max, NEXT_LIMITS.danbooruApiFallback.windowS * 1000)

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

// ---------------------------------------------------------------------------
// Merged per-IP + global check — Fase 2 (redis-optimization-plan.md)
//
// One EVAL per request: fixed-window INCR for a per-client counter and a
// shared global counter. Used by /api/download, which serves two very
// different workloads:
//
//  - `danbooruApi`: explicit downloads that count against Danbooru's shared
//    origin budget (tight per-IP window + 1s global burst cap).
//  - `image`: inline <img> fallbacks for the gallery grid (`inline=1`). A
//    masonry page renders ~60 cards at once, so these need their own, much
//    larger bucket — sharing the API caps above made a single page of images
//    trip the limiter, and the resulting image errors paused infinite scroll.
//
// Fixed window: the TTL is set only when a counter is created (or repaired if
// it has none). Re-running EXPIRE on every hit slid the expiry forward, so
// under steady traffic a counter never reset and the shared global key
// blocked every user until the whole site went quiet for a full window.
// ---------------------------------------------------------------------------

const MERGED_LIMIT_SCRIPT = `
  local user = redis.call('INCR', KEYS[1])
  if user == 1 or redis.call('TTL', KEYS[1]) == -1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  local global = redis.call('INCR', KEYS[2])
  if global == 1 or redis.call('TTL', KEYS[2]) == -1 then redis.call('EXPIRE', KEYS[2], ARGV[2]) end
  return {user, global}
`

export type CombinedLimitProfile = 'danbooruApi' | 'image'

const COMBINED_PROFILES = {
  danbooruApi: { limits: NEXT_LIMITS.danbooruCombined, prefix: 'danbooru-combined:' },
  image: { limits: NEXT_LIMITS.image, prefix: 'image-combined:' },
} as const

const combinedFallbacks: Record<CombinedLimitProfile, InMemoryRatelimit> = {
  danbooruApi: new InMemoryRatelimit(NEXT_LIMITS.danbooruCombined.perIp.max, NEXT_LIMITS.danbooruCombined.perIp.windowS * 1000),
  image: new InMemoryRatelimit(NEXT_LIMITS.image.perIp.max, NEXT_LIMITS.image.perIp.windowS * 1000),
}

export interface CombinedLimitResult {
  /** Per-client counter; block when `userCount > userMax`. */
  userCount: number
  /** Effective per-key limit for this request (scaled up for authed users). */
  userMax: number
  /** Shared counter; block when `globalCount > globalMax`. Always 0 when degraded. */
  globalCount: number
  globalMax: number
  /** Seconds until the per-client window resets (for Retry-After). */
  retryAfterS: number
  /** true when this result came from the in-memory fallback (Redis unavailable). */
  degraded: boolean
}

/**
 * Single Redis round-trip for the per-client and global windows. If Redis is missing or
 * errors, the per-client check still runs in memory (fail-closed per client);
 * only the global cap is skipped, since a per-instance global is meaningless.
 * Development never blocks.
 */
export async function getCombinedLimit(
  profile: CombinedLimitProfile,
  clientIp: string,
  userId?: string | null
): Promise<CombinedLimitResult> {
  const { limits, prefix } = COMBINED_PROFILES[profile]
  // Flag-gated, default off: an authenticated user is keyed by user id and
  // gets `authedMultiplier`× the per-IP allowance. When userId is null (flag off
  // or anonymous), the key and limit are IDENTICAL to the non-adaptive behavior.
  const authed = Boolean(userId)
  const userMax = authed ? limits.perIp.max * limits.authedMultiplier : limits.perIp.max
  const userKey = authed ? `${prefix}user:authed:${userId}` : `${prefix}user:${clientIp}`
  const globalMax = limits.global.max
  const retryAfterS = limits.perIp.windowS
  const allow: CombinedLimitResult = { userCount: 0, userMax, globalCount: 0, globalMax, retryAfterS, degraded: true }

  if (process.env.NODE_ENV === 'development') return allow

  const fromFallback = (): CombinedLimitResult => {
    const result = combinedFallbacks[profile].limit(userKey)
    return { ...allow, userCount: result.success ? 0 : userMax + 1 }
  }

  if (!redis) return fromFallback()

  // Fase 1: already-known-blocked key — skip Redis entirely.
  const shortCircuited = isShortCircuited(userKey)
  if (shortCircuited) {
    return { ...allow, userCount: userMax + 1, degraded: false, retryAfterS: Math.max(1, Math.ceil((shortCircuited.reset - Date.now()) / 1000)) }
  }

  try {
    const [userCount, globalCount] = await redis.eval(
      MERGED_LIMIT_SCRIPT,
      [userKey, `${prefix}global`],
      [String(limits.perIp.windowS), String(limits.global.windowS)]
    ) as [number, number]

    // Only the client's OWN overage is remembered: a global-cap rejection is
    // shared back-pressure, not this client's fault, and must not lock them
    // out for a whole per-IP window.
    rememberIfBlocked(userKey, {
      success: userCount <= userMax,
      limit: userMax,
      remaining: Math.max(0, userMax - userCount),
      reset: Date.now() + limits.perIp.windowS * 1000,
    })

    return { userCount, userMax, globalCount, globalMax, retryAfterS, degraded: false }
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err)
    logFallback(`${profile}-combined`, reason)
    return fromFallback()
  }
}

