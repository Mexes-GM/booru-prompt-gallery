"use client"

import { useCallback, useRef, useState } from "react"
import { getSuggestions, type TagSuggestion } from "@/app/actions/admin"

/** How many pending suggestions to pull per page from the server. */
const PAGE_SIZE = 100

/**
 * Feeds the Quick Review modal a queue of pending `tag_suggestions` rows,
 * mirroring the shape of `useQuickTeachQueue` (`hooks/use-quick-teach-queue.ts`)
 * but sourcing from Supabase instead of Danbooru. Always re-fetches page 1 of
 * the `pending` filter (rather than advancing to page 2, 3, …): every
 * decision here removes a row from the "pending" set in real time, which
 * shifts every later row up a page, so a plain offset-based page N would
 * skip whatever slid into page 1's position since the last fetch. Already
 * queued/decided ids are filtered out via `seenIdsRef`, so re-fetching page 1
 * just tops the queue back up with whatever's newly at the front.
 */
export function useQuickReviewQueue() {
  const [queue, setQueue] = useState<TagSuggestion[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [totalPending, setTotalPending] = useState<number | null>(null)

  const exhaustedRef = useRef(false)
  const seenIdsRef = useRef<Set<string>>(new Set())

  const refill = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const { data, pendingCount } = await getSuggestions(1, PAGE_SIZE, { status: "pending" })
      setTotalPending(pendingCount)

      const fresh = data.filter(s => !seenIdsRef.current.has(s.id))
      fresh.forEach(s => seenIdsRef.current.add(s.id))

      // "Exhausted" means the whole backlog (not just this page) has been
      // seen, not merely that this particular fetch returned zero *new* rows
      // — a page can be temporarily all-seen while more pending rows still
      // exist further back, in which case the buffer should keep refilling.
      exhaustedRef.current = pendingCount === 0

      if (fresh.length > 0) {
        setQueue(prev => [...prev, ...fresh])
      }
      return fresh.length
    } catch (err) {
      console.error("[useQuickReviewQueue] refill failed:", err)
      setError("Couldn't load pending suggestions. Check your connection and try again.")
      return 0
    } finally {
      setIsLoading(false)
    }
  }, [])

  const dequeue = useCallback(() => {
    setQueue(prev => prev.slice(1))
  }, [])

  /** Puts a suggestion back at the front of the queue (used by Undo). */
  const requeueFront = useCallback((suggestion: TagSuggestion) => {
    setQueue(prev => [suggestion, ...prev])
  }, [])

  const reset = useCallback(() => {
    exhaustedRef.current = false
    seenIdsRef.current = new Set()
    setQueue([])
    setError(null)
    setTotalPending(null)
  }, [])

  return {
    queue,
    current: queue[0] ?? null,
    remainingInBuffer: queue.length,
    totalPending,
    isLoading,
    error,
    isExhausted: exhaustedRef.current,
    refill,
    dequeue,
    requeueFront,
    reset,
  }
}
