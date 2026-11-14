/**
 * A requested garment or place as a condition (SceneRequests.conditions): every prompt meets it with
 * a variant of its own. The variant comes, in order, from the prompt's scene when it already meets
 * it, from another scene (a donor) that lends the part of its outfit or its place that meets it,
 * from an outfit of the library, and last from the tag as typed.
 *
 * What a donor lends for a garment is the part of its outfit the garment takes: the tags of the body
 * slots the garment occupies (its own and those the taxonomy says it can't share a prompt with,
 * SLOT_CONSTRAINTS) and the qualified forms of the garment. The rest of the outfit stays the
 * scene's. What the picture shows of the body goes with the clothes of the torso: when the lent part
 * covers the torso (an outfit, a top or a bottom), the donor's exposure comes with it; otherwise the
 * scene keeps its own. A place is lent whole.
 *
 * Pure; the pack is built in scene-pack.ts.
 */
import { SLOT_CONSTRAINTS, getTagSlotFromOverrides } from '../../tag-taxonomy'
import { isQualifiedVariant } from '../character-identity'
import { normalizeTagForPack } from '../pack-generator'
import { jaccard, type Scene, type SceneUnits } from './scene'

/** Garment slots that hold one piece at a time (taxonomy SLOT_CONSTRAINTS); accessories are left out. */
export const BODY_SLOTS: ReadonlySet<string> = new Set(['clothing:outfit', 'clothing:top', 'clothing:bottom', 'clothing:underwear', 'clothing:legwear', 'clothing:footwear'])
/** Body slots whose clothes decide what the picture shows of the torso. */
const TORSO_SLOTS: ReadonlySet<string> = new Set(['clothing:outfit', 'clothing:top', 'clothing:bottom'])

/** Body slots a garment takes up: its own, and those the taxonomy says it can't share a prompt with. */
export function slotsTakenBy(tag: string, overrides: Record<string, string>): string[] {
  const slot = getTagSlotFromOverrides(tag, overrides)?.slot
  if (!slot || !BODY_SLOTS.has(slot)) return []
  const constraint = SLOT_CONSTRAINTS[slot]
  return constraint && constraint.maxCount === 1 ? [slot, ...(constraint.incompatibleWith ?? [])] : []
}

/** The part of an outfit some garments take, and whether it covers the torso. */
export interface GarmentRegion {
  garments: readonly string[]
  /** Clothing slots the garments occupy (one-piece slots and their incompatible ones; a headwear's own slot). */
  slots: ReadonlySet<string>
  /** The region holds an outfit, a top or a bottom: the exposure goes with it. */
  torso: boolean
}

/** Every clothing slot of the taxonomy. */
export const CLOTHING_SLOTS: ReadonlySet<string> = new Set(['clothing:outfit', 'clothing:top', 'clothing:bottom', 'clothing:underwear', 'clothing:legwear', 'clothing:footwear', 'clothing:headwear', 'clothing:eyewear', 'clothing:accents'])

/**
 * The region of `garments`: every slot each takes (slotsTakenBy), plus the own slot of a garment of
 * a one-piece slot that isn't a body slot (headwear, eyewear). A garment of a slot that holds several
 * (accessories) takes no slot: only its own qualified forms are its part. A garment of the outfit
 * slot (a dress, a uniform, a swimsuit) is the whole outfit: its region is every clothing slot.
 */
export function garmentRegion(garments: readonly string[], overrides: Record<string, string>): GarmentRegion {
  const slots = new Set<string>()
  if (garments.some((garment) => getTagSlotFromOverrides(garment, overrides)?.slot === 'clothing:outfit')) {
    return { garments, slots: CLOTHING_SLOTS, torso: true }
  }
  for (const garment of garments) {
    slotsTakenBy(garment, overrides).forEach((slot) => slots.add(slot))
    const slot = getTagSlotFromOverrides(garment, overrides)?.slot
    if (slot?.startsWith('clothing:') && SLOT_CONSTRAINTS[slot]?.maxCount === 1) slots.add(slot)
  }
  return { garments, slots, torso: Array.from(slots).some((slot) => TORSO_SLOTS.has(slot)) }
}

