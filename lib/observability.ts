/**
 * Structured JSON logging for observability.
 *
 * Each log line is a JSON object that can be consumed by log aggregation
 * tools (Vercel Logs, Cloudflare Logpush, etc.).
 *
 * Events tracked:
 * - Rate limit hits (per layer)
 * - Cache hit/miss
 * - Circuit breaker transitions (logged in circuit-breaker.ts)
 * - API request latency
 */

interface LogEntry {
  layer: "client" | "api" | "worker" | "rate-limit" | "circuit-breaker"
  event: string
  [key: string]: unknown
}

function emit(entry: LogEntry): void {
  console.log(JSON.stringify({ ...entry, timestamp: Date.now() }))
}

// Rate limit hits
export function logRateLimitHit(layer: LogEntry["layer"], details: Record<string, unknown> = {}): void {
  emit({ layer, event: "rate_limit_hit", ...details })
}

// Cache operations
export function logCacheHit(layer: "worker" | "api", url?: string): void {
  emit({ layer, event: "cache_hit", url: url?.substring(0, 100) })
}

export function logCacheMiss(layer: "worker" | "api", url?: string): void {
  emit({ layer, event: "cache_miss", url: url?.substring(0, 100) })
}

// API request latency
export function logRequestLatency(endpoint: string, durationMs: number, status: number): void {
  emit({ layer: "api", event: "request", endpoint, durationMs, status })
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
  emit({ layer, event: "rate_limit_snapshot", ...stats })
}
