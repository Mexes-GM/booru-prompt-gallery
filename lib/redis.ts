// ponytail: shared Redis client for lib/rate-limit.ts
import { Redis } from "@upstash/redis"

export const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? Redis.fromEnv()
  : null
