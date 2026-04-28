import { useState, useEffect, useRef } from "react"

const BATCH_SIZE = 12
const BATCH_INTERVAL_MS = 2000

/**
 * Progressive image loading pool.
 *
 * Reveals items in batches so the Worker/CDN receives a controlled trickle
 * instead of a burst. The first batch renders immediately.
 *
 * `resetKey` — when this changes, the pool resets to batch 1 (new search).
 * `totalItemCount` — total items available. When it grows (pagination),
 *   the pool continues from where it left off.
 */
export function useImageLoadPool(
  totalItemCount: number,
  resetKey: string
): { visibleCount: number; isRevealing: boolean } {
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const prevResetKeyRef = useRef(resetKey)

  // Reset only when the search changes, not when pagination adds items
  useEffect(() => {
    if (resetKey !== prevResetKeyRef.current) {
      prevResetKeyRef.current = resetKey
      setVisibleCount(Math.min(BATCH_SIZE, totalItemCount || BATCH_SIZE))
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [resetKey, totalItemCount])

  // Progressive reveal
  useEffect(() => {
    if (visibleCount >= totalItemCount || totalItemCount === 0) {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      return
    }

    timerRef.current = setInterval(() => {
      setVisibleCount(prev => {
        const next = prev + BATCH_SIZE
        if (next >= totalItemCount) {
          if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
          }
          return totalItemCount
        }
        return next
      })
    }, BATCH_INTERVAL_MS)

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [visibleCount, totalItemCount])

  const isRevealing = visibleCount < totalItemCount && totalItemCount > 0

  return { visibleCount, isRevealing }
}
