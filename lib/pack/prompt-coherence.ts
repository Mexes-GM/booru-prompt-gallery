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
import { loadedTagRelations, needsCompany, requiredBy, type TagRelations } from '../tag-relations'
import { COUNT_TAG_RE } from './scene/permanence'
import { getTagSlotFromOverrides } from '../tag-taxonomy'

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

/**
 * True when the prompt shows one person: it says "solo", or its exact people counts add up
 * to one ("1girl"). False when it says nothing about how many people there are.
 */
export function showsOnePerson(tags: readonly string[]): boolean {
  let people = 0
  let counted = false
  for (const raw of tags) {
    const tag = normalizeTagForPack(raw)
    if (tag === 'solo') return true
    const count = COUNT_TAG_RE.exec(tag)
    if (!count) continue
    if (count[2] || count[3].startsWith('other')) return false
    counted = true
    people += Number(count[1])
  }
  return counted && people === 1
}

/**
 * Slots of what the people of a picture do: the people rule's scope. The measured `company`
 * list also has tags about how the picture is laid out ("multiple views", "4koma"), its framing
 * ("eye contact" is a camera tag) and relations between bodies or people ("height difference",
 * "sisters"): those are not acts, and a one-person prompt from a real post may carry them.
 */
const PEOPLE_SLOTS = new Set(['pose:interaction', 'pose:physiological', 'pose:posture', 'pose:combat', 'pose:gesture', 'pose:kinetic'])

/**
 * Tags of a one-person prompt that need more than one person ("princess carry", "looking at
 * another": the measured `company` list, within PEOPLE_SLOTS), with what requires them. Empty
 * when the prompt doesn't show one person or the relations aren't loaded.
 */
export function loneCompanyTags(
  tags: readonly string[],
  overrides: Record<string, string>,
  relations: TagRelations | null = loadedTagRelations()
): Set<string> {
  const out = new Set<string>()
  if (!relations || !showsOnePerson(tags)) return out
  tags.forEach((raw) => {
    const tag = normalizeTagForPack(raw)
    if (needsCompany(relations, tag) && PEOPLE_SLOTS.has(getTagSlotFromOverrides(tag, overrides)?.slot ?? '')) out.add(raw)
  })
  if (out.size === 0) return out
  const gone = new Set(Array.from(out).map(normalizeTagForPack))
  tags.forEach((tag) => {
    if (requiredBy(relations, normalizeTagForPack(tag)).some((needed) => gone.has(needed))) out.add(tag)
  })
  return out
}

export interface CoherenceOptions {
  /** Tags that stay whatever they say (the header and identity of a scene, a Classic base). */
  keep: readonly string[]
  /** Tags a qualified form can't replace; defaults to none. */
  fixed?: readonly string[]
  overrides: Record<string, string>
  relations?: TagRelations | null
  /**
   * The people rule: in a prompt of one person, a tag that needs company goes with what
   * requires it, unless it is in `keep` (the caller reports those). Off by default.
   */
  people?: boolean
}

/** `tags` after the last pass: redundant generics, tags that need company in a one-person prompt (opt-in), then dangling references, out. */
export function coherentPromptTags(tags: readonly string[], options: CoherenceOptions): string[] {
  const relations = options.relations === undefined ? loadedTagRelations() : options.relations
  let out = dropRedundantTags(tags, options.fixed ?? [], relations)
  if (options.people) {
    const lone = loneCompanyTags(out, options.overrides, relations)
    if (lone.size > 0) {
      const kept = new Set(options.keep)
      out = out.filter((tag) => kept.has(tag) || !lone.has(tag))
    }
  }
  return dropDanglingReferences(out, options.keep, options.overrides, relations)
}
