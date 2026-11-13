"use client"

/**
 * One row of the card: the label on the left in quiet text with its category icon,
 * and on the right what the row asks for, in ink, followed by the field to add more.
 * The label column is narrow and fixed so the rows read down as one sentence:
 * "Who Tifa Lockhart / Wearing bikini / Doing princess carry / Where anything".
 *
 * Focus: when a chip's Remove takes the chip away, focus goes to the neighbouring
 * chip's control, or to the row's field when none is left; taking an offer sends
 * focus to the field.
 */
import { memo, useId, useRef, type MouseEvent, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { afterUpdate, CHIP_ACTION } from "./focus"
import { SLOTS, type SlotId } from "./slots"
import { TagEntry, type TagEntryProps } from "./tag-entry"

export type SlotEntryProps = Omit<TagEntryProps, "labelledBy" | "placeholder" | "empty" | "slotId">

export interface BriefSlotProps {
  slot: SlotId
  /** The row has at least one chip. An empty row shows "Anything" in its field. */
  filled: boolean
  /** The chips. */
  children?: ReactNode
  entry: SlotEntryProps
  /** Overrides the field's placeholder. */
  placeholder?: string
  /** Controls after the field (a menu, a picker button). */
  actions?: ReactNode
  /** Lines under the row: conflicts, what a choice does. */
  notes?: ReactNode
  /** Changes each time a tag typed elsewhere lands in this row: the row lights up once. */
  flashKey?: number
  className?: string
}

/** The label column of a card row; also used by the People and Changes lines. */
export function SlotLabel({ id, slot, label, icon }: { id: string; slot?: SlotId; label?: string; icon?: ReactNode }) {
  const meta = slot ? SLOTS[slot] : null
  const Icon = meta?.icon
  return (
    <div className="flex h-7 items-center gap-1.5 pointer-coarse:h-11">
      {icon ?? (Icon && <Icon className={cn("size-3.5 shrink-0", meta.iconClass)} aria-hidden />)}
      <span id={id} className="text-xs font-medium text-muted-foreground">
        {label ?? meta?.label}
      </span>
    </div>
  )
}

export const SLOT_ROW = "grid grid-cols-[5.25rem_minmax(0,1fr)] gap-x-2 @md:grid-cols-[6rem_minmax(0,1fr)]"

export const BriefSlot = memo(function BriefSlot({
  slot,
  filled,
  children,
  entry,
  placeholder,
  actions,
  notes,
  flashKey,
  className,
}: BriefSlotProps) {
  const labelId = useId()
  const rowRef = useRef<HTMLDivElement>(null)
  const meta = SLOTS[slot]
  const help = !filled ? meta.help : undefined

  // Runs before the chip's own click handler, while the clicked control is still here.
  const onClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    const row = rowRef.current
    const target = e.target as HTMLElement
    if (!row) return
    const field = () => row.querySelector<HTMLInputElement>("input[data-slot-entry]")
    if (target.closest("[data-chip-offer]")) {
      afterUpdate(() => field()?.focus())
      return
    }
    const action = target.closest<HTMLElement>(CHIP_ACTION)
    if (!action) return
    const index = Array.from(row.querySelectorAll(CHIP_ACTION)).indexOf(action)
    afterUpdate(() => {
      if (action.isConnected && document.activeElement === action) return
      if (document.activeElement && document.activeElement !== document.body) return
      const left = Array.from(row.querySelectorAll<HTMLElement>(CHIP_ACTION))
      const next = left.length ? left[Math.min(index, left.length - 1)] : field()
      next?.focus()
    })
  }

  return (
    <div
      ref={rowRef}
      role="group"
      aria-labelledby={labelId}
      onClickCapture={onClickCapture}
      className={cn(SLOT_ROW, "relative py-1", className)}
    >
      {flashKey ? (
        <span
          key={flashKey}
          aria-hidden
          className="pointer-events-none absolute -inset-x-1.5 inset-y-0 rounded-md bg-mode-pack-soft animate-out fade-out-0 fill-mode-forwards duration-1000 ease-out-strong motion-reduce:hidden"
        />
      ) : null}
      <SlotLabel id={labelId} slot={slot} />
      <div className="relative min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          {children}
          <TagEntry
            {...entry}
            slotId={slot}
            labelledBy={labelId}
            empty={!filled}
            placeholder={placeholder ?? (filled ? meta.moreText : meta.emptyText)}
          />
          {actions}
        </div>
        {(help || notes) && (
          <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {help && <p className="text-pretty">{help}</p>}
            {notes}
          </div>
        )}
      </div>
    </div>
  )
})

/** A quiet line under a row, with an optional icon. */
export function SlotNote({ icon, children, tone = "quiet" }: { icon?: ReactNode; children: ReactNode; tone?: "quiet" | "warning" }) {
  return (
    <p className={cn("flex items-start gap-1.5 text-pretty", tone === "warning" ? "text-warning-text" : "text-muted-foreground")}>
      {icon && <span className="mt-0.5 shrink-0 [&_svg]:size-3.5">{icon}</span>}
      <span>{children}</span>
    </p>
  )
}
