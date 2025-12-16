
/**
 * Smart Fetcher
 * 
 * Handles:
 * - Exponential Backoff Retries
 * - Rate Limit Detection (429)
 * - Timeout Management
 * - Response Validation
 */

interface FetchOptions extends RequestInit {
  retries?: number
  retryDelay?: number
  timeout?: number
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

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function smartFetch(url: string, options: FetchOptions = {}) {
  const { 
    retries = 3, 
    retryDelay = 1000, 
    timeout = 10000,
    ...fetchInit 
  } = options

  let attempt = 0
  
  while (attempt <= retries) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)
    
    try {
      const response = await fetch(url, {
        ...fetchInit,
        signal: controller.signal,
      })
      
      clearTimeout(timeoutId)

      // Handle Success
      if (response.ok) {
        return response
      }

      // Handle Rate Limits (429)
      if (response.status === 429) {
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
