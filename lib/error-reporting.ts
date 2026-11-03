/**
 * Error reporting — PostHog Error Tracking is the single sink.
 *
 * Replaces the former Sentry integration. PostHog already autocaptures
 * unhandled exceptions (`capture_exceptions: true` in instrumentation-client.ts)
 * and receives source maps at build time (next.config.mjs), so these helpers
 * only cover errors the app catches and wants to report on purpose.
 *
 * posthog-js loads after the first paint (instrumentation-client.ts). Errors
 * reported before that wait in lib/posthog-queue.ts and are sent once it loads,
 * with the time they happened and the reference id already returned here.
 *
 * Browser-only: posthog-js does not run on the server. Server-side callers
 * (route handlers, server actions) fall back to console.error, which lands in
 * the Vercel/Netlify function logs.
 */

import {
  QUEUED_TIMESTAMP_PROP,
  QUEUED_UUID_PROP,
  getPostHog,
  uuidv7,
  withPostHog,
} from "@/lib/posthog-queue"

export interface ErrorContext {
  /** Low-cardinality labels to filter/group by in PostHog (e.g. `context`). */
  tags?: Record<string, string | number | boolean | null | undefined>
  /** Free-form diagnostic data attached to the exception event. */
  extra?: Record<string, unknown>
  level?: "fatal" | "error" | "warning" | "info"
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error
  if (typeof error === "string") return new Error(error)
  try {
    return new Error(JSON.stringify(error))
  } catch {
    return new Error(String(error))
  }
}

/**
 * Report a caught error. Returns the PostHog event uuid (shown to users as a
 * reference id) or undefined when nothing was sent. Never throws.
 */
export function reportError(error: unknown, ctx: ErrorContext = {}): string | undefined {
  const err = toError(error)
  if (typeof window === "undefined") {
    console.error("[error]", err, ctx)
    return undefined
  }
  const props = {
    ...ctx.tags,
    ...(ctx.extra ? { extra: ctx.extra } : {}),
    ...(ctx.level ? { $exception_level: ctx.level } : {}),
  }
  try {
    const posthog = getPostHog()
    if (posthog) return posthog.captureException(err, props)?.uuid
    // Not loaded yet: hand out the event id now and let before_send apply it,
    // together with the original time, when the queued exception is sent.
    const now = Date.now()
    const uuid = uuidv7(now)
    withPostHog((ph) => {
      ph.captureException(err, { ...props, [QUEUED_TIMESTAMP_PROP]: now, [QUEUED_UUID_PROP]: uuid })
    })
    return uuid
  } catch {
    /* non-fatal: telemetry is best-effort */
    return undefined
  }
}

/** Report a notable condition that isn't an exception object. */
export function reportMessage(message: string, ctx: ErrorContext = {}): string | undefined {
  return reportError(new Error(message), { level: "warning", ...ctx })
}

/**
 * Attach properties to every subsequent event of this session, including
 * exceptions (PostHog super properties). Use for low-volume diagnostic state
 * such as "page is being auto-translated" or "favorites count".
 */
export function setErrorContext(props: Record<string, string | number | boolean | null>): void {
  if (typeof window === "undefined") return
  withPostHog((ph) => ph.register(props))
}
