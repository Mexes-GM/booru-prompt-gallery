/**
 * Scene -> English sentences, one group per aspect of the image. Renderers pick
 * the groups they need and decide what stays as tags.
 *
 * `raw` collects every tag that no phrase rule could place. Renderers keep those
 * tags verbatim (nothing is dropped) and report them, which is the gap the
 * phrase dictionary has to close.
 */
import type { Scene, SceneSlot } from "./scene"
import {
  HAIR_COLOR_RE,
  PRONOUNS,
  type Pronouns,
  anglePhrase,
  capitalize,
  dropContainedPhrases,
  dropImplied,
  expressionPhrase,
  framingPhrase,
  garmentPhrase,
  gazePhrase,
  genericsOf,
  impliedTags,
  bareState,
  isClothingState,
  isPluralNoun,
  joinList,
  lexiconPhrase,
  mergeSameThing,
  mergeSharedPrefix,
  mergeThings,
  posePhrase,
  saysAll,
  splitPlacement,
  takesPluralVerb,
  withArticle,
} from "./english"
import {
  eachOther,
  FUTA_RE,
  genderedTraits,
  namesPartner,
  oneOfSentence,
  onlyPartners,
  peopleNamed,
  personNoun,
  posesSentence,
  possessivePronoun,
  roleAct,
  sceneRoles,
  splitPoses,
  visibleSentence,
  type ActPartner,
  type ActWho,
  type Role,
} from "./people"
import { canonicalTag, canonicalWord } from "./relations"
import { describeLayout, describeStyle } from "./style"

/**
 * How a dictionary phrase plugs into a sentence: "is" continues "She is ___",
 * "with" continues "..., with ___", "has" continues "She has ___", "wears"
 * continues "She wears ___", "framing" continues "The image is ___", "scene" is
 * a noun phrase for the atmosphere, or for a place or object ("a potted plant").
 * `{pos}` stands for the possessive pronoun. "keep" marks a tag with no phrase
 * ("military", "costume switch"): it stays a tag instead of "She wears a military".
 * "none" marks a tag nothing in a picture shows ("netorare", "sexy", "crossover"):
 * the scene drops it like a meta tag.
 */
export type PhraseKind = "is" | "with" | "has" | "wears" | "framing" | "scene" | "keep" | "none"
/**
 * `who` and `partner` say who does an act and to whom when the picture has
 * several people (see people.ts `roleAct`); without them the act is everyone's.
 * `slot` ("clothing:accents") comes with tags the taxonomy has no slot for, so
 * the scene knows where they go.
 */
export interface PhraseEntry { kind: PhraseKind; text: string; who?: ActWho; partner?: ActPartner; slot?: string }
export type PhraseDictionary = Record<string, PhraseEntry>

export interface SceneProse {
  /** What the picture is, from its style tags: "An anime-style illustration", "A 3D render". */
  medium: string
  /** "Yor Briar from Spy x Family, with long black hair and red eyes" (no final period). */
  identity: string
  /** One sentence per character with attributed traits ("Hatsune Miku has aqua hair…"). */
  characters: string[]
  /**
   * The same for unnamed people and groups ("The man is muscular.", "One of the
   * women is dark-skinned."): body and clothing details, worth less than the pose.
   */
  people: string[]
  body: string
  clothing: string
  held: string
  pose: string
  /** The pose sentence cut to its first actions, for when the whole one does not fit the word budget. */
  poseShort: string
  /** The outfit sentence cut to its main garments, for the same reason. */
  clothingShort: string
  setting: string
  lighting: string
  camera: string
  style: string
  extras: string
  pronouns: Pronouns
  /** Tags no phrase rule could place, still to be rendered verbatim. */
  raw: string[]
  /** Phrases left out by `compact` to keep the prose short. */
  omitted: number
  /** The sentences above that say one thing of one subject, for the renderer to join (SubjectClause). */
  clauses: SubjectClause[]
}

/**
 * One sentence of the body, clothing, held or extras sections, kept as its
 * parts so adjacent sentences about the same subject can be joined
 * ("She has X, wears Y, and holds Z.") without reading the finished text back.
 */
export interface SubjectClause {
  /** The sentence as written on its own. */
  text: string
  subject: string
  /**
   * Only clauses with the same key join. The main subject's share one; each
   * "One of them" sentence has its own, as two of them may be two people.
   */
  key: string
  /** Two clauses with the same verb never join ("has X, and has Y"); "shown" ("is shown with") only ends one. */
  verb: "is" | "has" | "wears" | "holds" | "shown"
  /** The clause without its subject: "wears a red sweater". */
  predicate: string
  /** What follows ", with": only the last clause of a joined sentence may have it. */
  tail?: string
}

const NUMBER_WORDS = ["no", "a", "two", "three", "four", "five", "six"]

const HAIR_LENGTHS = ["absurdly long", "very long", "long", "medium", "short", "very short"]
const HAIR_PATTERN = new Set(["multicolored", "two-tone", "gradient", "streaked", "colored inner", "split-color"])
const HAIR_TEXTURE = new Set(["wavy", "curly", "straight", "messy", "spiked", "drill", "fluffy"])
const HAIR_ACCESSORY_RE = /(ornament|ribbon|bow|flower|clip|band|tie|bun|pin|scrunchie|bobbles|bell|stick|tubes)$/

const BODY_ADJECTIVES = new Set([
  "curvy", "slim", "slender", "petite", "muscular", "plump", "skinny", "tall", "short", "toned", "chubby",
  "thick", "androgynous", "furry", "nude", "naked", "wet", "sweaty", "pregnant", "tan", "tanned", "pale",
  "busty", "voluptuous", "curvaceous", "chubby", "athletic", "lanky", "stocky",
])
// Body parts named because they are visible, not because the subject "has" them.
const BODY_VISIBLE = new Set([
  "navel", "midriff", "collarbone", "stomach", "armpits", "cleavage", "nipples", "thighs", "ass",
  "back", "shoulders", "abs", "ribs", "feet", "toes", "groin", "pussy", "penis", "anus", "testicles",
])
const SPECIES_RE = / (girl|boy)$/
// Demographic tags without a phrase. A kind of person is what the subject is
// ("an erune", "a priest"); these few say how the subject is drawn. The rest
// ("genderswap", "age difference") stay raw details rather than "She has a genderswap".
const DEMOGRAPHIC_WORDING: Record<string, string> = { "aged up": "drawn older than usual", manly: "manly", mature: "mature" }
const PERSON_NOUN_RE = /\b(girl|boy|woman|man|adult|priest|nun|femboy|twink|bishounen|anthro|erune|draph|harvin|elf|draconequus)$/
const RELATIONS = new Set([
  "siblings", "sisters", "brothers", "twins", "couple", "friends", "mother and daughter", "father and daughter", "mother and son", "brother and sister", "husband and wife",
  // How they compare: a relation between them, not a trait each one has ("They have a size difference").
  "size difference", "height difference", "age difference", "interracial",
])
// "They are ___": the singular ones need an article, the comparisons a wording.
const RELATION_WORDING: Record<string, string> = {
  couple: "a couple",
  "size difference": "very different in size",
  "height difference": "different in height",
  "age difference": "different in age",
  interracial: "of different skin tones",
}

/**
 * Held and carried items, each said once. "holding X" names the item; a kind
 * replaces its generic word ("holding gun" + "handgun" -> "a handgun", "weapon"
 * next to "knife" goes); a placement joins its item ("umbrella over shoulder" ->
 * "a parasol over her shoulder") instead of adding a second one. `wording` writes
 * an item (its dictionary phrase, or the tag with its article).
 */
