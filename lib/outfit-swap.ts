/**
 * "Random outfit": replaces the clothes of a single female subject with a
 * complete outfit from the outfit library (public/outfits.json).
 *
 * Split in two steps so the pure and display pipelines can never disagree:
 *   1. pickOutfit() runs ONCE per post (derivePostPrompt) and returns the tags
 *      to wear, or null when the post is left as it is.
 *   2. swapOutfit() runs in each pipeline, dropping the post's own clothing
 *      and putting the picked tags where it was.
 */
import { seededRandom } from "./color-theory"
import { NUDITY_TAGS, SEXUAL_ACT_TAGS } from "./background-context"
import { classifyTag } from "./tag-classifier"

export type OutfitMode = "keep" | "random"
export type OutfitDetail = "simple" | "full"

export const OUTFIT_STYLES = ["spring", "summer", "autumn", "winter", "party", "swimwear", "lingerie", "sexy"] as const
export type OutfitStyle = (typeof OUTFIT_STYLES)[number]
export const DEFAULT_OUTFIT_STYLES: OutfitStyle[] = ["spring", "summer", "autumn", "winter", "party", "swimwear"]

export const OUTFIT_SLOTS = [
  "outfit", "top", "bottom", "underwear", "legwear", "footwear", "headwear", "eyewear", "accents", "handheld",
] as const
export type OutfitSlot = (typeof OUTFIT_SLOTS)[number]

export interface Outfit {
  style: OutfitStyle
  slots: Partial<Record<OutfitSlot, string[]>>
}

export interface OutfitSettings {
  mode: OutfitMode
  styles: readonly OutfitStyle[]
  detail: OutfitDetail
  library: readonly Outfit[]
}

/** Parses public/outfits.json: `{ styles, slots, outfits: [styleIndex, [[slotIndex, tags]]][] }`. */
export function parseOutfitLibrary(raw: unknown): Outfit[] {
  const data = raw as { styles?: string[]; slots?: string[]; outfits?: [number, [number, string[]][]][] }
  if (!Array.isArray(data?.styles) || !Array.isArray(data?.slots) || !Array.isArray(data?.outfits)) return []
  const outfits: Outfit[] = []
  for (const [styleIndex, slotList] of data.outfits) {
    const style = data.styles[styleIndex] as OutfitStyle
    if (!OUTFIT_STYLES.includes(style) || !Array.isArray(slotList)) continue
    const slots: Outfit["slots"] = {}
    for (const [slotIndex, tags] of slotList) {
      const slot = data.slots[slotIndex] as OutfitSlot
      if (OUTFIT_SLOTS.includes(slot) && Array.isArray(tags) && tags.length > 0) slots[slot] = tags
    }
    if (Object.keys(slots).length > 0) outfits.push({ style, slots })
  }
  return outfits
}

const norm = (tag: string) => tag.toLowerCase().replace(/_/g, " ").replace(/\\(?=[()])/g, "").trim()

// ─── Who is in the picture ──────────────────────────────────────────────────

const COUNT_TAG = /^(\d+\+?)(girl|boy|other)s?$|^multiple (girls|boys|others)$/
const E621_COUNT = new Set(["duo", "trio", "group", "male", "intersex", "ambiguous gender", "andromorph", "gynomorph", "herm"])

/**
 * One clothed female subject: "1girl" with no other subject count, or e621's
 * "solo" + "female" without another gender. Nudity and depicted acts are left
 * alone, since dressing them changes what the post is.
 */
export function isOutfitEligible(tags: readonly string[]): boolean {
  const set = new Set(tags.map(norm))
  if ([...set].some((t) => SEXUAL_ACT_TAGS.has(t) || NUDITY_TAGS.has(t))) return false
  const counts = [...set].filter((t) => COUNT_TAG.test(t))
  if (counts.length > 0) return counts.length === 1 && counts[0] === "1girl"
  return set.has("solo") && set.has("female") && ![...set].some((t) => E621_COUNT.has(t))
}

// ─── Picking ────────────────────────────────────────────────────────────────

const WATER_SCENE = new Set(["beach", "ocean", "sea", "pool", "poolside", "swimming", "water park", "shore", "lake", "wading"])
const SNOW_SCENE = new Set(["snow", "snowing", "snowman", "winter", "christmas", "ski", "skiing"])

/** Styles that fit the post's scene: swimwear only by the water, winter clothes in the snow. */
function stylesForScene(tags: Set<string>, styles: readonly OutfitStyle[]): OutfitStyle[] {
  const prefer = (wanted: OutfitStyle[]) => {
    const kept = styles.filter((s) => wanted.includes(s))
    return kept.length > 0 ? kept : [...styles]
  }
  if ([...tags].some((t) => WATER_SCENE.has(t))) return prefer(["swimwear", "summer"])
  if ([...tags].some((t) => SNOW_SCENE.has(t))) return prefer(["winter"])
  const dry = styles.filter((s) => s !== "swimwear")
  return dry.length > 0 ? dry : [...styles]
}

