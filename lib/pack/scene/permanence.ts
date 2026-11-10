/**
 * Permanence: whether a tag describes who the subject IS or what a picture SHOWS.
 *
 * The slot of a tag (hair, posture, setting...) says what kind of thing it is;
 * permanence is a second, independent label:
 *
 *  - `identity`    stays with the character (hair colour, eye colour, species...).
 *  - `state`       depends on the picture (pose, clothing worn, exposure, place...).
 *  - `composition` how many people there are and how they pair up.
 *  - `signature`   an accessory that usually belongs to the character, but that a
 *                  picture can also just show (glasses, a hat).
 *
 * The data file only lists the exceptions to the default of each slot, so it
 * stays small:
 *
 *  - appearance:hair | eyes | anatomy   default identity; `state` lists the exceptions.
 *  - appearance:demographics            default state; `composition` and `identity` list exceptions.
 *  - clothing:headwear | eyewear | accents  default state; `signature` lists the exceptions.
 *  - any other slot, or a tag without a slot   state.
 */
import { getTagSlotFromOverrides } from '../../tag-taxonomy'

export type Permanence = 'identity' | 'state' | 'composition' | 'signature'

/** Shape of `public/tag-permanence.json`. Tags are in display form (spaces). */
export interface PermanenceData {
  version?: number
  state?: readonly string[]
  composition?: readonly string[]
  signature?: readonly string[]
  identity?: readonly string[]
}

/** "1girl", "2boys", "6+girls", "3others". */
export const COUNT_TAG_RE = /^(\d+)(\+?)\s?(girls?|boys?|others?)$/
/** Open-ended counts: "multiple girls", "6+boys". */
export const OPEN_COUNT_RE = /^(multiple (girls|boys|others)|\d+\+(girls|boys|others))$/
/** How many people and how they pair up, whatever the slot data says. */
const COMPOSITION_RE = new RegExp(
  [
    COUNT_TAG_RE.source,
    /^multiple (girls|boys|others)$/.source,
    /^solo$/.source,
    /^solo focus$/.source,
    /^(male|female) focus$/.source,
    /^hetero$/.source,
    /^yuri$/.source,
    /^yaoi$/.source,
    /^futa with .+$/.source,
    /^(couple|duo|trio|group)$/.source,
  ].join('|')
)

/** Relationships between the people of a picture: part of the donor, never of the character. */
const KINSHIP_RE =
  /\b(mother|father|daughter|son|brothers?|sisters?|siblings?|aunt|uncle|niece|nephew|cousins?|grand(father|mother|son|daughter)|twins|triplets|quintuplets|sextuplets|incest)\b/

const IDENTITY_BY_DEFAULT = new Set(['appearance:hair', 'appearance:eyes', 'appearance:anatomy'])
const SIGNATURE_CANDIDATES = new Set(['clothing:headwear', 'clothing:eyewear', 'clothing:accents'])

const normalize = (tag: string): string => tag.toLowerCase().replace(/_/g, ' ').trim()

/** True for tags that describe the people count or pairing, whatever the data says. */
export function isCompositionPattern(tag: string): boolean {
  return COMPOSITION_RE.test(normalize(tag))
}

/** True for tags that name a family relationship between the people of a picture. */
export function isKinshipTag(tag: string): boolean {
  return KINSHIP_RE.test(normalize(tag))
}

/**
 * Builds the permanence lookup. `overrides` maps tag (spaces) to
 * "category:subcategory"; slots resolve by suffix too, so "blue skirt" has the slot of "skirt".
 */
export function createPermanence(
  data: PermanenceData,
  overrides: Record<string, string>
): (tag: string) => Permanence {
  const state = new Set((data.state ?? []).map(normalize))
  const composition = new Set((data.composition ?? []).map(normalize))
  const signature = new Set((data.signature ?? []).map(normalize))
  const identity = new Set((data.identity ?? []).map(normalize))
  const cache = new Map<string, Permanence>()

  const compute = (tag: string): Permanence => {
    if (COMPOSITION_RE.test(tag)) return 'composition'
    const slot = getTagSlotFromOverrides(tag, overrides)?.slot
    if (slot && IDENTITY_BY_DEFAULT.has(slot)) return state.has(tag) ? 'state' : 'identity'
    if (slot === 'appearance:demographics') {
      if (composition.has(tag)) return 'composition'
      return identity.has(tag) ? 'identity' : 'state'
    }
    if (slot && SIGNATURE_CANDIDATES.has(slot)) return signature.has(tag) ? 'signature' : 'state'
    return 'state'
  }

  return (raw: string): Permanence => {
    const tag = normalize(raw)
    let result = cache.get(tag)
    if (!result) {
      result = compute(tag)
      cache.set(tag, result)
    }
    return result
  }
}
