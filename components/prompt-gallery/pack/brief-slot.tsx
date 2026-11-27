"use client"

/**
 * One row of the card: the label with its category icon, and what the row asks for, in ink,
 * followed by the field to add more. Where the card is wide the label sits in a narrow column on
 * the left, so the rows read down as one sentence ("Who Tifa Lockhart / Wearing bikini / Doing
 * princess carry"); where it is narrow (a phone) the label heads its row. The row's controls sit
 * at the end of the label's line until the card has room for them beside the content. An empty
 * row's hint shows while its field has focus, and is always its description for screen readers.
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

export type SlotEntryProps = Omit<TagEntryProps, "labelledBy" | "describedBy" | "placeholder" | "empty" | "slotId">

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

/** The label of a card row; also used by the People and Changes lines. */
export function SlotLabel({ id, slot, label, icon, className }: { id: string; slot?: SlotId; label?: string; icon?: ReactNode; className?: string }) {
  const meta = slot ? SLOTS[slot] : null
  const Icon = meta?.icon
  return (
    <div className={cn("flex h-7 items-center gap-2 @[22rem]:h-8 @[22rem]:pointer-coarse:h-11", className)}>
      {icon ?? (Icon && <Icon className={cn("size-4 shrink-0", meta.iconClass)} aria-hidden />)}
      <span id={id} className="text-[13px] font-medium text-muted-foreground">
        {label ?? meta?.label}
      </span>
    </div>
  )
}

/**
 * A card row's grid: narrow, the label and the row's controls share the first line and what the
 * row holds takes the full width under them; from 22rem, the label gets its own column and the
 * content lines up beside it. The controls join the content's line only from 36rem: their column
 * takes their full width and the content's (`minmax(0,1fr)`) gives way, so in a card narrower than
 * that a segmented choice or a text button beside the content left the chips a sliver they spilled
 * out of, over the controls. Until then the controls stay on the label's line, over the content.
 */
export const SLOT_ROW = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 @[22rem]:grid-cols-[5.75rem_minmax(0,1fr)_auto] @[22rem]:items-start"
export const SLOT_LABEL_CELL = "col-start-1 row-start-1"
const SLOT_ACTIONS_CELL =
  "col-start-2 row-start-1 flex min-w-0 items-center justify-end gap-1 @[22rem]:col-span-2 @[36rem]:col-start-3 @[36rem]:col-span-1"
/** `spanned`: no controls in the row, so the content takes their column too. */
export const slotContentCell = (spanned = true) =>
  cn(
    "col-span-2 row-start-2 min-w-0 @[22rem]:col-start-2",
    spanned ? "@[22rem]:row-start-1" : "@[36rem]:col-span-1 @[36rem]:row-start-1",
  )

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
  const helpId = useId()
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
      className={cn(SLOT_ROW, "group/slot relative py-3", className)}
    >
      {flashKey ? <RowFlash key={flashKey} /> : null}
      <SlotLabel id={labelId} slot={slot} className={SLOT_LABEL_CELL} />
      {actions && <div className={SLOT_ACTIONS_CELL}>{actions}</div>}
      <div className={slotContentCell(!actions)}>
        <div className="flex flex-wrap items-center gap-1.5">
          {children}
          <TagEntry
            {...entry}
            slotId={slot}
            labelledBy={labelId}
            describedBy={help ? helpId : undefined}
            empty={!filled}
            placeholder={placeholder ?? (filled ? meta.moreText : meta.emptyText)}
          />
        </div>
        {(help || notes) && (
          // The hint waits for the field (it is the field's description meanwhile); notes always show.
          <div className={cn("mt-2 space-y-1 text-xs leading-relaxed text-muted-foreground", !notes && "hidden group-focus-within/slot:block")}>
            {help && <p id={helpId} className="hidden text-pretty group-focus-within/slot:block">{help}</p>}
            {notes}
          </div>
        )}
      </div>
    </div>
  )
})

/** Lights a row up once, when a tag typed in another row lands in it. */
export function RowFlash() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute -inset-x-2 inset-y-1 rounded-lg bg-mode-pack-soft animate-out fade-out-0 fill-mode-forwards duration-1000 ease-out-strong motion-reduce:hidden"
    />
  )
}

/** A quiet line under a row, with an optional icon. */
export function SlotNote({ icon, children, tone = "quiet" }: { icon?: ReactNode; children: ReactNode; tone?: "quiet" | "warning" }) {
  return (
    <p className={cn("flex items-start gap-1.5 text-pretty", tone === "warning" ? "text-warning-text" : "text-muted-foreground")}>
      {icon && <span className="mt-0.5 shrink-0 [&_svg]:size-3.5">{icon}</span>}
      <span>{children}</span>
    </p>
  )
}
