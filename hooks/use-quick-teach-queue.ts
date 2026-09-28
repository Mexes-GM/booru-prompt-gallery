"use client"

import { useCallback, useRef, useState } from "react"
import { fetchTeachQueue, type TeachQueueItem } from "@/app/actions/teach-queue"
import type { TagCategory } from "@/lib/tag-taxonomy"

/** One classified candidate tag waiting to be reviewed in the Quick Teach loop. */
export interface QuickTeachCard {
  tag: string
  postCount: number
  proposedCategory: TagCategory | null
  proposedSubcategory: string | null
  confidence: number | null
  categoryName?: string | null
  subcategory?: string | null
}

const MAX_QUEUE_REFILL_ATTEMPTS = 3

/**
 * Supplies the Quick Teach modal with a stream of high-impact tags in
 * `needs_review` from `auto_suggest_tags`, prioritized by post count (`post_count DESC`).
 */
export function useQuickTeachQueue(_tagOverrides?: Record<string, string>) {
  const [queue, setQueue] = useState<QuickTeachCard[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const seenTagsRef = useRef<Set<string>>(new Set())
  const queueRef = useRef(queue)
  queueRef.current = queue

  /** (Re)fills the queue with prioritized tags needing review. */
  const refill = useCallback(async (targetSize = 15) => {
    setIsLoading(true)
    setError(null)
    try {
      let collected: QuickTeachCard[] = []
      let attempts = 0

      while (collected.length < targetSize && attempts < MAX_QUEUE_REFILL_ATTEMPTS) {
        const excludeList = Array.from(seenTagsRef.current)
        const res = await fetchTeachQueue({
          limit: targetSize - collected.length,
          excludeNames: excludeList,
        })

        if (!res.success) {
          throw new Error(res.error || "Failed to fetch tags for review")
        }

        const batch: QuickTeachCard[] = (res.items || []).filter(
          item => !seenTagsRef.current.has(item.tag)
        )

        for (const item of batch) {
          seenTagsRef.current.add(item.tag)
        }

        collected = [...collected, ...batch]
        attempts += 1

        // If the server returned fewer than requested, we've exhausted current needs_review
        if ((res.items || []).length < targetSize - collected.length) {
          break
        }
      }

      setQueue(prev => [...prev, ...collected])

      if (collected.length === 0 && queueRef.current.length === 0) {
        setError("All caught up! No tags currently need review.")
      }

      return collected.length
    } catch (err: any) {
      console.error("[useQuickTeachQueue] refill failed:", err)
      setError("Couldn't load tags for review. Please check your connection and try again.")
      return 0
    } finally {
      setIsLoading(false)
    }
  }, [])

  const dequeue = useCallback(() => {
    setQueue(prev => prev.slice(1))
  }, [])

  const reset = useCallback(() => {
    seenTagsRef.current = new Set()
    setQueue([])
    setError(null)
  }, [])

  return {
    queue,
    current: queue[0] ?? null,
    remainingInBuffer: queue.length,
    isLoading,
    error,
    refill,
    dequeue,
    reset,
  }
}

export type { TagCategory }
