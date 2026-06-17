/**
 * Structured JSON logger for Cloudflare Workers.
 *
 * Every log line is a JSON object with:
 *   - timestamp: ISO 8601
 *   - level: debug | info | warn | error
 *   - event: stable event name (kebab-case)
 *   - requestId: correlation ID from x-request-id header
 *   - layer: "worker"
 *   - ...additional context fields
 *
 * Usage:
 *   import { logger } from "./logger"
 *   const log = logger.child({ route: "/api/posts" })
 *   log.info("request", { durationMs: 42 })
 *
 * On-call questions this logger helps answer:
 *   Q1: "What happened during this specific failing request?"
 *       → Filter by requestId (propagated from frontend via x-request-id).
 *   Q3: "Which API endpoints are slow/erroring?"
 *       → Filter event=request, group by route, inspect durationMs.
 *   Q4: "Is Upstash/Supabase down?"
 *       → Filter event=supabase_error or event=redis_error.
 *   Q5: "Why did a booru fetch fail?"
 *       → Filter layer=worker, event=provider_fetch_error, inspect provider + status.
 */

export type LogLevel = "debug" | "info" | "warn" | "error"

export interface LogEntry {
  timestamp: string
  level: LogLevel
  event: string
  requestId?: string
  layer: string
  [key: string]: unknown
}

const LOG_LEVEL_NUM: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

export class Logger {
  private context: Record<string, unknown>

  constructor(context: Record<string, unknown> = {}) {
    this.context = context
  }

  child(extra: Record<string, unknown>): Logger {
    return new Logger({ ...this.context, ...extra })
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
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      layer: "worker",
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

export const logger = new Logger()

/**
 * Create a per-request logger that extracts the request ID from headers.
 * Use at the top of every route handler.
 */
export function reqLogger(request: Request, route: string): Logger {
  const requestId = request.headers.get("x-request-id") ?? undefined
  return logger.child({ route, requestId })
}
