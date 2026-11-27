"use client"

/**
 * The card in one line, for when it is folded away (on a phone, or after
 * generating): "Tifa Lockhart · bikini · princess carry · with 1 boy". The whole
 * line is the button that opens the card again.
 */
import { memo } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

export interface BriefSummaryProps {
  /** The parts of the line, in order; see briefSummaryParts. */
  parts: readonly string[]
  onExpand: () => void
  expanded?: boolean
  className?: string
}

export const BriefSummary = memo(function BriefSummary({ parts, onExpand, expanded = false, className }: BriefSummaryProps) {
  const line = parts.length ? parts.join(" · ") : "Anything"
  return (
    <button
      type="button"
      onClick={onExpand}
      aria-expanded={expanded}
      className={cn(
        "flex min-h-12 w-full min-w-0 items-center gap-3 rounded-xl border border-border/70 bg-card px-4 py-2.5 text-left shadow-xs",
        "transition-[border-color,background-color] duration-150 ease-out-strong hover:border-foreground/25",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
    >
      <span className="sr-only">Edit pack: </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        {parts.length === 0 ? <span className="text-muted-foreground">{line}</span> : line}
      </span>
      <ChevronDown
        className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out-strong motion-reduce:transition-none", expanded && "rotate-180")}
        aria-hidden
      />
    </button>
  )
})