function describeItems(
  tags: string[],
  possessive: string,
  context: string[],
  wording: (tag: string) => string = withArticle,
  holdsSomething = false,
): { held: string[]; loose: string[] } {
  const holding = tags.filter((t) => t.startsWith("holding ")).map((t) => t.slice("holding ".length))
  const placed = tags.filter((t) => !t.startsWith("holding ") && splitPlacement(t).place)
  const others = tags.filter((t) => t !== "holding" && !t.startsWith("holding ") && !splitPlacement(t).place)
  // "holding thermos" names the thermos held; it does not make "thermos" redundant here.
  const kept = new Set(dropImplied([...new Set([...holding, ...others])], [...holding, ...context.filter((t) => !t.startsWith("holding "))]))
  const isKind = (specific: string, generic: string) =>
    specific === generic || specific.endsWith(` ${generic}`) || genericsOf(specific).includes(generic)
  const heldSet = new Set<string>()
  for (const name of holding) {
    const item = kept.has(name) ? name : others.find((o) => kept.has(o) && isKind(o, name))
    if (item) heldSet.add(item)
  }
  // A bare "holding" with no "holding X" says the items are in hand: "holding" + "basket" -> "holding a basket".
  if (holdsSomething && !heldSet.size) for (const o of others) if (kept.has(o)) heldSet.add(o)
  // "parasol" held next to "white umbrella" is one white parasol (mergeThings).
  const things = mergeThings([...heldSet, ...others.filter((o) => kept.has(o) && !heldSet.has(o))].map((tag) => ({ tag, text: wording(tag), several: true })))
  const isHeld = (thing: (typeof things)[number]) => thing.tags.some((tag) => heldSet.has(tag))
  const held = things.filter(isHeld)
  const loose = things.filter((thing) => !isHeld(thing))
  const where = (place: string) => place.replace(/(shoulder|back|hip|mouth)$/, `${possessive} $1`)
  const holder = (list: typeof things, item: string) => list.find((thing) => thing.tags.some((tag) => isKind(tag, item)))
  // "sword on back" already says "weapon on back".
  for (const tag of dropImplied(placed, context)) {
    const { item, place } = splitPlacement(tag)
    const h = holder(held, item)
    // A held item is in the hand: only "over shoulder" still describes it.
    if (h) { if (/shoulder$/.test(place!)) h.text += ` ${where(place!)}`; continue }
    const l = holder(loose, item)
    if (l) l.text += ` ${where(place!)}`
    else loose.push({ tags: [tag], text: `${withArticle(item)} ${where(place!)}` })
  }
  return { held: held.map((thing) => thing.text), loose: loose.map((thing) => thing.text) }
}
// More names than this read as a list, not a description.
const MAX_NAMED_CHARACTERS = 4

const CLOTHING_ORDER: SceneSlot[] = ["outfit", "top", "bottom", "underwear", "legwear", "footwear", "headwear", "eyewear", "accents"]
const POSE_ORDER: SceneSlot[] = ["posture", "kinetic", "combat", "interaction", "gesture", "physiological"]
// Slots whose tags always become a noun phrase; tags of the others need a phrase rule to be said.
const NOUN_SLOTS = new Set<SceneSlot>(["hair", "eyes", "anatomy", ...CLOTHING_ORDER, "weapon", "handheld", "setting", "props", "animal"])
// Accessories come several to a person (two kinds of hair ornament are two); garments and body parts one of each.
const SEVERAL_SLOTS = new Set<SceneSlot>(["accents", "headwear", "eyewear"])

/**
 * The dictionary as other boorus' spellings read it: "boobs" or "big ass" have no
 * phrase of their own, so they say what the Danbooru tag's phrase says ("breasts",
 * "large buttocks"); see canonicalTag. The tag itself stays as given, so rules
 * that know the spelling ("femboy") still apply.
 */
function withSpellingPhrases(phrases: PhraseDictionary, tags: string[]): PhraseDictionary {
  const borrowed: PhraseDictionary = {}
  for (const tag of tags) {
    if (phrases[tag]) continue
    const danbooru = canonicalTag(tag, (t) => !!phrases[t])
    if (danbooru !== tag && phrases[danbooru]) borrowed[tag] = phrases[danbooru]
  }
  return Object.keys(borrowed).length ? Object.assign(Object.create(phrases) as PhraseDictionary, borrowed) : phrases
}

function tagSlots(scene: Scene): Map<string, SceneSlot> {
  const slotOf = new Map<string, SceneSlot>()
  for (const slots of [scene.slots, ...scene.assigned.map((a) => a.slots)]) {
    for (const [slot, tags] of Object.entries(slots) as [SceneSlot, string[] | undefined][]) for (const tag of tags ?? []) slotOf.set(tag, slot)
  }
  return slotOf
}

/**
 * The tags the prose puts into words, which is what may leave out a tag they
 * imply (dropImplied): a tag only listed raw ("Additional details: ...") must
 * not hide the plainer tag it implies.
 */
function sayableTags(scene: Scene, phrases: PhraseDictionary, p: Pronouns): string[] {
  const said = [...scene.camera.framing, ...scene.camera.angle, ...scene.camera.gaze]
  for (const slots of [scene.slots, ...scene.assigned.map((a) => a.slots)]) {
    for (const [slot, tags] of Object.entries(slots) as [SceneSlot, string[] | undefined][]) {
      for (const tag of tags ?? []) {
        if (NOUN_SLOTS.has(slot) || phrases[tag] || lexiconPhrase(tag, p) || posePhrase(tag, p) || expressionPhrase(tag, p)) said.push(tag)
      }
    }
  }
  return said
}

const OUTFIT_ADJECTIVES = new Set(["sleeveless", "strapless", "backless", "see-through", "off shoulder", "off-shoulder", "single off shoulder", "highleg", "open clothes", "torn clothes", "wet clothes", "taut clothes"])
const OUTFIT_WORDING: Record<string, string> = {
  // "Her outfit is ___": how it is worn, not a kind of outfit.
  "single off shoulder": "worn off one shoulder",
  "off shoulder": "worn off the shoulders",
  "off-shoulder": "worn off the shoulders",
  "open clothes": "worn open",
  highleg: "high-cut",
}
const BEING_STATES: Record<string, string> = {
  topless: "topless",
  bottomless: "bottomless",
  barefoot: "barefoot",
  nude: "nude",
  naked: "nude",
  "completely nude": "completely nude",
  "no bra": "not wearing a bra",
  "no panties": "not wearing panties",
}
// "hood down", "sleeves rolled up": a garment in a state, phrased as "with her hood down".
const WORN_STATE_RE = / (up|down|aside|removed|tucked in|rolled up|lift|pull|around neck)$/
// Parts of a garment ("long sleeves", "sailor collar") come after the garments, so a short list keeps the skirt.
const GARMENT_PART_RE = /(^|\s)(sleeves?|collar|cuffs?|hood|buttons|pockets?|zipper|trim|lining|neckline|hem)$/
const garmentsFirst = <T extends { tag: string }>(items: T[]) => [...items.filter((i) => !GARMENT_PART_RE.test(i.tag)), ...items.filter((i) => GARMENT_PART_RE.test(i.tag))]

// Furry pictures: Rule34 tags the people's species down the taxonomy ("arctic fox", "canid", "canine", "canis").
const FURRY_RE = /^(?:anthro|furry|kemono|anthrofied)(?: (?:female|male|girl|boy|only))?$/
const HUMAN_PARTNER_RE = /\bhuman\b|\bhumanoid\b/
const TAXON_RANKS = new Set([
  "mammal", "canid", "canine", "canis", "vulpine", "vulpes", "feline", "felid", "felis", "equine", "equid", "bovine", "bovid",
  "caprine", "cervid", "ursid", "ursine", "mustelid", "procyonid", "lagomorph", "leporid", "rodent", "murid", "avian",
  "reptile", "scalie", "squamate", "amphibian", "primate", "marsupial", "pinniped", "cetacean", "arthropod", "insect", "animal",
])
/** "fox" -> "foxes", "wolf" -> "wolves", "bunny" -> "bunnies". */
function pluralNoun(noun: string): string {
  if (/(?:s|x|ch|sh)$/.test(noun)) return `${noun}es`
  if (/[^aeiou]y$/.test(noun)) return `${noun.slice(0, -1)}ies`
  if (/(?:wolf|elf)$/.test(noun)) return `${noun.slice(0, -1)}ves`
  if (/(?:sheep|deer|fish|moose)$/.test(noun)) return noun
  return `${noun}s`
}

