"use client"

/** What changes from one prompt to the next, with a line that says what the choice does. */
import { memo, useId } from "react"
import { ChevronDown, Shuffle } from "lucide-react"
import type { ChangesAxis } from "@/lib/pack/brief"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { SLOT_LABEL_CELL, SLOT_ROW, SlotLabel, slotContentCell } from "./brief-slot"
import { CHANGES_OPTIONS } from "./pack-text"

export interface ChangesSelectProps {
  value: ChangesAxis
  onChange: (value: ChangesAxis) => void
  /** Options the current card can't do (no outfits to swap, say). */
  unavailable?: readonly ChangesAxis[]
}

export const ChangesSelect = memo(function ChangesSelect({ value, onChange, unavailable = [] }: ChangesSelectProps) {
  const labelId = useId()
  const explainId = useId()
  const triggerId = useId()
  const current = CHANGES_OPTIONS.find((o) => o.value === value) ?? CHANGES_OPTIONS[0]
  return (
    <div className={`${SLOT_ROW} py-2`}>
      <SlotLabel id={labelId} label="Changes" className={SLOT_LABEL_CELL} icon={<Shuffle className="size-4 shrink-0 text-muted-foreground" aria-hidden />} />
      <div className={slotContentCell()}>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            aria-labelledby={`${labelId} ${triggerId}`}
            aria-describedby={explainId}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/80 bg-background px-2.5 text-[13px] font-medium text-foreground shadow-xs pointer-coarse:h-11",
              "transition-[border-color,background-color] duration-150 ease-out-strong",
              "hover:border-foreground/30 data-[state=open]:border-foreground/30",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <span id={triggerId}>{current.label}</span>
            <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as ChangesAxis)}>
              {CHANGES_OPTIONS.map((o) => (
                <DropdownMenuRadioItem key={o.value} value={o.value} disabled={unavailable.includes(o.value)} className="pointer-coarse:min-h-11">
                  {o.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <p id={explainId} className="mt-1.5 text-xs leading-relaxed text-muted-foreground text-pretty">
          {current.explain}
        </p>
      </div>
    </div>
  )
})
