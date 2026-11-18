"use client"

/**
 * One thing the card asks for, as a chip.
 *
 * - `request`: in every prompt. Remove takes it off.
 * - `never`: in no prompt. Marked with a ban icon, not only by colour.
 * - `trait`: part of a character's usual look. Removing it strikes it through and
 *   keeps it on the card, so it can be put back. A trait Wearing replaces is struck
 *   through too, with no action: it comes back when Wearing is empty again.
 * - `offered`: something the card suggests. The whole chip is one button that adds it;
 *   its detail wraps to a second line rather than being cut.
 *
 * A Wearing or Where request carries its mode in front of the label: "Any" (each prompt has a
 * different kind of it) or "Exactly" (this tag in every prompt); one click switches it.
 * A chip that doesn't apply now (`inactive`) is struck through and says why; it can still go.
 *
 * Any chip can carry a conflict note: a warning icon, with the note as its name and tooltip.
 * Remove and Restore carry `data-chip-action`, so the row can move focus to a
 * neighbour when a chip goes away.
 */
import { memo } from "react"
import { AlertTriangle, Ban, Plus, Repeat2, RotateCcw, X } from "lucide-react"
import { DEFAULTS_TEXT } from "./pack-text"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export type RequestChipVariant = "request" | "never" | "trait" | "offered"

export interface RequestChipProps {
  label: string
  variant?: RequestChipVariant
  /** For `trait`: taken off the character's look, shown struck through. */
  removed?: boolean
  /** For `trait`: clothing the garments in Wearing replace. Struck through, with no action. */
  replaced?: boolean
  /** Wearing and Where: any kind of the tag (a condition) or exactly it; the switch is on the chip. */
  mode?: { exact: boolean; onToggle: () => void; ambience?: boolean }
  /** Doesn't apply now: struck through, with the reason for screen readers and as a tooltip. */
  inactive?: string
  /** One of the tags every new pack starts with: a small mark that takes it out of them. */
  inDefaults?: { onRemove: () => void }
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
  "inline-flex max-w-full min-w-0 items-center gap-1 rounded-md border text-[13px] leading-none h-7 pointer-coarse:h-9"

const SURFACE: Record<Exclude<RequestChipVariant, "offered">, string> = {
  request: "border-transparent bg-secondary text-foreground",
  never: "border-destructive-border bg-destructive-soft text-destructive-text",
  trait: "border-border text-muted-foreground",
}

// Small to look at, 44 px to touch: the touch area grows past the chip (pointer-coarse),
// so chips keep flowing several to a line on a phone.
const ICON_BUTTON =
  "relative grid size-6 shrink-0 place-items-center rounded-[6px] " +
  "pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5 pointer-coarse:after:content-[''] " +
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

/** What Any and Exactly mean on a chip, said as its tooltip. */
const MODE_HINT = {
  kind: {
    any: "Each prompt has a different kind. Select to use this exact tag",
    exact: "Every prompt has this exact tag. Select for a different kind in each prompt",
  },
  ambience: {
    any: "Each prompt gets a place that has it. Select to add it to whatever scene each prompt has",
    exact: "Added to whatever scene each prompt has. Select to get places that have it",
  },
} as const

function RequestChipInner({
  label,
  variant = "request",
  removed = false,
  replaced = false,
  mode,
  inactive,
  inDefaults,
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

  const struck = (variant === "trait" && (removed || replaced)) || !!inactive
  const restorable = variant === "trait" && removed
  const action = replaced && !removed ? undefined : restorable ? onRestore : onRemove
  return (
    <span
      title={inactive}
      className={cn(
        BASE,
        SURFACE[variant],
        mode ? "pl-0.5" : "pl-2",
        action ? "pr-0.5" : "pr-2",
        conflict && "border-warning-border",
        struck && "border-dashed",
        selected && "ring-2 ring-ring ring-offset-1 ring-offset-background",
        className,
      )}
    >
      {variant === "never" && <Ban className="size-3.5 shrink-0" aria-hidden />}
      {mode && (
        <button
          type="button"
          onClick={mode.onToggle}
          aria-pressed={mode.exact}
          aria-label={`Exactly ${label}`}
          title={MODE_HINT[mode.ambience ? "ambience" : "kind"][mode.exact ? "exact" : "any"]}
          className={cn(
            "relative h-6 shrink-0 rounded-[6px] px-1.5 text-[11px] font-medium",
            "pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5 pointer-coarse:after:content-['']",
            "transition-[color,background-color] duration-150 ease-out-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            mode.exact ? "bg-foreground/10 text-foreground hover:bg-foreground/15" : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
          )}
        >
          {mode.exact ? "Exactly" : "Any"}
        </button>
      )}
      <span className={cn("truncate py-1", strong ? "font-semibold" : "font-medium", struck && "line-through")}>
        {variant === "never" && <span className="sr-only">Never: </span>}
        {label}
        {struck && <span className="sr-only">{inactive ? ` (${inactive})` : removed ? " (removed)" : " (replaced by Wearing)"}</span>}
      </span>
      {conflict && <ConflictMark note={conflict} />}
      {inDefaults && (
        <button
          type="button"
          onClick={inDefaults.onRemove}
          aria-label={DEFAULTS_TEXT.removeOne(label)}
          title={DEFAULTS_TEXT.markHint}
          className={cn(ICON_BUTTON, "size-5 opacity-70 hover:opacity-100")}
        >
          <Repeat2 className="size-3" aria-hidden />
        </button>
      )}
      {action && (
        <button
          type="button"
          data-chip-action=""
          onClick={action}
          aria-label={`${restorable ? "Restore" : "Remove"} ${label}`}
          className={ICON_BUTTON}
        >
          {restorable ? <RotateCcw className="size-3.5" aria-hidden /> : <X className="size-3.5" aria-hidden />}
        </button>
      )}
    </span>
  )
}

export const RequestChip = memo(RequestChipInner)
