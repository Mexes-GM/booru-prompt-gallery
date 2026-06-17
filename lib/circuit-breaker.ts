/**
 * Circuit breaker para Danbooru.
 *
 * Si Danbooru retorna 429, el circuito se abre y todas las requests
 * subsecuentes fallan rápido durante 60s sin golpear el origen.
 * Después de 60s, pasa a half-open: permite una request de prueba.
 * Si tiene éxito, cierra el circuito. Si falla, lo reabre.
 */

type CircuitState = "closed" | "open" | "half-open"

interface CircuitEntry {
  state: CircuitState
  openedAt: number
  failCount: number
  lastFailAt: number
}

const circuits = new Map<string, CircuitEntry>()

const OPEN_TIMEOUT_MS = 60_000
const MAX_FAILS_BEFORE_OPEN = 2

function getCircuit(key: string): CircuitEntry {
  let entry = circuits.get(key)
  if (!entry) {
    entry = { state: "closed", openedAt: 0, failCount: 0, lastFailAt: 0 }
    circuits.set(key, entry)
  }
  return entry
}

export function isCircuitOpen(key: string): boolean {
  const entry = getCircuit(key)

  if (entry.state === "closed") return false

  if (entry.state === "open") {
    if (Date.now() - entry.openedAt >= OPEN_TIMEOUT_MS) {
      entry.state = "half-open"
      console.log(
        JSON.stringify({
          layer: "circuit-breaker",
          event: "half-open",
          key,
          openedFor: Date.now() - entry.openedAt,
        })
      )
      return false
    }
    return true
  }

  // half-open: allow one test request
  return false
}

export function recordSuccess(key: string): void {
  const entry = getCircuit(key)
  if (entry.state === "half-open") {
    console.log(
      JSON.stringify({
        layer: "circuit-breaker",
        event: "closed",
        key,
      })
    )
  }
  entry.state = "closed"
  entry.failCount = 0
}

export function recordFailure(key: string, status?: number): void {
  const entry = getCircuit(key)

  // Only 429 or 5xx should count toward circuit opening
  if (status && status !== 429 && status < 500) return

  entry.failCount++
  entry.lastFailAt = Date.now()

  if (entry.state === "half-open") {
    entry.state = "open"
    entry.openedAt = Date.now()
    console.log(
      JSON.stringify({
        layer: "circuit-breaker",
        event: "reopened",
        key,
        failCount: entry.failCount,
      })
    )
    return
  }

  if (entry.failCount >= MAX_FAILS_BEFORE_OPEN && entry.state === "closed") {
    entry.state = "open"
    entry.openedAt = Date.now()
    console.log(
      JSON.stringify({
        layer: "circuit-breaker",
        event: "opened",
        key,
        failCount: entry.failCount,
      })
    )
  }
}

export function getCircuitState(key: string): CircuitState {
  return getCircuit(key).state
}

export function getCircuitRetryAfter(key: string): number {
  const entry = getCircuit(key)
  if (entry.state !== "open") return 0
  return Math.max(0, OPEN_TIMEOUT_MS - (Date.now() - entry.openedAt))
}

// ---------------------------------------------------------------------------
// Redis-backed shared circuit breaker
//
// In Vercel, each function instance has its own in-memory circuit state.
// When one instance receives a 429 from Danbooru, other instances don't know
// and continue sending requests. These shared functions broadcast circuit
// state via Redis so ALL instances stop simultaneously.
// ---------------------------------------------------------------------------

import { redis } from "./redis"

const CIRCUIT_REDIS_PREFIX = "circuit:"

/**
 * Check circuit state across all Vercel instances via Redis.
 * Falls back to local in-memory state if Redis is unavailable.
 */
export async function isCircuitOpenShared(key: string): Promise<boolean> {
  if (isCircuitOpen(key)) return true

  if (!redis) return false
  try {
    const val = await redis.get(`${CIRCUIT_REDIS_PREFIX}${key}`)
    return val === "open"
  } catch {
    return false
  }
}

/**
 * Record failure locally and broadcast to all instances via Redis.
 */
export async function recordFailureShared(key: string, status?: number): Promise<void> {
  recordFailure(key, status)

  if (isCircuitOpen(key) && redis) {
    try {
      await redis.set(`${CIRCUIT_REDIS_PREFIX}${key}`, "open", { ex: Math.ceil(OPEN_TIMEOUT_MS / 1000) })
    } catch {
      // Redis unavailable — local circuit is still open for this instance
    }
  }
}

/**
 * Record success locally and clear shared circuit state.
 */
export async function recordSuccessShared(key: string): Promise<void> {
  recordSuccess(key)
  if (redis) {
    try {
      await redis.del(`${CIRCUIT_REDIS_PREFIX}${key}`)
    } catch {
      // ignore
    }
  }
}
