/**
 * "Min tags per prompt" support for Pack Mode. Pure helpers — no React — so
 * they can be verified like pack-generator.verify.ts.
 *
 * A prompt's size is the constant base (lockedTags) plus what each varying
 * axis contributes: `count` picks per prompt, each pick worth `tagsPerPick`
 * tags (1 for individual tags, the average bundle size for bundle axes).
 */
import type { TagCategory } from "../tag-classifier"

export interface AxisBudget {
  /** Picks per prompt currently requested for this axis (0 = axis off). */
  count: number
  /** Most picks this axis can take per prompt (pool size / slot constraints). */
  cap: number
  /** Tags one pick adds on average (1 for individual tags). */
  tagsPerPick: number
}

/** Expected tag count of one generated prompt (before the cleaner runs). */
export function estimateTagsPerPrompt(
  lockedCount: number,
  axes: Partial<Record<TagCategory, AxisBudget>>
): number {
  let total = lockedCount
  for (const axis of Object.values(axes)) {
    if (!axis || axis.count <= 0) continue
    total += Math.min(axis.count, axis.cap) * axis.tagsPerPick
  }
  return Math.round(total)
}

/**
 * Raises per-axis pick counts, one pick at a time round-robin (cheapest axis
 * first so no single category balloons), until the estimate reaches
 * `minTotal` or every active axis is at its cap. Axes switched off (count 0)
 * are never touched — "Off" is an explicit user choice, not a budget knob.
 * Returns a new counts map; `minTotal <= 0` returns the counts unchanged.
 */
export function raiseCountsForMinTotal(
  minTotal: number,
  lockedCount: number,
  axes: Partial<Record<TagCategory, AxisBudget>>
): Partial<Record<TagCategory, number>> {
  const counts: Partial<Record<TagCategory, number>> = {}
  const entries = Object.entries(axes) as Array<[TagCategory, AxisBudget | undefined]>
  entries.forEach(([cat, axis]) => {
    if (axis) counts[cat] = Math.min(axis.count, axis.cap)
  })
  if (minTotal <= 0) return counts

  const current = () =>
    entries.reduce((sum, [cat, axis]) => (axis ? sum + (counts[cat] ?? 0) * axis.tagsPerPick : sum), lockedCount)

  const growable = () =>
    entries.filter(([cat, axis]) => axis && axis.count > 0 && (counts[cat] ?? 0) < axis.cap)

  // Bounded: every iteration raises one count by one, and counts are capped.
  while (current() < minTotal) {
    const candidates = growable()
    if (candidates.length === 0) break
    // Axis with the fewest picks so far gets the next one (ties: taxonomy order).
    candidates.sort((a, b) => (counts[a[0]] ?? 0) - (counts[b[0]] ?? 0))
    const [cat] = candidates[0]
    counts[cat] = (counts[cat] ?? 0) + 1
  }
  return counts
}
