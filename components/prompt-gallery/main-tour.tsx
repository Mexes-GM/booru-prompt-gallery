"use client"

import { useState, useEffect, useCallback } from "react"
import { useJoyride, ACTIONS, ORIGIN, STATUS, type Status, type Step } from "react-joyride"
import { Sparkles, Search, Copy, SlidersHorizontal, LayoutGrid, HelpCircle } from "lucide-react"
import { TourTooltip, TOUR_OPTIONS, type TourStepData } from "@/components/tour-tooltip"

const TOUR_STORAGE_KEY = "booru_main_tour_done"

/** Let the page settle (hero, results skeleton) before spotlighting anything. */
const AUTO_START_DELAY_MS = 700

/**
 * Six glanceable steps: one line each, one target per idea. Anything a user
 * can discover by looking (card size, theme, favorites count) is left out on
 * purpose — the tour only points at what's easy to miss.
 */
const STEPS: Step[] = [
  {
    target: "body",
    placement: "center",
    title: "Welcome to Booru Prompt Gallery",
    content: "Real booru posts, turned into clean prompts you can copy. Quick 20-second tour?",
    data: { icon: <Sparkles />, primaryLabel: "Show me", skipLabel: "Not now" } satisfies TourStepData,
  },
  {
    target: "[data-tour='search-row']",
    title: "Search anything",
    content: "A character, outfit or pose. Source on the left, NSFW and Shuffle on the right.",
    placement: "bottom",
    data: { icon: <Search /> } satisfies TourStepData,
  },
  {
    target: "[data-tour='copy-options']",
    title: "Copy in one click",
    content: "Copy grabs the whole prompt. The ▾ copies a single category or opens Teach.",
    placement: "top",
    data: { icon: <Copy /> } satisfies TourStepData,
  },
  {
    target: "[data-tour='controls']",
    title: "Tune the results",
    content: "Filters pick which posts load. Customize adds, removes or rewrites tags in every prompt.",
    placement: "bottom",
    data: { icon: <SlidersHorizontal /> } satisfies TourStepData,
  },
  {
    target: "[data-tour='modes']",
    title: "Pick a mode",
    content: "Browse one by one, Merge several cards, or Pack a batch to export. Extras live in Tools.",
    placement: "bottom",
    data: { icon: <LayoutGrid /> } satisfies TourStepData,
  },
  {
    target: "[data-tour='help']",
    title: "That's it",
    content: "Replay this tour, send feedback or switch the theme from this menu anytime.",
    placement: "bottom",
    data: { icon: <HelpCircle />, primaryLabel: "Start exploring" } satisfies TourStepData,
  },
]

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

  // Auto-start on first visit only.
  useEffect(() => {
    if (localStorage.getItem(TOUR_STORAGE_KEY) === "1") return
    const timer = setTimeout(() => {
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

  const { Tour } = useJoyride({
    continuous: true,
    run,
    scrollToFirstStep: true,
    tooltipComponent: TourTooltip,
    // Extra offset keeps the spotlight clear of the sticky "Tags to Add" bar.
    // Tapping the dimmed overlay ends the tour: session replays showed mobile
    // users stuck under it, tapping everywhere except the tooltip buttons.
    options: { ...TOUR_OPTIONS, scrollOffset: 180, overlayClickAction: "close" },
    steps: STEPS,
    onEvent: ({ action, origin, status }) => {
      if (
        ([STATUS.FINISHED, STATUS.SKIPPED] as Status[]).includes(status) ||
        (action === ACTIONS.CLOSE && origin === ORIGIN.OVERLAY)
      ) {
        markDone()
      }
    },
  })

  return <>{Tour}</>
}
