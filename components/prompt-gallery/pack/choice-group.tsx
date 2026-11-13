"use client"

/**
 * A real radio group drawn as a segmented track or as a row of pills. Arrow keys
 * move the selection, Home and End jump to the ends, and only the checked option
 * (or the first one, while nothing is checked) sits in the tab order.
 */
import { memo, useRef, type KeyboardEvent, type ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface Choice<T extends string> {
  value: T
  label: ReactNode
  /** Read after the label by screen readers and shown as a tabular count. */
  count?: number
  /** Overrides the accessible name when the label is not plain text. */
  ariaLabel?: string
  disabled?: boolean
}

interface ChoiceGroupProps<T extends string> {
  choices: readonly Choice<T>[]
  value: T | null
  onChange: (value: T) => void
  /** The group's name for screen readers. Use `labelledBy` instead when a visible label exists. */
  label?: string
  labelledBy?: string
  describedBy?: string
  variant?: "segmented" | "pills"
  size?: "sm" | "md"
  className?: string
}

function ChoiceGroupInner<T extends string>({
  choices,
  value,
  onChange,
  label,
  labelledBy,
  describedBy,
  variant = "segmented",
  size = "md",
  className,
}: ChoiceGroupProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const enabled = choices.map((c, i) => (c.disabled ? -1 : i)).filter((i) => i >= 0)
  const checkedIndex = choices.findIndex((c) => c.value === value)
  const tabIndexOf = (i: number) => (i === (checkedIndex >= 0 ? checkedIndex : enabled[0]) ? 0 : -1)

  const move = (from: number, step: 1 | -1 | "first" | "last") => {
    if (enabled.length === 0) return
    let target: number
    if (step === "first") target = enabled[0]
    else if (step === "last") target = enabled[enabled.length - 1]
    else {
      const at = enabled.indexOf(from)
      target = enabled[(at + step + enabled.length) % enabled.length]
    }
    onChange(choices[target].value)
    refs.current[target]?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const keys: Record<string, 1 | -1 | "first" | "last"> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
      Home: "first",
      End: "last",
    }
    const step = keys[e.key]
    if (step === undefined) return
    e.preventDefault()
    move(i, step)
  }

  const segmented = variant === "segmented"
  return (
    <div
      role="radiogroup"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className={cn(
        segmented
          ? "inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/50 p-0.5"
          : "flex flex-wrap items-center gap-1.5",
        className,
      )}
    >
      {choices.map((choice, i) => {
        const checked = choice.value === value
        return (
          <button
            key={choice.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={choice.ariaLabel}
            disabled={choice.disabled}
            tabIndex={tabIndexOf(i)}
            onClick={() => onChange(choice.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium",
              "transition-[color,background-color,border-color] duration-150 ease-out-strong",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              "disabled:cursor-not-allowed disabled:opacity-50",
              size === "sm" ? "h-6 px-2 text-xs pointer-coarse:h-10" : "h-8 px-3 text-sm pointer-coarse:h-11",
              segmented
                ? cn(
                    "rounded-md",
                    checked
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )
                : cn(
                    "rounded-full border",
                    checked
                      ? "border-mode-pack-border bg-mode-pack-soft text-mode-pack-text"
                      : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                  ),
            )}
          >
            {!segmented && (
              <span
                aria-hidden
                className={cn(
                  "grid size-3.5 place-items-center rounded-full border",
                  checked ? "border-mode-pack-text" : "border-muted-foreground/60",
                )}
              >
                {checked && <span className="size-1.5 rounded-full bg-mode-pack-text" />}
              </span>
            )}
            <span>{choice.label}</span>
            {choice.count !== undefined && (
              <span className={cn("tabular-nums", checked ? "text-mode-pack-text" : "text-faint-foreground")}>
                <span aria-hidden>· </span>
                {choice.count}
                <span className="sr-only"> scenes</span>
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export const ChoiceGroup = memo(ChoiceGroupInner) as typeof ChoiceGroupInner
