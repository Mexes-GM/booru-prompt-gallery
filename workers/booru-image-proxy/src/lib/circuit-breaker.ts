import { Redis } from './redis'

const OPEN_TIMEOUT_MS = 60_000
const MAX_FAILS = 2

/** Single round-trip — returns both circuit state and retry-after. */
export async function checkCircuitOpen(
  redis: Redis,
  name: string
): Promise<{ open: boolean; retryAfter: number }> {
  const state = await redis.get(`circuit:${name}:state`)
  if (state !== 'open') return { open: false, retryAfter: 0 }
  const openedAt = parseInt((await redis.get(`circuit:${name}:openedAt`)) || '0')
  const elapsed = Date.now() - openedAt
  if (elapsed > OPEN_TIMEOUT_MS) {
    await redis.set(`circuit:${name}:state`, 'half-open')
    return { open: false, retryAfter: 0 }
  }
  const retryAfter = Math.ceil((OPEN_TIMEOUT_MS - elapsed) / 1000)
  return { open: true, retryAfter }
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
}

export async function recordFailure(redis: Redis, name: string): Promise<void> {
  // Atomic Lua: INCR failCount + EXPIRE + conditional open. 1 command instead of 1-3.
  const now = String(Date.now())
  await redis.eval(
    `local count = redis.call('INCR', KEYS[1])
     redis.call('EXPIRE', KEYS[1], ARGV[1])
     if count >= tonumber(ARGV[2]) then
       redis.call('SET', KEYS[2], 'open')
       redis.call('SET', KEYS[3], ARGV[3])
     end
     return count`,
    [`circuit:${name}:failCount`, `circuit:${name}:state`, `circuit:${name}:openedAt`],
    ['120', String(MAX_FAILS), now]
  )
}
