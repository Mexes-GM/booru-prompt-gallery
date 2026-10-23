/**
 * Booru tags -> structured scene, the intermediate representation every
 * natural-language renderer reads from.
 *
 * Deterministic and dependency-free: no model call, no network. Each input tag
 * ends up in exactly one place (a scene slot, `unclassified`, or `dropped`), so
 * a renderer can prove it lost nothing and the eval can measure coverage.
 *
 * Slots come from the 33-slot taxonomy (`lib/tag-taxonomy.ts`) through the same
 * `overrides` dictionary the rest of the app uses (tag -> "category:subcategory").
 * Character, series and artist names come from the post's own tag fields, which
 * the booru already separates, instead of being guessed.
 */
import { getTagSlotFromOverrides, TAG_SUBCATEGORIES } from "@/lib/tag-taxonomy"
import { isClothingState } from "./english"

export interface NaturalPromptInput {
  /** General tags, as on the post (underscores or spaces). */
  general: string[]
  characters?: string[]
  copyrights?: string[]
  artists?: string[]
  /** Booru rating letter: g, s, q or e. */
  rating?: string
}

export type SceneSlot = (typeof TAG_SUBCATEGORIES)[keyof typeof TAG_SUBCATEGORIES][number]

export interface SceneCharacter {
  /** Original tag, lowercase with spaces ("kashima (kancolle)"). */
  tag: string
  /** Display name without qualifiers ("Kashima"). */
  name: string
}

export interface CameraParts {
  framing: string[]
  angle: string[]
  gaze: string[]
}

export interface Scene {
  girls: number
  boys: number
  others: number
  /** Count and costume tags (1girl, solo, cosplay...), kept verbatim for tag renderers. */
  subjectTags: string[]
  /** Quality and score tags from AI-generated prompts (masterpiece, score_9...); tag renderers keep them. */
  quality: string[]
  /** One entry per person: costume variants of the same character are merged. */
  characters: SceneCharacter[]
  /** Every character tag as given, costume variants included (tag renderers keep them). */
  characterTags: string[]
  /** Characters someone is dressed as ("x (cosplay)" tags), not extra people. */
  cosplayAs: string[]
  series: string[]
  artists: string[]
  rating?: string
  /** Tags per taxonomy slot, in input order. Camera tags live in `camera`. */
  slots: Partial<Record<SceneSlot, string[]>>
  camera: CameraParts
  /** Tags the taxonomy does not know (rendered as-is so nothing is lost). */
  unclassified: string[]
  /** Tags removed on purpose (meta tags such as highres or commentary). */
  dropped: string[]
  /**
   * Traits moved out of `slots` to the character they belong to (see
   * `attributeTraits`). Empty unless several characters have trait profiles.
   */
  assigned: { character: SceneCharacter; slots: Partial<Record<SceneSlot, string[]>> }[]
}

/**
 * Per character, how often each general tag appears on its posts (0-1), e.g.
 * { "hatsune miku": { "twintails": 0.83, "aqua hair": 0.51 } }. Built from
 * Danbooru's related tags (scripts/natural-prompt-eval/traits/).
 */
export type CharacterTraits = Record<string, Record<string, number>>

export interface BuildSceneOptions {
  /** Enables per-character attribution of hair, eyes, body and outfit tags. */
  traits?: CharacterTraits
}

/** Lowercase, spaces instead of underscores, booru escapes removed. */
export function normalizeTag(tag: string): string {
  return tag.toLowerCase().replace(/_/g, " ").replace(/\\([()])/g, "$1").replace(/\s{2,}/g, " ").trim()
}

// "1girl", "2boys", and Rule34's "1girls", "1female", "1futa", "1boy1girl".
const COUNT_RE = /^(\d+)\+?(girl|boy|other|female|male|futa)s?$/
const PAIR_COUNT_RE = /^(\d+)(boy|girl)(\d+)(boy|girl)s?$/
const COUNT_WORDS = new Set([
  "solo", "multiple girls", "multiple boys", "multiple others", "solo focus", "male focus", "female focus",
  // Gender tags as other boorus write them (Rule34, Gelbooru): subject information, not description.
  "female", "male", "solo female", "solo male", "female only", "male only",
  // Rule34 pairing and species-scope tags ("straight" there means a man and a woman).
  "male/female", "female/female", "male/male", "human", "human only", "hetero", "straight", "humanoid only",
])
const COSTUME_WORDS = new Set(["cosplay", "alternate costume", "official alternate costume", "alternate hairstyle", "costume switch"])

