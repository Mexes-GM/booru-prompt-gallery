import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"

export function getRateLimit() {
  if (process.env.NODE_ENV === 'development') {
    return null // Bypass rate limits on localhost
  }

  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(10, "10 s"),
      analytics: true,
      prefix: "@upstash/ratelimit",
    })
  }
  return null
}
