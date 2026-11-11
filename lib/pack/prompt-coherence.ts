/**
 * The last pass every Pack Mode prompt goes through, Scenes and Classic alike:
 *  1. a generic tag next to a qualified form of the same thing gives way to it
 *     ("earrings" next to "gold earrings", "bra" next to "lace bra");
 *  2. tags that refer to something the prompt doesn't have go: a verb without its
 *     object ("holding", "drinking"), a garment state without the garment ("skirt lift").
 * The measured relations (lib/tag-relations.ts) say most of it; the shape rules and
 * the short hand lists cover what they can't see.
 */
import { isQualifiedVariant } from './character-identity'
import { normalizeTagForPack } from './pack-generator'
import { dropDanglingReferences } from './scene/scene-compose'
import { loadedTagRelations, requiredBy, type TagRelations } from '../tag-relations'

/** Comparable form of a word: "earrings" and "earring" match. */
function stem(word: string): string {
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`
  return word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word
}
const lastWord = (tag: string): string => tag.slice(tag.lastIndexOf(' ') + 1)

/**
 * True when `longer` says everything `shorter` does: a qualified form of it
 * ("lace bra" and "bra"), a garment it describes with a hyphenated adjective
 * ("off-shoulder sweater" and "off shoulder"), or a kind of it by the measured
 * relations ("single earring" requires "earrings" and is one). "blush stickers"
 * is not "blush".
 */
function implies(longer: string, shorter: string, relations: TagRelations | null): boolean {
  if (longer === shorter) return false
  if (isQualifiedVariant(longer, shorter)) return true
  const words = shorter.split(' ')
  if (words.length > 1 && longer.split(' ').includes(words.join('-'))) return true
  return !!relations && stem(lastWord(longer)) === stem(lastWord(shorter)) && requiredBy(relations, longer).includes(shorter)
}

/**
 * A booru tags both "lace bra" and "bra", "off-shoulder sweater" and "off shoulder":
 * the shorter one says nothing the longer doesn't, so it goes. Tags in `fixed` are
 * never dropped.
 */
export function dropRedundantTags(tags: readonly string[], fixed: readonly string[], relations: TagRelations | null = loadedTagRelations()): string[] {
  const kept = new Set(fixed)
  const spaced = tags.map(normalizeTagForPack)
  return tags.filter((tag, i) => kept.has(tag) || !spaced.some((other, j) => j !== i && implies(other, spaced[i], relations)))
}

export interface CoherenceOptions {
  /** Tags that stay whatever they say (the header and identity of a scene, a Classic base). */
  keep: readonly string[]
  /** Tags a qualified form can't replace; defaults to none. */
  fixed?: readonly string[]
  overrides: Record<string, string>
  relations?: TagRelations | null
}

/** `tags` after the last pass: redundant generics, then dangling references, out. */
export function coherentPromptTags(tags: readonly string[], options: CoherenceOptions): string[] {
  const relations = options.relations === undefined ? loadedTagRelations() : options.relations
  const deduped = dropRedundantTags(tags, options.fixed ?? [], relations)
  return dropDanglingReferences(deduped, options.keep, options.overrides, relations)
}
