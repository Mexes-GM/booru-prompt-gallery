/**
 * Classifies a failed booru search for telemetry (`error_shown` with
 * error_source=booru_search). Most failures never reach an HTTP status —
 * the browser rejects fetch() with a TypeError on CORS/network drops, or
 * res.json() throws on an HTML error page — so `status` alone left ~85% of
 * those events unexplained. `reason` buckets every case; `message` keeps a
 * trimmed copy of the raw text for the ones the buckets don't explain.
 */

export type SearchErrorReason =
  | "circuit_open"
  | "rate_limited"
  | "timeout"
  | "network"
  | "invalid_response"
  | `http_${number}`
  | "unknown"

export interface SearchErrorDetails {
  reason: SearchErrorReason
  status?: number
  message?: string
}

const MAX_MESSAGE_LENGTH = 200

type ErrorLike = {
  name?: unknown
  message?: unknown
  status?: unknown
  statusCode?: unknown
  info?: { error?: unknown; message?: unknown } | null
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

export function describeSearchError(error: unknown): SearchErrorDetails {
  const e = (error && typeof error === "object" ? error : {}) as ErrorLike
  const rawStatus = e.status ?? e.statusCode
  const status = typeof rawStatus === "number" && rawStatus > 0 ? rawStatus : undefined
  const name = asString(e.name)
  const message = asString(e.message) || (typeof error === "string" ? error : "")
  // The Worker puts its own explanation in the JSON body ({ error: "..." }).
  const serverMessage = asString(e.info?.error) || asString(e.info?.message)
  const combined = [message, serverMessage].filter(Boolean).join(" | ")

  let reason: SearchErrorReason
  if (status === 429) {
    reason = serverMessage.includes("saturated") ? "circuit_open" : "rate_limited"
  } else if (status !== undefined) {
    reason = `http_${status}`
  } else if (name === "AbortError" || name === "TimeoutError" || /timed? ?out/i.test(message)) {
    reason = "timeout"
  } else if (name === "SyntaxError") {
    // res.json() on a non-JSON body (proxy/CDN HTML error page).
    reason = "invalid_response"
  } else if (name === "TypeError" || /failed to fetch|load failed|networkerror/i.test(message)) {
    reason = "network"
  } else {
    reason = "unknown"
  }

  return {
    reason,
    ...(status !== undefined ? { status } : {}),
    ...(combined ? { message: combined.slice(0, MAX_MESSAGE_LENGTH) } : {}),
  }
}
