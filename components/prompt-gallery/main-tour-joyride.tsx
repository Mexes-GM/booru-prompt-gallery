"use client"

import { useJoyride, ACTIONS, ORIGIN, STATUS, type Status, type Step } from "react-joyride"
import { Sparkles, Search, Copy, SlidersHorizontal, LayoutGrid, HelpCircle } from "lucide-react"
import { TourTooltip, TOUR_OPTIONS, type TourStepData } from "@/components/tour-tooltip"

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

/**
 * The Joyride half of the main tour, loaded only when the tour is about to
 * run (see MainTour), so first paint doesn't wait on react-joyride.
 */
export function MainTourJoyride({ run, onDone }: { run: boolean; onDone: () => void }) {
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
        onDone()
      }
    },
  })

  return <>{Tour}</>
}
