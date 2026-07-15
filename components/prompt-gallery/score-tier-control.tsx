"use client"

import { useCallback, useEffect, useState } from "react"
import { InfoTooltip } from "@/components/ui/info-tooltip"
import { Slider } from "@/components/ui/slider"
import type { ScoreTier } from "@/lib/api-client"

const TIERS: ScoreTier[] = ["off", "good", "great", "best"]
const TIER_LABELS: Record<ScoreTier, string> = {
  off: "Off",
  good: "Good",
  great: "Great",
  best: "Best",
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
    ticks: "flex justify-between text-[10px] text-muted-foreground/70 px-0.5",
  },
  compact: {
    wrapper: "space-y-1 mt-2",
    label: "text-[11px] font-medium text-muted-foreground flex items-center gap-1.5",
    row: "flex items-center",
    ticks: "flex justify-between text-[9px] text-muted-foreground/70 px-0.5",
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

  return (
    <div className={classes.wrapper}>
      <label className={classes.label}>
        <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
        <InfoTooltip
          title="Score Floor"
          description="Only shows posts with at least this score (upvotes) on the booru. Some testing indicates that higher-scored posts tend to be better tagged — not a hard rule, but it can improve the prompts you get. 'Off' disables the filter. The presets were calibrated from testing that balanced tag-quality gains against how many posts get filtered out, run separately per provider — so each preset is tuned to that provider's own score scale."
        >
          Score Floor ({TIER_LABELS[TIERS[localIndex]]})
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
          aria-label="Score floor tier"
          aria-valuetext={TIER_LABELS[TIERS[localIndex]]}
        />
      </div>
      <div className={classes.ticks}>
        {TIERS.map(tier => (
          <span key={tier}>{TIER_LABELS[tier]}</span>
        ))}
      </div>
    </div>
  )
}
