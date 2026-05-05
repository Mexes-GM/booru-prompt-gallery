
import { isCircuitOpen, recordFailure } from '@/lib/circuit-breaker'

/**
 * Smart Fetcher
 *
 * Handles:
 * - Exponential Backoff Retries
 * - Rate Limit Detection (429)
 * - Circuit breaker awareness (aborts retries if circuit opens)
 * - Proactive throttling via x-rate-limit headers
 * - Timeout Management
 * - Response Validation
 */

interface FetchOptions extends RequestInit {
  retries?: number
  retryDelay?: number
  timeout?: number
}

interface RateLimitInfo {
  remaining: number
  limit: number
  reset: number
}

export class NetworkError extends Error {
  status: number
  statusText: string

  constructor(message: string, status: number, statusText: string) {
    super(message)
    this.name = 'NetworkError'
    this.status = status
    this.statusText = statusText
  }
}

// Track 429 responses for observability
let recent429Count = 0
let last429Timestamp = 0

export function getRateLimit429Stats(): { recentCount: number; lastTimestamp: number } {
  return { recentCount: recent429Count, lastTimestamp: last429Timestamp }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Parse Danbooru's x-rate-limit header.
 * Format: JSON string with { remaining, limit, reset, rechargeRate } or similar.
 */
function parseRateLimitHeader(response: Response): RateLimitInfo | null {
  try {
    const header = response.headers.get('x-rate-limit')
    if (!header) return null

    const parsed = JSON.parse(header)
    if (typeof parsed.remaining === 'number') {
      return {
        remaining: parsed.remaining,
        limit: parsed.limit || 10,
        reset: parsed.reset || Date.now() + 1000,
      }
    }
    return null
  } catch {
    return null
  }
}

export async function smartFetch(url: string, options: FetchOptions = {}) {
  const {
    retries = 3,
    retryDelay = 1000,
    timeout = 10000,
    ...fetchInit
  } = options

  let attempt = 0

  while (attempt <= retries) {
    // Abort retries if the Danbooru circuit breaker has opened
    const isDanbooru = url.includes('danbooru.donmai.us')
    if (isDanbooru && isCircuitOpen('danbooru-api') && attempt > 0) {
      throw new NetworkError(
        'Danbooru circuit breaker open — failing fast',
        429,
        'Circuit Open'
      )
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const response = await fetch(url, {
        ...fetchInit,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      // Parse rate limit info for proactive throttling
      const rateLimitInfo = parseRateLimitHeader(response)

      // Proactive throttling: if we have very few requests remaining,
      // add a delay before the next outbound call to let the bucket recharge.
      if (rateLimitInfo && rateLimitInfo.remaining <= 2 && rateLimitInfo.remaining >= 0) {
        const waitMs = Math.max(500, (rateLimitInfo.reset - Date.now()) || 1500)
        await sleep(waitMs)
      }

      // Handle Success
      if (response.ok) {
        return response
      }

      // Handle Rate Limits (429)
      if (response.status === 429) {
        recent429Count++
        last429Timestamp = Date.now()

        // Signal the circuit breaker — 2 consecutive 429s open the circuit
        if (isDanbooru) {
          recordFailure('danbooru-api', 429)
        }

        // If the circuit just opened, stop retrying immediately
        if (isDanbooru && isCircuitOpen('danbooru-api')) {
          throw new NetworkError(
            'Danbooru circuit breaker open — failing fast',
            429,
            'Circuit Open'
          )
        }

        const retryAfter = response.headers.get('Retry-After')
        const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : retryDelay * Math.pow(2, attempt)

        console.warn(`[SmartFetch] Rate limited on ${url}. Waiting ${waitTime}ms...`)

        if (attempt < retries) {
          await sleep(waitTime)
          attempt++
          continue
        }
      }

      // Handle Server Errors (5xx) - Retryable
      if (response.status >= 500 && attempt < retries) {
        const waitTime = retryDelay * Math.pow(2, attempt)
        console.warn(`[SmartFetch] Server error ${response.status} on ${url}. Retrying in ${waitTime}ms...`)
        await sleep(waitTime)
        attempt++
        continue
      }

      // Client Errors (4xx) - usually not retryable (except 429 handled above)
      throw new NetworkError(
        `Request failed with status ${response.status}`,
        response.status,
        response.statusText
      )

    } catch (error: any) {
      clearTimeout(timeoutId)

      const isAbort = error.name === 'AbortError'
      const isRetryable = isAbort || error.message.includes('network') || error.message.includes('fetch')

      if (isRetryable && attempt < retries) {
        const waitTime = retryDelay * Math.pow(2, attempt)
        console.warn(`[SmartFetch] Network/Timeout error on ${url}. Retrying in ${waitTime}ms...`)
        await sleep(waitTime)
        attempt++
        continue
      }

      throw error
    }
  }

  throw new Error(`Failed to fetch ${url} after ${retries} attempts`)
}
