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
  /** Position in public/outfits.json, which is also its index in outfit-descriptions.json. */
  id: number
  style: OutfitStyle
  slots: Partial<Record<OutfitSlot, string[]>>
}

export interface OutfitSettings {
  mode: OutfitMode
  styles: readonly OutfitStyle[]
  detail: OutfitDetail
  library: readonly Outfit[]
  /** Plain-English description per outfit id, for the natural-language formats. */
  descriptions?: readonly string[]
}

export interface PickedOutfit {
  id: number
  tags: string[]
  /** The outfit in sentences, trimmed like the tags; absent until descriptions load. */
  description?: string
}

/** Parses public/outfits.json: `{ styles, slots, outfits: [styleIndex, [[slotIndex, tags]]][] }`. */
export function parseOutfitLibrary(raw: unknown): Outfit[] {
  const data = raw as { styles?: string[]; slots?: string[]; outfits?: [number, [number, string[]][]][] }
  if (!Array.isArray(data?.styles) || !Array.isArray(data?.slots) || !Array.isArray(data?.outfits)) return []
  const outfits: Outfit[] = []
  data.outfits.forEach(([styleIndex, slotList], id) => {
    const style = data.styles![styleIndex] as OutfitStyle
    if (!OUTFIT_STYLES.includes(style) || !Array.isArray(slotList)) return
    const slots: Outfit["slots"] = {}
    for (const [slotIndex, tags] of slotList) {
      const slot = data.slots![slotIndex] as OutfitSlot
      if (OUTFIT_SLOTS.includes(slot) && Array.isArray(tags) && tags.length > 0) slots[slot] = tags
    }
    if (Object.keys(slots).length > 0) outfits.push({ id, style, slots })
  })
  return outfits
}

/** Parses public/outfit-descriptions.json: `{ descriptions: string[] }`, indexed by outfit id. */
export function parseOutfitDescriptions(raw: unknown): string[] {
  const list = (raw as { descriptions?: unknown })?.descriptions
  return Array.isArray(list) ? list.map((d) => (typeof d === "string" ? d : "")) : []
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
    const want = new Set(wanted)
    const kept = styles.filter((s) => want.has(s))
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

/** Slots the post's framing can't show: shoes and legwear in close shots, shoes in a cowboy shot. */
function hiddenSlots(postTags: readonly string[]): Set<OutfitSlot> {
  const set = new Set(postTags.map(norm))
  const hidden = new Set<OutfitSlot>()
  if ([...set].some((t) => CLOSE_FRAMING.has(t))) hidden.add("footwear").add("legwear")
  else if ([...set].some((t) => MID_FRAMING.has(t))) hidden.add("footwear")
  return hidden
}

/** Tags of one outfit at the chosen detail, without what the framing can't show. */
export function outfitTags(outfit: Outfit, detail: OutfitDetail, postTags: readonly string[] = []): string[] {
  const hidden = hiddenSlots(postTags)

  // Lingerie sets have no top or bottom: underwear is their main garment.
  const main: readonly OutfitSlot[] = outfit.slots.outfit || outfit.slots.top || outfit.slots.bottom ? SIMPLE_SLOTS : [...SIMPLE_SLOTS, "underwear"]
  const slots = new Set<OutfitSlot>(detail === "simple" ? main : OUTFIT_SLOTS)
  // Tags inside a slot are ordered most-certain first, and the later ones
  // often restate the garment ("turtleneck", "turtleneck sweater").
  const perSlot = detail === "simple" ? SIMPLE_TAGS_PER_SLOT : Infinity
  return OUTFIT_SLOTS
    .filter((slot) => slots.has(slot) && !hidden.has(slot))
    .flatMap((slot) => (outfit.slots[slot] ?? []).slice(0, perSlot))
}

// What a description sentence is about: the first garment word it names.
// Descriptions go garment by garment, so the first one is the sentence's subject
// ("A dress with a belt" is about the dress, "lace-top stockings" about stockings).
const SENTENCE_KINDS: { kind: "main" | "footwear" | "legwear" | "accessory"; re: RegExp }[] = [
  { kind: "main", re: /\b(?:dress|gown|(?<![-\w])top|shirt|blouse|skirt|pants|trousers|shorts|jeans|sweater|cardigan|jacket|coat|blazer|vest|hoodie|bikini|swimsuit|bra|panties|briefs|thong|corset|bodysuit|jumpsuit|romper|camisole|teddy|babydoll|negligee|robe|kimono|leotard|bodice|overalls|outfit)s?\b/i },
  { kind: "footwear", re: /\b(?:shoes|boots|heels|sandals|sneakers|loafers|pumps|flats|slippers|mules|wedges|stilettos|footwear)\b/i },
  { kind: "legwear", re: /\b(?:stockings|thigh-highs?|thighhighs|tights|pantyhose|socks|leggings|legwear|garters?|fishnets|leg warmers)\b/i },
  { kind: "accessory", re: /\b(?:bag|handbag|purse|clutch|tote|backpack|basket|necklace|earrings?|bracelets?|rings?|choker|pendant|jewelry|sunglasses|glasses|hat|cap(?! sleeves?)|beret|beanie|headband|scarf|gloves|belt|watch|earmuffs|tiara|crown|brooch|anklet|accessor(?:y|ies))\b/i },
]

function sentenceKind(sentence: string): (typeof SENTENCE_KINDS)[number]["kind"] | null {
  let best: { kind: (typeof SENTENCE_KINDS)[number]["kind"]; at: number } | null = null
  for (const { kind, re } of SENTENCE_KINDS) {
    const at = sentence.search(re)
    if (at !== -1 && (!best || at < best.at)) best = { kind, at }
  }
  return best?.kind ?? null
}

/**
 * The description trimmed like the tags: "simple" keeps the main garments and
 * shoes, and sentences about what the framing hides are left out.
 */
export function outfitDescription(text: string, detail: OutfitDetail, postTags: readonly string[] = []): string {
  const hidden = hiddenSlots(postTags)
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => {
      const kind = sentenceKind(sentence)
      if (kind === "footwear") return !hidden.has("footwear")
      if (kind === "legwear") return detail === "full" && !hidden.has("legwear")
      if (kind === "accessory") return detail === "full"
      return true
    })
    .join(" ")
}

