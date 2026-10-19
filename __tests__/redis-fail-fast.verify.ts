/**
 * Verification script for the Worker's Redis fail-fast path
 * (workers/booru-image-proxy/src/lib/redis.ts + coalesce.ts):
 *   - an Upstash write rejected with 400 (quota exhausted) must not send
 *     coalesce() into its 5.1s loser poll — it fetches directly
 *   - after a failure getRedis() returns null for the cooldown, so routes take
 *     their no-Redis path without spending more Upstash calls
 *   - a thrown fetch (network error / timeout) is turned into a non-ok
 *     response instead of propagating
 *   - a healthy Redis still coalesces normally
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/redis-fail-fast.verify.ts
 */
import { getRedis, isRedisDown, resetRedisHealth } from '../workers/booru-image-proxy/src/lib/redis'
import { coalesce } from '../workers/booru-image-proxy/src/lib/coalesce'
import type { Env } from '../workers/booru-image-proxy/src/types'

let passed = 0
let failed = 0

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++
  } else {
    failed++
    console.error(`FAIL: ${label}`)
  }
}

const env = { UPSTASH_REDIS_REST_URL: 'https://redis.test', UPSTASH_REDIS_REST_TOKEN: 't' } as Env

// Upstash on an exhausted free tier: reads answer, writes get 400.
function mockQuotaExhausted(): { calls: number } {
  const log = { calls: 0 }
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    log.calls++
    const url = String(input)
    const isWrite = init?.method === 'POST' || url.includes('/set/') || url.includes('/del/')
    if (isWrite) {
      return new Response(JSON.stringify({ error: 'ERR max requests limit exceeded. Limit: 500000, Usage: 500000.' }), { status: 400 })
    }
    return new Response(JSON.stringify({ result: null }), { status: 200 })
  }) as typeof fetch
  return log
}

async function main() {
  // ── Quota exhausted: coalesce fetches directly, no 5s poll ──
  {
    resetRedisHealth()
    mockQuotaExhausted()
    const redis = getRedis(env)
    assert(redis !== null, 'Redis is used while healthy')
    let fetches = 0
    const start = Date.now()
    const result = await coalesce(redis, 'posts:test', async () => { fetches++; return [1, 2, 3] }, 600)
    const ms = Date.now() - start
    assert(JSON.stringify(result) === '[1,2,3]', 'fetcher result is returned')
    assert(fetches === 1, `fetcher runs exactly once (ran ${fetches})`)
    assert(ms < 1000, `no loser poll when the lock SET fails (took ${ms}ms)`)
    assert(isRedisDown(), 'a rejected write marks Redis down')
  }

  // ── While down: getRedis() hands routes the no-Redis path, zero calls ──
  {
    const log = mockQuotaExhausted()
    assert(getRedis(env) === null, 'getRedis returns null during the cooldown')
    const result = await coalesce(getRedis(env), 'posts:test2', async () => 'direct')
    assert(result === 'direct' && log.calls === 0, 'no Upstash calls during the cooldown')
  }

  // ── Network failure: no throw, Redis marked down ──
  {
    resetRedisHealth()
    globalThis.fetch = (async () => { throw new TypeError('fetch failed') }) as typeof fetch
    const redis = getRedis(env)!
    let threw = false
    let value: string | null = 'x'
    try {
      value = await redis.get('k')
    } catch {
      threw = true
    }
    assert(!threw && value === null, 'a thrown fetch becomes a miss, not an exception')
    assert(isRedisDown(), 'a network failure marks Redis down')
  }

  // ── Healthy Redis: winner path still caches and returns ──
  {
    resetRedisHealth()
    const store = new Map<string, string>()
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const parts = new URL(String(input)).pathname.split('/').filter(Boolean).map(decodeURIComponent)
      const [cmd, key, value] = parts
      if (cmd === 'get') return new Response(JSON.stringify({ result: store.get(key) ?? null }), { status: 200 })
      if (cmd === 'set') {
        if (parts.includes('NX') && store.has(key)) return new Response(JSON.stringify({ result: null }), { status: 200 })
        store.set(key, value)
        return new Response(JSON.stringify({ result: 'OK' }), { status: 200 })
      }
      if (cmd === 'del') {
        store.delete(key)
        return new Response(JSON.stringify({ result: 1 }), { status: 200 })
      }
      return new Response(JSON.stringify({ result: null }), { status: 200 })
    }) as typeof fetch
    let fetches = 0
    const first = await coalesce(getRedis(env), 'posts:ok', async () => { fetches++; return 'fresh' }, 600)
    const second = await coalesce(getRedis(env), 'posts:ok', async () => { fetches++; return 'again' }, 600)
    assert(first === 'fresh' && second === 'fresh' && fetches === 1, 'healthy Redis serves the second call from cache')
    assert(!isRedisDown(), 'healthy calls never mark Redis down')
  }

  console.log(`${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
