"use client"

import { useEffect, useRef } from "react"

/** Page movement (px) tolerated before closing — ignores tiny scroll nudges
 *  such as layout shifts or momentum settling right after opening. */
const SCROLL_TOLERANCE = 8

/**
 * Closes a floating element (non-modal dropdown / popover) as soon as the page
 * scrolls while it's open.
 *
 * Why: Radix positions every floating layer with `position: fixed` and moves
 * it from JavaScript on each scroll event, which always lands a frame behind
 * the compositor's native scroll — the layer visibly jitters/lags behind its
 * trigger. Closing on scroll (as GitHub or Linear do) avoids that entirely
 * while keeping Radix's keyboard/focus/a11y behavior.
 *
 * Skip it for layers anchored to something that doesn't move with the page
 * (e.g. a trigger inside a fixed/sticky footer): there's no jitter to avoid.
 */
export function useCloseOnScroll(open: boolean, close: () => void, enabled = true) {
  // Keep the latest `close` without re-subscribing on every render.
  const closeRef = useRef(close)
  closeRef.current = close

  useEffect(() => {
    if (!open || !enabled) return
    const startX = window.scrollX
    const startY = window.scrollY

    const onScroll = () => {
      if (Math.abs(window.scrollY - startY) > SCROLL_TOLERANCE || Math.abs(window.scrollX - startX) > SCROLL_TOLERANCE) {
        closeRef.current()
      }
    }

    // Only the page scroll: scrolling inside the menu itself (a long folder
    // list) or inside some other scrollable region (carousels, tab strips)
    // fires on that element, never on window, so it doesn't close the layer.
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [open, enabled])
}
