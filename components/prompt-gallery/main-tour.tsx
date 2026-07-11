"use client"

import { useState, useEffect, useCallback } from "react"
import { useJoyride, STATUS, EVENTS, type Status, type TooltipRenderProps } from "react-joyride"
import { X, Search, ShieldAlert, Settings2, GraduationCap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

const TOUR_STORAGE_KEY = "booru_main_tour_done"

/**
 * Custom Joyride tooltip rendered with the app's own primitives (shadcn Button,
 * Badge) and design tokens so the guided tour matches the rest of the gallery
 * UI instead of Joyride's default box. Mirrors components/extension-tour.tsx
 * so both tours look/feel identical.
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
      className="w-[420px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2.5 border-b px-5 pb-3 pt-[18px]">
        <div className="flex min-w-0 items-center gap-2.5">
          {step.title && (
            <h3 className="truncate text-base font-bold leading-tight text-foreground">
              {step.title}
            </h3>
          )}
        </div>
        <button
          {...closeProps}
          className="-mr-1 -mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-[18px] w-[18px]" />
        </button>
      </div>

      {/* Body */}
      <div className="px-5 py-4">
        <p className="text-sm leading-relaxed text-muted-foreground">{step.content}</p>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2.5 px-5 pb-4 pt-1.5">
        {/* Progress dots */}
        <div className="flex items-center gap-1.5" aria-label={`Step ${index + 1} of ${size}`}>
          {Array.from({ length: size }).map((_, i) => (
            <span
              key={i}
              className={`h-2 rounded-full transition-all ${
                i === index ? "w-5 bg-primary" : "w-2 bg-muted-foreground/30"
              }`}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {index > 0 && (
            <Button
              {...backProps}
              variant="ghost"
              size="sm"
              className="h-9 px-3 text-sm text-muted-foreground hover:text-foreground"
            >
              Back
            </Button>
          )}
          {!isLastStep && (
            <Button
              {...skipProps}
              variant="ghost"
              size="sm"
              className="h-9 px-3 text-sm text-muted-foreground hover:text-foreground"
            >
              Skip
            </Button>
          )}
          <Button {...primaryProps} size="sm" className="h-9 px-4 text-sm font-semibold">
            {isLastStep ? "Got it!" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  )
}

interface MainTourProps {
  /** Bump this number to force-(re)start the tour, e.g. from a Help button. */
  runSignal?: number
  /**
   * Called right before the tour starts (auto or manual) so the host can make
   * sure every step's target is on-screen — e.g. open the settings panel and
   * expand the mobile-collapsed generation options section.
   */
  onStart?: () => void
}

/**
 * First-visit welcome tour for the main gallery. Orients a brand-new user
 * through the core value path (provider -> search -> a result card -> tags to
 * add -> generation options -> modes -> quick controls) in 8 short steps.
 * Auto-starts once per browser (localStorage) and can be replayed anytime via
 * the Help button in the header (bump `runSignal`).
 */
export function MainTour({ runSignal, onStart }: MainTourProps) {
  const [run, setRun] = useState(false)

  // Hydrate from localStorage on mount; auto-start on first visit only.
  useEffect(() => {
    const seen = localStorage.getItem(TOUR_STORAGE_KEY) === "1"
    if (!seen) {
      onStart?.()
      setRun(true)
    }
    // onStart is stable enough for a mount-only effect; excluding it avoids
    // re-running this on every parent re-render.
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
    options: {
      primaryColor: "hsl(var(--primary))",
      arrowColor: "hsl(var(--popover))",
      overlayColor: "rgba(0, 0, 0, 0.55)",
      spotlightRadius: 8,
      spotlightPadding: 8,
      zIndex: 10000,
      overlayClickAction: false,
      closeButtonAction: "skip",
      skipBeacon: true,
    },
    steps: [
      {
        target: "body",
        placement: "center",
        title: "Welcome to Booru Prompt Gallery",
        content:
          "This turns booru posts into clean, ready-to-copy prompts for AI art. Here's the essentials in about 30 seconds.",
      },
      {
        target: "[data-tour='provider']",
        title: "Pick a source",
        content:
          "Choose which booru to pull posts from. Danbooru is recommended — its tagging works best for Illustrious/Pony models.",
        placement: "bottom",
      },
      {
        target: "[data-tour='search']",
        title: (
          <span className="inline-flex items-center gap-1.5">
            <Search className="h-4 w-4 shrink-0" />
            Search for anything
          </span>
        ),
        content:
          "Type a character, action, or concept (e.g. \"frieren\"). Autocomplete helps you get the exact tag format.",
        placement: "bottom",
      },
      {
        target: "[data-tour='safety-controls']",
        title: (
          <span className="inline-flex items-center gap-1.5">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            Blacklist & content filter
          </span>
        ),
        content:
          "Blacklist excludes tags you never want to see. The shield button switches between Safe and NSFW results.",
        placement: "bottom",
      },
      {
        target: "[data-tour='results']",
        title: "Your prompt cards",
        content:
          "Each card is a cleaned-up, ready-to-copy prompt extracted from a real post.",
        placement: "top",
      },
      {
        target: "[data-tour='copy-options']",
        title: (
          <span className="inline-flex items-center gap-1.5">
            <GraduationCap className="h-4 w-4 shrink-0" />
            Copy by category & Teach
          </span>
        ),
        content:
          "Click the dropdown arrow next to Copy on any card to copy just one category — like clothing or pose — instead of the whole prompt. You'll also find Teach there: help us classify tags correctly and improve prompts for everyone.",
        placement: "top",
      },
      {
        target: "[data-tour='tags-to-add']",
        title: "Tags to Add",
        content:
          "Inject your own tags into every prompt — perfect for LoRA trigger words or a fixed style. Save combinations as presets to reuse later.",
        placement: "top",
      },
      {
        target: "[data-tour='generation-options']",
        title: (
          <span className="inline-flex items-center gap-1.5">
            <Settings2 className="h-4 w-4 shrink-0" />
            Prompt Generation Options
          </span>
        ),
        content:
          "These switches fine-tune your prompts — hover the ⓘ next to each one to see exactly what it does.",
        placement: "top",
      },
      {
        target: "[data-tour='modes']",
        title: "Modes",
        content:
          "Favorites saves posts to folders, Trending shows what's popular today (click a card to search it), and Merge combines categories from multiple cards into one prompt.",
        placement: "bottom",
      },
      {
        target: "[data-tour='feedback']",
        title: "Feedback",
        content:
          "Found a bug or have an idea? Send it straight to us from here — it helps shape what gets built next.",
        placement: "bottom",
      },
      {
        target: "[data-tour='quick-controls']",
        title: "Quick controls",
        content:
          "Shuffle for random results, Refresh to check for new posts, and History to revisit anything you've copied. You can reopen this tour anytime from the Help button.",
        placement: "bottom",
      },
    ],
    onEvent: (data) => {
      const { status, type, step } = data

      if (([STATUS.FINISHED, STATUS.SKIPPED] as Status[]).includes(status)) {
        markDone()
      }

      if (step.target === "[data-tour='copy-options']") {
        // Open the dropdown when the tooltip renders for this step
        if (type === EVENTS.TOOLTIP) {
          setTimeout(() => {
            const trigger = document.querySelector("[data-tour='copy-options'] button[aria-haspopup='menu']") as HTMLElement
            if (trigger && trigger.getAttribute('aria-expanded') !== 'true') {
              trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
              trigger.click()
            }
          }, 100) // Small delay to ensure the step is fully active and not stealing focus immediately
        }
        
        // Close the dropdown when moving away from the step
        if (type === EVENTS.STEP_AFTER) {
          const trigger = document.querySelector("[data-tour='copy-options'] button[aria-haspopup='menu']") as HTMLElement
          if (trigger && trigger.getAttribute('aria-expanded') === 'true') {
            trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
            trigger.click()
          }
        }
      }
    },
  })

  return <>{Tour}</>
}
