"use client"

/**
 * One sentence on how well the scenes fit the card: how many there are and what
 * could not be met. A polite live region that speaks only when the situation
 * changes, not on every count while scenes are still coming in.
 */
import { memo } from "react"
import { AlertTriangle, Check, Info, Pause, Repeat2, RotateCcw, Search, Shuffle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { BUILDER_TEXT, fitText, type FitState } from "./pack-text"

const TONE: Record<FitState["kind"], { icon: typeof Check; className: string }> = {
  finding: { icon: Search, className: "text-muted-foreground" },
  fit: { icon: Check, className: "text-success-text" },
  "few-rated": { icon: AlertTriangle, className: "text-warning-text" },
  reuse: { icon: Repeat2, className: "text-info-text" },
  similar: { icon: Shuffle, className: "text-info-text" },
  short: { icon: AlertTriangle, className: "text-warning-text" },
  imposed: { icon: Shuffle, className: "text-info-text" },
  "no-pose-here": { icon: AlertTriangle, className: "text-warning-text" },
  "needs-company": { icon: AlertTriangle, className: "text-warning-text" },
  dropped: { icon: Info, className: "text-info-text" },
  stale: { icon: RotateCcw, className: "text-muted-foreground" },
  "people-missing": { icon: AlertTriangle, className: "text-warning-text" },
  paused: { icon: Pause, className: "text-muted-foreground" },
  "no-new": { icon: Info, className: "text-muted-foreground" },
  "kept-on-axis": { icon: Info, className: "text-info-text" },
  "few-variations": { icon: AlertTriangle, className: "text-warning-text" },
}

export interface FitLineProps {
  state: FitState
  /** A quiet second half, e.g. how to leave a scene out. */
  hint?: string
  className?: string
}

export const FitLine = memo(function FitLine({ state, hint, className }: FitLineProps) {
  const { text, spoken } = fitText(state)
  const { icon: Icon, className: tone } = TONE[state.kind]
  return (
    <div className={cn("flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 text-sm", className)}>
      <Icon className={cn("size-4 shrink-0", tone)} aria-hidden />
      <span aria-hidden className="min-w-0 text-pretty tabular-nums text-foreground">
        {text}
        {hint && <span className="text-muted-foreground"> · {hint}</span>}
      </span>
      {state.kind === "few-rated" && (
        <Button type="button" variant="outline" size="sm" onClick={state.onInclude} className="h-7 px-2.5 text-xs pointer-coarse:h-11">
          Include sensitive
        </Button>
      )}
      {state.kind === "paused" && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={state.onLoadMore}
          disabled={state.waiting}
          className="h-7 px-2.5 text-xs pointer-coarse:h-11"
        >
          {BUILDER_TEXT.findMore}
        </Button>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {spoken}
      </span>
    </div>
  )
})
