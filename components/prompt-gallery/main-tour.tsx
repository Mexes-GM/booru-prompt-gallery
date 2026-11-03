"use client"

import { useState, useEffect, useCallback } from "react"
import dynamic from "next/dynamic"
import { MAIN_TOUR_STORAGE_KEY as TOUR_STORAGE_KEY, isFeatureIntroPreview, isOverlayOpen } from "@/lib/onboarding"

/** Let the page settle (hero, results skeleton) before spotlighting anything. */
const AUTO_START_DELAY_MS = 700

const loadJoyride = () => import("@/components/prompt-gallery/main-tour-joyride")
const MainTourJoyride = dynamic(() => loadJoyride().then((m) => m.MainTourJoyride), { ssr: false, loading: () => null })

/** Starts downloading the tour's code ahead of a replay (e.g. when its menu opens). */
export function preloadMainTour() {
  void loadJoyride()
}

interface MainTourProps {
  /** Bump this number to force-(re)start the tour, e.g. from a Help button. */
  runSignal?: number
  /**
   * Called right before the tour starts (auto or manual) so the host can make
   * sure every step's target is on-screen.
   */
  onStart?: () => void
}

/**
 * First-visit welcome tour for the main gallery. The intro step asks before
 * spotlighting anything, so skipping costs one click. Auto-starts once per
 * browser (localStorage) and can be replayed anytime from the corner "⋯"
 * menu (bump `runSignal`).
 */
export function MainTour({ runSignal, onStart }: MainTourProps) {
  const [run, setRun] = useState(false)
  const [hasRun, setHasRun] = useState(false)
  if (run && !hasRun) setHasRun(true)

  // Auto-start on first visit only.
  useEffect(() => {
    if (localStorage.getItem(TOUR_STORAGE_KEY) === "1") return
    if (isFeatureIntroPreview()) return
    // Fetch the tour's code now so it is ready when the delay below ends.
    preloadMainTour()
    const timer = setTimeout(() => {
      // Never cover something already open (a dialog, a menu). The flag stays
      // unset, so the tour starts on the next visit instead of popping up later
      // in this one, once the user is busy with something else.
      if (isOverlayOpen()) return
      // Persist the flag at auto-start, not only on FINISH/SKIP: an interrupted
      // tour (reload, tab close, a missing target stalling Joyride) must not
      // re-trigger on every visit. Written here, not before the timeout, so a
      // StrictMode double-mount doesn't see the flag and cancel the tour.
      try {
        localStorage.setItem(TOUR_STORAGE_KEY, "1")
      } catch {}
      onStart?.()
      setRun(true)
    }, AUTO_START_DELAY_MS)
    return () => clearTimeout(timer)
    // Mount-only: onStart is recreated every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const markDone = useCallback(() => {
    try {
      localStorage.setItem(TOUR_STORAGE_KEY, "1")
    } catch {}
    setRun(false)
  }, [])

  // Manual replay from the Help button.
  useEffect(() => {
    if (runSignal && runSignal > 0) {
      onStart?.()
      setRun(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runSignal])

  // Mounted from the first run on and kept mounted, so a replay reuses it.
  if (!hasRun) return null
  return <MainTourJoyride run={run} onDone={markDone} />
}
