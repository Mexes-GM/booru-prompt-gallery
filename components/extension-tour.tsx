"use client"

import { useState, useEffect, useCallback } from "react"
import { useJoyride, STATUS, type Status, type Step } from "react-joyride"
import { Crosshair, Send, Zap, Settings2 } from "lucide-react"
import { CompactTourTooltip, TOUR_OPTIONS, type TourStepData } from "@/components/tour-tooltip"

const TOUR_STORAGE_KEY = "booru_extension_tour_done"

/** Four one-liners covering the Pocket's core loop: target → send → bulk → tune. */
const STEPS: Step[] = [
  {
    target: "#extension-target-btn",
    title: "Pick a target",
    content: "Click this, then click the prompt box on the generator page.",
    placement: "top",
    data: { icon: <Crosshair /> } satisfies TourStepData,
  },
  {
    target: ".pocket-card-send-btn",
    title: "Send a prompt",
    content: "Send drops a card's prompt into that box. Double-click a card works too.",
    placement: "top",
    data: { icon: <Send /> } satisfies TourStepData,
  },
  {
    target: "#extension-bulk-send",
    title: "Bulk Send",
    content: "Queue many prompts for your current search in one click.",
    placement: "top",
    data: { icon: <Zap /> } satisfies TourStepData,
  },
  {
    target: "#extension-settings-btn",
    title: "Fine-tune",
    content: "Tags to add or remove here apply to everything you send.",
    placement: "bottom",
    data: { icon: <Settings2 />, primaryLabel: "Got it" } satisfies TourStepData,
  },
]

interface ExtensionTourProps {
  /** Bump this number to (re)start the tour, e.g. from the Help button. */
  runSignal?: number
}

export function ExtensionTour({ runSignal }: ExtensionTourProps) {
  const [run, setRun] = useState(false)

  // Auto-start on first visit only.
  useEffect(() => {
    if (localStorage.getItem(TOUR_STORAGE_KEY) === "1") return
    // Persist immediately at auto-start (not only on FINISH/SKIP) so an
    // interrupted tour — reload, tab close, or a missing step target that
    // stalls Joyride before FINISHED — doesn't re-trigger on every visit.
    try { localStorage.setItem(TOUR_STORAGE_KEY, "1") } catch {}
    setRun(true)
  }, [])

  const markDone = useCallback(() => {
    try { localStorage.setItem(TOUR_STORAGE_KEY, "1") } catch {}
    setRun(false)
  }, [])

  // Manual replay. A counter (not a boolean) so every click restarts it.
  useEffect(() => {
    if (runSignal && runSignal > 0) setRun(true)
  }, [runSignal])

  const { Tour } = useJoyride({
    continuous: true,
    run,
    scrollToFirstStep: true,
    tooltipComponent: CompactTourTooltip,
    options: TOUR_OPTIONS,
    steps: STEPS,
    onEvent: ({ status }) => {
      if (([STATUS.FINISHED, STATUS.SKIPPED] as Status[]).includes(status)) {
        markDone()
      }
    },
  })

  return <>{Tour}</>
}
