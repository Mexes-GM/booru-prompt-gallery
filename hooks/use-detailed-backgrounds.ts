import { useEffect, useState } from "react"

export type DetailedBackgroundsList = string[][]

/** Stable empty value so `list` keeps referential identity until data lands. */
const EMPTY: DetailedBackgroundsList = []

/** Retry budget for a failed load, including the first attempt. */
const MAX_LOAD_ATTEMPTS = 3
/** Base delay between retries; doubles per attempt. */
const RETRY_BASE_DELAY_MS = 1000

/**
 * In-flight / resolved load, shared process-wide.
 *
 * The dataset is a static, immutable public asset, so one request per page
 * session is enough no matter how many consumers mount (the gallery and the
 * extension client both call the hook). Caching the PROMISE — rather than
 * gating on a per-hook ref — is what makes concurrent and repeated mounts
 * (React StrictMode double-invokes every effect in dev) collapse onto a single
 * fetch without any of them being able to starve the others.
 *
 * Cleared on failure so a later attempt starts a fresh request instead of
 * replaying the rejection forever.
 */
let pendingLoad: Promise<DetailedBackgroundsList> | null = null

/**
 * Maps the raw JSON payload to the shape consumers use. Only the `scenery`
 * axis reaches the prompt: Detailed Random REPLACES the post's background, so
 * injecting pose/clothing/appearance would fight the post's own tags. Exported
 * for direct testing — a resolved load is intentionally sticky, so this can't
 * be exercised twice through loadDetailedBackgrounds in one process.
 */
export function toSceneryList(data: unknown): DetailedBackgroundsList {
  if (!Array.isArray(data)) throw new Error("Invalid detailed-backgrounds.json format")
  return data.map((item) => {
    const scenery = (item as { scenery?: unknown } | null)?.scenery
    return Array.isArray(scenery) ? (scenery as string[]) : []
  })
}

/**
 * Starts (or joins) the shared load. Exported for the regression test that
 * pins the two properties the past bugs violated: concurrent/repeated calls
 * collapse onto ONE request, and a failure leaves the cache clear so the next
 * call actually retries instead of replaying the rejection.
 */
export function loadDetailedBackgrounds(): Promise<DetailedBackgroundsList> {
  if (!pendingLoad) {
    pendingLoad = fetch("/detailed-backgrounds.json")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching detailed-backgrounds.json`)
        return res.json()
      })
      .then(toSceneryList)
      .catch((err) => {
        pendingLoad = null
        throw err
      })
  }
  return pendingLoad
}

/**
 * Loads the `/detailed-backgrounds.json` scenery dataset used by the
 * "Detailed Random" background mode. Shared by the main gallery and the
 * extension client so the fetch/validation logic lives in exactly one place.
 *
 * Fetched lazily — only once `enabled` is true, i.e. the user actually selects
 * Detailed Random. An empty list makes `processBackgroundTags` strip the
 * original background and inject nothing, so Detailed Random silently degrades
 * into "Remove All"; every failure mode below has to end in either data or a
 * retry, never in a permanent empty list.
 *
 * Two past bugs produced exactly that permanent-empty state:
 *   1. The fetch was gated on the `random` mode instead of `detailed_random`,
 *      so the real consumer never triggered the load.
 *   2. The load was deduped with a `loadedRef` that was set BEFORE the fetch
 *      settled and reset inside `.catch`. An AbortController cancelled the
 *      request on unmount, so StrictMode's mount/unmount/remount aborted the
 *      only attempt: the remount saw `loadedRef === true` and returned early,
 *      and resetting the ref afterwards changed nothing because the effect
 *      re-runs on `enabled` alone — which never changed. Result: no data, no
 *      retry, no error surfaced (AbortError was swallowed).
 *
 * Hence: no AbortController (cancelling a ~100 KB immutable asset saves
 * nothing and was the whole failure mechanism), dedupe via the module-level
 * promise above, and retries driven by `attempt` STATE so a genuine network
 * failure actually re-runs this effect.
 */
export function useDetailedBackgrounds(enabled: boolean): DetailedBackgroundsList {
  const [list, setList] = useState<DetailedBackgroundsList>(EMPTY)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled) return

    let active = true
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    loadDetailedBackgrounds()
      .then((data) => {
        if (active) setList(data)
      })
      .catch((err) => {
        if (!active) return
        console.error("Failed to load detailed backgrounds:", err)
        if (attempt < MAX_LOAD_ATTEMPTS - 1) {
          retryTimer = setTimeout(
            () => setAttempt((prev) => prev + 1),
            RETRY_BASE_DELAY_MS * 2 ** attempt,
          )
        }
      })

    return () => {
      active = false
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [enabled, attempt])

  return list
}
