"use client"

/**
 * Pack Mode's "Variety" slider (design spec §5) — 5 stops mapped to presets
 * the engine already understands (see lib/pack/variety-presets.ts). Reads
 * as "Custom" once a manual Advanced edit has diverged axis modes/min-counts
 * from any preset; moving the slider from there re-applies a preset and
 * discards those manual values (usePackMode.setVarietyLevel does the discarding).
 */
import { useState } from "react"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { VARIETY_LABELS, type VarietyLevel, type VarietySetting } from "@/lib/pack/variety-presets"

export interface PackVarietySliderProps {
  value: VarietySetting
  onChange: (level: VarietyLevel) => void
}

export function PackVarietySlider({ value, onChange }: PackVarietySliderProps) {
  const committed = value === 'custom' ? 3 : value

  // Live display while dragging, decoupled from the committed value — same
  // reasoning as the Prompts count slider elsewhere in the builder: commit
  // only on release so mid-drag frames don't each re-run generation-adjacent
  // state updates. Synced during render (not via useEffect), same pattern.
  const [live, setLive] = useState(committed)
  const [prevCommitted, setPrevCommitted] = useState(committed)
  if (committed !== prevCommitted) {
    setPrevCommitted(committed)
    setLive(committed)
  }

  return (
    <div className="flex items-center gap-3 w-full max-w-sm mx-auto">
      <Label htmlFor="pack-variety" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
        Variety
      </Label>
      <Slider
        id="pack-variety"
        min={1}
        max={5}
        step={1}
        value={[live]}
        onValueChange={([v]) => setLive(v as VarietyLevel)}
        onValueCommit={([v]) => onChange(v as VarietyLevel)}
        className="flex-1"
      />
      <span className="text-xs font-bold text-mode-pack-text bg-mode-pack-soft px-2.5 py-0.5 rounded-full border border-mode-pack-border min-w-[5.5rem] text-center">
        {value === 'custom' ? 'Custom' : VARIETY_LABELS[value as VarietyLevel]}
      </span>
    </div>
  )
}