// Framing tags that the taxonomy stores outside pose:camera (e.g. "upper body"
// is filed under appearance:anatomy) still belong to the camera.
const FRAMING_RE = /(^|\s)(shot|portrait|close-up|upper body|lower body|full body|out of frame|wide shot|profile)$/
const ANGLE_RE = /^(from (above|below|side|behind|outside)|dutch angle|pov|straight-on|sideways|upside-down|fisheye|foreshortening|perspective)$/
const GAZE_RE = /^(looking |eye contact|facing |looking$)/
const EFFECT_RE = /^(depth of field|bokeh|blurry|blurry background|blurry foreground|motion blur|chromatic aberration|film grain|lens flare)$/

// Meta tags that describe the file or the post, not the picture.
const QUALITY_RE = /^(masterpiece|best quality|high quality|good quality|normal quality|amazing quality|very aesthetic|aesthetic|newest|recent|score \d+( up)?|score_\d+(_up)?|year \d{4})$/
const META_RE = /(commentary|translat|request|^bad |md5|duplicate|revision|third-party|^highres$|^absurdres$|^lowres$|resolution|^tagme$|^check |^official art$|^variant set$|^image sample$|^paid reward)/

/** "rapi (red hood) (nikke)" -> "Rapi". */
function displayName(tag: string): string {
  return titleCase(tag.replace(/(\s*\([^)]*\))+$/, ""))
}

const COSPLAY_RE = /^(.+?) \(cosplay\)$/

const SMALL_WORDS = new Set(["x", "of", "the", "no", "to", "and", "in", "a", "an", "on", "wo", "ga", "wa", "de", "na"])

/** "spy x family" -> "Spy x Family", "fate/grand order" -> "Fate/Grand Order". */
export function titleCase(text: string): string {
  return text
    .split(" ")
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.replace(/(^|[/-])([a-z])/g, (_, sep, c) => sep + c.toUpperCase())))
    .join(" ")
}

/** "tsunade (naruto)" -> "naruto"; costume qualifiers such as "(cosplay)" are not series. */
function qualifier(tag: string): string | null {
  const m = tag.match(/\(([^)]+)\)$/)
  return m && !/^(cosplay|costume|swimsuit|young|adult|alternate|human|male|female)\b/.test(m[1]) ? m[1] : null
}

function seriesNames(copyrights: string[]): string[] {
  const names = copyrights.map(normalizeTag).map((c) => titleCase(c.replace(/\s*\([^)]*\)$/, "")))
  // "arknights" + "arknights: endfield": keep the more specific one.
  return names.filter((n, i) => !names.some((o, j) => j !== i && o.length > n.length && o.toLowerCase().startsWith(n.toLowerCase())))
}

/** Slot for a tag that the taxonomy left unresolved or only knows the category of. */
function fallbackSlot(tag: string, category?: string): SceneSlot | null {
  if (/ hair$|^(bangs|ahoge|ponytail|twintails|braid|hair bun|sidelocks)$/.test(tag)) return "hair"
  if (/ eyes$|^heterochromia$/.test(tag)) return "eyes"
  if (/ (lighting|light)$|^(backlighting|sunlight|moonlight|shadow|lens flare|light rays)$/.test(tag)) return "atmosphere"
  if (/ background$/.test(tag)) return "setting"
  if (/^holding /.test(tag)) return "handheld"
  switch (category) {
    case "appearance": return "anatomy"
    case "clothing": return "accents"
    case "equipment": return "handheld"
    case "pose": return "posture"
    case "scenery": return "props"
    case "creature": return "animal"
    default: return null
  }
}