/**
 * True when `tag` of an outfit belongs to `region`: its slot is one the region takes, it is a form
 * of one of the garments ("white bikini"), or, for a region of the torso, it is a clothing tag
 * without a slot (whose part of the body nothing says).
 */
export function inRegion(tag: string, region: GarmentRegion, overrides: Record<string, string>): boolean {
  if (region.garments.some((garment) => isQualifiedVariant(tag, garment))) return true
  const info = getTagSlotFromOverrides(tag, overrides)
  if (info?.slot) return region.slots.has(info.slot)
  return region.torso
}

/** Words of a clothing tag that name a part or a detail of a garment, or clothes in general, not a garment. */
const DETAIL_WORDS = new Set(['sleeve', 'collar', 'lapel', 'button', 'cutout', 'neckline', 'strap', 'hem', 'frill', 'trim', 'pocket', 'zipper', 'halter', 'clothes', 'clothing', 'print'])
/** Cut and exposure words filed with the garments ("off shoulder", "halterneck", "sleeveless"). */
const CUT_RE = /^(off[- ]shoulder|halterneck|highleg|backless|.+less)$/
const stem = (word: string) => (word.endsWith('ies') ? `${word.slice(0, -3)}y` : word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word)

/**
 * True for a tag filed with the garments that isn't a piece someone wears: exposure and cut
 * ("bare shoulders", "sleeveless", "off shoulder"), a detail of a garment ("long sleeves", "sailor
 * collar"), clothes in general ("see-through clothes", "striped clothes"). The same notion the bench's
 * contradiction measure uses.
 */
export function isGarmentDetail(tag: string): boolean {
  if (/^(bare|no) /.test(tag) || CUT_RE.test(tag)) return true
  return tag.split(/[ -]/).some((word) => DETAIL_WORDS.has(stem(word)))
}

/** True when `tag` is a piece of `garment`: it names the garment's head word ("bikini top", "side-tie bikini bottom" for "bikini"). */
export function isPieceOf(tag: string, garment: string): boolean {
  const head = stem(garment.slice(garment.lastIndexOf(' ') + 1))
  return tag.split(' ').some((word) => stem(word) === head)
}

/** The head word of a garment tag, as garments are compared: "white apron" -> "apron", "pleated skirts" -> "skirt". */
export const garmentHead = (tag: string): string => stem(tag.slice(tag.lastIndexOf(' ') + 1))

/**
 * Share of the outfits wearing a garment of the outfit slot (a uniform, a maid outfit) that must carry
 * a piece (by head word) for it to be one of the garment's own pieces rather than a layer over it.
 * Measured on the theme posts of 26 garments (ENG-7): every core piece of a costume is at 30 % or more
 * (school uniform's serafuku 30, police uniform's skirt 42, santa costume's dress 50, maid's apron 71,
 * playboy bunny's leotard 83), and every layer seen over a swimsuit or a dress is below it (a jacket
 * over a bikini 15, a shirt over a one-piece swimsuit 28).
 */
export const PIECE_SHARE = 0.3
/** Outfits that must wear the garment before its pieces are measured: with fewer, it has none. */
export const MIN_PIECE_SUPPORT = 10

/**
 * The pieces of a garment of the outfit slot, measured on `outfits` (the outfit units of the scenes a
 * pack has, its donors included): the head words of the outfit, top and bottom garments that at least
 * PIECE_SHARE of the outfits wearing it (or a form of it) carry. A costume is its pieces: a maid
 * outfit's apron and dress, a school uniform's shirt and skirt. Empty for a garment of another slot,
 * or with fewer than MIN_PIECE_SUPPORT outfits wearing it.
 */
