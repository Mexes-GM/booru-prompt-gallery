// In-memory short-circuit for already-blocked rate-limit keys.
// See docs/redis-optimization-plan.md — Fase 1.
//
// Upstash charges per command, even for rejected requests. A hammering IP
// (incident: ~4,000 req/hour from one user) costs the same 1-2 commands per
// request whether it's allowed or rejected. Once a key has been rejected,
// we remember it in memory (per isolate) until its window resets and
// short-circuit all further checks locally — no Upstash call at all.
//
// This only ever makes rejection cheaper; it never lets a request through
// that Redis would have blocked (fail-closed). Per-isolate memory is
// best-effort (not shared across Cloudflare instances), but a hammering
// abuser keeps hitting the same warm isolate, so this captures the bulk of
// the amplification in practice.

const blockedUntil = new Map<string, number>()

/** Returns true if `key` is currently known-blocked (skip Redis entirely). */
export function isBlocked(key: string): boolean {
  const reset = blockedUntil.get(key)
  if (reset === undefined) return false
  if (Date.now() >= reset) {
    blockedUntil.delete(key)
    return false
  }
  return true
}

/**
 * Record that `key` was rejected by the real limiter; it will be
 * short-circuited locally until `windowSeconds` from now.
 */
export function markBlocked(key: string, windowSeconds: number): void {
  blockedUntil.set(key, Date.now() + windowSeconds * 1000)
}

/** Clear a key once it's confirmed to be under the limit again. */
export function clearBlocked(key: string): void {
  blockedUntil.delete(key)
}

/** Periodic cleanup of expired entries (call opportunistically). */
export function cleanupBlocked(): void {
  const now = Date.now()
  for (const [key, reset] of blockedUntil) {
    if (now >= reset) blockedUntil.delete(key)
  }
}

// ---------------------------------------------------------------------------
// Pure in-memory rate limiter — Fase 5 (redis-optimization-plan.md)
//
// For endpoints that don't protect the donmai origin (health checks against
// Supabase, the static tags list), a Redis-backed limiter buys no extra
// protection — a per-isolate in-memory counter is enough to stop trivial
// abuse without spending any Upstash commands at all.
// ---------------------------------------------------------------------------

const memoryWindows = new Map<string, { count: number; windowStart: number }>()

/**
 * Fixed-window in-memory rate limit. Returns true if the request is allowed.
 * Never touches Redis — intended for low-risk endpoints only.
 */
export function memoryRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now()
  let entry = memoryWindows.get(key)

  if (!entry || now - entry.windowStart > windowMs) {
    memoryWindows.set(key, { count: 1, windowStart: now })
    return true
  }

  entry.count++
  return entry.count <= maxRequests
}
