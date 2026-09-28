"use client"

import type { ReactNode } from "react"
import type { TooltipRenderProps } from "react-joyride"
import { ArrowLeft, ArrowRight, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Extra per-step fields read by the tooltip. Joyride passes `step.data` through
 * untouched, so each tour can set a leading icon or override the primary label
 * (e.g. "Show me" on the welcome step) without a custom tooltip per step.
 */
export interface TourStepData {
  icon?: ReactNode
  primaryLabel?: string
  skipLabel?: string
}

/**
 * Shared Joyride tooltip for the gallery and the extension Pocket. Built from
 * the app's own primitives and tokens so the tour reads as part of the UI.
 * Deliberately terse: icon + title, one line of body, step counter, and a
 * single primary action — the tour should feel like a quick glance, not a read.
 */
function TourTooltipBase({
  step,
  index,
  size,
  isLastStep,
  backProps,
  closeProps,
  primaryProps,
  skipProps,
  tooltipProps,
  compact,
}: TooltipRenderProps & { compact?: boolean }) {
  const data = (step.data ?? {}) as TourStepData
  const isIntro = index === 0 && step.placement === "center"
  const primaryLabel = data.primaryLabel ?? (isLastStep ? "Done" : "Next")

  return (
    <div
      {...tooltipProps}
      className={cn(
        "max-w-[calc(100vw-24px)] rounded-xl border bg-popover text-popover-foreground shadow-xl",
        "animate-in fade-in-0 zoom-in-95 duration-200 motion-reduce:animate-none",
        compact ? "w-[272px] p-3.5" : "w-[340px] p-4"
      )}
    >
      <div className="flex items-start gap-2.5">
        {data.icon && (
          <span
            aria-hidden="true"
            className={cn(
              "flex shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary-text [&_svg]:shrink-0",
              compact ? "h-7 w-7 [&_svg]:h-3.5 [&_svg]:w-3.5" : "h-8 w-8 [&_svg]:h-4 [&_svg]:w-4"
            )}
          >
            {data.icon}
          </span>
        )}
        <div className="min-w-0 flex-1 pt-0.5">
          {step.title && (
            <h3 className={cn("font-semibold leading-tight text-foreground text-balance", compact ? "text-sm" : "text-[15px]")}>
              {step.title}
            </h3>
          )}
          <p className={cn("mt-1 leading-snug text-muted-foreground text-pretty", compact ? "text-xs" : "text-sm")}>
            {step.content}
          </p>
        </div>
        <button
          {...closeProps}
          aria-label="Close tour"
          className="-mr-1.5 -mt-1.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className={cn("flex items-center justify-between gap-2", compact ? "mt-3" : "mt-4")}>
        {isIntro ? (
          <Button
            {...skipProps}
            variant="ghost"
            size="sm"
            className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {data.skipLabel ?? "Skip"}
          </Button>
        ) : (
          <span className="text-xs tabular-nums text-muted-foreground" aria-label={`Step ${index + 1} of ${size}`}>
            {index + 1}
            <span className="text-muted-foreground/50"> / {size}</span>
          </span>
        )}

        <div className="flex items-center gap-1">
          {index > 0 && (
            <Button
              {...backProps}
              variant="ghost"
              size="icon"
              aria-label="Previous step"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <Button {...primaryProps} size="sm" className="h-8 gap-1 px-3 text-xs font-semibold">
            {primaryLabel}
            {!isLastStep && <ArrowRight className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function TourTooltip(props: TooltipRenderProps) {
  return <TourTooltipBase {...props} />
}

export function CompactTourTooltip(props: TooltipRenderProps) {
  return <TourTooltipBase {...props} compact />
}

/** Joyride theming shared by both tours; colors follow the active theme. */
export const TOUR_OPTIONS = {
  primaryColor: "var(--primary)",
  arrowColor: "var(--popover)",
  overlayColor: "color-mix(in oklab, var(--overlay) 55%, transparent)",
  spotlightRadius: 10,
  spotlightPadding: 6,
  zIndex: 10000,
  overlayClickAction: false,
  closeButtonAction: "skip",
  skipBeacon: true,
} as const