export function buildScene(input: NaturalPromptInput, overrides: Record<string, string>, options: BuildSceneOptions = {}): Scene {
  const characterTags = (input.characters ?? []).map(normalizeTag)
  const copyrightTags = new Set((input.copyrights ?? []).map(normalizeTag))
  const artistTags = new Set((input.artists ?? []).map(normalizeTag))
  const characterSet = new Set(characterTags)

  // Danbooru tags both the cosplayer and the character being cosplayed, and
  // each costume variant separately; neither is an extra person.
  const cosplayNames = new Set(input.general.map(normalizeTag).flatMap((t) => {
    const m = t.match(COSPLAY_RE)
    return m ? [displayName(m[1])] : []
  }))
  const characters: SceneCharacter[] = []
  for (const tag of characterTags) {
    const name = displayName(tag)
    if (cosplayNames.has(name) || characters.some((c) => c.name === name)) continue
    characters.push({ tag, name })
  }

  const scene: Scene = {
    girls: 0,
    boys: 0,
    others: 0,
    subjectTags: [],
    quality: [],
    characters,
    characterTags,
    cosplayAs: [...cosplayNames],
    // Without copyright tags (a pasted prompt), the character qualifiers still name the series.
    series: seriesNames(input.copyrights?.length ? input.copyrights : [...new Set(characterTags.map(qualifier).filter((q): q is string => !!q))]),
    artists: [...artistTags],
    rating: input.rating,
    slots: {},
    camera: { framing: [], angle: [], gaze: [] },
    unclassified: [],
    dropped: [],
    assigned: [],
  }

  const seen = new Set<string>()
  for (const raw of input.general) {
    const tag = normalizeTag(raw)
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    // Providers without split tag fields mix names into the general list.
    if (characterSet.has(tag) || copyrightTags.has(tag) || artistTags.has(tag)) continue

    // Boorus that tag both "1girl" and "1girls" would double the count, so each
    // gender keeps the largest number seen instead of a sum.
    const pair = tag.match(PAIR_COUNT_RE)
    const count = tag.match(COUNT_RE)
    if (pair || count) {
      const counts = pair ? [[pair[1], pair[2]], [pair[3], pair[4]]] : [[count![1], count![2]]]
      for (const [n, who] of counts) {
        if (who === "girl" || who === "female" || who === "futa") scene.girls = Math.max(scene.girls, Number(n))
        else if (who === "boy" || who === "male") scene.boys = Math.max(scene.boys, Number(n))
        else scene.others = Math.max(scene.others, Number(n))
      }
      scene.subjectTags.push(tag)
      continue
    }
    if (COSPLAY_RE.test(tag) || COSTUME_WORDS.has(tag)) {
      // Rendered through `cosplayAs`; the generic costume tags carry nothing visual.
      scene.subjectTags.push(tag)
      continue
    }
    if (COUNT_WORDS.has(tag)) {
      scene.subjectTags.push(tag)
      continue
    }

    if (QUALITY_RE.test(tag) || QUALITY_RE.test(raw.trim().toLowerCase())) {
      scene.quality.push(raw.trim().toLowerCase().startsWith("score_") ? raw.trim().toLowerCase() : tag)
      continue
    }

    if (FRAMING_RE.test(tag)) { scene.camera.framing.push(tag); continue }
    if (ANGLE_RE.test(tag)) { scene.camera.angle.push(tag); continue }
    if (GAZE_RE.test(tag)) { scene.camera.gaze.push(tag); continue }

    // Hand-written tags ("lying on stomach") are not in the taxonomy; the suffix
    // fallback would file them by their last word (stomach -> anatomy), so a tag
    // that starts with a verb is read as a pose instead.
    if (!overrides[tag] && /^[a-z]+ing\b/.test(tag) && !/^(earring|ring|string|wing|ceiling|building|clothing|stocking)s?\b/.test(tag)) {
      push(scene, "posture", tag)
      continue
    }
    const exact = overrides[tag] ?? overrides[tag.replace(/ /g, "_")]
    const slot = getTagSlotFromOverrides(tag, overrides)
    // A name slot reached through the suffix fallback is a guess ("sakura haruno"
    // ends in an artist's name), so only an exact match may drop the tag.
    if (slot?.category === "other" && !exact) {
      scene.unclassified.push(tag)
      continue
    }
    if (slot?.category === "other" && (slot.subcategory === "meta" || slot.subcategory === "artist")) {
      scene.dropped.push(tag)
      continue
    }
    if (!slot && META_RE.test(tag)) {
      scene.dropped.push(tag)
      continue
    }
    // Optical effects are filed under camera or style in the taxonomy; prose treats them as atmosphere.
    if (EFFECT_RE.test(tag)) {
      push(scene, "atmosphere", tag)
      continue
    }
    if (slot?.subcategory === "camera") {
      scene.camera.framing.push(tag)
      continue
    }
    if (slot?.subcategory === "demographics") {
      // "1girl" and friends were handled above; what is left (e.g. "furry female") describes the subject.
      push(scene, "demographics", tag)
      continue
    }

    const known = slot?.subcategory as SceneSlot | undefined
    // A general tag filed as character/copyright is a franchise-specific item; keep it as-is.
    const resolved = known && known !== "character" && known !== "copyright"
      ? known
      : fallbackSlot(tag, slot?.category)
    if (resolved) push(scene, resolved, tag)
    else scene.unclassified.push(tag)
  }

  if (options.traits) attributeTraits(scene, options.traits)
  return scene
}

