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
import { HAIR_COLOR_RE, isClothingState, splitHairCompound } from "./english"
import { GENDER_AFFINITY } from "./gender-affinity"
import { CROSSDRESSING_RE, FUTA_RE, genderedTraits, personNoun, ruleGender } from "./people"

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
  /** Original tag, lowercase with spaces ("kashima (kancolle)"); empty for someone unnamed. */
  tag: string
  /** Display name without qualifiers ("Kashima"), or how to call someone unnamed ("the woman"). */
  name: string
  /** When the count tags, a "(male)" qualifier or the trait profile tell (see `assignGenders`). */
  gender?: "female" | "male"
  /** Someone the count tags say is there but no character tag names ("the woman"). */
  generic?: boolean
  /** Several unnamed people of one gender, described together ("the women"). */
  plural?: boolean
  /** The futanari of a post with no man: the male anatomy is hers. */
  futa?: boolean
  /** How many people an unnamed entry stands for. */
  count?: number
  /**
   * An unnamed woman or man who may be one of the named characters (whose gender
   * is unknown): takes only what gender alone decides, never a profile's traits.
   */
  standIn?: boolean
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
  /** Series names for prose ("Pokemon", not "Nintendo and Pokemon"; never "Original" or "Patreon"). */
  series: string[]
  /** Copyright tags as given, less sites and misfiled text tags (tag renderers keep them). */
  copyrightTags: string[]
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
   * Everyone a trait can belong to: the named characters, then the unnamed people
   * the count tags leave ("the woman", "the men"). Empty for one person.
   */
  people: SceneCharacter[]
  /**
   * Traits moved out of `slots` to the person they belong to (see
   * `attributeTraits`), in `people` order. Empty with fewer than two people.
   */
  assigned: { character: SceneCharacter; slots: Partial<Record<SceneSlot, string[]>> }[]
}

/**
 * Per tag, the share of a woman's and of a man's solo posts that carry it, in
 * general and in adult posts: [woman, man, woman adult, man adult].
 */
export type GenderAffinity = Record<string, readonly [number, number, number, number]>

/**
 * Per character, how often each general tag appears on its posts (0-1), e.g.
 * { "hatsune miku": { "twintails": 0.83, "aqua hair": 0.51 } }. Built from
 * Danbooru's related tags (scripts/natural-prompt-eval/traits/).
 */
export type CharacterTraits = Record<string, Record<string, number>>

export interface BuildSceneOptions {
  /** Per-character profiles for attributing hair, eyes, body and outfit tags between named characters. */
  traits?: CharacterTraits
  /** Generic gender profiles (defaults to the bundled GENDER_AFFINITY); `{}` leaves only the tags and rules. */
  genderAffinity?: GenderAffinity
  /**
   * Character tag -> canonical tag, for boorus that tag one character under
   * several names (Rule34 posts carry both "kasumi (pokemon)" and "misty (pokemon)").
   * Names with the same canonical tag are one person.
   */
  characterAliases?: Record<string, string>
  /**
   * The phrase dictionary (prose.ts `PhraseDictionary`): a tag the taxonomy has no
   * slot for goes where its phrase reads (see `phraseSlot`).
   */
  phrases?: Record<string, { kind: string; text: string; slot?: string }>
}

