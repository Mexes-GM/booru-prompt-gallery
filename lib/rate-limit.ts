import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"

const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? Redis.fromEnv()
  : null

export function getRateLimit() {
  if (process.env.NODE_ENV === 'development') {
    return null
  }

  if (!redis) return null

  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, "10 s"),
    analytics: true,
    prefix: "@upstash/ratelimit",
  })
}

export function getAuthRateLimit() {
  if (process.env.NODE_ENV === 'development') {
    return null
  }

  if (!redis) return null

  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, "15 m"),
    analytics: true,
    prefix: "@upstash/ratelimit/auth",
  })
}

export function getMagicLinkRateLimit() {
  if (process.env.NODE_ENV === 'development') {
    return null
  }

  if (!redis) return null

  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(3, "10 m"),
    analytics: true,
    prefix: "@upstash/ratelimit/magiclink",
  })
}