const MALE_PART_RE = /\b(penis|penises|testicles|balls|scrotum|erection|foreskin)\b/

const ADVERB_PLACES = new Set(["outdoors", "indoors", "underwater", "outside", "inside"])
// Whole words only: "fitting room", "bedroom", but not "mushroom" or "chocolate bar".
const ROOM_RE = /(^|s)(room|bedroom|bathroom|classroom|kitchen|office|library|hallway|corridor|infirmary|dungeon|bathhouse|attic|basement|cafe|restaurant|church|temple|studio|gym|prison cell|elevator|train interior|car interior)$/
const TIME_PHRASES: Record<string, string> = {
  night: "at night", day: "during the day", sunset: "at sunset", sunrise: "at sunrise",
  evening: "in the evening", dusk: "at dusk", dawn: "at dawn", twilight: "at twilight",
  morning: "in the morning", noon: "at noon", "night sky": "under a night sky",
}
const UNIQUE_NOUNS = new Set(["sky", "ocean", "sea", "sun", "moon", "horizon", "city", "beach", "shore"])
const EFFECTS_RE = /^(depth of field|bokeh|blurry|blurry background|blurry foreground|motion blur|chromatic aberration|film grain|lens flare|sparkle|glint|light particles|light rays|sunbeam)$/

function pronounsFor(scene: Scene): Pronouns {
  const people = scene.girls + scene.boys + scene.others
  // The count tags are the most reliable signal: several character tags can
  // describe one person (cosplay, costume variants).
  if (people > 1) return PRONOUNS.their
  if (people === 1) return scene.boys === 1 ? PRONOUNS.his : scene.girls === 1 ? PRONOUNS.her : PRONOUNS.their
  if (scene.characters.length > 1) return PRONOUNS.their
  // One named robot or creature in a "no humans" post is "it", not "she".
  if (scene.characters.length === 1 && (scene.slots.demographics ?? []).includes("no humans")) return PRONOUNS.its
  return scene.characters.length === 1 ? PRONOUNS.her : PRONOUNS.their
}

function countPhrase(n: number, noun: string, plural = `${noun}s`): string {
  if (n <= 0) return ""
  return `${NUMBER_WORDS[n] ?? String(n)} ${n > 1 ? plural : noun}`
}

const SPECIES_ADJECTIVES = new Set(["busty", "slim", "skinny", "fat", "thick", "cute", "tall", "small", "tiny", "little", "tanned", "beautiful", "bearded", "round", "goth", "girly", "muscle", "teen", "teenage", "young", "alt"])

/**
 * One person's "grey-skinned girl", "vampire girl" and "busty girl" are one
 * noun ("a grey-skinned, busty vampire girl"), not three people.
 */
function speciesPhrase(species: string[]): string {
  const heads = new Set(species.map((t) => t.split(" ").pop()!))
  if (species.length < 2 || heads.size > 1 || species.some((t) => t.includes(" and "))) return joinList(species.map(withArticle))
  const modifiers = species.map((t) => t.slice(0, t.lastIndexOf(" ")))
  const isAdjective = (m: string) => SPECIES_ADJECTIVES.has(m) || /ed$/.test(m)
  const adjectives = modifiers.filter(isAdjective).join(", ")
  return withArticle([adjectives, ...modifiers.filter((m) => !isAdjective(m)), ...heads].filter(Boolean).join(" "))
}

// Tags that make the other people in the picture versions of the one named character.
const SELF_RE = /^(dual persona|selfcest|multiple persona|clone|time paradox)$/

/** How many versions of the one named character the picture shows ("dual persona"), or 0. */
function selfVersions(scene: Scene): number {
  const people = scene.girls + scene.boys + scene.others
  if (scene.characters.length !== 1 || people < 2) return 0
  const tags = [...Object.values(scene.slots).flat(), ...scene.unclassified]
  return tags.some((t) => !!t && SELF_RE.test(t)) ? people : 0
}

function subjectPhrase(scene: Scene, species: string[]): string {
  let subject = ""
  if (scene.characters.length > 0) {
    const all = scene.characters.map((c) => c.name)
    const versions = selfVersions(scene)
    const names = versions
      ? `${NUMBER_WORDS[versions] ?? versions} versions of ${all[0]}`
      : all.length > MAX_NAMED_CHARACTERS
        ? `a crowd of characters including ${all.slice(0, MAX_NAMED_CHARACTERS).join(", ")} and others`
        : joinList(all)
    const series = scene.series.slice(0, 2)
    subject = series.length ? `${names} from ${joinList(series)}` : names
    // The partner nobody names is still in the picture: "Kitagawa Marin from ... and a man".
    const unnamed = scene.people
      .filter((p) => p.generic && !p.standIn && p.gender)
      .map((p) => (p.futa ? "a futanari" : countPhrase(p.count ?? 1, personNoun(scene, p.gender!, false), personNoun(scene, p.gender!, true))))
    if (unnamed.length && all.length <= MAX_NAMED_CHARACTERS && !versions) subject = `${subject} and ${joinList(unnamed)}`
  } else {
    const parts = [
      countPhrase(scene.girls, personNoun(scene, "female", false), personNoun(scene, "female", true)),
      countPhrase(scene.boys, personNoun(scene, "male", false), personNoun(scene, "male", true)),
      countPhrase(scene.others, "character"),
    ].filter(Boolean)
    if (parts.length) subject = joinList(parts)
    else if ((scene.slots.demographics ?? []).includes("no humans")) subject = "a scene with no people"
  }
  if (!subject) return ""
  const appositive = [
    species.length ? speciesPhrase(species) : "",
    scene.cosplayAs.length ? `cosplaying as ${joinList(scene.cosplayAs)}${scene.cosplaySeries.length ? ` from ${joinList(scene.cosplaySeries.slice(0, 2))}` : ""}` : "",
  ].filter(Boolean).join(", ")
  return appositive ? `${subject}, ${appositive}` : subject
}

/**
 * `plural`: the hair of several people. Two lengths there are two people's
 * ("long and short hair"), not one "long purple hair, short hair".
 */
function hairTraits(hair: string[], plural = false): string[] {
  const lengths = HAIR_LENGTHS.filter((l) => hair.includes(`${l} hair`))
  const severalLengths = plural && lengths.length > 1
  const length = severalLengths ? undefined : lengths[0]
  const colors: string[] = []
  const descriptors: string[] = []
  const rest: string[] = []
  for (const tag of hair) {
    if (severalLengths ? lengths.some((l) => tag === `${l} hair`) : length && tag === `${length} hair`) continue
    const base = tag.endsWith(" hair") ? tag.slice(0, -5) : null
    if (base && HAIR_COLOR_RE.test(base)) colors.push(base)
    else if (base && (HAIR_TEXTURE.has(base) || HAIR_PATTERN.has(base))) descriptors.push(base)
    // "a single braid", "a wolf cut": one hairstyle, with its article.
    else rest.push(HAIR_ACCESSORY_RE.test(tag) || /(^ponytail|braid|^ahoge| cut)$/.test(tag) ? withArticle(tag) : tag)
  }
  const traits: string[] = severalLengths ? [`${joinList(lengths)} hair`] : []
  if (length || colors.length || descriptors.length) {
    traits.push(`${[length, ...descriptors, joinList(colors)].filter(Boolean).join(" ")} hair`)
  }
  return [...traits, ...rest]
}