/**
 * The outfit for one post, or null when the post keeps its own clothes.
 * Seeded by the post id, so a card shows the same outfit every time.
 */
export function pickOutfit(postTags: readonly string[], settings: OutfitSettings | undefined, seed: number): PickedOutfit | null {
  if (!settings || settings.mode !== "random" || settings.library.length === 0 || settings.styles.length === 0) return null
  if (!isOutfitEligible(postTags)) return null
  const styles = stylesForScene(new Set(postTags.map(norm)), settings.styles)
  const styleSet = new Set(styles)
  const pool = settings.library.filter((o) => styleSet.has(o.style))
  if (pool.length === 0) return null
  // Offset from the background's seed so the two picks aren't correlated.
  const outfit = pool[Math.floor(seededRandom(seed * 31 + 7)() * pool.length)]
  const tags = outfitTags(outfit, settings.detail, postTags)
  if (tags.length === 0) return null
  const text = settings.descriptions?.[outfit.id]
  const description = text ? outfitDescription(text, settings.detail, postTags) : ""
  return { id: outfit.id, tags, ...(description ? { description } : {}) }
}

/** Styles with adult content, left out of safe-for-work packs. */
export const ADULT_OUTFIT_STYLES: readonly OutfitStyle[] = ["lingerie", "sexy"]

/**
 * A random draw of whole outfits for Pack Mode's clothing pool: `size` outfits
 * of the chosen styles at the chosen detail, each with its tag list. The same
 * seed gives the same draw, so a new seed is "pick other outfits".
 */
export function outfitPackDraw(
  library: readonly Outfit[],
  styles: readonly OutfitStyle[],
  detail: OutfitDetail,
  seed: number,
  size: number,
): { outfit: Outfit; tags: string[] }[] {
  const styleSet = new Set(styles)
  const pool = library.filter((o) => styleSet.has(o.style))
  const rng = seededRandom(seed)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, size).map((outfit) => ({ outfit, tags: outfitTags(outfit, detail) })).filter((o) => o.tags.length > 0)
}

