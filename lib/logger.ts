/**
 * Structured JSON logger with correlation ID support.
 *
 * Every log line is a JSON object with:
 *   - timestamp: ISO 8601
 *   - level: debug | info | warn | error
 *   - event: stable event name (kebab-case)
 *   - requestId: correlation ID propagated via x-request-id
 *   - layer: "client" | "api" | "worker" | "middleware" | "rate-limit" | "circuit-breaker"
 *   - ...additional context fields from child()
 *
 * Use child() to create scoped loggers with extra context fields.
 * Debug logs are suppressed when NODE_ENV=production.
 *
 * On-call questions this logger helps answer:
 *   Q1: "What happened during this specific failing request?"
 *       → Filter by requestId, follow all events in chronological order.
 *   Q2: "Is the Danbooru circuit breaker cycling?"
 *       → Filter event=opened|half-open|closed|reopened, layer=circuit-breaker.
 *   Q3: "Which API endpoints are slow/erroring?"
 *       → Filter event=request, group by endpoint, inspect durationMs.
 *   Q4: "Is Upstash Redis down?"
 *       → Filter event=upstash_fallback, layer=rate-limit.
 */

export type LogLevel = "debug" | "info" | "warn" | "error"

export interface LogEntry {
  timestamp: string
  level: LogLevel
  event: string
  requestId?: string
  layer?: string
  [key: string]: unknown
}

const LOG_LEVEL_NUM: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const DEFAULT_MIN_LEVEL: LogLevel =
  process.env.NODE_ENV === "production" ? "info" : "debug"

export class Logger {
  private context: Record<string, unknown>
  private minLevel: LogLevel

  constructor(
    context: Record<string, unknown> = {},
    minLevel: LogLevel = DEFAULT_MIN_LEVEL
  ) {
    this.context = context
    this.minLevel = minLevel
  }

  /** Create a child logger inheriting parent context + extra fields. */
  child(extra: Record<string, unknown>): Logger {
    return new Logger({ ...this.context, ...extra }, this.minLevel)
  }

  /** Clone with a different minimum level (e.g. force debug for one route). */
  withLevel(level: LogLevel): Logger {
    return new Logger({ ...this.context }, level)
  }

  debug(event: string, fields: Record<string, unknown> = {}): void {
    this.log("debug", event, fields)
  }

  info(event: string, fields: Record<string, unknown> = {}): void {
    this.log("info", event, fields)
  }

  warn(event: string, fields: Record<string, unknown> = {}): void {
    this.log("warn", event, fields)
  }

  error(event: string, fields: Record<string, unknown> = {}): void {
    this.log("error", event, fields)
  }

  private log(level: LogLevel, event: string, fields: Record<string, unknown>): void {
    if (LOG_LEVEL_NUM[level] < LOG_LEVEL_NUM[this.minLevel]) return

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...this.context,
      ...fields,
    }

    const output = JSON.stringify(entry)

    switch (level) {
      case "error":
        console.error(output)
        break
      case "warn":
        console.warn(output)
        break
      default:
        console.log(output)
    }
  }
}

/** Root logger — create child loggers per-request or per-module. */
export const rootLogger = new Logger()

// ---------------------------------------------------------------------------
// Request ID helpers
// ---------------------------------------------------------------------------

let _generateRequestId: () => string = () => {
  // crypto.randomUUID is available in Node 19+, Edge, and Workers
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // Fallback for older environments
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Override the ID generator (e.g., for testing). */
export function setRequestIdGenerator(fn: () => string): void {
  _generateRequestId = fn
}

export function generateRequestId(): string {
  return _generateRequestId()
}
