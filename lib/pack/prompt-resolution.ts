/**
 * Per-prompt generation resolution for Pack Mode. Some poses need a wider or
 * taller canvas (all fours, wide shots, lying down), so each prompt borrows
 * the proportions of the posts its own tags came from:
 *
 *   1. Pose (camera framing is part of it) — it decides the composition.
 *      A full set came from specific posts, so its proportions are used as
 *      is; for loose tags, the one whose posts lean furthest from the pool's
 *      usual shape wins (most tags, like "looking at viewer", carry none).
 *   2. Scenery, same rule.
 *   3. The base card, then the pool's typical shape.
 *
 * Clothing is ignored: it barely changes the composition. The result is
 * snapped to the closest curated bucket the extension already uses.
 */
import type { TagCategory } from "../tag-taxonomy"
import { computeGenerationResolution, type GenerationResolution } from "../extension/generation-resolution"

/** Loose tags seen on fewer posts than this are too noisy to set a shape. */
export const MIN_ASPECT_SUPPORT = 3

/** Categories that may set the shape, in priority order. */
const SHAPE_CATEGORIES: readonly TagCategory[] = ["pose", "scenery"]

export interface ValueAspect {
  /** Median width / height of the posts carrying the value. */
  aspect: number
  /** How many posts carry it. */
  count: number
}

export interface PickPromptAspectArgs {
  /** The prompt's sampled axis values (bundles and/or single tags). */
  values: string[]
  categoryOf: (value: string) => TagCategory | undefined
  aspectOf: (category: TagCategory, value: string) => ValueAspect | undefined
  /** Width / height of the base card, when the base is a card with a size. */
  baseAspect?: number | null
  /** Typical width / height across the pool. */
  poolAspect?: number | null
}

export function pickPromptAspect({ values, categoryOf, aspectOf, baseAspect, poolAspect }: PickPromptAspectArgs): number | null {
  const reference = Math.log(poolAspect && poolAspect > 0 ? poolAspect : 1)
  for (const category of SHAPE_CATEGORIES) {
    const known = values.flatMap((value) => {
      if (categoryOf(value) !== category) return []
      const info = aspectOf(category, value)
      return info ? [{ value, ...info }] : []
    })
    const set = known.find((k) => k.value.includes(","))
    if (set) return set.aspect
    const distinctive = known
      .filter((k) => k.count >= MIN_ASPECT_SUPPORT)
      .sort((a, b) => Math.abs(Math.log(b.aspect) - reference) - Math.abs(Math.log(a.aspect) - reference))[0]
    if (distinctive) return distinctive.aspect
  }
  return baseAspect && baseAspect > 0 ? baseAspect : poolAspect && poolAspect > 0 ? poolAspect : null
}

export interface ResolutionPrefs {
  maxLongSide: number
  strictCap: boolean
}

/** Bucketed generation size for a width / height ratio, honoring the extension's size settings. */
export function resolutionForAspect(aspect: number, prefs: ResolutionPrefs): GenerationResolution | null {
  if (!(aspect > 0) || !Number.isFinite(aspect)) return null
  return computeGenerationResolution(Math.round(aspect * 1000), 1000, {
    maxLongSide: prefs.maxLongSide,
    strictCap: prefs.strictCap,
    snapToBucket: true,
  })
}

/** "[1024x1536] prompt" — the inline form the extension's Import List reads. */
export function withResolutionPrefix(prompt: string, resolution: { width?: number; height?: number }): string {
  return resolution.width && resolution.height ? `[${resolution.width}x${resolution.height}] ${prompt}` : prompt
}
