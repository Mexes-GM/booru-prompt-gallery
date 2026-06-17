// ponytail: shared Redis client, was duplicated in rate-limit.ts + circuit-breaker.ts
import { Redis } from "@upstash/redis"

export const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? Redis.fromEnv()
  : null
