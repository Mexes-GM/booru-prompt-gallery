"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/** What the last copy did, for a moment: worked, failed, or nothing to say. */
export type CopyResult = "idle" | "copied" | "failed"

/**
 * Like useCopyFeedback, but a failed copy has its own state, held longer so the
 * user can read what to do instead.
 */
export function useCopyResult(copiedMs = 1500, failedMs = 5000): [CopyResult, (ok: boolean) => void] {
  const [result, setResult] = useState<CopyResult>("idle")
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const report = useCallback(
    (ok: boolean) => {
      if (timer.current) clearTimeout(timer.current)
      setResult(ok ? "copied" : "failed")
      timer.current = setTimeout(() => {
        timer.current = null
        setResult("idle")
      }, ok ? copiedMs : failedMs)
    },
    [copiedMs, failedMs],
  )

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  return [result, report]
}
