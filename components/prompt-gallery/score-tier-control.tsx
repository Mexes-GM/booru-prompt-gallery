"use client"

import { useCallback, useEffect, useState } from "react"
import { InfoTooltip } from "@/components/ui/info-tooltip"
import { Slider } from "@/components/ui/slider"
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
 * gold): Off is neutral/disabled, then quality climbs to a triumphant gold at
 * Best. `dot` colors the stop indicator; `text` colors the label. Kept as
 * literal class strings so Tailwind can see them at build time.
 */
const TIER_STYLES: Record<ScoreTier, { text: string; dot: string }> = {
  off: { text: "text-muted-foreground", dot: "bg-muted-foreground" },
  good: { text: "text-emerald-500", dot: "bg-emerald-500" },
  great: { text: "text-sky-500", dot: "bg-sky-500" },
  best: { text: "text-amber-500", dot: "bg-amber-500" },
}

export interface ScoreTierControlProps {
  value: ScoreTier
  onChange: (value: ScoreTier) => void
  onCommit: (value: ScoreTier) => void
  /** "default" matches the main gallery panel; "compact" matches the extension side-panel. */
  variant?: "default" | "compact"
}

const VARIANT_CLASSES = {
  default: {
    wrapper: "space-y-2",
    label: "text-xs font-medium text-muted-foreground flex items-center gap-2",
    row: "flex items-center",
    stops: "relative h-6",
    tierText: "text-[10px]",
  },
  compact: {
    wrapper: "space-y-1 mt-2",
    label: "text-[11px] font-medium text-muted-foreground flex items-center gap-1.5",
    row: "flex items-center",
    stops: "relative h-5",
    tierText: "text-[9px]",
  },
} as const

/**
 * Quality floor control (Palanca 1, docs/prompt-genericness-mitigation-plan.md §7-§8): a
 * 4-stop slider mapping to score:>=N per provider (see lib/booru/tag-limits.ts
 * SCORE_FLOOR_BY_PROVIDER). Snaps to 4 discrete positions (step=1, min=0, max=3) — semantic
 * tiers (Off/Good/Great/Best), not a raw number, since score scales differ wildly
 * across providers (§7.3). Mirrors SmoothFilterSlider's local-value-while-dragging pattern so
 * dragging feels smooth and only commits (triggers a refetch) on release.
 */
export function ScoreTierControl({ value, onChange, onCommit, variant = "default" }: ScoreTierControlProps) {
  const classes = VARIANT_CLASSES[variant]
  const [localIndex, setLocalIndex] = useState(TIERS.indexOf(value))

  useEffect(() => {
    setLocalIndex(TIERS.indexOf(value))
  }, [value])

  const handleSliderChange = useCallback((val: number[]) => {
    setLocalIndex(val[0])
  }, [])

  const handleSliderCommit = useCallback((val: number[]) => {
    const tier = TIERS[val[0]]
    onChange(tier)
    onCommit(tier)
  }, [onChange, onCommit])

  const handleTierSelect = useCallback((index: number) => {
    setLocalIndex(index)
    const tier = TIERS[index]
    onChange(tier)
    onCommit(tier)
  }, [onChange, onCommit])

  const currentStyle = TIER_STYLES[TIERS[localIndex]]

  return (
    <div className={classes.wrapper}>
      <label className={classes.label}>
        <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
        <InfoTooltip
          title="Score Floor"
          description="Only shows posts with at least this score (upvotes) on the booru. Some testing indicates that higher-scored posts tend to be better tagged — not a hard rule, but it can improve the prompts you get. 'Off' disables the filter. The presets were calibrated from testing that balanced tag-quality gains against how many posts get filtered out, run separately per provider — so each preset is tuned to that provider's own score scale."
        >
          Score Floor (<span className={cn("font-semibold transition-colors", currentStyle.text)}>{TIER_LABELS[TIERS[localIndex]]}</span>)
        </InfoTooltip>
      </label>
      <div className={classes.row}>
        <Slider
          min={0}
          max={TIERS.length - 1}
          step={1}
          value={[localIndex]}
          onValueChange={handleSliderChange}
          onValueCommit={handleSliderCommit}
          className="flex-1"
          animateWhileDragging
          staticTrack
          thumbAccentClassName={currentStyle.dot}
          aria-label="Score floor tier"
          aria-valuetext={TIER_LABELS[TIERS[localIndex]]}
        />
      </div>
      <div className={classes.stops}>
        {TIERS.map((tier, i) => {
          const active = i === localIndex
          const style = TIER_STYLES[tier]
          // Align each stop with the thumb's exact center for this step.
          // Radix keeps the thumb in bounds, so its center sits at
          // `calc(p% + (halfThumb - p/100 * thumbWidth)px)` — with a 20px
          // (w-5) thumb that's `10 - p*0.2`px. Placing the stop there (then
          // centering it with -translate-x-1/2) makes the dot line up with the
          // knob instead of drifting at the ends like flex justify-between did.
          const p = (i / (TIERS.length - 1)) * 100
          const offset = 10 - p * 0.2
          const left = `calc(${p}% ${offset >= 0 ? "+" : "-"} ${Math.abs(offset)}px)`
          return (
            <button
              key={tier}
              type="button"
              onClick={() => handleTierSelect(i)}
              aria-label={`Set score floor to ${TIER_LABELS[tier]}`}
              aria-pressed={active}
              style={{ left }}
              className="group/tier absolute top-0 flex -translate-x-1/2 flex-col items-center gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full transition-all duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
                  style.dot,
                  active
                    ? "scale-[1.7]"
                    : "opacity-30 group-hover/tier:opacity-60"
                )}
              />
              <span
                className={cn(
                  "font-medium leading-none transition-all duration-200",
                  classes.tierText,
                  style.text,
                  active
                    ? "font-semibold"
                    : "opacity-50 group-hover/tier:opacity-90"
                )}
              >
                {TIER_LABELS[tier]}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
