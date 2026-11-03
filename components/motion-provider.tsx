"use client"

import { useEffect, useLayoutEffect, useState, type ReactNode } from "react"
import { LazyMotion, domAnimation, visualElementStore } from "framer-motion"

type MotionFeatures = typeof domAnimation

const loadLayoutFeatures = () => import("@/lib/motion-features").then((mod) => mod.default)

/**
 * Lets `m.*` components animate without shipping all of framer-motion up front.
 *
 * domAnimation (animate, exit, variants, hover/tap/focus/inView) loads with the
 * page so mount animations play on the first paint. Layout animations and drag
 * (domMax) are only needed once the user interacts, so they load in a separate
 * chunk right after mount. Swapping the bundle re-renders LazyMotion with a new
 * context value, so every `m` component re-renders and picks up the projection
 * features, the same way LazyMotion's own async loading does.
 *
 * `strict` makes a stray `motion.*` throw, since it would pull the full bundle
 * back in.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  const [features, setFeatures] = useState<MotionFeatures>(domAnimation)

  useEffect(() => {
    let cancelled = false
    loadLayoutFeatures()
      .then((full) => {
        if (!cancelled) setFeatures(full)
      })
      // Chunk failed to load (offline, new deploy): animations keep working,
      // layout changes just jump instead of animating.
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Elements already on screen get their projection node on the re-render
  // above, but framer-motion only mounts a projection node when the element
  // itself mounts, so without this they would skip their first layout
  // animation (e.g. the mode pill's first slide). Runs after the children's
  // layout effects, the same order a normal mount uses; document order mounts
  // parents before children.
  useLayoutEffect(() => {
    if (features === domAnimation) return
    for (const element of document.querySelectorAll("*")) {
      const projection = visualElementStore.get(element)?.projection
      if (projection && !projection.instance) projection.mount(element)
    }
  }, [features])

  return (
    <LazyMotion features={features} strict>
      {children}
    </LazyMotion>
  )
}
