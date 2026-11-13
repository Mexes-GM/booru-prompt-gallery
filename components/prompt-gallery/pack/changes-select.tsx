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
import { SLOT_ROW, SlotLabel } from "./brief-slot"
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
    <div className={`${SLOT_ROW} py-1`}>
      <SlotLabel id={labelId} label="Changes" icon={<Shuffle className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />} />
      <div className="min-w-0">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            aria-labelledby={`${labelId} ${triggerId}`}
            aria-describedby={explainId}
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-[13px] font-medium text-foreground pointer-coarse:h-11",
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
                <DropdownMenuRadioItem key={o.value} value={o.value} disabled={unavailable.includes(o.value)}>
                  {o.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <p id={explainId} className="mt-1 text-xs text-muted-foreground text-pretty">
          {current.explain}
        </p>
      </div>
    </div>
  )
})
