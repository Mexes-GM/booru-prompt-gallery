"use client"

/**
 * Pack Mode's "Variety" control (design spec §5) — 5 levels mapped to presets
 * the engine already understands (see lib/pack/variety-presets.ts), as a
 * compact select next to Generate. Reads as "Custom" once a manual per-category
 * edit has diverged axis modes/min-counts from any preset; picking a level from
 * there re-applies a preset and discards those manual values
 * (usePackMode.setVarietyLevel does the discarding).
 */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { VARIETY_LABELS, type VarietyLevel, type VarietySetting } from "@/lib/pack/variety-presets"

export interface PackVarietySelectProps {
  value: VarietySetting
  onChange: (level: VarietyLevel) => void
}

const LEVELS: VarietyLevel[] = [1, 2, 3, 4, 5]

export function PackVarietySelect({ value, onChange }: PackVarietySelectProps) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v) as VarietyLevel)}>
      <SelectTrigger aria-label="Variety" className="h-9 pointer-coarse:h-11 w-auto gap-1.5 px-2.5 text-xs">
        <span className="text-muted-foreground">Variety</span>
        <span className="font-semibold text-foreground">
          <SelectValue>{value === "custom" ? "Custom" : VARIETY_LABELS[value]}</SelectValue>
        </span>
      </SelectTrigger>
      <SelectContent>
        {LEVELS.map((level) => (
          <SelectItem key={level} value={String(level)} className="text-sm">
            {VARIETY_LABELS[level]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
