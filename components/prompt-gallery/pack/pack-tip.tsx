"use client"

/**
 * A short tip the builder shows once, where it helps (lib/storage.ts PACK_TIPS_SEEN
 * remembers it). It blocks nothing and covers no control; it goes with its own button.
 */
import { memo } from "react"
import { Lightbulb, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { TIP_TEXT } from "./pack-text"

export interface PackTipProps {
  text: string
  onDismiss: () => void
  className?: string
}

export const PackTip = memo(function PackTip({ text, onDismiss, className }: PackTipProps) {
  return (
    <div className={cn("flex items-start gap-2 rounded-lg border border-border bg-muted/40 py-1.5 pl-2.5 pr-1 text-xs text-foreground", className)}>
      <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-info-text" aria-hidden />
      <p className="min-w-0 flex-1 text-pretty leading-relaxed">{text}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={TIP_TEXT.dismiss}
        className={cn(
          "relative grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground",
          "pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5 pointer-coarse:after:content-['']",
          "transition-[color,background-color] duration-150 ease-out-strong hover:bg-muted hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  )
})