const ATTRIBUTABLE_SLOTS: SceneSlot[] = [
  "hair", "eyes", "anatomy",
  "outfit", "top", "bottom", "underwear", "legwear", "footwear", "headwear", "eyewear", "accents",
  "weapon", "handheld",
]
// A trait goes to a character when it appears on at least MIN_SHARE of that
// character's posts and MIN_RATIO times more often than for the next one.
const MIN_SHARE = 0.15
const MIN_RATIO = 1.5
// With a named character we know nothing about, a trait could be theirs: ask for more.
const MIN_SHARE_WITH_UNKNOWN = 0.3

/**
 * Booru tags are one flat list, so "aqua hair, blonde hair" does not say who
 * has which. Each character's trait profile does: Hatsune Miku's posts carry
 * "aqua hair" far more often than Kagamine Rin's. Tags with a clear owner move
 * from `slots` to `assigned`; ambiguous ones stay shared. Costume posts
 * (cosplay, alternate costume) only attribute hair, eyes and body, since the
 * outfit is not the character's usual one; genderswap posts only hair and eyes.
 */
export function attributeTraits(scene: Scene, traits: CharacterTraits): void {
  const profiled = scene.characters.flatMap((character) => (traits[character.tag] ? [{ character, profile: traits[character.tag] }] : []))
  if (scene.characters.length < 2 || profiled.length < 2) return
  const minShare = profiled.length < scene.characters.length ? MIN_SHARE_WITH_UNKNOWN : MIN_SHARE
  const costume = scene.subjectTags.some((t) => /cosplay|alternate costume/.test(t))
  const genderswap = [...Object.values(scene.slots).flat(), ...scene.unclassified].some((t) => t?.startsWith("genderswap"))
  const slots = genderswap ? ATTRIBUTABLE_SLOTS.slice(0, 2) : costume ? ATTRIBUTABLE_SLOTS.slice(0, 3) : ATTRIBUTABLE_SLOTS
  const owners = new Map(profiled.map(({ character }) => [character.tag, { character, slots: {} as Partial<Record<SceneSlot, string[]>> }]))

  for (const slot of slots) {
    const shared: string[] = []
    for (const tag of scene.slots[slot] ?? []) {
      // "bare shoulders", "sleeveless": how the outfit is worn, not an item someone owns.
      if (isClothingState(tag)) { shared.push(tag); continue }
      const [best, second] = profiled
        .map(({ character, profile }) => ({ character, share: profile[tag] ?? 0 }))
        .sort((a, b) => b.share - a.share)
      if (best.share >= minShare && best.share >= MIN_RATIO * (second?.share ?? 0)) {
        ;((owners.get(best.character.tag)!.slots[slot] ??= [])).push(tag)
      } else {
        shared.push(tag)
      }
    }
    if (scene.slots[slot]) scene.slots[slot] = shared
  }
  scene.assigned = [...owners.values()].filter((o) => Object.keys(o.slots).length > 0)
}

const nameIndexes = new WeakMap<Record<string, string>, Map<string, string | null>>()

