import { Redis } from './redis'

const OPEN_TIMEOUT_MS = 60_000
const MAX_FAILS = 2

export async function isCircuitOpen(redis: Redis, name: string): Promise<boolean> {
  const state = await redis.get(`circuit:${name}:state`)
  if (state !== 'open') return false
  const openedAt = parseInt((await redis.get(`circuit:${name}:openedAt`)) || '0')
  if (Date.now() - openedAt > OPEN_TIMEOUT_MS) {
    await redis.set(`circuit:${name}:state`, 'half-open')
    return false
  }
  return true
}

export async function recordSuccess(redis: Redis, name: string): Promise<void> {
  await redis.set(`circuit:${name}:state`, 'closed')
  await redis.del(`circuit:${name}:failCount`)
}

export async function recordFailure(redis: Redis, name: string): Promise<void> {
  const count = await redis.incr(`circuit:${name}:failCount`)
  if (count === 1) {
    await redis.expire(`circuit:${name}:failCount`, 120) // Failures expire after 2 mins
  }
  if (count >= MAX_FAILS) {
    await redis.set(`circuit:${name}:state`, 'open')
    await redis.set(`circuit:${name}:openedAt`, String(Date.now()))
  }
}

export async function getRetryAfter(redis: Redis, name: string): Promise<number> {
  const openedAt = parseInt((await redis.get(`circuit:${name}:openedAt`)) || '0')
  if (!openedAt) return 60
  return Math.ceil((OPEN_TIMEOUT_MS - (Date.now() - openedAt)) / 1000)
}
