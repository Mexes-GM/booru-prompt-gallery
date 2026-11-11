/**
 * Clothing that belongs to a work: a named school's uniform ("kuoh academy
 * school uniform"), a garment named after the series it comes from ("kita high
 * school uniform (subarashiki hibi)") or after something of that series
 * ("mizutsune (armor)"). Like a hairstyle, it is part of who the donor is, so it
 * never travels with a scene. Generic garments ("school uniform", "pom pom
 * (clothes)") are not affected.
 *
 * Told from the tag's own shape and the vocabulary the app already has, not
 * from a list:
 *  - a parenthesised suffix that is not a generic qualifier names a work;
 *  - a generic qualifier ("(armor)", "(clothes)") on a tag the taxonomy doesn't
 *    know as clothing, whose base isn't clothing either, marks a named item;
 *  - "<name> (school) uniform" where a word of the name appears in no other tag
 *    of the vocabulary: a proper name, not a kind of uniform ("summer", "gym").
 */
import { getTagSlotFromOverrides } from '../../tag-taxonomy'

/** Booru disambiguators that only say what kind of thing the tag is. */
const GENERIC_QUALIFIERS = new Set([
  'clothes', 'clothing', 'garment', 'accessory', 'object', 'fashion', 'headwear', 'hat', 'footwear', 'shoes',
  'jewelry', 'dress', 'armor', 'costume', 'uniform', 'outfit', 'swimsuit', 'mask', 'eyewear', 'glasses',
])
const PARENTHESISED = /^(.+) \(([^()]+)\)$/
const NAMED_UNIFORM = /^(.+?) (?:school )?uniform$/

const vocabularyCache = new WeakMap<Record<string, string>, Map<string, number>>()

/** How many tags of the vocabulary (both spellings counted once) use each word. */
function wordCounts(overrides: Record<string, string>): Map<string, number> {
  let counts = vocabularyCache.get(overrides)
  if (counts) return counts
  counts = new Map()
  const tags = new Set(Object.keys(overrides).map((tag) => tag.toLowerCase().replace(/_/g, ' ').trim()))
  for (const tag of tags) {
    for (const word of new Set(tag.split(' '))) counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  vocabularyCache.set(overrides, counts)
  return counts
}

/** True for a garment tag that names a work or something of it. `tag` is in spaced form. */
export function isFranchiseGarment(tag: string, overrides: Record<string, string>): boolean {
  const parenthesised = PARENTHESISED.exec(tag)
  if (parenthesised) {
    const [, base, qualifier] = parenthesised
    if (!GENERIC_QUALIFIERS.has(qualifier)) return true
    // "pom pom (clothes)" is a garment the taxonomy knows; "mizutsune (armor)" names a monster.
    const known = (t: string) => getTagSlotFromOverrides(t, overrides)?.category === 'clothing'
    return !known(tag) && !known(base)
  }
  const uniform = NAMED_UNIFORM.exec(tag)
  if (!uniform) return false
  const counts = wordCounts(overrides)
  return uniform[1].split(' ').some((word) => (counts.get(word) ?? 0) <= 1)
}

/** True when the tag is a parenthesised item with a garment qualifier ("mizutsune (armor)"), whatever its slot. */
export function hasGarmentQualifier(tag: string): boolean {
  const parenthesised = PARENTHESISED.exec(tag)
  return !!parenthesised && GENERIC_QUALIFIERS.has(parenthesised[2])
}
