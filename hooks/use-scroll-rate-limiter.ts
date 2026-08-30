"use client"

/**
 * Shared client-side anti-abuse guard for "load another page" actions:
 * a sliding-window burst limiter (max N loads per window, with a fixed
 * cooldown once tripped) plus a hard per-session page cap.
 *
 * Extracted from hooks/use-booru-search.ts's loadMore() so any other feature
 * that pages through booru results (Pack Mode's own seeding fetch — see
 * hooks/use-pack-seed-search.ts) enforces the EXACT same guards instead of a
 * second, potentially-drifting implementation. This is deliberately just the
 * decision logic + timers; callers own their own `size`/`setSize` state and
 * call `registerLoad()` right before actually requesting the next page.
 *
 * See use-booru-search.ts's inline comments for the full rationale behind
 * the specific numbers (WINDOW_MS, MAX_LOADS_PER_WINDOW, SCROLL_COOLDOWN_MS,
 * MAX_SESSION_PAGE_LOADS) — reproduced here verbatim so both call sites stay
 * in sync if those are ever retuned.
 */
import { useCallback, useEffect, useRef, useState } from "react"

const WINDOW_MS = 10_000
const MAX_LOADS_PER_WINDOW = 2
const SCROLL_COOLDOWN_MS = 5_000
export const MAX_SESSION_PAGE_LOADS = 35

export interface UseScrollRateLimiterOptions {
  /** Called once when the session cap is newly reached (for a toast, etc.). */
  onSessionCapReached?: () => void
  /** Called once when the burst limiter newly trips (for a toast, etc.). */
  onScrollLimited?: () => void
}

export interface UseScrollRateLimiterResult {
  /** True while the sliding-window burst cap is cooling down. */
  scrollLimited: boolean
  /** True once `size` has reached MAX_SESSION_PAGE_LOADS for this session. */
  sessionCapReached: boolean
  /**
   * Checks the current `size` (SWR page count) against both guards. Returns
   * true if a load may proceed (and records it against the burst window) —
   * false if the caller should refuse and not call setSize/loadMore.
   */
  canLoadMore: (size: number) => boolean
  /** Reset both guards — call whenever the underlying search/session resets
   *  (new tags, provider, filters, etc.), mirroring useBooruSearch's own
   *  "Reset pagination" effect. */
  reset: () => void
}

export function useScrollRateLimiter(options: UseScrollRateLimiterOptions = {}): UseScrollRateLimiterResult {
  const { onSessionCapReached, onScrollLimited } = options

  const [scrollLimited, setScrollLimited] = useState(false)
  const [sessionCapReached, setSessionCapReached] = useState(false)
  const scrollLimitedRef = useRef(false)
  const loadTimestampsRef = useRef<number[]>([])
  const throttleRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (throttleRetryRef.current) clearTimeout(throttleRetryRef.current)
    }
  }, [])

  const canLoadMore = useCallback((size: number): boolean => {
    if (size >= MAX_SESSION_PAGE_LOADS) {
      setSessionCapReached((prev) => {
        if (!prev) onSessionCapReached?.()
        return true
      })
      return false
    }

    const now = Date.now()
    loadTimestampsRef.current = loadTimestampsRef.current.filter((t) => now - t < WINDOW_MS)

    if (loadTimestampsRef.current.length >= MAX_LOADS_PER_WINDOW) {
      const wasAlreadyLimited = scrollLimitedRef.current
      scrollLimitedRef.current = true
      setScrollLimited(true)
      if (!wasAlreadyLimited) onScrollLimited?.()

      if (throttleRetryRef.current) clearTimeout(throttleRetryRef.current)
      throttleRetryRef.current = setTimeout(() => {
        throttleRetryRef.current = null
        scrollLimitedRef.current = false
        setScrollLimited(false)
        loadTimestampsRef.current = []
      }, SCROLL_COOLDOWN_MS)
      return false
    }

    scrollLimitedRef.current = false
    setScrollLimited(false)
    loadTimestampsRef.current.push(now)
    return true
  }, [onSessionCapReached, onScrollLimited])

  const reset = useCallback(() => {
    setSessionCapReached(false)
    setScrollLimited(false)
    scrollLimitedRef.current = false
    loadTimestampsRef.current = []
    if (throttleRetryRef.current) {
      clearTimeout(throttleRetryRef.current)
      throttleRetryRef.current = null
    }
  }, [])

  return { scrollLimited, sessionCapReached, canLoadMore, reset }
}
