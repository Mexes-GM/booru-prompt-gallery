"use client"

/**
 * One sentence on how well the scenes fit the card: how many there are and what
 * could not be met. A polite live region that speaks only when the situation
 * changes, not on every count while scenes are still coming in.
 */
import { memo } from "react"
import { AlertTriangle, Check, ChevronDown, Hourglass, Info, Pause, Repeat2, RotateCcw, Search, Shuffle } from "lucide-react"
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
  waiting: { icon: Hourglass, className: "text-muted-foreground" },
  variety: { icon: Shuffle, className: "text-info-text" },
  "as-written": { icon: Info, className: "text-info-text" },
  "condition-supply": { icon: AlertTriangle, className: "text-warning-text" },
  "no-new": { icon: Info, className: "text-muted-foreground" },
  "axis-fit": { icon: Check, className: "text-success-text" },
  "finding-variants": { icon: Search, className: "text-muted-foreground" },
  "people-short-of-cast": { icon: AlertTriangle, className: "text-warning-text" },
  "kept-on-axis": { icon: Info, className: "text-info-text" },
  "few-variations": { icon: AlertTriangle, className: "text-warning-text" },
}

export interface FitLineProps {
  state: FitState
  /** A quiet second half, e.g. how to leave a scene out. */
  hint?: string
  /** False when the page has one live region for every line (see fitText's `spoken`). */
  announce?: boolean
  /** For a short pack that more pictures could fill: the offer of sensitive pictures on its line. */
  onIncludeSensitive?: () => void
  /**
   * What the scenes were found in, after the sentence ("from 240 posts on Danbooru so far"),
   * with "Find more scenes" while the site has more. Read in place, not announced.
   */
  loaded?: { text: string; onFindMore?: () => void }
  /** The toggle that shows what the pack searches (the panel is the caller's, `controls` its id). */
  searches?: { open: boolean; onToggle: () => void; controls: string }
  className?: string
}

export const FitLine = memo(function FitLine({ state, hint, announce = true, onIncludeSensitive, loaded, searches, className }: FitLineProps) {
  const offer = (state.kind === "short" || state.kind === "few-variations") && state.offerSensitive ? onIncludeSensitive : undefined
  const { text, spoken } = fitText(state)
  const { icon: Icon, className: tone } = TONE[state.kind]
  return (
    <div className={cn("flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 text-sm", className)}>
      <Icon className={cn("size-4 shrink-0", tone)} aria-hidden />
      <span className="min-w-0 text-pretty tabular-nums text-foreground">
        <span aria-hidden>{text}</span>
        {/* Goes on the sentence ("76 scenes fit from 240 posts…"), or follows it as its own. */}
        {loaded && <span className="text-muted-foreground"> {/[.!?…]$/.test(text) ? `${loaded.text.charAt(0).toUpperCase()}${loaded.text.slice(1)}.` : loaded.text}</span>}
        {hint && <span aria-hidden className="text-muted-foreground"> · {hint}</span>}
      </span>
      {searches && (
        <button
          type="button"
          onClick={searches.onToggle}
          aria-expanded={searches.open}
          aria-controls={searches.controls}
          className={cn(
            "relative inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground",
            "pointer-coarse:after:absolute pointer-coarse:after:-inset-y-2 pointer-coarse:after:inset-x-0 pointer-coarse:after:content-['']",
            "transition-[color,background-color] duration-150 ease-out-strong hover:bg-muted hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          {BUILDER_TEXT.howItSearches}
          <ChevronDown className={cn("size-3.5 transition-transform duration-150", searches.open && "rotate-180")} aria-hidden />
        </button>
      )}
      {loaded?.onFindMore && (
        <Button type="button" variant="outline" size="sm" onClick={loaded.onFindMore} className="h-7 px-2.5 text-xs pointer-coarse:h-11">
          {BUILDER_TEXT.findMore}
        </Button>
      )}
      {state.kind === "few-rated" && (
        <Button type="button" variant="outline" size="sm" onClick={state.onInclude} className="h-7 px-2.5 text-xs pointer-coarse:h-11">
          Include sensitive
        </Button>
      )}
      {offer && (
        <Button type="button" variant="outline" size="sm" onClick={offer} className="h-7 px-2.5 text-xs pointer-coarse:h-11">
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
      {announce && (
        <span className="sr-only" role="status" aria-live="polite">
          {spoken}
        </span>
      )}
    </div>
  )
})
