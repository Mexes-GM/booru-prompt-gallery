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
  const notifyKey = `coalesce:notify:${key}`

  // ── Cache hit ──────────────────────────────────────────────────────────
  const cached = await redis.get(cacheKey)
  if (cached) {
    console.log(JSON.stringify({ layer: 'worker', event: 'cache_hit', key: cacheKey.substring(0, 100), timestamp: Date.now() }))
    return JSON.parse(cached) as T
  }
  console.log(JSON.stringify({ layer: 'worker', event: 'cache_miss', key: cacheKey.substring(0, 100), timestamp: Date.now() }))

  // ── Try to acquire the fetch lock ──────────────────────────────────────
  const acquired = await redis.set(lockKey, '1', { nx: true, ex: 10 })
  if (acquired) {
    // Winner path: fetch, cache, signal losers, release lock
    try {
      const result = await fetcher()
      // 1. Write cached result
      await redis.set(cacheKey, JSON.stringify(result), { ex: ttlSeconds })
      // 2. Signal losers via lightweight notify key (4 bytes vs 80KB cache entry)
      await redis.set(notifyKey, '1', { ex: Math.min(ttlSeconds, 15) })
      return result
    } finally {
      await redis.del(lockKey)
    }
  }

  // ── Loser path: wait for winner via lightweight notify-key polling ─────
  //
  // Instead of polling the heavy cacheKey (up to ~80KB JSON × 8 iterations
  // = 640KB transferred), we poll a lightweight notifyKey ("1" = 4 bytes).
  // After the signal appears, we fetch the cached data in ONE get.
  //
  // 8 iterations × 300ms = 2.4s window. Most booru APIs respond in <1s.
  for (let i = 0; i < 8; i++) {
    await sleep(300)
    const signal = await redis.get(notifyKey)
    if (signal) {
      const result = await redis.get(cacheKey)
      if (result) return JSON.parse(result) as T
      break // signal was set but cache vanished? Fall through to direct fetch
    }
  }

  // ── Fallback: winner never materialized → fetch directly ───────────────
  return fetcher()
}
