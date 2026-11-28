/**
 * Pure preset table for Pack Mode's "Variety" slider. Each level maps to the
 * axis parameters the generation engine already understands (`axisTagModes`,
 * `axisMinCounts`, exploration temperature) — see the design spec
 * `docs/superpowers/specs/2026-09-27-pack-mode-simplification-design.md` §5.1.
 */
import type { TagCategory } from '../tag-classifier'
import type { AxisTagMode } from './pack-generator'

export type VarietyLevel = 1 | 2 | 3 | 4 | 5
export type VarietySetting = VarietyLevel | 'custom'

export const DEFAULT_VARIETY_LEVEL: VarietyLevel = 3

export const VARIETY_LABELS: Record<VarietyLevel, string> = {
  1: 'Faithful',
  2: 'Coherent',
  3: 'Balanced',
  4: 'Varied',
  5: 'Chaotic',
}

export interface VarietyPresetResult {
  axisTagModes: Partial<Record<TagCategory, AxisTagMode>>
  axisMinCounts: Partial<Record<TagCategory, number>>
  temperature: number
}

/** Categories bundled at the "Balanced" level; every other active axis goes individual. */
const BALANCED_BUNDLE_CATEGORIES: ReadonlySet<TagCategory> = new Set(['clothing', 'equipment'])

/**
 * Computes the axis modes/min-counts/temperature for a Variety level, over
 * only the axes that are actually active (unlocked). `axisMaxPerPrompt` is
 * the same per-axis ceiling `regenerate` already clamps against.
 */
export function varietyPreset(
  level: VarietyLevel,
  activeAxes: readonly TagCategory[],
  axisMaxPerPrompt: Partial<Record<TagCategory, number>>
): VarietyPresetResult {
  const axisTagModes: Partial<Record<TagCategory, AxisTagMode>> = {}
  const axisMinCounts: Partial<Record<TagCategory, number>> = {}

  const clampIndividual = (cat: TagCategory, desired: number): number => {
    const max = axisMaxPerPrompt[cat]
    const clamped = max != null ? Math.min(desired, max) : desired
    return Math.max(1, clamped)
  }

  for (const cat of activeAxes) {
    switch (level) {
      case 1:
        axisTagModes[cat] = 'bundle'
        axisMinCounts[cat] = 1
        break
      case 2:
        axisTagModes[cat] = 'bundle'
        axisMinCounts[cat] = 1
        break
      case 3: {
        const bundle = BALANCED_BUNDLE_CATEGORIES.has(cat)
        axisTagModes[cat] = bundle ? 'bundle' : 'individual'
        axisMinCounts[cat] = bundle ? 1 : clampIndividual(cat, 2)
        break
      }
      case 4:
        axisTagModes[cat] = 'individual'
        axisMinCounts[cat] = clampIndividual(cat, 3)
        break
      case 5:
        axisTagModes[cat] = 'individual'
        axisMinCounts[cat] = axisMaxPerPrompt[cat] ?? 1
        break
    }
  }

  const temperature = { 1: 0.7, 2: 1.0, 3: 1.0, 4: 1.3, 5: 2.0 }[level]

  return { axisTagModes, axisMinCounts, temperature }
}

/** Type guard for values read back from storage. */
export function isValidVarietySetting(x: unknown): x is VarietySetting {
  return x === 'custom' || (typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= 5)
}

/** True when two per-category records hold the same entries. */
export function sameCategoryRecord<T>(a: Partial<Record<TagCategory, T>>, b: Partial<Record<TagCategory, T>>): boolean {
  const keys = Object.keys(a) as TagCategory[]
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
}

/**
 * A preset's per-category counts, except that a category the user switched Off (0)
 * stays Off. Returns `current` itself when nothing changes, so re-applying the same
 * preset doesn't count as an update (the preset is re-applied from an effect whose
 * inputs depend on these counts: a new object every time would never settle).
 */
export function presetCounts(
  current: Partial<Record<TagCategory, number>>,
  preset: Partial<Record<TagCategory, number>>
): Partial<Record<TagCategory, number>> {
  const next = { ...preset }
  ;(Object.keys(current) as TagCategory[]).forEach((cat) => {
    if (current[cat] === 0) next[cat] = 0
  })
  return sameCategoryRecord(current, next) ? current : next
}

/** A preset's modes, or `current` itself when they're the same. */
export function presetModes(
  current: Partial<Record<TagCategory, AxisTagMode>>,
  preset: Partial<Record<TagCategory, AxisTagMode>>
): Partial<Record<TagCategory, AxisTagMode>> {
  return sameCategoryRecord(current, preset) ? current : preset
}