/** "tsunade" -> "tsunade (naruto)" when exactly one character tag has that base name. */
function characterByBaseName(base: string, overrides: Record<string, string>): string | null {
  let index = nameIndexes.get(overrides)
  if (!index) {
    index = new Map()
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== "other:character") continue
      const m = key.replace(/_/g, " ").match(/^(.+?) \([^)]+\)$/)
      if (!m) continue
      // Two characters sharing a base name are ambiguous: remember that with null.
      index.set(m[1], index.has(m[1]) && index.get(m[1]) !== key ? null : key.replace(/_/g, " "))
    }
    nameIndexes.set(overrides, index)
  }
  return index.get(base) ?? null
}

/**
 * "(smile:1.2)" -> "smile", "((smile))" -> "smile". Only wrapping brackets go:
 * the qualifier in "2d_(artwork)" is part of the tag.
 */
function stripWeight(piece: string): string {
  let text = piece.trim()
  const opening = text.match(/^[([{]+/)?.[0].length ?? 0
  if (opening) text = text.slice(opening).replace(new RegExp(`[)\\]}]{0,${opening}}$`), "")
  return text.replace(/:\s*[\d.]+$/, "").trim()
}

/**
 * Splits a pasted prompt ("1girl, sakura haruno, (smile:1.2), @artist") into the
 * fields a post would carry. Weights are removed; names are found by exact tag,
 * by swapped given/family name ("sakura haruno" -> "haruno sakura"), or by base
 * name ("tsunade" -> "tsunade (naruto)").
 */
export function splitPromptTags(
  prompt: string,
  overrides: Record<string, string>,
  options: { guessNames?: boolean } = {},
): NaturalPromptInput {
  // Booru posts (Rule34, Gelbooru) spell names exactly; only hand-written prompts need guessing.
  const guessNames = options.guessNames ?? true
  const input = { general: [] as string[], characters: [] as string[], copyrights: [] as string[], artists: [] as string[] }
  const kindOf = (t: string) => overrides[t] ?? overrides[t.replace(/ /g, "_")]
  const unknown: { tag: string; cleaned: string }[] = []
  for (const piece of prompt.split(",")) {
    const cleaned = stripWeight(piece)
    const tag = normalizeTag(cleaned)
    if (!tag) continue
    if (tag.startsWith("@")) { input.artists.push(tag.slice(1).trim()); continue }
    const kind = kindOf(tag)
    if (kind === "other:character") input.characters.push(tag)
    else if (kind === "other:copyright") input.copyrights.push(tag)
    else if (kind === "other:artist") input.artists.push(tag)
    else if (!kind && guessNames) unknown.push({ tag, cleaned })
    // The original spelling goes on, so score tags keep their underscores.
    else input.general.push(cleaned)
  }
  // Guesses run last so they can check the series the prompt names: a base-name
  // match whose series is not among them ("lifeguard" -> "lifeguard (lilo & stitch)"
  // in an Overwatch prompt) is a coincidence, not the character.
  const series = new Set(input.copyrights)
  for (const { tag, cleaned } of unknown) {
    const words = tag.split(" ")
    const swapped = words.length === 2 ? `${words[1]} ${words[0]}` : null
    const byBase = characterByBaseName(tag, overrides)
    if (swapped && kindOf(swapped) === "other:character") input.characters.push(swapped)
    else if (byBase && (series.size === 0 || series.has(qualifier(byBase) ?? ""))) input.characters.push(byBase)
    else input.general.push(cleaned)
  }
  return input
}

function push(scene: Scene, slot: SceneSlot, tag: string) {
  ;(scene.slots[slot] ??= []).push(tag)
}

/** Every tag the scene will render (everything except `dropped`). */
export function sceneTagCount(scene: Scene): number {
  const slotTags = [...Object.values(scene.slots), ...scene.assigned.flatMap((a) => Object.values(a.slots))]
    .reduce((n, tags) => n + (tags?.length ?? 0), 0)
  const camera = scene.camera.framing.length + scene.camera.angle.length + scene.camera.gaze.length
  return slotTags + camera + scene.unclassified.length + scene.subjectTags.length + scene.quality.length
}
