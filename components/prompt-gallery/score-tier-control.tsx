"use client"

import { useCallback, useId, useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { InfoTooltip } from "@/components/ui/info-tooltip"
import { useDeferredCallback } from "@/hooks/use-deferred-callback"
import { FILTER_COMMIT_DELAY_MS, SEGMENT_PILL_SPRING } from "@/lib/motion"
import { cn } from "@/lib/utils"
import type { ScoreTier } from "@/lib/api-client"

const TIERS: ScoreTier[] = ["off", "good", "great", "best"]
const TIER_LABELS: Record<ScoreTier, string> = {
  off: "Off",
  good: "Good",
  great: "Great",
  best: "Best",
}

/**
 * Each tier reads as a rung on an ascending quality ladder, using the "loot
 * rarity" color language this audience already knows (gray → green → blue →
 * gold). Only the ACTIVE segment is tinted, so the control stays quiet until
 * a floor is actually set. Kept as literal class strings so Tailwind can see
 * them at build time.
 */
const TIER_PILL_STYLES: Record<ScoreTier, string> = {
  off: "bg-background shadow-sm",
  good: "bg-success-soft shadow-sm",
  great: "bg-info-soft shadow-sm",
  best: "bg-warning-soft shadow-sm",
}
const TIER_TEXT_STYLES: Record<ScoreTier, string> = {
  off: "text-foreground",
  good: "text-success-text",
  great: "text-info-text",
  best: "text-warning-text",
}

export interface ScoreTierControlProps {
  value: ScoreTier
  onChange: (value: ScoreTier) => void
  onCommit: (value: ScoreTier) => void
  /** "default" matches the main gallery panel; "compact" matches the extension side-panel. */
  variant?: "default" | "compact"
  /** Plain label + one-line hint instead of the ⓘ tooltip label (main panel). */
  label?: string
  hint?: string
}

const VARIANT_CLASSES = {
  default: {
    wrapper: "space-y-2",
    label: "text-xs font-medium text-muted-foreground flex items-center gap-2",
    group: "h-8 p-0.5",
    segment: "text-xs",
  },
  compact: {
    wrapper: "space-y-1",
    label: "text-[11px] font-medium text-muted-foreground flex items-center gap-1.5",
    group: "h-7 p-0.5",
    segment: "text-[11px]",
  },
} as const

/**
 * Quality floor control (Palanca 1, docs/prompt-genericness-mitigation-plan.md §7-§8): four
 * semantic tiers mapping to score:>=N per provider (see lib/booru/tag-limits.ts
 * SCORE_FLOOR_BY_PROVIDER) — tiers rather than a raw number, since score scales differ wildly
 * across providers (§7.3). Rendered as a segmented radio group instead of a 4-stop slider:
 * the options are discrete, so every choice is visible and one click away. Each click
 * commits (triggers a refetch) once the selection pill has settled.
 */
export function ScoreTierControl({ value, onChange, onCommit, variant = "default", label, hint }: ScoreTierControlProps) {
  const classes = VARIANT_CLASSES[variant]
  const pillId = useId()
  const reduceMotion = useReducedMotion()

  // The pill follows local state right away; the commit (gallery re-render +
  // refetch) waits until the pill has settled so it doesn't stutter.
  const [selected, setSelected] = useState(value)
  const [prevValue, setPrevValue] = useState(value)
  if (value !== prevValue) {
    setPrevValue(value)
    setSelected(value)
  }

  const { schedule: scheduleCommit } = useDeferredCallback((tier: ScoreTier) => {
    onChange(tier)
    onCommit(tier)
  }, FILTER_COMMIT_DELAY_MS)

  const handleSelect = useCallback((tier: ScoreTier) => {
    if (tier === selected) return
    setSelected(tier)
    scheduleCommit(tier)
  }, [selected, scheduleCommit])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0
    if (!delta) return
    e.preventDefault()
    const next = TIERS[(TIERS.indexOf(selected) + delta + TIERS.length) % TIERS.length]
    handleSelect(next)
    const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>("[role='radio']")
    buttons[TIERS.indexOf(next)]?.focus()
  }, [selected, handleSelect])

  return (
    <div className={classes.wrapper}>
      {hint !== undefined ? (
        <div className="flex items-baseline justify-between gap-3">
          <span id="score-floor-label" className="text-sm font-medium text-foreground">{label ?? "Score Floor"}</span>
          <span className="truncate text-xs text-muted-foreground">{hint}</span>
        </div>
      ) : (
      <span id="score-floor-label" className={classes.label}>
        <InfoTooltip
          title="Score Floor"
          description="Only shows posts with at least this score (upvotes) on the booru. Some testing indicates that higher-scored posts tend to be better tagged — not a hard rule, but it can improve the prompts you get. 'Off' disables the filter. The presets were calibrated from testing that balanced tag-quality gains against how many posts get filtered out, run separately per provider — so each preset is tuned to that provider's own score scale."
        >
          Score Floor
        </InfoTooltip>
      </span>
      )}
      <div
        role="radiogroup"
        aria-labelledby="score-floor-label"
        onKeyDown={handleKeyDown}
        className={cn("grid grid-cols-4 gap-0.5 rounded-md border border-input bg-muted/50", hint !== undefined ? "h-10 sm:h-9 rounded-lg p-[3px]" : classes.group)}
      >
        {TIERS.map((tier) => {
          const active = tier === selected
          return (
            <button
              key={tier}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              onClick={() => handleSelect(tier)}
              className={cn(
                "relative rounded-[5px] font-medium transition-[color,background-color,transform] duration-150 ease-out outline-none active:scale-[0.97] motion-reduce:active:scale-100",
                "focus-visible:ring-2 focus-visible:ring-ring",
                classes.segment,
                active ? TIER_TEXT_STYLES[tier] : "text-muted-foreground hover:text-foreground hover:bg-background/40"
              )}
            >
              {/* One pill slides between segments (and re-tints on the way)
                  instead of the highlight teleporting. */}
              {active && (
                <motion.span
                  layoutId={`${pillId}-score-tier-pill`}
                  aria-hidden="true"
                  className={cn("absolute inset-0 rounded-[5px] transition-colors duration-150", TIER_PILL_STYLES[tier])}
                  transition={reduceMotion ? { duration: 0 } : SEGMENT_PILL_SPRING}
                />
              )}
              <span className="relative">{TIER_LABELS[tier]}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
