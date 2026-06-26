"use client"

import { useState, useEffect, useCallback } from "react"
import { useJoyride, STATUS, type Status } from "react-joyride"

const TOUR_STORAGE_KEY = "booru_extension_tour_done"

export function ExtensionTour({ externalRun }: { externalRun?: boolean }) {
  const [hasSeenTour, setHasSeenTour] = useState(true)
  const [run, setRun] = useState(false)

  // Hydrate from localStorage on mount
  useEffect(() => {
    const seen = localStorage.getItem(TOUR_STORAGE_KEY) === "1"
    setHasSeenTour(seen)
    if (!seen) setRun(true) // auto-start on first visit
  }, [])

  const markDone = useCallback(() => {
    try { localStorage.setItem(TOUR_STORAGE_KEY, "1") } catch {}
    setHasSeenTour(true)
    setRun(false)
  }, [])

  // Allow the parent to trigger the tour manually (e.g. the Help button)
  useEffect(() => {
    if (externalRun) setRun(true)
  }, [externalRun])

  const { Tour } = useJoyride({
    continuous: true,
    run,
    scrollToFirstStep: true,
    showSkipButton: true,
    showProgress: true,
    disableOverlayClose: true,
    spotlightPadding: 8,
    steps: [
      {
        target: "#extension-target-btn",
        title: "🎯 Select Your Target",
        content:
          "This button lets you pick WHERE your prompts go. Click it, then click any textarea on the page you want to send prompts to (e.g., SeaArt, TensorArt, or any image generator).",
        placement: "top",
        skipBeacon: true,
      },
      {
        target: ".pocket-card-send-btn",
        title: "📤 Send a Prompt",
        content:
          "Once you've set a target, click Send on any image card to inject its prompt directly into the textarea you selected. The prompt will queue and auto-inject when the generator is ready.",
        placement: "top",
      },
      {
        target: "#extension-settings-btn",
        title: "⚙️ Fine-Tune Your Prompts",
        content:
          "Open Settings to customize which tags to add/remove, adjust character inclusion, background handling, and more — all automatically applied to every prompt you send.",
        placement: "bottom",
      },
    ],
    onEvent: (data) => {
      if (
        ([STATUS.FINISHED, STATUS.SKIPPED] as Status[]).includes(data.status)
      ) {
        markDone()
      }
    },
    locale: {
      back: "Back",
      close: "Close",
      last: "Got it!",
      next: "Next",
      open: "Open tutorial",
      skip: "Skip",
    },
    styles: {
      options: {
        primaryColor: "#3b82f6",
        backgroundColor: "#1e1b2e",
        textColor: "#e2e8f0",
        overlayColor: "rgba(0, 0, 0, 0.6)",
        arrowColor: "#1e1b2e",
        zIndex: 10000,
      },
      tooltip: {
        borderRadius: 10,
        fontSize: 13,
      },
      tooltipTitle: {
        fontSize: 15,
        fontWeight: 600,
      },
      buttonNext: {
        borderRadius: 6,
        fontSize: 12,
        padding: "6px 14px",
      },
      buttonBack: {
        borderRadius: 6,
        fontSize: 12,
        color: "#94a3b8",
        marginRight: 8,
      },
      buttonSkip: {
        fontSize: 11,
        color: "#64748b",
      },
    },
  })

  return <>{Tour}</>
}