export function garmentPieces(garment: string, outfits: ReadonlyArray<readonly string[]>, overrides: Record<string, string>): Set<string> {
  if (getTagSlotFromOverrides(garment, overrides)?.slot !== 'clothing:outfit') return new Set()
  const wearing = outfits.filter((outfit) => outfit.some((tag) => isQualifiedVariant(tag, garment)))
  if (wearing.length < MIN_PIECE_SUPPORT) return new Set()
  const counts = new Map<string, number>()
  for (const outfit of wearing) {
    const heads = new Set(outfit.filter((tag) => {
      const slot = getTagSlotFromOverrides(tag, overrides)?.slot
      return !!slot && TORSO_SLOTS.has(slot) && !isQualifiedVariant(tag, garment) && !isGarmentDetail(tag)
    }).map(garmentHead))
    heads.forEach((head) => counts.set(head, (counts.get(head) ?? 0) + 1))
  }
  return new Set(Array.from(counts).filter(([, n]) => n / wearing.length >= PIECE_SHARE).map(([head]) => head))
}

/**
 * The tags of an outfit (`tags`) worn over or instead of a requested garment it has: whole garments
 * of a body slot the garment takes ("tied shirt", "sarong" with a "bikini"), other than the garment's
 * forms and pieces, what the measured relations say it requires ("swimsuit" for "bikini"), and
 * details or cuts. The taxonomy says one piece holds those slots, so such an outfit contradicts the
 * request: the condition takes it from no scene and no donor. A piece of a costume (`pieces`) is not
 * a layer: an apron with a maid outfit is the outfit.
 */
export function layersOver(
  tags: readonly string[],
  garments: readonly string[],
  overrides: Record<string, string>,
  requires: (garment: string) => readonly string[] = () => [],
  /** A garment's own pieces (garmentPieces), by head word: never layers over it. */
  pieces: (garment: string) => ReadonlySet<string> = () => new Set(),
): string[] {
  const worn = garments.filter((garment) => tags.some((tag) => isQualifiedVariant(tag, garment)))
  if (worn.length === 0) return []
  return tags.filter((tag) => {
    const slot = getTagSlotFromOverrides(tag, overrides)?.slot
    if (!slot || isGarmentDetail(tag)) return false
    // Another of the requested garments (or a form of it) is asked for, not worn over them.
    if (garments.some((garment) => isQualifiedVariant(tag, garment))) return false
    return worn.some((garment) => {
      if (!slotsTakenBy(garment, overrides).includes(slot)) return false
      if (isQualifiedVariant(tag, garment) || isQualifiedVariant(garment, tag) || isPieceOf(tag, garment)) return false
      if (pieces(garment).has(garmentHead(tag))) return false
      // The wider kind itself, not another form of it: "white dress" next to "sundress" names a second dress.
      return !requires(garment).includes(tag)
    })
  })
}

/** How many of `tags` `list` has, each itself or a qualified form. */
export function metCount(list: readonly string[], tags: readonly string[]): number {
  return tags.filter((tag) => list.some((have) => isQualifiedVariant(have, tag))).length
}

/** True when `list` has every one of `tags` (itself or a qualified form). */
export const meetsAll = (list: readonly string[], tags: readonly string[]): boolean => metCount(list, tags) === tags.length

/** The tags of `outfit` in `region`: what a scene lends, or gives up, for the garments. */
export const regionTags = (outfit: readonly string[], region: GarmentRegion, overrides: Record<string, string>): string[] =>
  outfit.filter((tag) => inRegion(tag, region, overrides))

/**
 * `base` wearing `donor`'s part of the outfit for `region` (the rest of the outfit stays the base's),
 * with the donor's exposure when the region covers the torso; rated as the higher of the two.
 */
export function lendOutfitPart(base: Scene, donor: Scene, region: GarmentRegion, overrides: Record<string, string>): Scene {
  const units: SceneUnits = { ...base.units }
  units.outfit = [
    ...base.units.outfit.filter((tag) => !inRegion(tag, region, overrides)),
    ...donor.units.outfit.filter((tag) => inRegion(tag, region, overrides)),
  ]
  if (region.torso) units.exposure = donor.units.exposure.slice()
  return { ...base, units, rating: higherRating(base, donor) }
}

