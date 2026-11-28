"use client"

import { Minus, Plus } from "lucide-react"

/** "− n +" stepper; 0 renders as `zeroLabel`. */
export function Stepper({
  value,
  min,
  max,
  onChange,
  zeroLabel,
  ariaLabel,
}: {
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  zeroLabel?: string
  ariaLabel: string
}) {
  return (
    <div className="inline-flex items-center rounded-md border border-border/60 bg-background" role="group" aria-label={ariaLabel}>
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label={`Decrease ${ariaLabel}`}
        className="h-8 w-8 pointer-coarse:h-11 pointer-coarse:w-11 grid place-items-center text-muted-foreground hover:text-foreground disabled:opacity-30"
      >
        <Minus className="w-3 h-3" />
      </button>
      <span className="min-w-[2.25rem] text-center text-xs font-semibold tabular-nums">
        {value === 0 && zeroLabel ? zeroLabel : value}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label={`Increase ${ariaLabel}`}
        className="h-8 w-8 pointer-coarse:h-11 pointer-coarse:w-11 grid place-items-center text-muted-foreground hover:text-foreground disabled:opacity-30"
      >
        <Plus className="w-3 h-3" />
      </button>
    </div>
  )
}