const SIMPLE_SLOTS: readonly OutfitSlot[] = ["outfit", "top", "bottom", "footwear"]
const SIMPLE_TAGS_PER_SLOT = 2
const CLOSE_FRAMING = new Set(["portrait", "upper body", "close-up", "face", "headshot", "bust"])
const MID_FRAMING = new Set(["cowboy shot"])

/** Tags of one outfit at the chosen detail, without what the framing can't show. */
export function outfitTags(outfit: Outfit, detail: OutfitDetail, postTags: readonly string[] = []): string[] {
  const set = new Set(postTags.map(norm))
  const hidden = new Set<OutfitSlot>()
  if ([...set].some((t) => CLOSE_FRAMING.has(t))) hidden.add("footwear").add("legwear")
  else if ([...set].some((t) => MID_FRAMING.has(t))) hidden.add("footwear")

  // Lingerie sets have no top or bottom: underwear is their main garment.
  const main = outfit.slots.outfit || outfit.slots.top || outfit.slots.bottom ? SIMPLE_SLOTS : [...SIMPLE_SLOTS, "underwear"]
  const slots = detail === "simple" ? main : OUTFIT_SLOTS
  // Tags inside a slot are ordered most-certain first, and the later ones
  // often restate the garment ("turtleneck", "turtleneck sweater").
  const perSlot = detail === "simple" ? SIMPLE_TAGS_PER_SLOT : Infinity
  return OUTFIT_SLOTS
    .filter((slot) => slots.includes(slot) && !hidden.has(slot))
    .flatMap((slot) => (outfit.slots[slot] ?? []).slice(0, perSlot))
}

/**
 * The outfit tags for one post, or null when the post keeps its own clothes.
 * Seeded by the post id, so a card shows the same outfit every time.
 */
export function pickOutfit(postTags: readonly string[], settings: OutfitSettings | undefined, seed: number): string[] | null {
  if (!settings || settings.mode !== "random" || settings.library.length === 0 || settings.styles.length === 0) return null
  if (!isOutfitEligible(postTags)) return null
  const styles = stylesForScene(new Set(postTags.map(norm)), settings.styles)
  const pool = settings.library.filter((o) => styles.includes(o.style))
  if (pool.length === 0) return null
  // Offset from the background's seed so the two picks aren't correlated.
  const outfit = pool[Math.floor(seededRandom(seed * 31 + 7)() * pool.length)]
  const tags = outfitTags(outfit, settings.detail, postTags)
  return tags.length > 0 ? tags : null
}

// ─── Swapping ───────────────────────────────────────────────────────────────

/** Words that tie a pose to a garment ("skirt lift", "hand in pocket"). */
const GARMENT_WORDS = new Set([
  "clothes", "clothing", "shirt", "skirt", "dress", "pants", "shorts", "panties", "panty", "bra", "jacket", "coat",
  "hat", "hood", "collar", "sleeve", "sleeves", "pocket", "pockets", "strap", "straps", "kimono", "swimsuit", "bikini",
  "thighhighs", "pantyhose", "socks", "shoes", "boots", "scarf", "necktie", "tie", "gloves", "apron", "uniform",
  "cape", "cloak", "belt", "zipper", "hem", "buttons", "leotard", "bodysuit", "sweater", "hoodie", "vest", "underwear",
  "undressing", "dressing", "malfunction",
])

/** Hair accessories are part of how the character looks, so they stay. */
const isHairAccessory = (tag: string) => /^hair[ a-z]/.test(tag) || tag.startsWith("hairclip") || tag.startsWith("hairband")

function isGarmentAction(tag: string): boolean {
  return tag.split(/[\s-]+/).some((w) => GARMENT_WORDS.has(w))
}

/**
 * Drops the post's clothing (and poses that act on a garment) and inserts the
 * outfit where the clothing used to be, so the canonical order is kept.
 */
export function swapOutfit(tags: readonly string[], outfit: readonly string[] | null, tagOverrides?: Record<string, string>): string[] {
  if (!outfit || outfit.length === 0) return [...tags]
  const result: string[] = []
  let clothingAt = -1
  // With no clothing to replace, the outfit goes after the appearance tags.
  let afterAppearance = -1
  for (const tag of tags) {
    const n = norm(tag)
    const category = classifyTag(n, tagOverrides)
    const isClothing = category === "clothing" && !isHairAccessory(n)
    const isAction = (category === "pose" || category === "other") && isGarmentAction(n)
    if (isClothing || isAction) {
      if (isClothing && clothingAt === -1) clothingAt = result.length
      continue
    }
    if (afterAppearance === -1 && category !== "appearance") afterAppearance = result.length
    result.push(tag)
  }
  const present = new Set(result.map(norm))
  const added = outfit.filter((t) => !present.has(norm(t)))
  const insertAt = clothingAt !== -1 ? clothingAt : afterAppearance !== -1 ? afterAppearance : result.length
  result.splice(insertAt, 0, ...added)
  return result
}