/** The tag lists of outfitPackDraw. */
export function outfitPackPool(
  library: readonly Outfit[],
  styles: readonly OutfitStyle[],
  detail: OutfitDetail,
  seed: number,
  size: number,
): string[][] {
  return outfitPackDraw(library, styles, detail, seed, size).map((o) => o.tags)
}

/** The outfit slots each kind of description sentence is about. */
const SENTENCE_SLOTS: Record<(typeof SENTENCE_KINDS)[number]["kind"], readonly OutfitSlot[]> = {
  main: ["outfit", "top", "bottom", "underwear"],
  footwear: ["footwear"],
  legwear: ["legwear"],
  accessory: ["headwear", "eyewear", "accents", "handheld"],
}

/** A prompt tag without its weight: "(red dress:1.2)" -> "red dress". */
const bareTag = (tag: string) => norm(/^\s*\((.+):\s*-?\d+(?:\.\d+)?\)\s*$/.exec(tag)?.[1] ?? tag)

/**
 * A library outfit's sentences for one Pack Mode prompt. Pack prompts lose
 * outfit tags to the detail level, muted slots and the cleaner, so a sentence
 * stays only while the prompt still has a tag from the part of the outfit it
 * is about. Undefined when none of the outfit's tags made it into the prompt.
 */
export function packOutfitDescription(outfit: Outfit, text: string, prompt: string): string | undefined {
  const present = new Set(prompt.split(",").map(bareTag))
  const shown = (slots: readonly OutfitSlot[]) => slots.some((slot) => (outfit.slots[slot] ?? []).some((t) => present.has(norm(t))))
  if (!text || !shown(OUTFIT_SLOTS)) return undefined
  const kept = text.split(/(?<=[.!?])\s+/).filter((sentence) => {
    const kind = sentenceKind(sentence)
    return !kind || shown(SENTENCE_SLOTS[kind])
  })
  return kept.join(" ") || undefined
}

/**
 * The outfit's sentences for a card's natural-language prompt, only while its
 * tags are still in that prompt (an exclusion or edit can take them out).
 */
export function liveOutfitDescription(prompt: string, outfitTags: readonly string[] | null, description: string | null): string | undefined {
  if (!description || !outfitTags?.length) return undefined
  const present = new Set(prompt.split(",").map(norm))
  return outfitTags.some((t) => present.has(norm(t))) ? description : undefined
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

/** Glasses are too: a character who wears them keeps them, and the outfit's own are left out. */
const EYEWEAR_RE = /(?:glasses|eyewear|goggles|monocle|pince-nez)$/
const isEyewear = (tag: string) => EYEWEAR_RE.test(tag)

/** "uruha (6th costume)", "alternate costume": a named costume the new outfit replaces. */
export const COSTUME_TAG_RE = /\((?:[\w-]+ )*costume\)$|^(?:official )?alternate costume$/
const isCostumeTag = (tag: string) => COSTUME_TAG_RE.test(tag)

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
  let keepsEyewear = false
  for (const tag of tags) {
    const n = norm(tag)
    if (isCostumeTag(n)) continue
    const category = classifyTag(n, tagOverrides)
    const kept = isHairAccessory(n) || isEyewear(n)
    if (kept && isEyewear(n)) keepsEyewear = true
    const isClothing = category === "clothing" && !kept
    const isAction = (category === "pose" || category === "other") && isGarmentAction(n)
    if (isClothing || isAction) {
      if (isClothing && clothingAt === -1) clothingAt = result.length
      continue
    }
    if (afterAppearance === -1 && category !== "appearance") afterAppearance = result.length
    result.push(tag)
  }
  const present = new Set(result.map(norm))
  const added = outfit.filter((t) => !present.has(norm(t)) && !(keepsEyewear && isEyewear(norm(t))))
  const insertAt = clothingAt !== -1 ? clothingAt : afterAppearance !== -1 ? afterAppearance : result.length
  result.splice(insertAt, 0, ...added)
  return result
}
