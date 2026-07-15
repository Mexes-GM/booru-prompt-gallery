"use client"

import { useEffect, useState } from "react"

export interface ClientFormattedDateProps {
  /** Epoch ms or anything accepted by `new Date(...)` */
  timestamp: number | string | Date
  className?: string
}

/**
 * Renders `toLocaleString()` for a timestamp, but only after mount.
 *
 * `toLocaleString()` depends on the runtime's locale/timezone. During SSR
 * that's the server's, but hydration runs in the user's browser — if they
 * differ, React throws a hydration mismatch. Rendering an empty string on
 * the server (and on the client's first paint, before the effect runs)
 * keeps server and client markup identical, then the effect swaps in the
 * real, correctly-localized value.
 */
export function ClientFormattedDate({ timestamp, className }: ClientFormattedDateProps) {
  const [formatted, setFormatted] = useState("")

  useEffect(() => {
    setFormatted(new Date(timestamp).toLocaleString())
  }, [timestamp])

  return <span className={className}>{formatted}</span>
}