/** Lowercase, spaces instead of underscores, booru escapes and HTML entities (Rule34's "another&#039;s") removed. */
export function normalizeTag(tag: string): string {
  return tag.toLowerCase().replace(/_/g, " ").replace(/\\([()])/g, "$1").replace(/&#0*39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
    .replace(/\s{2,}/g, " ").trim()
}

// "1girl", "2boys", and Rule34's "1girls", "1female", "1futa", "1boy1girl", "3girls1boy".
const COUNT_RE = /^(\d+)\+?(girl|boy|other|female|male|futa)s?$/
const PAIR_COUNT_RE = /^(\d+)(boy|girl)s?(\d+)(boy|girl)s?$/
const COUNT_WORDS = new Set([
  "solo", "multiple girls", "multiple boys", "multiple others", "solo focus", "male focus", "female focus",
  // Gender tags as other boorus write them (Rule34, Gelbooru): subject information, not description.
  "female", "male", "solo female", "solo male", "female only", "male only", "multiple females", "multiple males", "duo", "trio",
  // Rule34 pairing and species-scope tags ("straight" there means a man and a woman).
  "male/female", "female/female", "male/male", "human", "human only", "hetero", "straight", "humanoid only",
])
// Other boorus' spellings of a Danbooru tag, read as the Danbooru one.
const SPELLINGS: Record<string, string> = { indoor: "indoors", outdoor: "outdoors" }
// Plurals that name another thing ("glasses" are not several glass), never swapped.
const OWN_PLURALS = new Set(["glasses", "sunglasses", "shorts", "pants", "boxers", "briefs", "tights", "balls", "arms", "goods"])

/**
 * The known tag an unknown one is a spelling of, as other boorus write tags:
 * without an apostrophe ("hand on anothers chin"), with a space for a hyphen,
 * as one word ("succubustail"), or with the head noun in the other number
 * ("body marking" -> "body markings"; only in tags of several words, where the
 * number does not change what the tag is). Null unless exactly one tag that
 * `isKnown` accepts matches; of its spellings, a `preferred` one wins.
 */
function knownSpelling(tag: string, isKnown: (tag: string) => boolean, preferred: (tag: string) => boolean): string | null {
  const words = tag.split(" ")
  const replace = (i: number, word: string) => [...words.slice(0, i), word, ...words.slice(i + 1)].join(" ")
  const candidates: string[] = []
  const head = words[words.length - 1]
  if (words.length > 1 && !OWN_PLURALS.has(head)) {
    const last = words.length - 1
    candidates.push(...(head.endsWith("s") ? [replace(last, head.slice(0, -1)), ...(head.endsWith("es") ? [replace(last, head.slice(0, -2))] : [])] : [replace(last, `${head}s`), replace(last, `${head}es`)]))
  }
  words.forEach((word, i) => {
    if (/^[a-z]{3,}s$/.test(word)) candidates.push(replace(i, `${word.slice(0, -1)}'s`))
    // One word for two: "wideeyed" -> "wide-eyed", "crosssection" -> "cross-section".
    if (/^[a-z]{7,}$/.test(word)) {
      for (let cut = 3; cut <= word.length - 3; cut++) {
        for (const rest of [word.slice(cut), word.slice(cut - 1)]) {
          for (const sep of [" ", "-"]) candidates.push(replace(i, `${word.slice(0, cut)}${sep}${rest}`))
        }
      }
    }
  })
  if (tag.includes("-")) candidates.push(tag.replace(/-/g, " "))
  if (tag.includes(" ")) candidates.push(tag.replace(/ /g, "-"))
  const found = [...new Set(candidates)].filter(isKnown)
  // "cross section" and "cross-section" are one tag written two ways.
  const same = new Set(found.map((t) => t.replace(/-/g, " ")))
  return same.size === 1 ? found.find(preferred) ?? found[0] : null
}

// Rule34 pairings ("futa with female", "male on futa"): who is in the picture, like
// the count tags. A futanari counts as a girl, as "1futa" does.
const PAIRING_RE = /^(futa|futanari|female|male|girl|boy)s? (with|on|x) (futa|futanari|female|male|girl|boy)s?$|^(futa|futanari) only$/

interface PeopleCount { girls: number; boys: number; others: number }

/** Who a count tag says is there ("2girls", "1boy1girl", "futa with female"), or null for any other tag. */
function countsIn(tag: string): PeopleCount | null {
  const people: PeopleCount = { girls: 0, boys: 0, others: 0 }
  const add = (n: number, who: string) => {
    const key = /^(girl|female|futa|futanari)$/.test(who) ? "girls" : /^(boy|male)$/.test(who) ? "boys" : "others"
    people[key] = Math.max(people[key], n)
  }
  const pair = tag.match(PAIR_COUNT_RE)
  const count = tag.match(COUNT_RE)
  const pairing = tag.match(PAIRING_RE)
  if (pair) { add(Number(pair[1]), pair[2]); add(Number(pair[3]), pair[4]) }
  else if (count) add(Number(count[1]), count[2])
  else if (pairing?.[1]) {
    const males = [pairing[1], pairing[3]].filter((who) => who === "male" || who === "boy").length
    people.girls = 2 - males
    people.boys = males
  } else if (!pairing) return null
  return people
}

// "duo", "trio": how many people there are, whoever they are. A floor, not a sum:
// "1girl, 1boy, duo" are two people.
const GROUP_SIZES: Record<string, number> = { duo: 2, trio: 3 }

/** People a group tag says are there beyond what the count tags name ("1girl, duo" -> 1). */
function unnamedByGroup(people: PeopleCount, tags: string[]): number {
  const least = Math.max(0, ...tags.map((t) => GROUP_SIZES[t] ?? 0))
  return Math.max(0, least - people.girls - people.boys - people.others)
}

/** How many people a tag list's count tags say there are ("1girl, 1boy" -> 2). */
export function peopleCount(general: string[]): number {
  const total: PeopleCount = { girls: 0, boys: 0, others: 0 }
  const tags = general.map(normalizeTag)
  for (const tag of tags) {
    const counts = countsIn(tag)
    if (counts) for (const key of ["girls", "boys", "others"] as const) total[key] = Math.max(total[key], counts[key])
  }
  return total.girls + total.boys + total.others + unnamedByGroup(total, tags)
}
const COSTUME_WORDS = new Set(["cosplay", "alternate costume", "official alternate costume", "alternate hairstyle", "costume switch"])
// Placeholders some boorus file as character tags ("anonymous male"): they name nobody.
const PLACEHOLDER_CHARACTER_RE = /^(anon|anonymous( (character|female|male|person))?|(background|unknown|unnamed) (character|characters|female|male)|original characters?|oc|you|npc|someone else's oc)$/

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

// Roman numerals after the first word: "final fantasy vii" -> "Final Fantasy VII".
const ROMAN_RE = /^(i{1,3}|iv|vi{0,3}|ix|xi{0,3}|xiv|xvi{0,3})$/

/** "spy x family" -> "Spy x Family", "fate/grand order" -> "Fate/Grand Order", "final fantasy vii" -> "Final Fantasy VII". */
export function titleCase(text: string): string {
  return text
    .split(" ")
    .map((w, i) => {
      if (i > 0 && SMALL_WORDS.has(w)) return w
      if (i > 0 && ROMAN_RE.test(w)) return w.toUpperCase()
      return w.replace(/(^|[/-])([a-z])/g, (_, sep, c) => sep + c.toUpperCase())
    })
    .join(" ")
}

/** "tsunade (naruto)" -> "naruto"; costume qualifiers such as "(cosplay)" are not series. */
function qualifier(tag: string): string | null {
  const m = tag.match(/\(([^)]+)\)$/)
  return m && !/^(cosplay|costume|swimsuit|young|adult|alternate|human|male|female)\b/.test(m[1]) ? m[1] : null
}

// Copyright tags that name no franchise: an original character, the site a post
// was published on, and text in the picture that taxonomies file as a copyright.
const NOT_A_FRANCHISE_RE = /^(original|patreon|fanbox|pixiv fanbox|pixiv|fantia|gumroad|ko-fi|subscribestar|onlyfans|boosty|twitter|deviantart|newgrounds|tumblr|instagram|youtube|twitch|tiktok|discord|copyright name|copyright logo|character name|artist name|company name)$/
// Companies and labels: named only when nothing more specific is ("Pokemon", not "Nintendo and Pokemon").
const COMPANY_RE = /^(nintendo|game freak|the pokemon company|sega|sonic team|capcom|square enix|bandai namco|namco|konami|atlus|koei tecmo|nippon ichi software|level-5|falcom|arc system works|spike chunsoft|microsoft|xbox|sony|playstation|valve|riot games|blizzard entertainment|mihoyo|hoyoverse|cygames|nexon|netmarble|yostar|shift up|kuro games|epic games|bethesda softworks|bethesda|ubisoft|electronic arts|activision|fromsoftware|kadokawa|aniplex|toei animation|kyoto animation|disney|pixar|dreamworks|warner bros|hasbro|mattel|glitch productions|cover corp|anycolor)$/

// Character qualifiers that are kinds, not series: "little red riding hood (fairy tale character)".
const GENERIC_QUALIFIER_RE = /^(fairy tale( character)?|folklore|mythology|legend|real life|original|oc|vtuber|mascot|meme)$/

/**
 * A character qualifier as a series: "kancolle" in "kashima (kancolle)". The
 * taxonomy rarely files the short forms, so an unknown one counts; one it files
 * as anything else (Rule34's "draco malfoy (redteneri)" names an artist) does not.
 */
function isSeriesQualifier(qualifier: string, overrides: Record<string, string>): boolean {
  if (GENERIC_QUALIFIER_RE.test(qualifier) || NOT_A_FRANCHISE_RE.test(qualifier)) return false
  const kind = overrides[qualifier] ?? overrides[qualifier.replace(/ /g, "_")]
  return !kind || kind === "other:copyright"
}

function seriesNames(copyrights: string[]): string[] {
  const franchises = copyrights.map(normalizeTag).filter((c) => !NOT_A_FRANCHISE_RE.test(c))
  const specific = franchises.filter((c) => !COMPANY_RE.test(c))
  // "touhou" + "touhou (pc-98)" are one series once the qualifier goes.
  const names = [...new Set((specific.length ? specific : franchises).map((c) => titleCase(c.replace(/\s*\([^)]*\)$/, ""))))]
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

// Slots whose sentence reads a "scene" phrase as a noun ("The background features a potted plant").
const NOUN_SLOTS = new Set<string>(["setting", "props", "weapon", "handheld", "animal", "layout"])

/**
 * Where a tag the taxonomy has no slot for goes, from its phrase entry. The kind
 * decides which sentences can read the phrase ("wears" is clothing, "framing" the
 * camera); the slot the phrase pass gave the tag, when it fits that kind, picks
 * among them. Hair and eye sentences are built from colour and length words, so
 * other traits go with the body. A noun phrase ("a robot") is what someone is.
 */
function phraseSlot(entry: { kind: string; text: string; slot?: string } | undefined): SceneSlot | "framing" | "gaze" | null {
  if (!entry) return null
  const [category, sub] = (entry.slot ?? "").split(":")
  const known = !!sub && ((TAG_SUBCATEGORIES as Record<string, readonly string[]>)[category]?.includes(sub) ?? false)
  const own = (...categories: string[]) => (known && categories.includes(category) ? (sub === "hair" || sub === "eyes" ? "anatomy" : sub as SceneSlot) : null)
  switch (entry.kind) {
    case "wears": return own("clothing") ?? "accents"
    case "has": return own("appearance") ?? "anatomy"
    case "with": return own("clothing", "appearance") ?? (category === "pose" && sub !== "camera" ? own("pose") : null) ?? "gesture"
    case "is":
      if (category === "pose" && sub === "camera") return "gaze"
      return own("clothing", "appearance", "pose") ?? (/^an? /.test(entry.text) ? "demographics" : "posture")
    case "framing": return "framing"
    case "scene": return known && NOUN_SLOTS.has(sub) ? sub as SceneSlot : sub === "style" ? "layout" : "atmosphere"
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
    if (PLACEHOLDER_CHARACTER_RE.test(tag) || cosplayNames.has(name) || characters.some((c) => c.name === name)) continue
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
    series: seriesNames(input.copyrights?.length
      ? input.copyrights
      : [...new Set(characterTags.map(qualifier).filter((q): q is string => !!q && isSeriesQualifier(q, overrides)))]),
    copyrightTags: [...copyrightTags].filter((c) => !NOT_A_FRANCHISE_RE.test(c) || c === "original"),
    artists: [...artistTags],
    rating: input.rating,
    slots: {},
    camera: { framing: [], angle: [], gaze: [] },
    unclassified: [],
    dropped: [],
    people: [],
    assigned: [],
  }

  const seen = new Set<string>()
  const seenSpellings = new Set<string>()
  const entryOf = (tag: string) => overrides[tag] ?? overrides[tag.replace(/ /g, "_")]
  // A spelling is worth reading as another tag only if that tag says something: not a name.
  const describes = (tag: string) => {
    const kind = entryOf(tag)
    return kind ? !/^other:(artist|character|copyright)$/.test(kind) : !!options.phrases?.[tag]
  }
  // Cleaned prompts merge one noun's adjectives ("blue long hair"); hair goes back to plain tags.
  const general = input.general.flatMap((raw) => splitHairCompound(normalizeTag(raw)) ?? [raw])
  for (const raw of general) {
    const given = normalizeTag(raw)
    let tag = SPELLINGS[given] ?? given
    if (!tag || seenSpellings.has(given)) continue
    seenSpellings.add(given)
    // A second spelling of a tag already there ("indoor" next to "indoors") says nothing new.
    if (seen.has(tag)) { scene.dropped.push(given); continue }
    seen.add(tag)
    // Providers without split tag fields mix names into the general list.
    if (characterSet.has(tag) || copyrightTags.has(tag) || artistTags.has(tag)) continue

    // Boorus that tag both "1girl" and "1girls" would double the count, so each
    // gender keeps the largest number seen instead of a sum.
    const counts = countsIn(tag)
    if (counts) {
      scene.girls = Math.max(scene.girls, counts.girls)
      scene.boys = Math.max(scene.boys, counts.boys)
      scene.others = Math.max(scene.others, counts.others)
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

    // Another booru's spelling of a known tag ("body marking") is read as that tag,
    // in the taxonomy's spelling when it has one ("dark-skinned female", not "dark skinned female").
    const spelled = !entryOf(tag) && !options.phrases?.[tag] ? knownSpelling(tag, describes, (t) => !!entryOf(t)) : null
    if (spelled && seen.has(spelled)) { scene.dropped.push(given); continue }
    if (spelled) { seen.add(spelled); tag = spelled }
    const exact = entryOf(tag)
    // The phrase dictionary knows tags the taxonomy left without a slot ("makeup",
    // "girl on top"); its placement is a judgment about this tag, so it beats the guesses below.
    const phrased = exact ? null : phraseSlot(options.phrases?.[tag])
    if (phrased === "framing" || phrased === "gaze") { scene.camera[phrased].push(tag); continue }
    if (phrased) { push(scene, phrased, tag); continue }
    // Hand-written tags ("lying on stomach") are not in the taxonomy; the suffix
    // fallback would file them by their last word (stomach -> anatomy), so a tag
    // that starts with a verb is read as a pose instead.
    if (!overrides[tag] && /^[a-z]+ing\b/.test(tag) && !/^(earring|ring|string|wing|ceiling|building|clothing|stocking)s?\b/.test(tag)) {
      push(scene, "posture", tag)
      continue
    }
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

  scene.others += unnamedByGroup(scene, scene.subjectTags)
  scene.characters = mergeAliases(scene.characters, options, scene.girls + scene.boys + scene.others)
  assignGenders(scene, options.traits)
  scene.people = scenePeople(scene)
  attributeTraits(scene, options.traits ?? {}, options.genderAffinity ?? GENDER_AFFINITY)
  return scene
}

/**
 * The named characters plus the unnamed people the count tags leave: in a
 * "1girl, 1boy" post naming only her, "the man" (or "the boy", see personNoun).
 * When a named character's gender is unknown, who is left is a guess: each
 * gender none of the named is known to have gets a stand-in ("the woman" may be
 * her), which only takes what gender alone decides. A post with a futanari and
 * no man gets "the futanari", the one the male anatomy belongs to.
 */
function scenePeople(scene: Scene): SceneCharacter[] {
  if (scene.girls + scene.boys + scene.others < 2 && scene.characters.length < 2) return []
  const people: SceneCharacter[] = [...scene.characters]
  const unnamed = (gender: "female" | "male", count: number, standIn = false): SceneCharacter =>
    ({ tag: "", name: `the ${personNoun(scene, gender, count > 1)}`, gender, generic: true, plural: count > 1, count, standIn })
  const total = (gender: "female" | "male") => (gender === "female" ? scene.girls : scene.boys)
  const named = (gender: "female" | "male") => scene.characters.filter((c) => c.gender === gender).length
  if (scene.characters.some((c) => !c.gender)) {
    for (const gender of ["female", "male"] as const) {
      if (total(gender) > 0 && named(gender) === 0) people.push(unnamed(gender, total(gender), true))
    }
    return people.length >= 2 ? people : []
  }
  let women = total("female") - named("female")
  if (hasFuta(scene) && scene.boys === 0 && scene.characters.length === 0 && women >= 2) {
    people.push({ tag: "", name: "the futanari", gender: "female", generic: true, futa: true, count: 1 })
    women--
  }
  for (const [gender, n] of [["female", women], ["male", total("male") - named("male")]] as const) {
    if (n > 0) people.push(unnamed(gender, n))
  }
  return people.length >= 2 ? people : []
}

function hasFuta(scene: Scene): boolean {
  return [...scene.subjectTags, ...(scene.slots.demographics ?? []), ...(scene.slots.anatomy ?? []), ...scene.unclassified].some((t) => FUTA_RE.test(t))
}

// 1boy over 1girl in a character's solo posts, where the count tag is the
// character itself: 0 for women, high for men. Across all posts it is often the
// partner (a man drawn with a woman, a woman almost always drawn with a man), so
// that fallback needs a much clearer ratio.
const SOLO = { male: 0.9, female: 0.6 }
const ALL_POSTS = { male: 2, female: 0.5 }

function genderRatio(profile: Record<string, number> | undefined): { ratio: number; solo: boolean } | null {
  if (!profile) return null
  const [soloBoy, soloGirl] = [profile["solo 1boy"] ?? 0, profile["solo 1girl"] ?? 0]
  if (soloBoy + soloGirl >= 0.5) return { ratio: soloBoy / Math.max(soloGirl, 0.01), solo: true }
  const [boy, girl] = [profile["1boy"] ?? 0, profile["1girl"] ?? 0]
  return Math.max(boy, girl) >= 0.5 ? { ratio: boy / Math.max(girl, 0.01), solo: false } : null
}

/**
 * Gender per character, for the pronoun in its own sentence and for which
 * traits it can own. Single-gender posts decide it outright. In mixed posts a
 * "(male)" qualifier, else the profile (`genderRatio`): when every person is
 * named and has solo data, the highest ratios are the boys; otherwise only clear
 * ratios count, and the rest stay unknown.
 */
function assignGenders(scene: Scene, traits: CharacterTraits = {}): void {
  const single = scene.others > 0 ? null : scene.boys === 0 && scene.girls > 0 ? "female" : scene.girls === 0 && scene.boys > 0 ? "male" : null
  const open: SceneCharacter[] = []
  for (const c of scene.characters) {
    const qualified = c.tag.match(/\((male|female)\)/)?.[1] as SceneCharacter["gender"] | undefined
    if (single || qualified) c.gender = single ?? qualified
    else open.push(c)
  }
  const ratios = open.map((c) => ({ c, g: genderRatio(traits[c.tag]) }))
  const boysLeft = scene.boys - scene.characters.filter((c) => c.gender === "male").length
  if (scene.characters.length === scene.girls + scene.boys && ratios.every((x) => x.g?.solo)) {
    ratios.sort((a, b) => b.g!.ratio - a.g!.ratio).forEach((x, i) => (x.c.gender = i < boysLeft ? "male" : "female"))
    return
  }
  for (const { c, g } of ratios) {
    const limits = g?.solo ? SOLO : ALL_POSTS
    if (g && g.ratio >= limits.male) c.gender = "male"
    else if (g && g.ratio <= limits.female) c.gender = "female"
  }
}

/** "kitagawa marin" = "marin kitagawa", "gotoh naoki" = "gotou naoki": same words in any order, either romanisation. */
function nameKey(name: string): string {
  return name.toLowerCase().replace(/o[uh](?![aeiou])/g, "o").replace(/uu/g, "u").split(" ").sort().join(" ")
}

/** "Marceline" and "Marceline the Vampire Queen", or the same words in another order or romanisation. */
function similarNames(a: string, b: string): boolean {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()]
  return nameKey(x) === nameKey(y) || x.startsWith(`${y} `) || y.startsWith(`${x} `)
}

/**
 * Joins names that are one person. The alias map is always trusted; similar
 * spellings could also be two people ("Jeanne d'Arc" and "Jeanne d'Arc Alter"),
 * so they only merge while the post has more names than people. Each merged
 * person keeps the canonical tag, or else one with a trait profile.
 */
function mergeAliases(characters: SceneCharacter[], options: BuildSceneOptions, people: number): SceneCharacter[] {
  const aliases = options.characterAliases ?? {}
  const canonical = (c: SceneCharacter) => aliases[c.tag] ?? c.tag
  const groups: SceneCharacter[][] = []
  for (const character of characters) {
    const group = groups.find((g) => g.some((c) => canonical(c) === canonical(character)))
    if (group) group.push(character)
    else groups.push([character])
  }
  while (people > 0 && groups.length > people) {
    const i = groups.findIndex((g, i) => groups.slice(i + 1).some((o) => g.some((a) => o.some((b) => similarNames(a.name, b.name)))))
    if (i === -1) break
    const j = groups.findIndex((o, j) => j > i && groups[i].some((a) => o.some((b) => similarNames(a.name, b.name))))
    groups[i].push(...groups.splice(j, 1)[0])
  }
  return groups.map((g) => g.find((c) => g.some((o) => canonical(o) === c.tag)) ?? g.find((c) => options.traits?.[c.tag]) ?? g[0])
}

const ATTRIBUTABLE_SLOTS: SceneSlot[] = [
  "hair", "eyes", "anatomy",
  "outfit", "top", "bottom", "underwear", "legwear", "footwear", "headwear", "eyewear", "accents",
  "weapon", "handheld",
]
const ATTRIBUTABLE = new Set(ATTRIBUTABLE_SLOTS)
const CLOTHING_SLOTS = new Set<SceneSlot>(["outfit", "top", "bottom", "underwear", "legwear", "footwear", "headwear", "eyewear", "accents"])
// A trait goes to a person when it appears on at least MIN_SHARE of their posts
// and MIN_RATIO times more often than for the next one.
const MIN_SHARE = 0.15
const MIN_RATIO = 1.5
// With a named character we know nothing about, a trait could be theirs: ask for more.
const MIN_SHARE_WITH_UNKNOWN = 0.3
// A tag goes to the woman or the man on the gender profiles alone when one's solo
// posts carry it at least GENDER_MIN_SHARE of the time and GENDER_RATIO times more
// often than the other's ("bikini", "beard"); a gap of 2x ("short hair") is a
// tendency, left to the profiles.
const GENDER_MIN_SHARE = 0.005
const GENDER_RATIO = 4
// Below one post in the sample: a share of 0 only means "not seen".
const GENDER_FLOOR = 0.001
// Genitals, nipples and the like: a character's profile counts the partner's too
// (a male character's posts carry "nipples" and "pussy" from the women he appears
// with), so only gender decides who has them.
const SEXUAL_ANATOMY_RE = /\b(penis(es)?|pussy|vulva|vagina|labia|clitoris|testicles|balls|scrotum|anus|nipples?|areolae?|pubic hair|erection|foreskin|genitals|crotch|cameltoe|cum|sperm)\b|^heart$/
// Traits only one gender can own; a profile's "breasts" share for a male character is his partners'.
const FEMALE_ONLY_RE = /\b(breasts?|cleavage|underboob|sideboob|female)\b/
const MALE_ONLY_RE = /\b(male|pectorals|beard|facial hair|mustache|stubble)\b/

type PersonSlots = Partial<Record<SceneSlot, string[]>>

/**
 * Booru tags are one flat list, so "aqua hair, blonde hair" or "large breasts,
 * large penis" do not say who has which. A tag goes to one of `scene.people`
 * when the evidence is clear, in this order:
 * 1. the tag says whose it is ("muscular male", "dark-skinned female");
 * 2. it belongs to one gender: the gender profiles (solo posts of a woman and of
 *    a man) show it far more often on one, or, for tags they do not list, a rule
 *    does (sexual anatomy, typically female garments);
 * 3. one person's profile carries it far more often than the others': a
 *    character's trait profile ("aqua hair" for Hatsune Miku), or the gender
 *    profile for someone unnamed.
 * Gender settles it only when one person (or one group) has that gender, and a
 * trait the gender profiles give to women stays open when a named man's own
 * profile carries it (a long-haired male character). Sexual anatomy goes by
 * gender only. Costume posts (cosplay, alternate costume) attribute only hair,
 * eyes and body by profile, since the outfit is not the character's usual one;
 * genderswap posts only hair and eyes. Ambiguous tags stay shared.
 */
export function attributeTraits(scene: Scene, traits: CharacterTraits, affinity: GenderAffinity = GENDER_AFFINITY): void {
  const people = scene.people
  if (people.length < 2) return
  // The rating picks the sample: "nipples" in general posts are a shirtless man's,
  // in adult ones mostly a woman's. Without a rating both count.
  const rating = scene.rating === "q" || scene.rating === "e" ? "adult" : scene.rating ? "general" : "any"
  const genderShare = (tag: string, gender: "female" | "male") => {
    const row = affinity[tag]
    if (!row) return 0
    const [general, adult] = gender === "female" ? [row[0], row[2]] : [row[1], row[3]]
    if (rating === "adult" && row[2] + row[3] > 0) return adult
    return rating === "any" ? (general + adult) / 2 : general
  }
  const dataGender = (tag: string): "female" | "male" | null => {
    if (!affinity[tag]) return null
    const [woman, man] = [genderShare(tag, "female"), genderShare(tag, "male")]
    if (woman >= GENDER_MIN_SHARE && woman >= GENDER_RATIO * Math.max(man, GENDER_FLOOR)) return "female"
    if (man >= GENDER_MIN_SHARE && man >= GENDER_RATIO * Math.max(woman, GENDER_FLOOR)) return "male"
    return null
  }
  const share = (person: SceneCharacter, tag: string) =>
    person.generic ? (person.gender ? genderShare(tag, person.gender) : 0) : traits[person.tag]?.[tag] ?? 0
  const known = (person: SceneCharacter) => !!person.generic || !!traits[person.tag]
  // In a post with a man, what several women share by gender ("breasts" with
  // three named girls) is said of them together: "The girls have breasts."
  const mixed = scene.girls > 0 && scene.boys > 0
  const groups = new Map<"female" | "male", SceneCharacter>()
  const groupOf = (gender: "female" | "male") => {
    if (!groups.has(gender)) groups.set(gender, { tag: "", name: `the ${personNoun(scene, gender, true)}`, gender, generic: true, plural: true })
    return groups.get(gender)!
  }

  const postTags = [...scene.subjectTags, ...Object.values(scene.slots).flat(), ...scene.unclassified].filter((t): t is string => !!t)
  const futa = hasFuta(scene)
  const crossdressing = postTags.some((t) => CROSSDRESSING_RE.test(t))
  const costume = scene.subjectTags.some((t) => /cosplay|alternate costume/.test(t))
  const genderswap = postTags.some((t) => t.startsWith("genderswap"))
  const profileSlots = new Set(genderswap ? ATTRIBUTABLE_SLOTS.slice(0, 2) : costume ? ATTRIBUTABLE_SLOTS.slice(0, 3) : ATTRIBUTABLE_SLOTS)

  const byProfile = (tag: string, slot: SceneSlot, candidates: SceneCharacter[]): SceneCharacter | null => {
    if (!profileSlots.has(slot)) return null
    const pool = candidates.filter((p) => !p.standIn)
    const profiled = pool.filter(known)
    if (profiled.length < 2) return null
    const minShare = profiled.length < pool.length ? MIN_SHARE_WITH_UNKNOWN : MIN_SHARE
    const excluded = FEMALE_ONLY_RE.test(tag) ? "male" : MALE_ONLY_RE.test(tag) ? "female" : null
    const [best, second] = profiled
      .filter((person) => !excluded || person.gender !== excluded)
      .map((person) => ({ person, share: share(person, tag) }))
      .sort((a, b) => b.share - a.share)
    return best && best.share >= minShare && best.share >= MIN_RATIO * (second?.share ?? 0) ? best.person : null
  }

  // The named character of unknown gender whose profile clearly carries a tag, if one does.
  const claimant = (tag: string, slot: SceneSlot): SceneCharacter | null => {
    if (!profileSlots.has(slot)) return null
    const [best, second] = people
      .filter((p) => !p.generic && !p.gender && traits[p.tag])
      .map((person) => ({ person, share: share(person, tag) }))
      .sort((a, b) => b.share - a.share)
    return best && best.share >= MIN_SHARE && best.share >= MIN_RATIO * (second?.share ?? 0) ? best.person : null
  }

  const ownerOf = (tag: string, slot: SceneSlot): SceneCharacter | null => {
    const named = genderedTraits(tag)
    const fromTag = named.length === 1 ? named[0].gender : null
    // Other slots (expression, pose) only hand out tags that name their person ("embarrassed female").
    if (!fromTag && !ATTRIBUTABLE.has(slot)) return null
    // "bare shoulders", "sleeveless": how the outfit is worn, not an item someone owns
    // (but "sideboob" or "cleavage" can only be the woman's).
    if (!fromTag && isClothingState(tag) && !ruleGender(tag)) return null
    const sexual = slot === "anatomy" && SEXUAL_ANATOMY_RE.test(tag)
    // With crossdressing in the post, a dress says nothing about who wears it.
    const genderBlind = CLOTHING_SLOTS.has(slot) && crossdressing
    const byData = fromTag || genderBlind ? null : dataGender(tag)
    const gender = fromTag ?? byData ?? (genderBlind ? null : ruleGender(tag))
    if (gender) {
      // Next to a futanari, a tag that says "female" means the other woman.
      let pool = gender === "futa" ? people.filter((p) => p.futa) : people.filter((p) => p.gender === gender && !(fromTag && p.futa))
      // A futanari has the male anatomy too: hers when there is no man, nobody's in particular otherwise.
      if (gender === "male" && futa && (sexual || ruleGender(tag) === "male")) pool = scene.boys === 0 ? people.filter((p) => p.futa) : []
      // A named man's profile carrying a women's tendency ("long hair") may be his own;
      // carrying "sideboob" or "bikini" it is his partners', as with sexual anatomy.
      const oneSex = sexual || ruleGender(tag) === gender || (gender === "female" ? FEMALE_ONLY_RE : MALE_ONLY_RE).test(tag)
      const inPool = new Set(pool)
      const ownedByOther = !!byData && !oneSex && people.some((p) => !inPool.has(p) && !p.generic && (traits[p.tag]?.[tag] ?? 0) >= MIN_SHARE)
      if (!ownedByOther) {
        // A stand-in is the last resort: a named character of unknown gender whose
        // profile carries the trait ("large breasts" on Nagiha's posts) is likelier hers.
        if (pool.length === 1 && pool[0].standIn && !sexual) return claimant(tag, slot) ?? pool[0]
        if (pool.length === 1) return pool[0]
        if (pool.length === 0) return null
        const one = sexual || fromTag ? null : byProfile(tag, slot, pool)
        // "dark-skinned female" among several women describes one of them, not the group,
        // and so does a kind of person ("futanari"): only shared traits go to the group.
        const personal = !!fromTag || slot === "demographics" || FUTA_RE.test(tag)
        return one ?? (mixed && !personal && gender !== "futa" ? groupOf(gender) : null)
      }
    }
    return sexual ? null : byProfile(tag, slot, people)
  }

  const owners = new Map<SceneCharacter, PersonSlots>()
  for (const slot of Object.keys(scene.slots) as SceneSlot[]) {
    const shared: string[] = []
    for (const tag of scene.slots[slot] ?? []) {
      const owner = ownerOf(tag, slot)
      if (!owner) { shared.push(tag); continue }
      if (!owners.has(owner)) owners.set(owner, {})
      ;(owners.get(owner)![slot] ??= []).push(tag)
    }
    scene.slots[slot] = shared
  }
  giveLeftoverColors(scene, owners)
  scene.assigned = [...people, ...groups.values()].filter((p) => owners.has(p)).map((character) => ({ character, slots: owners.get(character)! }))
}

/**
 * Every named character but one has a hair (or eye) colour of their own: the
 * colours left over are that one's. Otherwise "Sandrone has brown hair" would
 * follow a shared "with purple hair" that reads as hers too. Unnamed partners
 * never take them: the tags rarely describe the man drawn with a named woman.
 */
function giveLeftoverColors(scene: Scene, owners: Map<SceneCharacter, PersonSlots>): void {
  const named = scene.people.filter((p) => !p.generic)
  if (named.length < 2) return
  for (const slot of ["hair", "eyes"] as const) {
    const suffix = slot === "hair" ? " hair" : " eyes"
    const isColor = (t: string) => t.endsWith(suffix) && HAIR_COLOR_RE.test(t.slice(0, -suffix.length))
    const uncolored = named.filter((p) => !owners.get(p)?.[slot]?.some(isColor))
    const leftover = (scene.slots[slot] ?? []).filter(isColor)
    if (uncolored.length !== 1 || leftover.length === 0) continue
    const other = uncolored[0]
    if (!owners.has(other)) owners.set(other, {})
    ;(owners.get(other)![slot] ??= []).push(...leftover)
    scene.slots[slot] = scene.slots[slot]!.filter((t) => !isColor(t))
  }
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