function eyeTraits(eyes: string[]): string[] {
  // Only colours merge into "blue and green eyes"; "bedroom eyes" or "half-closed eyes" stay whole.
  const isColor = (e: string) => / eyes$/.test(e) && HAIR_COLOR_RE.test(e.slice(0, -5))
  const colors = eyes.filter(isColor).map((e) => e.slice(0, -5))
  const rest = eyes.filter((e) => !isColor(e))
  return [...(colors.length ? [`${joinList(colors)} eyes`] : []), ...rest]
}

// "unworn panties", and the card's merged "satin stained unworn panties".
const UNWORN_RE = /^(.*?)\bunworn (.+)$/

/**
 * How a clothing-slot tag reads. Not every one is a garment she "wears": the
 * dictionary phrases details and states ("long sleeves", "{pos} shoulders bare")
 * as "with", states of the person ("crossdressing") as "is", and marks the ones
 * with no phrase to "keep" as tags; an unworn garment is taken off.
 */
function clothingPhrase(tag: string, possessive: string, entry: PhraseEntry | undefined): { kind: "wears" | "with" | "is" | "keep"; text: string } {
  const unworn = tag.match(UNWORN_RE)
  if (unworn) return { kind: "with", text: `${possessive} ${unworn[1]}${unworn[2]} taken off` }
  if (entry?.kind === "keep") return { kind: "keep", text: tag }
  if (entry && (entry.kind === "wears" || entry.kind === "with" || entry.kind === "is")) return { kind: entry.kind, text: entry.text.replace(/\{pos\}/g, possessive) }
  return { kind: "wears", text: garmentPhrase(tag, possessive) }
}

/** "her bra taken off", "her panties taken off" -> "her bra and panties taken off". */
function mergeTakenOff(items: string[]): string[] {
  const isOff = (i: string) => i.endsWith(" taken off")
  const off = items.filter(isOff)
  const owner = off[0]?.split(" ")[0]
  if (off.length < 2 || !off.every((i) => i.startsWith(`${owner} `))) return items
  const merged = `${owner} ${joinList(off.map((i) => i.slice(owner.length + 1, -" taken off".length)))} taken off`
  return items.flatMap((i) => (i === off[0] ? [merged] : isOff(i) ? [] : [i]))
}

/** "hood down", "shirt lift": how a garment is worn ("her hood down"); a phrase is used only when it says whose. */
function wornState(tag: string, possessive: string, entry: PhraseEntry | undefined): string {
  if (entry?.kind === "with" && entry.text.includes("{pos}")) return entry.text.replace(/\{pos\}/g, possessive)
  return `${possessive} ${tag.replace(/ lift$/, " lifted").replace(/ pull$/, " pulled")}`
}

function articleForScenery(tag: string): string {
  if (UNIQUE_NOUNS.has(tag)) return `the ${tag}`
  return withArticle(tag)
}

/**
 * `phrases` is the generated phrase dictionary (public/natural-prompt-phrases.json).
 * It is passed in rather than imported so the browser can load it lazily.
 * Hand-written wording in english.ts wins over it; the generic rules come last.
 */
