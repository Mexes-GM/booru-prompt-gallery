"use client"

import { useLayoutEffect, useRef } from "react"

/** After the content shows again, its position is held this long against late layout shifts. */
const SETTLE_MS = 300
const USER_SCROLL_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const

/**
 * Keeps the page's scroll position while its content is hidden (an <Activity mode="hidden">
 * hides it with display: none, and the browser then scrolls the empty page to the top) and puts
 * it back as the content shows again, before the browser paints.
 *
 * The position is the last one a scroll event reported while shown: once the content is hidden,
 * reading `window.scrollY` would already give the emptied page's. Runs after the layout effects of
 * the components inside (focus moved on close comes first), and holds the position for a moment
 * after: the content's effects start again as it shows and can move it (measuring, a late focus),
 * until the user scrolls themselves.
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
    const onScroll = () => {
      lastRef.current = window.scrollY
    }
    let settle: (() => void) | null = null
    if (saved !== null) {
      const restore = () => {
        if (Math.abs(window.scrollY - saved) > 1) window.scrollTo({ top: saved, behavior: "instant" })
      }
      restore()
      let frame = requestAnimationFrame(function again() {
        restore()
        frame = requestAnimationFrame(again)
      })
      const stop = () => {
        cancelAnimationFrame(frame)
        clearTimeout(timer)
        USER_SCROLL_EVENTS.forEach((type) => window.removeEventListener(type, stop))
        settle = null
      }
      const timer = setTimeout(stop, SETTLE_MS)
      USER_SCROLL_EVENTS.forEach((type) => window.addEventListener(type, stop, { passive: true }))
      settle = stop
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      settle?.()
      window.removeEventListener("scroll", onScroll)
    }
  }, [hidden])
}
