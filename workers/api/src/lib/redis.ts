import { Env } from '../types'

// In-memory fallback for when Redis is not configured (local dev)
// For production, always use Upstash Redis.
const memoryStore = new Map<string, { value: string; expiresAt: number }>()

function redisAvailable(env: Env): boolean {
  return !!(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN)
}

function makeUpstashUrl(env: Env): string {
  return env.UPSTASH_REDIS_REST_URL!
}

function makeUpstashToken(env: Env): string {
  return env.UPSTASH_REDIS_REST_TOKEN!
}

async function redisRequest(
  env: Env,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const url = `${makeUpstashUrl(env)}${path}`
  const resp = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${makeUpstashToken(env)}`,
      ...(init?.headers || {}),
    },
  })
  return resp
}

export interface Redis {
  get(key: string): Promise<string | null>
  set(key: string, value: string, opts?: { ex?: number; nx?: boolean }): Promise<boolean>
  del(key: string): Promise<void>
  incr(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<void>
  eval(script: string, keys: string[], args: string[]): Promise<unknown>
}

class MemoryRedis implements Redis {
  async get(key: string): Promise<string | null> {
    const entry = memoryStore.get(key)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      memoryStore.delete(key)
      return null
    }
    return entry.value
  }

  async set(key: string, value: string, opts?: { ex?: number; nx?: boolean }): Promise<boolean> {
    const existing = memoryStore.get(key)
    if (opts?.nx && existing && Date.now() <= existing.expiresAt) return false
    memoryStore.set(key, {
      value,
      expiresAt: opts?.ex ? Date.now() + opts.ex * 1000 : Infinity,
    })
    return true
  }

  async del(key: string): Promise<void> {
    memoryStore.delete(key)
  }

  async incr(key: string): Promise<number> {
    const entry = memoryStore.get(key)
    if (!entry || Date.now() > entry.expiresAt) {
      memoryStore.set(key, { value: '1', expiresAt: Infinity })
      return 1
    }
    const num = (parseInt(entry.value) || 0) + 1
    entry.value = String(num)
    return num
  }

  async expire(key: string, seconds: number): Promise<void> {
    const val = await this.get(key)
    if (val !== null) {
      memoryStore.set(key, { value: val, expiresAt: Date.now() + seconds * 1000 })
    }
  }

  async eval(_script: string, _keys: string[], _args: string[]): Promise<unknown> {
    // Not supported in memory fallback
    return null
  }
}

class UpstashRedis implements Redis {
  constructor(private env: Env) {}

  async get(key: string): Promise<string | null> {
    const resp = await redisRequest(this.env, `/get/${key}`)
    if (!resp.ok) return null
    const data = await resp.json() as any
    return data.result
  }

  async set(key: string, value: string, opts?: { ex?: number; nx?: boolean }): Promise<boolean> {
    let url = `/set/${key}/${encodeURIComponent(value)}`
    if (opts?.ex) url += `/EX/${opts.ex}`
    if (opts?.nx) url += `/NX`

    const resp = await redisRequest(this.env, url)
    if (!resp.ok) return false
    const data = await resp.json() as any
    return data.result === 'OK'
  }

  async del(key: string): Promise<void> {
    await redisRequest(this.env, `/del/${key}`)
  }

  async incr(key: string): Promise<number> {
    const resp = await redisRequest(this.env, `/incr/${key}`)
    if (!resp.ok) return 0
    const data = await resp.json() as any
    return data.result || 0
  }

  async expire(key: string, seconds: number): Promise<void> {
    await redisRequest(this.env, `/expire/${key}/${seconds}`)
  }

  async eval(script: string, keys: string[], args: string[]): Promise<unknown> {
    const body = JSON.stringify({ script, keys, arguments: args })
    const resp = await redisRequest(this.env, '/eval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    if (!resp.ok) return null
    const data = await resp.json() as any
    return data.result
  }
}

export function getRedis(env: Env): Redis | null {
  if (redisAvailable(env)) {
    return new UpstashRedis(env)
  }
  return null
}
