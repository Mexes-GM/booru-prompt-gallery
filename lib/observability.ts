/**
 * Observability helpers — thin wrappers around the structured Logger.
 *
 * Each function emits a JSON log line that can be consumed by log aggregation
 * tools (Vercel Logs, Cloudflare Logpush, etc.).
 *
 * Events tracked:
 * - Rate limit hits (per layer)
 * - Cache hit/miss
 * - Circuit breaker transitions (logged in circuit-breaker.ts)
 * - API request latency
 *
 * On-call questions these logs answer:
 *   Q2 (circuit breaker): Filter event=opened|half-open|closed|reopened, layer=circuit-breaker
 *   Q3 (slow endpoints): Filter event=request, group by endpoint, inspect durationMs
 *   Q4 (Upstash down): Filter event=upstash_fallback, layer=rate-limit
 */

import { rootLogger, type Logger } from "./logger"

// Re-export for consumers that want the full Logger API
export { Logger, rootLogger, generateRequestId } from "./logger"
export type { LogEntry, LogLevel } from "./logger"

const log = rootLogger.child({ module: "observability" })

// Rate limit hits
export function logRateLimitHit(
  layer: string,
  details: Record<string, unknown> = {}
): void {
  log.warn("rate_limit_hit", { layer, ...details })
}

// ---------------------------------------------------------------------------
// Standardized rate-limit block telemetry (F0 — rate-limit-antiabuse plan).
//
// Every rejection (429) on a cost-bearing surface emits ONE structured line
// with a stable schema so blocks can be graphed by surface / identity / origin
// without parsing free-text messages. Answers: "which surface is shedding the
// most load, for anon vs authed users, and against which upstream origin?".
// ---------------------------------------------------------------------------
export type RateLimitSurface =
  | "posts"
  | "image"
  | "download"
  | "tags"
  | "trends"
  | "ai"
  | "auth"
  | "feedback"
  | "favorites"

export interface RateLimitBlockFields {
  /** Which product surface was rejected. */
  surface: RateLimitSurface
  /** Whether the limit key was an anonymous IP or an authenticated user. */
  keyType: "anon" | "authed"
  /** Which counter tripped: the per-key window or the shared global budget. */
  scope: "per-ip" | "global" | "circuit" | "client"
  /** Upstream origin the surface protects (for cost attribution). */
  origin?: string
  /** Correlation id if available. */
  requestId?: string
  [key: string]: unknown
}

export function logRateLimitBlock(fields: RateLimitBlockFields): void {
  log.warn("ratelimit_block", { layer: "rate-limit", ...fields })
}

// Cache operations
export function logCacheHit(
  layer: "worker" | "api",
  url?: string
): void {
  log.debug("cache_hit", { layer, url: url?.substring(0, 100) })
}

export function logCacheMiss(
  layer: "worker" | "api",
  url?: string
): void {
  log.debug("cache_miss", { layer, url: url?.substring(0, 100) })
}

// API request latency (RED: Duration)
export function logRequestLatency(
  endpoint: string,
  durationMs: number,
  status: number
): void {
  const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info"
  log[level]("request", {
    layer: "api",
    endpoint,
    durationMs: Math.round(durationMs),
    status,
  })
}

// Rate limit state snapshot (periodic)
let lastSnapshotTime = 0
export function maybeLogSnapshot(
  layer: "worker" | "api",
  stats: { requests: number; blocked: number; windowMs: number }
): void {
  const now = Date.now()
  if (now - lastSnapshotTime < 60_000) return
  lastSnapshotTime = now
  log.info("rate_limit_snapshot", { layer, ...stats })
}
