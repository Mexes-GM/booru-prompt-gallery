"use client"

/**
 * One thing the card asks for, as a chip.
 *
 * - `request`: in every prompt. Remove takes it off.
 * - `never`: in no prompt. Marked with a ban icon, not only by colour.
 * - `trait`: part of a character's usual look. Removing it strikes it through and
 *   keeps it on the card, so it can be put back.
 * - `offered`: something the card suggests. The whole chip is one button that adds it.
 *
 * Any chip can carry a conflict note: a warning icon, with the note as its name and tooltip.
 */
import { memo } from "react"
import { AlertTriangle, Ban, Plus, RotateCcw, X } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export type RequestChipVariant = "request" | "never" | "trait" | "offered"

export interface RequestChipProps {
  label: string
  variant?: RequestChipVariant
  /** For `trait`: taken off the character's look, shown struck through. */
  removed?: boolean
  /** Remove (request, never, trait) or put back (a removed trait). */
  onRemove?: () => void
  onRestore?: () => void
  /** For `offered`: adds it to the card. */
  onAccept?: () => void
  /** For `offered`: the tags it would add, shown after the label. */
  detail?: string
  conflict?: string
  /** Picked by a first Backspace in the field; a second one removes it. */
  selected?: boolean
  /** Bolder, for a character's name. */
  strong?: boolean
  className?: string
}

const BASE =
  "inline-flex max-w-full min-w-0 items-center gap-1 rounded-md border text-[13px] leading-none h-7 pointer-coarse:h-11"

const SURFACE: Record<RequestChipVariant, string> = {
  request: "border-transparent bg-secondary text-foreground",
  never: "border-destructive-border bg-destructive-soft text-destructive-text",
  trait: "border-border text-muted-foreground",
  offered: "border-dashed border-border text-muted-foreground",
}

const ICON_BUTTON =
  "relative grid size-6 shrink-0 place-items-center rounded-[6px] pointer-coarse:size-11 " +
  "transition-[color,background-color] duration-150 ease-out-strong " +
  "hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

function ConflictMark({ note }: { note: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          role="img"
          aria-label={note}
          className="grid size-5 shrink-0 place-items-center rounded-[6px] text-warning-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <AlertTriangle className="size-3.5" aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-xs">{note}</TooltipContent>
    </Tooltip>
  )
}

export const RequestChip = memo(function RequestChip({
  label,
  variant = "request",
  removed = false,
  onRemove,
  onRestore,
  onAccept,
  detail,
  conflict,
  selected = false,
  strong = false,
  className,
}: RequestChipProps) {

  if (variant === "offered") {
    return (
      <button
        type="button"
        onClick={onAccept}
        className={cn(
          BASE,
          SURFACE.offered,
          "px-2 font-medium",
          "transition-[color,background-color,border-color] duration-150 ease-out-strong",
          "hover:border-foreground/30 hover:bg-secondary/60 hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        <Plus className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
        {detail && <span className="truncate font-normal text-faint-foreground">{detail}</span>}
      </button>
    )
  }

  const struck = variant === "trait" && removed
  return (
    <span
      className={cn(
        BASE,
        SURFACE[variant],
        "pl-2",
        onRemove || onRestore ? "pr-0.5" : "pr-2",
        conflict && "border-warning-border",
        struck && "border-dashed text-faint-foreground",
        selected && "ring-2 ring-ring ring-offset-1 ring-offset-background",
        className,
      )}
    >
      {variant === "never" && <Ban className="size-3.5 shrink-0" aria-hidden />}
      <span
        className={cn(
          "truncate py-1",
          strong ? "font-semibold" : "font-medium",
          struck && "line-through decoration-faint-foreground",
        )}
      >
        {variant === "never" && <span className="sr-only">Never: </span>}
        {label}
        {struck && <span className="sr-only"> (removed)</span>}
      </span>
      {conflict && <ConflictMark note={conflict} />}
      {struck
        ? onRestore && (
            <button type="button" onClick={onRestore} aria-label={`Restore ${label}`} className={ICON_BUTTON}>
              <RotateCcw className="size-3.5" aria-hidden />
            </button>
          )
        : onRemove && (
            <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className={ICON_BUTTON}>
              <X className="size-3.5" aria-hidden />
            </button>
          )}
    </span>
  )
})
