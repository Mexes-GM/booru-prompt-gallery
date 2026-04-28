/**
 * In-flight request deduplication across concurrent requests.
 * If multiple callers request the same key before the first resolves,
 * they share a single upstream call. After the promise settles, the
 * result is held for `ttlMs` so rapid re-requests also get coalesced.
 */
const inFlight = new Map<string, Promise<unknown>>()

export async function coalesce<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = 5000
): Promise<T> {
  const existing = inFlight.get(key)
  if (existing) return existing as Promise<T>

  const promise = fetcher().finally(() => {
    setTimeout(() => inFlight.delete(key), ttlMs)
  })
  inFlight.set(key, promise)
  return promise
}
