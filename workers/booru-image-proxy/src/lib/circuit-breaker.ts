import { Redis } from './redis'

const OPEN_TIMEOUT_MS = 60_000
const MAX_FAILS = 2

// Fase 4 (redis-optimization-plan.md): cache circuit-state reads in memory
// for a short window. Circuit opens are rare, so the cache is almost always
// fresh+closed, and this eliminates the GET round-trip on nearly every
// request. The cache only affects checkCircuitOpen (reads); recordSuccess/
// recordFailure still write through to Redis immediately and also refresh
// this cache so a state change is visible to this isolate right away.
const CIRCUIT_CACHE_TTL_MS = 8_000
type CachedCircuit = { open: boolean; retryAfter: number; state: 'closed' | 'open' | 'half-open'; cachedAt: number }
const circuitCache = new Map<string, CachedCircuit>()

/** Single round-trip — returns circuit state, open flag, and retry-after. */
export async function checkCircuitOpen(
  redis: Redis,
  name: string
): Promise<{ open: boolean; retryAfter: number; state: 'closed' | 'open' | 'half-open' }> {
  const cached = circuitCache.get(name)
  if (cached && Date.now() - cached.cachedAt < CIRCUIT_CACHE_TTL_MS) {
    return { open: cached.open, retryAfter: cached.retryAfter, state: cached.state }
  }

  const state = await redis.get(`circuit:${name}:state`)
  if (state !== 'open') {
    const observedState: 'closed' | 'half-open' = state === 'half-open' ? 'half-open' : 'closed'
    const result = { open: false, retryAfter: 0, state: observedState }
    circuitCache.set(name, { ...result, cachedAt: Date.now() })
    return result
  }
  const openedAt = parseInt((await redis.get(`circuit:${name}:openedAt`)) || '0')
  const elapsed = Date.now() - openedAt
  if (elapsed > OPEN_TIMEOUT_MS) {
    await redis.set(`circuit:${name}:state`, 'half-open')
    const result = { open: false, retryAfter: 0, state: 'half-open' as const }
    circuitCache.set(name, { ...result, cachedAt: Date.now() })
    return result
  }
  const retryAfter = Math.ceil((OPEN_TIMEOUT_MS - elapsed) / 1000)
  const result = { open: true, retryAfter, state: 'open' as const }
  circuitCache.set(name, { ...result, cachedAt: Date.now() })
  return result
}

export async function recordSuccess(redis: Redis, name: string): Promise<void> {
  // Atomic Lua: close circuit + clear failCount + clear openedAt — 1 command instead of 3
  await redis.eval(
    `redis.call('SET', KEYS[1], 'closed')
     redis.call('DEL', KEYS[2])
     redis.call('DEL', KEYS[3])
     return 1`,
    [`circuit:${name}:state`, `circuit:${name}:failCount`, `circuit:${name}:openedAt`],
    []
  )
  circuitCache.set(name, { open: false, retryAfter: 0, state: 'closed', cachedAt: Date.now() })
}

export async function recordFailure(redis: Redis, name: string): Promise<void> {
  // Atomic Lua: INCR failCount + EXPIRE + conditional open. 1 command instead of 1-3.
  const now = String(Date.now())
  const count = await redis.eval(
    `local count = redis.call('INCR', KEYS[1])
     redis.call('EXPIRE', KEYS[1], ARGV[1])
     if count >= tonumber(ARGV[2]) then
       redis.call('SET', KEYS[2], 'open')
       redis.call('SET', KEYS[3], ARGV[3])
     end
     return count`,
    [`circuit:${name}:failCount`, `circuit:${name}:state`, `circuit:${name}:openedAt`],
    ['120', String(MAX_FAILS), now]
  ) as number

  if (count >= MAX_FAILS) {
    circuitCache.set(name, { open: true, retryAfter: Math.ceil(OPEN_TIMEOUT_MS / 1000), state: 'open', cachedAt: Date.now() })
  } else {
    // Not yet open — invalidate so the next read re-checks Redis rather
    // than trusting a possibly-stale "closed" cache entry.
    circuitCache.delete(name)
  }
}
