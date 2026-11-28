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
 * category says, one they dashed leaves them, and traits added by hand are pinned unless dashed.
 * A category on Keep wins over a dash (`inKeptCategory`): nothing would pick the tag
 * there, so its chip stays pinned until the category varies again, when the dash is back.
 */
export function classicKeptTags(
  defaults: readonly string[],
  baseTags: readonly string[],
  choiceOf: (tag: string) => ChipState | undefined,
  added: readonly string[],
  inKeptCategory: (tag: string) => boolean = () => false
): string[] {
  const kept = defaults.filter((tag) => choiceOf(tag) !== 'scene' || inKeptCategory(tag))
  baseTags.forEach((tag) => { if (choiceOf(tag) === 'pinned') kept.push(tag) })
  // An added trait is pinned unless the user dashed it (then it is one of the pool's values).
  kept.push(...added.filter((tag) => choiceOf(tag) !== 'scene'))
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

/**
 * Pinned tags that contradict another pinned tag, each with the one it clashes with:
 * `reasonOf(tag, others)` is the conflict resolver's reason ("Conflicts with 'sitting'").
 */
export function pinnedConflicts(
  pinned: readonly string[],
  candidates: Iterable<string>,
  reasonOf: (tag: string, others: string[]) => string | null
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const tag of candidates) {
    const reason = reasonOf(tag, pinned.filter((t) => t !== tag))
    if (reason) out[tag] = /'([^']+)'/.exec(reason)?.[1] ?? reason
  }
  return out
}

/** Where an added trait is shown: the category the taxonomy gives it, else the row it was added from. */
export function addedTraitCategory(tag: string, taxonomyCategory: string, home: TagCategory | undefined): TagCategory {
  return (PACK_AXES as readonly string[]).includes(taxonomyCategory) ? (taxonomyCategory as TagCategory) : home ?? 'appearance'
}

/**
 * Added traits the user dashed (a scene idea's optional tags), by the category row they
 * show in: Classic offers them to that category's sampling instead of every prompt.
 */
export function dashedAddedByCategory(
  added: readonly string[],
  choiceOf: (tag: string) => ChipState | undefined,
  categoryOf: (tag: string) => TagCategory
): Partial<Record<TagCategory, string[]>> {
  const out: Partial<Record<TagCategory, string[]>> = {}
  for (const tag of added) {
    if (choiceOf(tag) !== 'scene') continue
    ;(out[categoryOf(tag)] ??= []).push(tag)
  }
  return out
}

/**
 * Pool values that can still vary: a value whose every tag each prompt keeps already
 * (pinned from the pool, the base or Always add) would only take a pick and add
 * nothing, so it leaves the pool. A full set with one kept tag stays.
 */
export function withoutKeptValues(values: readonly string[], isKept: (tag: string) => boolean): string[] {
  return values.filter((value) => {
    const tags = value.includes(',') ? splitCommaSeparatedTags(value) : [value]
    return !tags.every((tag) => isKept(tag))
  })
}

/**
 * What typing `text` into a category's pool adds: one value per comma-separated tag,
 * or, for a pool of full sets, the whole text as one set.
 */
export function poolEntriesFromInput(text: string, mode: 'individual' | 'bundle'): string[] {
  if (mode === 'bundle') {
    const set = splitCommaSeparatedTags(text)
    return set.length > 0 ? [set.join(', ')] : []
  }
  return Array.from(new Set(splitCommaSeparatedTags(text)))
}
