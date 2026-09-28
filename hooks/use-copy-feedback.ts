"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Shared "copy state + timed reset" pattern, extracted from the places
 * that each reimplemented `useState(false) + setTimeout(..., 2000)` around a
 * copy action: merge-sticky-footer.tsx, ai-convert-sticky-
 * footer.tsx, pack-builder-sticky-footer.tsx (PromptRow + PackResultsList),
 * masonry-item.tsx, prompt-gallery.tsx, and reverse-prompt-parser-modal.tsx.
 *
 * `trigger()` sets the flag to true and schedules it back to false after
 * `duration` ms, clearing/replacing any pending timeout from a previous call
 * so rapid re-copies don't fire multiple resets. `reset()` clears the flag
 * (and any pending timeout) immediately without waiting for the duration —
 * for callers that need to force the "not copied" state on an unrelated
 * event (e.g. ai-convert-sticky-footer.tsx clearing it when a NEW conversion
 * starts, before the previous copy's timeout would have fired on its own).
 * The pending timeout is also cleared on unmount.
 */
export function useCopyFeedback(duration = 2000): [boolean, () => void, () => void] {
  const [isCopied, setIsCopied] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const trigger = useCallback(() => {
    setIsCopied(true)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null
      setIsCopied(false)
    }, duration)
  }, [duration])

  const reset = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    setIsCopied(false)
  }, [])

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  return [isCopied, trigger, reset]
}
