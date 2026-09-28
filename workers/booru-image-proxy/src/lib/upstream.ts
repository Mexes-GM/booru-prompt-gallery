// ---------------------------------------------------------------------------
// Single outbound fetch helper for every booru API call the Worker makes.
//
// Retry policy (the ONLY retry layer for Worker-proxied calls — the frontend
// does not retry /api/* 5xx on top of this, see lib/api-client.ts):
//   - network error / timeout, 502, 503, 504 → retry once after a short backoff
//   - 429 → retry once only if Retry-After is short (≤ MAX_INLINE_RETRY_S);
//           otherwise surface it to the caller with its retryAfter
//   - any other non-2xx (400/401/403/404/410/422…) → never retried: the same
//           request would fail again and only adds load on the provider
// ---------------------------------------------------------------------------

export class UpstreamError extends Error {
  constructor(
    message: string,
    /** HTTP status from the provider; 502 = network failure, 504 = timeout. */
    readonly status: number,
    /** Seconds the provider asked us to wait (429/503), when it said so. */
    readonly retryAfter?: number
  ) {
    super(message)
    this.name = 'UpstreamError'
  }
}

/**
 * True when an error means the provider is unhealthy or throttling us — the
 * only failures that should count toward a circuit breaker. A 4xx caused by
 * the caller's own query (tag limit, bad page) says nothing about the origin.
 */
export function isUpstreamOutage(error: unknown): boolean {
  if (!(error instanceof UpstreamError)) return true
  return error.status === 429 || error.status >= 500
}

const RETRYABLE_STATUSES = new Set([502, 503, 504])
const MAX_INLINE_RETRY_S = 3
const DEFAULT_TIMEOUT_MS = 12_000

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds)
  const date = Date.parse(value)
  if (Number.isNaN(date)) return undefined
  return Math.max(0, Math.ceil((date - Date.now()) / 1000))
}

export interface UpstreamFetchOptions {
  headers?: Record<string, string>
  timeoutMs?: number
  /** Extra attempts after the first one (default 1). */
  retries?: number
}

/**
 * Fetch `url` and return the response only when it is 2xx; every failure is
 * thrown as an UpstreamError carrying the provider status.
 */
export async function fetchUpstream(
  url: string,
  { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS, retries = 1 }: UpstreamFetchOptions = {}
): Promise<Response> {
  let lastError: UpstreamError | null = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    // The timer is left running on success so it also bounds the caller's
    // body read (aborting an already-consumed response is a no-op).
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    let waitS = attempt + 1

    let response: Response
    try {
      response = await fetch(url, { headers, signal: controller.signal })
    } catch (error) {
      clearTimeout(timeoutId)
      const timedOut = error instanceof Error && error.name === 'AbortError'
      lastError = new UpstreamError(
        timedOut ? 'Upstream timed out' : 'Upstream network error',
        timedOut ? 504 : 502
      )
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, waitS * 1000))
      continue
    }

    if (response.ok) return response
    clearTimeout(timeoutId)

    const retryAfter = parseRetryAfter(response.headers.get('Retry-After'))
    lastError = new UpstreamError(`Upstream responded ${response.status}`, response.status, retryAfter)
    // Drain the body so the connection can be reused.
    await response.body?.cancel()

    const shortRateLimit =
      response.status === 429 && retryAfter !== undefined && retryAfter <= MAX_INLINE_RETRY_S
    if (!shortRateLimit && !RETRYABLE_STATUSES.has(response.status)) throw lastError
    if (shortRateLimit) waitS = Math.max(retryAfter, 1)

    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, waitS * 1000))
    }
  }

  throw lastError ?? new UpstreamError('Upstream fetch failed', 502)
}

/**
 * Maps a provider failure to the status/message our API returns. Upstream
 * error text is never relayed verbatim (it can contain provider internals).
 */
export function toClientError(error: unknown): { status: number; message: string; retryAfter?: number } {
  if (error instanceof UpstreamError) {
    if (error.status === 429) {
      return { status: 429, message: 'The provider is rate limiting requests. Please try again shortly.', retryAfter: error.retryAfter ?? 30 }
    }
    if (error.status === 400 || error.status === 422) {
      return { status: 422, message: 'The provider rejected this search. Try fewer or different tags.' }
    }
    if (error.status === 410) {
      return { status: 422, message: 'This page is beyond what the provider allows browsing.' }
    }
    if (error.status === 404) {
      return { status: 404, message: 'Not found on the provider.' }
    }
    if (error.status === 504) {
      return { status: 504, message: 'The provider took too long to respond.' }
    }
    return { status: 502, message: 'The provider is unavailable right now.' }
  }
  return { status: 500, message: 'Internal server error' }
}
