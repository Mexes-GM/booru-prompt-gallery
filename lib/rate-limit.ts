import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"

const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? Redis.fromEnv()
  : null

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
const fallbackDanbooruGlobal = new InMemoryRatelimit(5, 1_000) // 5 req/s per-instance fallback

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
// Rate limiter factory with automatic Upstash → in-memory fallback
// ---------------------------------------------------------------------------

async function safeLimit(
  upstashLimiter: Ratelimit | null,
  fallbackLimiter: InMemoryRatelimit,
  key: string,
  label: string
): Promise<RateLimitResult> {
  if (!upstashLimiter) {
    // Development mode or no Redis configured — use in-memory directly
    return fallbackLimiter.limit(key)
  }

  try {
    const result = await upstashLimiter.limit(key)
    fallbackLimiter.cleanup()
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
    limiter: Ratelimit.slidingWindow(15, "10 s"),
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
export function getDanbooruGlobalRateLimit(): SafeRatelimit | null {
  if (process.env.NODE_ENV === 'development') return null

  if (!redis) {
    return { limit: (key: string) => Promise.resolve(fallbackDanbooruGlobal.limit(key)) }
  }

  const upstash = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(8, "1 s"),
    analytics: false,
    prefix: "@upstash/ratelimit/danbooru-global",
  })

  return {
    limit: (key: string) => safeLimit(upstash, fallbackDanbooruGlobal, key, 'danbooru-global'),
  }
}
