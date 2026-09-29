import { Redis } from './redis'
import { sleep } from '../utils'

/**
 * Fase 3 (redis-optimization-plan.md): peek the coalesce cache for `key`
 * without acquiring any lock or running the fetcher. Used to skip
 * rate-limit/circuit-breaker Redis commands entirely on a cache hit — a
 * cached response never reaches the origin, so it doesn't need to be
 * counted against the per-IP/global/circuit protections.
 *
 * Costs 1 extra GET on a cache MISS (coalesce() below re-checks), but saves
 * 1-4 commands on a HIT, which is the common case for popular/trending posts.
 */
export async function peekCache<T>(redis: Redis | null, key: string): Promise<T | null> {
  if (!redis) return null
  const cached = await redis.get(`coalesce:cache:${key}`)
  if (!cached) return null
  try {
    return JSON.parse(cached) as T
  } catch {
    return null
  }
}

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
    return JSON.parse(cached) as T
  }

  // ── Try to acquire the fetch lock ──────────────────────────────────────
  // TTL covers the winner's worst case (fetchUpstream: 2 × 12s timeout + 1s
  // backoff) so the lock cannot expire mid-fetch and let a second fetch in.
  const acquired = await redis.set(lockKey, '1', { nx: true, ex: 30 })
  if (acquired) {
    // Winner path: fetch, cache, signal losers, release lock
    let result: T
    try {
      result = await fetcher()
    } catch (error) {
      await redis.del(lockKey).catch(() => {})
      throw error
    }
    // Cache writes are best-effort: once the data is in hand, a Redis hiccup
    // (or hitting the per-invocation subrequest cap) must not turn the
    // response into a 500. Losers then simply fall through to a direct fetch.
    try {
      // 1. Write cached result
      await redis.set(cacheKey, JSON.stringify(result), { ex: ttlSeconds })
      // 2. Signal losers via lightweight notify key (4 bytes vs 80KB cache entry)
      await redis.set(notifyKey, '1', { ex: Math.min(ttlSeconds, 15) })
      await redis.del(lockKey)
    } catch {
      /* lock expires on its own (TTL) */
    }
    return result
  }

  // ── Loser path: wait for winner via lightweight notify-key polling ─────
  //
  // Instead of polling the heavy cacheKey (up to ~80KB per GET), we poll a
  // lightweight notifyKey ("1" = 4 bytes). After the signal appears, we
  // fetch the cached data in ONE get.
  //
  // 17 iterations × 300ms = 5.1s window — matches the old 5s coalesce
  // timeout. Danbooru sometimes takes 3-5s under load; a shorter window
  // causes losers to fall through to direct fetch, creating a thundering
  // herd that further degrades the API.
  for (let i = 0; i < 17; i++) {
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
