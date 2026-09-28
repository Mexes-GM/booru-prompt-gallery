import { startTransition, useCallback, useEffect, useRef } from "react"

/**
 * Defers an expensive callback (e.g. committing a search filter, which
 * re-renders the whole gallery and triggers a refetch) until `delay` ms after
 * the LAST `schedule` call, and runs it inside a transition so React can keep
 * the UI responsive while it re-renders.
 *
 * Lets a control update its own local state immediately — so its selection
 * animation plays smoothly — while the heavy work happens once it has settled.
 * Rapid successive calls collapse into one commit with the latest value.
 * A pending call is flushed (not dropped) on unmount.
 */
export function useDeferredCallback<T>(callback: (value: T) => void, delay: number) {
  const callbackRef = useRef(callback)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<{ value: T } | null>(null)

  useEffect(() => {
    callbackRef.current = callback
  })

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const pending = pendingRef.current
    if (!pending) return
    pendingRef.current = null
    startTransition(() => callbackRef.current(pending.value))
  }, [])

  const schedule = useCallback((value: T) => {
    pendingRef.current = { value }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, delay)
  }, [delay, flush])

  useEffect(() => flush, [flush])

  return { schedule, flush }
}