export function describeScene(scene: Scene, givenPhrases: PhraseDictionary = {}, options: { compact?: boolean } = {}): SceneProse {
  const slotOf = tagSlots(scene)
  const phrases = withSpellingPhrases(givenPhrases, [...slotOf.keys(), ...scene.camera.framing, ...scene.camera.angle, ...scene.camera.gaze])
  const p = pronounsFor(scene)
  const Subject = capitalize(p.subject)
  const Possessive = capitalize(p.possessive)
  const is = p.plural ? "are" : "is"
  const has = p.plural ? "have" : "has"
  const wears = p.plural ? "wear" : "wears"
  // Experimental: in a point-of-view picture of a woman and a man, the man is the
  // camera, so the pose, the expression, the gaze and the traits nobody owns are hers.
  const pov = scene.povSubject
  const poseP: Pronouns = pov ? { subject: pov.name, possessive: "her", plural: false } : p
  const PoseSubject = pov ? capitalize(pov.name) : Subject
  const poseIs = pov ? "is" : is
  const raw: string[] = []
  const sayable = sayableTags(scene, phrases, p)
  const slot = (s: SceneSlot) => dropImplied(scene.slots[s] ?? [], sayable)
  // One person's tags that name one thing several ways become one phrase; a group's stay apart.
  const sameThing = (items: { tag: string; text: string }[], plural: boolean) => (plural
    ? items.map((i) => i.text)
    : mergeSameThing(items.map((i) => ({ ...i, several: SEVERAL_SLOTS.has(slotOf.get(i.tag) ?? "anatomy") }))))
  // Lists are built in priority order (the taxonomy slot order), so `compact`
  // keeps the first items of each and counts what it leaves out.
  let omitted = 0
  // Phrases already written in an earlier section ("completely naked" in the body,
  // then "completely nude" for the outfit). Words Danbooru aliases count as one
  // ("naked" and "nude", "curvaceous" and "curvy"), and so do body and figure, as
  // the dictionary writes both ("a curvy body", "a curvy figure").
  const said: string[] = []
  const sameAs = (text: string) => ` ${text.split(" ").map(canonicalWord).join(" ").replace(/\bbody\b/g, "figure")} `
  const tidy = (items: string[], max: number) => {
    const keys = new Set<string>()
    // A tag's qualifier is for the booru, not the sentence: "a lily (flower)" -> "a lily".
    const plain = items.map((item) => item.replace(/ \([^)]*\)/g, ""))
    const unique = dropContainedPhrases(plain).filter((item) => {
      const key = sameAs(item)
      if (keys.has(key) || said.some((done) => done.includes(key))) return false
      keys.add(key)
      return true
    })
    said.push(...unique.map(sameAs))
    if (!options.compact || unique.length <= max) return unique
    omitted += unique.length - max
    return unique.slice(0, max)
  }
  const dictionary = (tag: string) => {
    const entry = phrases[tag]
    if (!entry || entry.kind === "keep" || entry.kind === "none") return null
    const text = entry.text.replace(/\{pos\}/g, p.possessive)
    // Said of everyone, a mutual act has no one else to name: "hugging a partner" -> "hugging each other".
    return { kind: entry.kind, text: p.plural && entry.who === "together" ? eachOther(text) : text }
  }
  // Places, objects and creatures read a "scene" phrase as the noun itself.
  const nounPhrase = (tag: string) => (phrases[tag]?.kind === "scene" ? dictionary(tag)!.text : undefined)
  // Medium and style first: some style-slot tags describe the outfit or the setting instead.
  const styleParts = describeStyle(slot("style"), slot("layout"))
  const elsewhere = (kind: "being" | "prop" | "mood") => styleParts.elsewhere.filter((e) => e.kind === kind).map((e) => e.text)

  // Identity: name or count, species, cosplay, hair and eyes.
  // A trait one person was given ("light-skinned male") already says the shared one ("light skin").
  const saidOfSomeone = impliedTags(scene.assigned.flatMap((a) => Object.values(a.slots).flat()).filter((t): t is string => !!t))
  const anatomyAll = dropImplied([...(scene.slots.demographics ?? []).filter((t) => t !== "no humans"), ...(scene.slots.anatomy ?? [])], sayable).filter((t) => !saidOfSomeone.has(t))
  const species = p.plural ? [] : anatomyAll.filter((t) => SPECIES_RE.test(t))
  // A shared "long hair" says nothing once a character owns "very long hair".
  const ownedTraits = scene.assigned.flatMap((a) => [...(a.slots.hair ?? []), ...(a.slots.eyes ?? [])])
  const notOwned = (tag: string) => !ownedTraits.some((o) => o.endsWith(` ${tag}`) || o.startsWith(`${tag} `))
  // With a woman and a man, a trait the tags give to nobody is not everyone's ("They have
  // animal ears" would give them to a human man too): "One of them has ..." says no more than the tags.
  const open = p.plural && scene.girls > 0 && scene.boys > 0
  const Someone = pov ? PoseSubject : open ? "One of them" : Subject
  const [someoneIs, someoneHas, someoneWears] = open || pov ? ["is", "has", "wears"] : [is, has, wears]
  const clauses: SubjectClause[] = []
  /** A sentence of the main subject ("subject") or of "One of them" when `open`, recorded for the renderer. */
  const clause = (who: "subject" | "someone", verb: SubjectClause["verb"], predicate: string, tail: string[] = []) => {
    const subject = who === "someone" ? Someone : Subject
    const key = who === "someone" && open ? `someone ${clauses.length}` : "subject"
    const withTail = tail.length ? joinList(tail) : undefined
    const text = `${subject} ${predicate}${withTail ? `, with ${withTail}` : ""}.`
    clauses.push({ text, subject, key, verb, predicate, tail: withTail })
    return text
  }
  // Several hair colours nobody owns are several people's: "one has black hair, another blue hair".
  const sharedHair = slot("hair").filter(notOwned)
  const sharedColors = sharedHair.filter((t) => / hair$/.test(t) && HAIR_COLOR_RE.test(t.slice(0, -5)))
  const peopleCount = scene.girls + scene.boys + scene.others
  const splitColors = open && sharedColors.length > 1 && sharedColors.length <= peopleCount
  const colorSet = new Set(sharedColors)
  const colorSentence = splitColors
    ? `${sharedColors.map((c, i) => `${i === 0 ? "One of them has" : i === sharedColors.length - 1 ? "and another" : "another"} ${c}`).join(", ")}.`
    : ""
  const traits = [
    ...tidy(hairTraits(splitColors ? sharedHair.filter((t) => !colorSet.has(t)) : sharedHair, p.plural && !open), 3),
    ...tidy(eyeTraits(slot("eyes").filter(notOwned)), 1),
  ]
  const subject = subjectPhrase(scene, species)
  const identityTraits = open ? [] : traits
  const identity = subject
    ? `${subject}${identityTraits.length ? `, with ${joinList(identityTraits)}` : ""}`
    : identityTraits.length ? `A figure with ${joinList(identityTraits)}` : ""

  // Traits attributed to one person (attributeTraits), named or not ("The man"):
  // one sentence each, with that person's possessive and verbs. What is visible
  // ("The man's penis is visible.") goes with the body, at its lower priority.
  const described = scene.assigned.map(({ character, slots }) => {
    const possessive = possessivePronoun(character)
    const [isVerb, hasVerb, wearVerb, holdVerb] = character.plural ? ["are", "have", "wear", "hold"] : ["is", "has", "wears", "holds"]
    const own = (tag: string) => phrases[tag]?.text.replace(/\{pos\}/g, possessive)
    // Gendered tags read as adjectives (below), whatever slot they are in.
    const of = (s: SceneSlot) => dropImplied(slots[s] ?? [], sayable).filter((t) => !genderedTraits(t).length)
    // "muscular male", "embarrassed female": the adjective, whichever slot the tag is in.
    const genderedOwn = Object.values(slots).flat().filter((t): t is string => !!t)
      .flatMap((t) => genderedTraits(t).map((g) => g.trait)).filter((t) => !HAIR_COLOR_RE.test(t))
    const isList: string[] = []
    const hasBody: { tag: string; text: string }[] = []
    const withList: string[] = []
    const visibleList: string[] = []
    for (const t of dropImplied([...(slots.demographics ?? []), ...(slots.anatomy ?? [])], sayable)) {
      if (genderedTraits(t).length) continue
      const phrase = phrases[t]
      // "reptile girl", "a mature woman": what the person is, not something they have.
      if (SPECIES_RE.test(t)) isList.push(withArticle(t))
      else if (phrase?.kind === "is") isList.push(own(t)!)
      else if (phrase?.kind === "with") withList.push(own(t)!)
      else if (phrase) hasBody.push({ tag: t, text: own(t)! })
      else if (BODY_ADJECTIVES.has(t)) isList.push(t)
      else if (BODY_VISIBLE.has(t)) visibleList.push(t)
      else hasBody.push({ tag: t, text: isPluralNoun(t) ? t : withArticle(t) })
    }
    const wearing: { tag: string; text: string }[] = []
    for (const t of CLOTHING_ORDER.flatMap(of)) {
      // "leotard aside": how a garment is worn ("with her leotard aside"), not another garment.
      if (WORN_STATE_RE.test(t)) { withList.push(wornState(t, possessive, phrases[t])); continue }
      const c = clothingPhrase(t, possessive, phrases[t])
      if (c.kind === "wears") wearing.push({ tag: t, text: c.text })
      else (c.kind === "with" ? withList : c.kind === "is" ? isList : raw).push(c.text)
    }
    // Several people together ("the women") are not all "smaller": one of them is.
    const oneOf = character.plural ? oneOfSentence({ label: `one of ${character.name}`, plural: false, possessive }, tidy(genderedOwn, 3)) : ""
    const isText = tidy([...(character.plural ? [] : genderedOwn), ...isList], 3)
    const hasList = tidy([...hairTraits(of("hair")), ...eyeTraits(of("eyes")), ...sameThing(hasBody, !!character.plural)], 4)
    const wearList = tidy(sameThing(garmentsFirst(wearing), !!character.plural), 4)
    const items = describeItems([...(slots.weapon ?? []), ...(slots.handheld ?? [])], possessive, sayable, (t) => (phrases[t]?.kind === "scene" ? own(t)! : withArticle(t)))
    const holdList = tidy([...items.held, ...items.loose], 2)
    const withText = tidy(mergeTakenOff(withList), 2)
    const clauses = [
      isText.length ? `${isVerb} ${joinList(isText)}` : "",
      hasList.length ? `${hasVerb} ${joinList(hasList)}` : "",
      wearList.length ? `${wearVerb} ${joinList(wearList)}` : "",
      holdList.length ? `${holdVerb} ${joinList(holdList)}` : "",
    ].filter(Boolean)
    const name = character.generic ? capitalize(character.name) : character.name
    const withPart = withText.length ? `, with ${joinList(withText)}` : ""
    let main = ""
    if (clauses.length) {
      const last = clauses.pop()!
      main = `${name} ${clauses.length ? `${clauses.join(", ")}, and ${last}` : last}${withPart}.`
    } else if (withText.length) {
      main = `${name} ${isVerb} shown with ${joinList(withText)}.`
    }
    return { named: !character.generic, text: [main, oneOf].filter(Boolean).join(" "), visible: visibleSentence(character.name, tidy(visibleList, 3)) }
  })
  const characters = described.filter((d) => d.named && d.text).map((d) => d.text)

  // Body. Relations ("couple", "husband and wife") are filed in several slots, or none.
  const relationTags = [...new Set([...anatomyAll, ...Object.values(scene.slots).flat(), ...scene.unclassified])]
    .filter((t): t is string => !!t && RELATIONS.has(t))
  const relations = dropImplied(relationTags).map((t) => RELATION_WORDING[t] ?? t)
  const speciesSet = new Set(species)
  const anatomy = anatomyAll.filter((t) => !speciesSet.has(t) && !RELATIONS.has(t))

  // A gendered tag nobody could be given ("dark-skinned female" among several women)
  // describes one of them, not all: "One of the women is dark-skinned."
  const roles = p.plural ? sceneRoles(scene) : null
  const oneOf = new Map<string, { role: Role; traits: string[] }>()
  // "curvy female", "muscular male": the adjective is the description; "blonde female" repeats the hair.
  const hairColors = new Set(slot("hair").map((h) => h.replace(/ hair$/, "")))
  const gendered = (tag: string, fallback: string[]) => {
    const traits = genderedTraits(tag)
    for (const { gender, trait } of traits) {
      if (hairColors.has(trait) || HAIR_COLOR_RE.test(trait)) continue
      const role = roles?.one(gender)
      if (!role) { fallback.push(trait); continue }
      if (!oneOf.has(role.label)) oneOf.set(role.label, { role, traits: [] })
      oneOf.get(role.label)!.traits.push(trait)
    }
    return traits.length > 0
  }
  const bodyAdjectives = anatomy.filter((t) => BODY_ADJECTIVES.has(t))
  const visible = anatomy.filter((t) => BODY_VISIBLE.has(t))
  const bodyNouns: { tag: string; text: string }[] = []
  const bodyWith: string[] = []
  // A noun phrase ("a mature woman") cannot follow "They are"; with several people it gets its own sentence.
  const bodyRoles: string[] = []
  const demographics = new Set(scene.slots.demographics ?? [])
  const demographicPhrase = (tag: string) => {
    if (!demographics.has(tag)) return null
    if (DEMOGRAPHIC_WORDING[tag]) return { kind: "is" as const, text: DEMOGRAPHIC_WORDING[tag] }
    return PERSON_NOUN_RE.test(tag) ? { kind: "is" as const, text: withArticle(tag) } : null
  }
  for (const tag of anatomy) {
    if (BODY_ADJECTIVES.has(tag) || BODY_VISIBLE.has(tag)) continue
    if (gendered(tag, bodyAdjectives)) continue
    const phrase = dictionary(tag) ?? demographicPhrase(tag)
    if (phrase?.kind === "is" && p.plural && /^an? /.test(phrase.text)) bodyRoles.push(phrase.text)
    else if (phrase?.kind === "is") bodyAdjectives.push(phrase.text)
    else if (phrase?.kind === "with") bodyWith.push(phrase.text)
    else if (phrase) bodyNouns.push({ tag, text: phrase.text })
    else if (demographics.has(tag)) raw.push(tag)
    else bodyNouns.push({ tag, text: isPluralNoun(tag) ? tag : withArticle(tag) })
  }
  // What a gendered tag says of one person ("clothed female nude male") is not said of everyone ("They are nude").
  const personal = new Set([
    ...scene.assigned.flatMap((a) => Object.values(a.slots).flat().flatMap((t) => (t ? genderedTraits(t).map((g) => g.trait) : []))),
    ...[...oneOf.values()].flatMap((o) => o.traits),
  ])
  const notPersonal = (text: string) => !personal.has(text)
  const adjectiveList = tidy(bodyAdjectives.filter(notPersonal), 3)
  const roleList = tidy(bodyRoles, 1)
  const nounList = [...(open ? traits : []), ...tidy(sameThing(bodyNouns, p.plural && !open), 4)]
  // Women only, one of them a futanari the tags do not name: the male anatomy is one of them's, not theirs.
  const futaGroup = p.plural && scene.boys === 0 && [...scene.subjectTags, ...Object.values(scene.slots).flat()].some((t) => !!t && FUTA_RE.test(t))
  const maleVisible = futaGroup ? visible.filter((t) => MALE_PART_RE.test(t)) : []
  const visibleList = tidy(visible.filter((t) => !futaGroup || !MALE_PART_RE.test(t)), 3)
  const maleVisibleList = tidy(maleVisible, 2)
  const bodyWithList = tidy(bodyWith, 2)
  const body = [
    colorSentence,
    adjectiveList.length ? clause("someone", "is", `${someoneIs} ${joinList(adjectiveList)}`) : "",
    roleList.length ? `One of them is ${joinList(roleList)}.` : "",
    nounList.length ? clause("someone", "has", `${someoneHas} ${joinList(nounList)}`) : "",
    visibleList.length ? `${Possessive} ${joinList(visibleList)} ${visibleList.length > 1 || takesPluralVerb(visibleList[0]) ? "are" : "is"} visible.` : "",
    maleVisibleList.length ? `One of them has their ${joinList(maleVisibleList)} visible.` : "",
    bodyWithList.length ? clause("someone", "shown", `${someoneIs} shown with ${joinList(bodyWithList)}`) : "",
    relations.length ? `They are ${joinList(relations)}.` : "",
    ...described.map((d) => d.visible),
  ].filter(Boolean).join(" ")

  // Clothing: garments, then how the outfit is worn.
  const clothingTags = dropImplied(CLOTHING_ORDER.flatMap((s) => scene.slots[s] ?? []), sayable)
  const states = clothingTags.filter(isClothingState)
  const worn = clothingTags.filter((t) => !isClothingState(t) && WORN_STATE_RE.test(t))
  const adjectives = states.filter((t) => OUTFIT_ADJECTIVES.has(t)).map((t) => OUTFIT_WORDING[t] ?? t.replace(/ clothes$/, ""))
  const beings = [...states.filter((t) => BEING_STATES[t]).map((t) => BEING_STATES[t]), ...elsewhere("being")]
  const showing = states.filter((t) => !OUTFIT_ADJECTIVES.has(t) && !BEING_STATES[t] && !bareState(t, "")).map((t) => (/cutout$/.test(t) ? withArticle(t) : t))
  // "bare shoulders": the body, said with the outfit ("..., with her shoulders bare").
  const wornPhrases = [...worn.map((t) => wornState(t, p.possessive, phrases[t])), ...states.flatMap((t) => bareState(t, p.possessive) ?? [])]
  const garments: { tag: string; text: string }[] = []
  for (const tag of clothingTags) {
    if (gendered(tag, beings)) continue
    if (isClothingState(tag) || WORN_STATE_RE.test(tag)) continue
    const c = clothingPhrase(tag, p.possessive, phrases[tag])
    if (c.kind === "wears") garments.push({ tag, text: c.text })
    else (c.kind === "with" ? wornPhrases : c.kind === "is" ? beings : raw).push(c.text)
  }
  const garmentList = tidy(sameThing(garmentsFirst(garments), p.plural && !open), 5)
  const wornList = tidy(mergeTakenOff(wornPhrases), 2)
  const adjectiveOutfit = tidy(adjectives, 2)
  const beingList = tidy(beings.filter(notPersonal), 2)
  const showingList = tidy(showing, 2)
  // Nobody in the picture ("no humans"): the garments are things in it, not worn.
  const noOne = scene.girls + scene.boys + scene.others === 0 && !scene.characters.length && (scene.slots.demographics ?? []).includes("no humans")
  const clothing = [
    garmentList.length && noOne ? `The image shows ${joinList(garmentList)}.` : "",
    garmentList.length && !noOne ? clause("someone", "wears", `${someoneWears} ${joinList(garmentList)}`, wornList) : "",
    !garmentList.length && wornList.length ? clause("someone", "shown", `${someoneIs} shown with ${joinList(wornList)}`) : "",
    adjectiveOutfit.length ? `${Possessive} outfit is ${joinList(adjectiveOutfit)}.` : "",
    beingList.length ? clause("subject", "is", `${is} ${joinList(beingList)}`) : "",
    showingList.length ? `The outfit shows ${joinList(showingList)}.` : "",
  ].filter(Boolean).join(" ")
  // The main garments, for when the whole outfit does not fit the word budget: better than no outfit.
  const clothingShort = garmentList.length > 3 || (garmentList.length && wornList.length)
    ? noOne ? `The image shows ${joinList(garmentList.slice(0, 3))}.` : clause("someone", "wears", `${someoneWears} ${joinList(garmentList.slice(0, 3))}`)
    : ""

  // Held and carried items, each said once (see describeItems).
  const holdsSomething = POSE_ORDER.some((s) => scene.slots[s]?.includes("holding"))
  const items = describeItems([...(scene.slots.weapon ?? []), ...(scene.slots.handheld ?? [])], p.possessive, sayable, (t) => nounPhrase(t) ?? withArticle(t), holdsSomething)
  const heldList = tidy(items.held, 2)
  const looseList = tidy(items.loose, 2)
  const held = [
    heldList.length ? clause("subject", "holds", `${is} holding ${joinList(heldList)}`) : "",
    looseList.length ? clause("subject", "has", `${has} ${joinList(looseList)}`) : "",
  ].filter(Boolean).join(" ")

  // Pose, expression and gaze in one sentence (in a point-of-view picture, hers: see `pov`).
  const poseDictionary = (tag: string) => {
    if (!pov) return dictionary(tag)
    const entry = phrases[tag]
    if (!entry || entry.kind === "keep" || entry.kind === "none") return null
    return { kind: entry.kind, text: entry.text.replace(/\{pos\}/g, poseP.possessive) }
  }
  const statesOut: string[] = []
  const withs: string[] = []
  const extraFraming: string[] = []
  const extraMood: string[] = []
  // Phrases of the shared sentence with their tags, so poses of several bodies can be told apart (splitPoses).
  const posed: { tag: string; kind: "state" | "with"; text: string }[] = []
  // A pair tag filed elsewhere ("clothed female nude male") already says what "clothed sex" would.
  const impliedElsewhere = impliedTags(Object.values(scene.slots).flat().filter((t): t is string => !!t))
  const poseTags = dropImplied([...POSE_ORDER.flatMap((s) => scene.slots[s] ?? []), ...(scene.slots.expression ?? [])], sayable).filter((t) => !impliedElsewhere.has(t))
  // Acts with a known subject ("The man is performing oral sex on the woman"), one sentence per person.
  const acts = new Map<string, { role: Role; states: string[]; withs: string[] }>()
  for (const tag of poseTags) {
    if (tag === "holding" || RELATIONS.has(tag)) continue
    // "embarrassed female": an adjective for that person, not "an embarrassed woman".
    if (gendered(tag, statesOut)) continue
    const phrased = phrases[tag]?.kind === "keep" ? undefined : phrases[tag]
    // A phrase that needs more people than the picture has ("between two partners" with two women) describes another picture.
    if (phrased && peopleNamed(phrased.text) > (roles?.count ?? 1)) { raw.push(tag); continue }
    // With several people, a pairing tag ("human on anthro": "an anthropomorphic partner") only says who is there.
    if (roles && phrased?.kind === "with" && onlyPartners(phrased.text)) continue
    // Said of everyone, an act on someone else adds a person ("They are standing behind another person"): it is one of theirs.
    const asAct = roles && phrased && !phrased.who && namesPartner(phrased.text) ? { ...phrased, who: "doer" as const, partner: "anyone" as const } : phrases[tag]
    const act = roleAct(tag, asAct, roles)
    if (act) {
      if (!acts.has(act.role.label)) acts.set(act.role.label, { role: act.role, states: [], withs: [] })
      const entry = acts.get(act.role.label)!
      ;(phrases[tag]?.kind === "with" ? entry.withs : entry.states).push(act.text)
      continue
    }
    const curated = lexiconPhrase(tag, poseP)
    if (curated) { posed.push({ tag, kind: curated.kind, text: curated.text }); continue }
    const phrase = poseDictionary(tag)
    if (phrase) {
      if (phrase.kind === "is") posed.push({ tag, kind: "state", text: phrase.text })
      else if (phrase.kind === "framing") extraFraming.push(phrase.text)
      else if (phrase.kind === "scene") extraMood.push(phrase.text)
      else posed.push({ tag, kind: "with", text: phrase.text })
      continue
    }
    const ruled = posePhrase(tag, poseP) ?? expressionPhrase(tag, poseP)
    if (!ruled) { raw.push(tag); continue }
    posed.push({ tag, kind: ruled.kind, text: ruled.text })
  }
  // Two people can be one lying and one standing, but not both at once: poses one body
  // cannot hold together go to different people ("One of them ..., and another ...").
  const groups = roles && !pov ? splitPoses(posed) : []
  const apart = new Set(groups.length > 1 && groups.length <= roles!.count ? groups.flat() : [])
  // A face is one person's: with a woman and a man, an expression the tags give to nobody is "one of them"'s.
  const expressions = new Set(open && !pov ? scene.slots.expression ?? [] : [])
  const faces = { states: [] as string[], withs: [] as string[] }
  for (const x of posed) {
    if (apart.has(x)) continue
    if (expressions.has(x.tag)) (x.kind === "state" ? faces.states : faces.withs).push(x.text)
    else (x.kind === "state" ? statesOut : withs).push(x.text)
  }
  const posesApart = apart.size
    ? posesSentence(groups.map((g) => ({ states: tidy(g.filter((x) => x.kind === "state").map((x) => x.text), 2), withs: tidy(g.filter((x) => x.kind === "with").map((x) => x.text), 2) })))
    : ""
  const faceStates = tidy(faces.states, 3)
  const faceWiths = tidy(faces.withs, 2)
  const faceSentence = faceStates.length
    ? `One of them is ${joinList(faceStates)}${faceWiths.length ? `, with ${joinList(faceWiths)}` : ""}.`
    : faceWiths.length ? `One of them is shown with ${joinList(faceWiths)}.` : ""
  statesOut.push(...dropImplied(scene.camera.gaze, sayable).map((t) => (poseDictionary(t)?.kind === "is" ? poseDictionary(t)!.text : gazePhrase(t, poseP))))
  const stateList = tidy(mergeSharedPrefix(statesOut), 4)
  const withList = tidy(mergeSharedPrefix(withs), 3)
  let pose = ""
  if (stateList.length) pose = `${PoseSubject} ${poseIs} ${joinList(stateList)}${withList.length ? `, with ${joinList(withList)}` : ""}.`
  else if (withList.length) pose = `${PoseSubject} ${poseIs} shown with ${joinList(withList)}.`
  // The short form keeps what they do with someone ("having sex", "hugging") over how they stand.
  const interactionTexts = new Set((scene.slots.interaction ?? []).flatMap((t) => [poseDictionary(t)?.text, lexiconPhrase(t, poseP)?.text].filter(Boolean)))
  const firstActions = [...stateList.filter((s) => interactionTexts.has(s)), ...stateList.filter((s) => !interactionTexts.has(s))].slice(0, 2)
  const poseShort = stateList.length > 2 || (stateList.length && withList.length) ? `${PoseSubject} ${poseIs} ${joinList(firstActions)}.` : ""
  const actSentences = [...acts.values()].map(({ role, states: done, withs: shown }) => {
    const Label = capitalize(role.label)
    const verb = role.plural ? "are" : "is"
    const doing = tidy(done, 2)
    const extra = tidy(shown, 1)
    // "One of the men" is nobody in particular: two of his acts may be two men's,
    // so each is its own clause ("One of the men is A, one is B, and one is C"),
    // but never more clauses than there are people: two women's three acts stay one sentence.
    const pool = role.pool === "female" ? scene.girls : role.pool === "male" ? scene.boys : roles?.count ?? 0
    const clauses = [...doing.map((d) => `${verb} ${d}`), ...extra.map((e) => `${verb} shown with ${e}`)]
    if (!role.person && clauses.length > 1 && clauses.length <= pool) {
      const rest = clauses.slice(1).map((c, i) => `${i === clauses.length - 2 ? "and " : ""}one ${c}`)
      return `${Label} ${clauses[0]}, ${rest.join(", ")}.`
    }
    if (doing.length) return `${Label} ${verb} ${joinList(doing)}${extra.length ? `, with ${joinList(extra)}` : ""}.`
    return extra.length ? `${Label} ${verb} shown with ${joinList(extra)}.` : ""
  })
  pose = [pose, faceSentence, posesApart, ...actSentences].filter(Boolean).join(" ")

  // Setting.
  const sceneryTags = dropImplied([...(scene.slots.setting ?? []), ...(scene.slots.props ?? [])], sayable)
  const atmosphere = slot("atmosphere")
  const adverbs = sceneryTags.filter((t) => ADVERB_PLACES.has(t))
  const times = atmosphere.filter((t) => TIME_PHRASES[t]).map((t) => TIME_PHRASES[t])
  const backgrounds = sceneryTags.filter((t) => / background$/.test(t))
  // "scenery" only says the background is detailed; the place tags carry the content.
  const places = tidy(sceneryTags.filter((t) => !ADVERB_PLACES.has(t) && !/ background$/.test(t) && t !== "scenery"), 4)
  // A room is where the scene takes place ("in a bedroom"), not something it is "with".
  const room = !adverbs.length || adverbs[0] === "indoors" ? places.find((t) => ROOM_RE.test(t)) : undefined
  const placeText = (t: string) => nounPhrase(t) ?? articleForScenery(t)
  const placeTexts = [...places.filter((t) => t !== room).map(placeText), ...tidy(elsewhere("prop"), 2)]
  const settingParts: string[] = []
  if (room) {
    settingParts.push(`The scene takes place in ${placeText(room)}${times.length ? ` ${times.join(" ")}` : ""}${placeTexts.length ? `, with ${joinList(placeTexts)}` : ""}.`)
  } else if (adverbs.length || times.length) {
    settingParts.push(`The scene takes place ${[adverbs[0], ...times].filter(Boolean).join(" ")}${placeTexts.length ? `, with ${joinList(placeTexts)}` : ""}.`)
  } else if (placeTexts.length) {
    settingParts.push(`The background features ${joinList(placeTexts)}.`)
  }
  const allBackgrounds = scene.slots.setting?.filter((t) => / background$/.test(t)) ?? []
  if (backgrounds.length || allBackgrounds.length) {
    // "no background" and "transparent background" read as a plain one.
    const plain = allBackgrounds.some((b) => /^(simple|no|transparent) background$/.test(b))
    const others = allBackgrounds.filter((b) => !/^(simple|no|transparent) background$/.test(b)).map((b) => b.replace(/ background$/, ""))
    const kind = others.length ? `${joinList(others)} background` : "background"
    settingParts.push(`It is set against ${withArticle(`${plain ? "plain " : ""}${kind}`)}.`)
  }
  const setting = settingParts.join(" ")

  // Lighting and effects.
  const lightingAdjectives = atmosphere.filter((t) => / lighting$/.test(t)).map((t) => t.slice(0, -9))
  const effects = atmosphere.filter((t) => EFFECTS_RE.test(t))
  const moodTags = atmosphere.filter((t) => !TIME_PHRASES[t] && !/ lighting$/.test(t) && !EFFECTS_RE.test(t))
  // A lone adjective with no phrase ("shiny") would read as "a shiny"; keep it as a raw tag instead.
  const moodAdjectives = moodTags.filter((t) => dictionary(t)?.kind !== "scene" && /^[a-z]+(y|ed|ful|ous)$/.test(t) && !UNIQUE_NOUNS.has(t))
  raw.push(...moodAdjectives)
  const moodAdjectiveSet = new Set(moodAdjectives)
  const mood = [
    ...moodTags
      .filter((t) => !moodAdjectiveSet.has(t))
      .map((t) => (dictionary(t)?.kind === "scene" ? dictionary(t)!.text : isPluralNoun(t) || /^(rain|snow|fog|mist|steam|wind|smoke|fire|water)$/.test(t) ? t : withArticle(t))),
    ...extraMood,
    ...elsewhere("mood"),
  ]
  const lightList = tidy(lightingAdjectives, 2)
  const moodList = tidy(mood, 3)
  const effectList = tidy(effects.map((t) => (/^(depth of field|bokeh|motion blur|film grain|chromatic aberration|light particles|light rays)$/.test(t) ? t : withArticle(t))), 2)
  const lighting = [
    lightList.length ? `The lighting is ${joinList(lightList)}.` : "",
    moodList.length ? `The atmosphere includes ${joinList(moodList)}.` : "",
    effectList.length ? `The image has ${joinList(effectList)}.` : "",
  ].filter(Boolean).join(" ")

  // Camera.
  // A framing the angle already says goes ("a first-person view", "seen from a first-person point of view").
  const anglePhrases = scene.camera.angle.map((t) => anglePhrase(t, dictionary(t)?.text))
  const framings = [...dropImplied(scene.camera.framing, sayable).map((t) => framingPhrase(t, dictionary(t)?.text)), ...extraFraming]
    .filter((f) => !anglePhrases.some((a) => saysAll(a, f)))
  // The shot first, then what it focuses on: "a full-body shot, focused on the buttocks".
  const isFocus = (f: string) => f.startsWith("focused on ")
  const framing = tidy([...framings.filter((f) => !isFocus(f)), ...framings.filter(isFocus)], 1)
  const framingText = [joinList(framing.filter((f) => !isFocus(f))), joinList(framing.filter(isFocus))].filter(Boolean).join(", ")
  const angle = tidy(anglePhrases, 1)
  const camera = framing.length
    ? `The image is ${framingText}${angle.length ? `, ${joinList(angle)}` : ""}.`
    : angle.length ? `The image is ${joinList(angle)}.` : ""

  // Style (see style.ts), layout and other elements.
  const style = styleParts.sentence
  raw.push(...styleParts.raw)
  // In a furry picture the animal tags are the people's own species ("arctic fox, canid,
  // canine"), not more creatures: the most specific says what they are, the ranks say nothing more.
  const sceneTags = [...scene.subjectTags, ...Object.values(scene.slots).flat()].filter((t): t is string => !!t)
  const furry = sceneTags.some((t) => FURRY_RE.test(t))
  const animalTags = slot("animal")
  const animalSpecies = furry
    ? dropImplied([...new Set(animalTags.filter((t) => !TAXON_RANKS.has(t)).map((t) => t.replace(/^(?:female|male) /, "")))], sayable)
    : []
  const animals = furry ? [] : tidy(animalTags.map((t) => nounPhrase(t) ?? withArticle(t)), 2)
  // With a human in the picture too ("human on anthro"), the species is only one of them's.
  const allFurry = !p.plural || !sceneTags.some((t) => HUMAN_PARTNER_RE.test(t))
  const speciesList = tidy(animalSpecies.map((t) => (p.plural && allFurry ? pluralNoun(t) : withArticle(`anthropomorphic ${t}`))), 2)
  const speciesSentence = !speciesList.length ? ""
    : !p.plural ? clause("subject", "is", `${is} ${joinList(speciesList)}`)
      : allFurry ? `They are anthropomorphic ${joinList(speciesList)}.` : `One of them is ${joinList(speciesList)}.`
  const extras = [
    speciesSentence,
    animals.length ? `There ${animals.length > 1 || takesPluralVerb(animals[0]) ? "are" : "is"} also ${joinList(animals)}.` : "",
    describeLayout(slot("layout"), nounPhrase),
  ].filter(Boolean).join(" ")

  const people = [
    ...described.filter((d) => !d.named && d.text).map((d) => d.text),
    ...[...oneOf.values()].map(({ role, traits: adjectives }) => oneOfSentence(role, tidy(adjectives, 3))),
  ].filter(Boolean)

  raw.push(...scene.unclassified.filter((t) => !RELATIONS.has(t)))
  // "dual persona" is said by the subject ("two versions of Shelly").
  const rawLeft = selfVersions(scene) ? raw.filter((t) => !SELF_RE.test(t)) : raw
  return { medium: styleParts.medium, identity, characters, people, body, clothing, clothingShort, held, pose, poseShort, setting, lighting, camera, style, extras, pronouns: p, raw: rawLeft, omitted, clauses }
}
