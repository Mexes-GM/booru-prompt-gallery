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
}

/** Lowercase, spaces instead of underscores, booru escapes removed. */
export function normalizeTag(tag: string): string {
  return tag.toLowerCase().replace(/_/g, " ").replace(/\\([()])/g, "$1").replace(/\s{2,}/g, " ").trim()
}

const COUNT_RE = /^(\d+)\+?(girl|boy|other)s?$/
const COUNT_WORDS = new Set(["solo", "multiple girls", "multiple boys", "multiple others", "solo focus", "male focus", "female focus"])
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

export function buildScene(input: NaturalPromptInput, overrides: Record<string, string>): Scene {
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
    series: seriesNames(input.copyrights ?? []),
    artists: [...artistTags],
    rating: input.rating,
    slots: {},
    camera: { framing: [], angle: [], gaze: [] },
    unclassified: [],
    dropped: [],
  }

  const seen = new Set<string>()
  for (const raw of input.general) {
    const tag = normalizeTag(raw)
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    // Providers without split tag fields mix names into the general list.
    if (characterSet.has(tag) || copyrightTags.has(tag) || artistTags.has(tag)) continue

    const count = tag.match(COUNT_RE)
    if (count) {
      const n = Number(count[1])
      if (count[2] === "girl") scene.girls += n
      else if (count[2] === "boy") scene.boys += n
      else scene.others += n
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
    const slot = getTagSlotFromOverrides(tag, overrides)
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

  return scene
}

function push(scene: Scene, slot: SceneSlot, tag: string) {
  ;(scene.slots[slot] ??= []).push(tag)
}

/** Every tag the scene will render (everything except `dropped`). */
export function sceneTagCount(scene: Scene): number {
  const slotTags = Object.values(scene.slots).reduce((n, tags) => n + (tags?.length ?? 0), 0)
  const camera = scene.camera.framing.length + scene.camera.angle.length + scene.camera.gaze.length
  return slotTags + camera + scene.unclassified.length + scene.subjectTags.length + scene.quality.length
}
