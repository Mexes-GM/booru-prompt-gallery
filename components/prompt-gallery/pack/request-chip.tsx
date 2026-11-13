"use client"

/**
 * One thing the card asks for, as a chip.
 *
 * - `request`: in every prompt. Remove takes it off.
 * - `never`: in no prompt. Marked with a ban icon, not only by colour.
 * - `trait`: part of a character's usual look. Removing it strikes it through and
 *   keeps it on the card, so it can be put back.
 * - `offered`: something the card suggests. The whole chip is one button that adds it;
 *   its detail wraps to a second line rather than being cut.
 *
 * Any chip can carry a conflict note: a warning icon, with the note as its name and tooltip.
 * Remove and Restore carry `data-chip-action`, so the row can move focus to a
 * neighbour when a chip goes away.
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

const SURFACE: Record<Exclude<RequestChipVariant, "offered">, string> = {
  request: "border-transparent bg-secondary text-foreground",
  never: "border-destructive-border bg-destructive-soft text-destructive-text",
  trait: "border-border text-muted-foreground",
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

function OfferedChip({ label, detail, onAccept, className }: Pick<RequestChipProps, "label" | "detail" | "onAccept" | "className">) {
  return (
    <button
      type="button"
      data-chip-offer=""
      onClick={onAccept}
      className={cn(
        "inline-flex min-h-7 max-w-full items-start gap-1 rounded-md border border-dashed border-border px-2 py-1.5 text-left text-[13px] leading-tight text-muted-foreground pointer-coarse:min-h-11 pointer-coarse:items-center",
        "transition-[color,background-color,border-color] duration-150 ease-out-strong",
        "hover:border-foreground/30 hover:bg-secondary/60 hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <Plus className="mt-px size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 text-pretty">
        <span className="font-medium">{label}</span>
        {detail && <span className="font-normal"> · {detail}</span>}
      </span>
    </button>
  )
}

function RequestChipInner({
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
  if (variant === "offered") return <OfferedChip label={label} detail={detail} onAccept={onAccept} className={className} />

  const struck = variant === "trait" && removed
  const action = struck ? onRestore : onRemove
  return (
    <span
      className={cn(
        BASE,
        SURFACE[variant],
        "pl-2",
        action ? "pr-0.5" : "pr-2",
        conflict && "border-warning-border",
        struck && "border-dashed",
        selected && "ring-2 ring-ring ring-offset-1 ring-offset-background",
        className,
      )}
    >
      {variant === "never" && <Ban className="size-3.5 shrink-0" aria-hidden />}
      <span className={cn("truncate py-1", strong ? "font-semibold" : "font-medium", struck && "line-through")}>
        {variant === "never" && <span className="sr-only">Never: </span>}
        {label}
        {struck && <span className="sr-only"> (removed)</span>}
      </span>
      {conflict && <ConflictMark note={conflict} />}
      {action && (
        <button
          type="button"
          data-chip-action=""
          onClick={action}
          aria-label={`${struck ? "Restore" : "Remove"} ${label}`}
          className={ICON_BUTTON}
        >
          {struck ? <RotateCcw className="size-3.5" aria-hidden /> : <X className="size-3.5" aria-hidden />}
        </button>
      )}
    </span>
  )
}

export const RequestChip = memo(RequestChipInner)
