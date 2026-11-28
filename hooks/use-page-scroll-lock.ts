"use client"

import { useLayoutEffect } from "react"

/**
 * Locks the page's own scroll while `locked`, for a modal layer over a page that stays on screen.
 *
 * The page keeps its position and its width: `overflow: hidden` on the root stops scrolling by
 * wheel, touch and keys without moving the page, and the space of the scrollbar the page always
 * shows (globals.css) is kept, so nothing behind the layer reflows. On unlock
 * the root's own styles come back and the position is put back if anything moved it meanwhile.
 * Runs in a layout effect, so the page never paints unlocked under an open layer.
 */
export function usePageScrollLock(locked: boolean): void {
  useLayoutEffect(() => {
    if (!locked) return
    const root = document.documentElement
    const top = window.scrollY
    const before = { overflow: root.style.overflow, gutter: root.style.scrollbarGutter, padding: root.style.paddingRight }
    const width = root.clientWidth
    root.style.overflow = "hidden"
    root.style.scrollbarGutter = "stable"
    // Where the browser drops the gutter anyway (custom scrollbars), its width is made up as padding.
    const grown = root.clientWidth - width
    if (grown > 0) root.style.paddingRight = `${grown}px`
    return () => {
      root.style.overflow = before.overflow
      root.style.scrollbarGutter = before.gutter
      root.style.paddingRight = before.padding
      if (Math.abs(window.scrollY - top) > 1) window.scrollTo({ top, behavior: "instant" })
    }
  }, [locked])
}