/** `base` at `donor`'s place: its place unit whole, rated as the higher of the two (anchors: the base's pose and the new place). */
export function lendPlace(base: Scene, donor: Scene): Scene {
  return { ...base, units: { ...base.units, place: donor.units.place.slice() }, rating: higherRating(base, donor) }
}

const LEVEL = { g: 0, s: 1, q: 2, e: 3 } as const
const higherRating = (a: Scene, b: Scene): Scene['rating'] => (LEVEL[b.rating] > LEVEL[a.rating] ? b.rating : a.rating)

/** An outfit of the library (ScenePackArgs.outfitLibrary) as a scene that lends only its clothes. */
export interface LibraryDonor extends Scene {
  /** The library outfit's id (PackPrompt.outfitId). */
  outfitId: number
  style?: string
}

/** Post ids of library donors are negative, so no real post shares one: -1 - outfitId. */
export const libraryDonorId = (outfitId: number): number => -1 - outfitId

export function libraryDonor(outfit: { outfitId: number; tags: readonly string[]; style?: string }): LibraryDonor {
  const units: SceneUnits = { skeleton: [], face: [], camera: [], outfit: Array.from(new Set(outfit.tags.map(normalizeTagForPack).filter(Boolean))), exposure: [], body: [], place: [], extras: [], loose: [] }
  return { postId: libraryDonorId(outfit.outfitId), rating: 'g', people: null, pairing: [], units, anchors: [], outfitId: outfit.outfitId, ...(outfit.style ? { style: outfit.style } : {}) }
}

export const isLibraryDonor = (scene: Scene): scene is LibraryDonor => scene.postId < 0 && 'outfitId' in scene

/** A comparable key for a lent value. */
export const valueKey = (tags: readonly string[]): string => Array.from(new Set(tags)).sort().join('|')

/**
 * Donors in the order a pack tries them for each prompt, without taking them out: by group (the
 * pack's own scenes, then scenes of the condition's searches, then library outfits; partial donors
 * after full ones), then the one whose value is farthest from every value already in the pack, ties
 * in a seeded order. A value accepted for a prompt is never lent again.
 */
export class ConditionQueue {
  private readonly nearest = new Map<number, number>()
  private readonly used = new Set<string>()
  private readonly entries: Array<{ scene: Scene; value: string[]; key: string; group: number; tie: number }>

  constructor(candidates: ReadonlyArray<{ scene: Scene; value: string[]; group: number }>, rng: () => number) {
    this.entries = candidates.map((c) => ({ ...c, key: valueKey(c.value), tie: rng() }))
    this.entries.forEach((e) => this.nearest.set(e.scene.postId, 1))
  }

  get size(): number {
    return this.entries.length
  }

  /** Values still free, in the order to try them; `fits` filters per prompt without using anything up. */
  ordered(fits: (scene: Scene) => boolean = () => true): Array<{ scene: Scene; value: string[]; key: string; group: number }> {
    return this.entries
      .filter((e) => !this.used.has(e.key) && fits(e.scene))
      .sort((a, b) => a.group - b.group || (this.nearest.get(b.scene.postId) ?? 1) - (this.nearest.get(a.scene.postId) ?? 1) || a.tie - b.tie)
  }

  isUsed(value: readonly string[]): boolean {
    return this.used.has(valueKey(value))
  }

  /** A value now in the pack: it isn't lent again, and the others measure their distance to it. */
  accept(value: readonly string[]): void {
    this.used.add(valueKey(value))
    for (const e of this.entries) {
      const distance = 1 - jaccard(e.value, value)
      if (distance < (this.nearest.get(e.scene.postId) ?? 1)) this.nearest.set(e.scene.postId, distance)
    }
  }
}
