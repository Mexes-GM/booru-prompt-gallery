import { Redis } from './redis'
import { sleep } from '../utils'

export async function coalesce<T>(
  redis: Redis | null,
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds = 5
): Promise<T> {
  if (!redis) return fetcher()

  const lockKey = `coalesce:lock:${key}`
  const cacheKey = `coalesce:cache:${key}`

  const cached = await redis.get(cacheKey)
  if (cached) return JSON.parse(cached) as T

  const acquired = await redis.set(lockKey, '1', { nx: true, ex: 10 })
  if (acquired) {
    try {
      const result = await fetcher()
      await redis.set(cacheKey, JSON.stringify(result), { ex: ttlSeconds })
      return result
    } finally {
      await redis.del(lockKey)
    }
  }

  for (let i = 0; i < 20; i++) {
    await sleep(250)
    const result = await redis.get(cacheKey)
    if (result) return JSON.parse(result) as T
  }

  return fetcher()
}
