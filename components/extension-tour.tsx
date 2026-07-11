"use client"

import { useState, useEffect, useCallback } from "react"
import { useJoyride, STATUS, type Status, type TooltipRenderProps } from "react-joyride"
import { X, Settings2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

const TOUR_STORAGE_KEY = "booru_extension_tour_done"

/**
 * Custom Joyride tooltip rendered with the app's own primitives (shadcn Button,
 * Badge) and design tokens (bg-popover, border, primary, muted-foreground) so the
 * guided tour matches the rest of the Pocket UI instead of Joyride's default box.
 */
function TourTooltip({
  step,
  index,
  size,
  isLastStep,
  backProps,
  closeProps,
  primaryProps,
  skipProps,
  tooltipProps,
}: TooltipRenderProps) {
  return (
    <div
      {...tooltipProps}
      className="w-[300px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b px-4 pb-2 pt-3.5">
        <div className="flex min-w-0 items-center gap-2">
          {step.title && (
            <h3 className="truncate text-sm font-bold leading-tight text-foreground">
              {step.title}
            </h3>
          )}
        </div>
        <button
          {...closeProps}
          className="-mr-1 -mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        <p className="text-xs leading-relaxed text-muted-foreground">{step.content}</p>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-1">
        {/* Progress dots */}
        <div className="flex items-center gap-1" aria-label={`Step ${index + 1} of ${size}`}>
          {Array.from({ length: size }).map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === index ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/30"
              }`}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          {index > 0 && (
            <Button
              {...backProps}
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              Back
            </Button>
          )}
          {!isLastStep && (
            <Button
              {...skipProps}
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              Skip
            </Button>
          )}
          <Button {...primaryProps} size="sm" className="h-7 px-3 text-xs font-semibold">
            {isLastStep ? "Got it!" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  )
}

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
    tooltipComponent: TourTooltip,
    // Theming + behavior live under `options` in react-joyride v3. Colors use the
    // app's CSS variables so the spotlight/arrow follow the active theme.
    options: {
      primaryColor: "hsl(var(--primary))",
      arrowColor: "hsl(var(--popover))",
      overlayColor: "rgba(0, 0, 0, 0.55)",
      spotlightRadius: 8,
      spotlightPadding: 8,
      zIndex: 10000,
      overlayClickAction: false, // don't dismiss when clicking the backdrop
      closeButtonAction: "skip", // the X ends the tour
      skipBeacon: true, // continuous tour → open tooltip directly, no pulsing beacon
    },
    steps: [
      {
        target: "#extension-target-btn",
        title: "Select your target",
        content:
          "This button lets you pick WHERE your prompts go. Click it, then click any textarea on the page you want to send prompts to (e.g., SeaArt, TensorArt, or any image generator).",
        placement: "top",
      },
      {
        target: ".pocket-card-send-btn",
        title: "Send a prompt",
        content:
          "Once you've set a target, click Send on any image card to inject its prompt directly into the textarea you selected. The prompt will queue and auto-inject when the generator is ready.",
        placement: "top",
      },
      {
        target: "#extension-settings-btn",
        title: (
          <span className="inline-flex items-center gap-1.5">
            <Settings2 className="h-4 w-4 shrink-0" />
            Fine-tune your prompts
          </span>
        ),
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
  })

  return <>{Tour}</>
}
