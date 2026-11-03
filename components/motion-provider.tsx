"use client"

import { useEffect, useState, type ReactNode } from "react"
import { LazyMotion, domAnimation } from "framer-motion"

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
    loadLayoutFeatures().then((full) => {
      if (!cancelled) setFeatures(full)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <LazyMotion features={features} strict>
      {children}
    </LazyMotion>
  )
}
