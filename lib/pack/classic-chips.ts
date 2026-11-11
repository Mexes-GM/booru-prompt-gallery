/**
 * What the character chips (lib/pack/scene-pack.ts's chip model, shared with Scenes)
 * mean for Classic's prompts: which tags every prompt keeps, which never appear, and
 * where a trait added by hand is shown.
 */
import type { TagCategory } from '../tag-classifier'
import { PACK_AXES } from '../tag-taxonomy'
import { splitCommaSeparatedTags } from '../utils/tag-utils'
import type { ChipState } from './scene-pack'

/**
 * The tags every Classic prompt keeps. `defaults` is what the categories say (Keep, a
 * kept part, signature accessories); a chip the user pinned joins them whatever its
 * category says, one they dashed leaves them, and traits added by hand are pinned.
 */
export function classicKeptTags(
  defaults: readonly string[],
  baseTags: readonly string[],
  choiceOf: (tag: string) => ChipState | undefined,
  added: readonly string[]
): string[] {
  const kept = defaults.filter((tag) => choiceOf(tag) !== 'scene')
  baseTags.forEach((tag) => { if (choiceOf(tag) === 'pinned') kept.push(tag) })
  kept.push(...added)
  return Array.from(new Set(kept.filter(Boolean)))
}

/**
 * Pool values without the tags no prompt may have: a single tag goes, a full set
 * stays without it (the rest still belongs together). Returns the values and, for
 * each, the value it came from (to keep its sampling weight).
 */
export function withoutNeverTags(values: readonly string[], isNever: (tag: string) => boolean): { values: string[]; originOf: Map<string, string> } {
  const originOf = new Map<string, string>()
  const out: string[] = []
  for (const value of values) {
    const tags = value.includes(',') ? splitCommaSeparatedTags(value) : [value]
    const kept = tags.filter((tag) => !isNever(tag))
    if (kept.length === 0) continue
    const next = kept.length === tags.length ? value : kept.join(', ')
    if (originOf.has(next)) continue
    originOf.set(next, value)
    out.push(next)
  }
  return { values: out, originOf }
}

/** Where an added trait is shown: the category the taxonomy gives it, else the row it was added from. */
export function addedTraitCategory(tag: string, taxonomyCategory: string, home: TagCategory | undefined): TagCategory {
  return (PACK_AXES as readonly string[]).includes(taxonomyCategory) ? (taxonomyCategory as TagCategory) : home ?? 'appearance'
}
