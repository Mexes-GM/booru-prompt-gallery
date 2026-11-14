"use client"

/**
 * "Removed smile from 8 prompts · Undo": a short notice after a change that touched
 * prompts already generated. The parent decides how long it stays; Escape inside it
 * dismisses it.
 */
import { memo } from "react"
import { X } from "lucide-react"
import { useLowMotion } from "@/hooks/use-low-motion"
import { cn } from "@/lib/utils"

export interface UndoNoticeProps {
  message: string
  onUndo: () => void
  onDismiss?: () => void
  className?: string
}

export const UndoNotice = memo(function UndoNotice({ message, onUndo, onDismiss, className }: UndoNoticeProps) {
  const lowMotion = useLowMotion()
  return (
    // The message is the live region; the buttons stay outside it.
    <div
      onKeyDown={(e) => {
        if (e.key === "Escape" && onDismiss) {
          e.stopPropagation()
          onDismiss()
        }
      }}
      className={cn(
        "flex min-h-10 items-center gap-1 rounded-lg border border-border bg-popover py-1 pl-3 pr-1 text-sm text-popover-foreground shadow-md",
        lowMotion ? "animate-in fade-in-0" : "animate-in fade-in-0 slide-in-from-bottom-2 ease-out-strong duration-200",
        className,
      )}
    >
      <span role="status" aria-live="polite" className="min-w-0 flex-1 text-pretty tabular-nums">{message}</span>
      <button
        type="button"
        onClick={onUndo}
        className={cn(
          "h-8 shrink-0 rounded-md px-2.5 text-sm font-medium text-primary-text pointer-coarse:h-11",
          "transition-[background-color] duration-150 ease-out-strong hover:bg-primary/10",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        Undo
      </button>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground pointer-coarse:size-11",
            "transition-[color,background-color] duration-150 ease-out-strong hover:bg-muted hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  )
})
