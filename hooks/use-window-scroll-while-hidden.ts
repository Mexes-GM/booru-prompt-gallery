"use client"

import { useLayoutEffect, useRef } from "react"

/**
 * Keeps the page's scroll position while its content is hidden (an <Activity mode="hidden">
 * hides it with display: none, and the browser then scrolls the empty page to the top) and puts
 * it back as the content shows again, before the browser paints.
 *
 * The position is the last one a scroll event reported while shown: once the content is hidden,
 * reading `window.scrollY` would already give the emptied page's.
 */
export function useWindowScrollWhileHidden(hidden: boolean): void {
  const lastRef = useRef(0)
  const savedRef = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (hidden) {
      savedRef.current = lastRef.current
      return
    }
    const saved = savedRef.current
    savedRef.current = null
    if (saved !== null) window.scrollTo({ top: saved, behavior: "instant" })
    const onScroll = () => {
      lastRef.current = window.scrollY
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [hidden])
}
