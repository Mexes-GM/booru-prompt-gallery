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
  PRONOUNS,
  type Pronouns,
  anglePhrase,
  capitalize,
  dropImplied,
  expressionPhrase,
  framingPhrase,
  gazePhrase,
  isClothingState,
  isPluralNoun,
  joinList,
  lexiconPhrase,
  posePhrase,
  withArticle,
} from "./english"

/**
 * How a dictionary phrase plugs into a sentence: "is" continues "She is ___",
 * "with" continues "..., with ___", "has" continues "She has ___", "wears"
 * continues "She wears ___", "framing" continues "The image is ___", "scene" is
 * a noun phrase for the atmosphere. `{pos}` stands for the possessive pronoun.
 */
export type PhraseKind = "is" | "with" | "has" | "wears" | "framing" | "scene"
export type PhraseDictionary = Record<string, { kind: PhraseKind; text: string }>

export interface SceneProse {
  /** "Yor Briar from Spy x Family, with long black hair and red eyes" (no final period). */
  identity: string
  body: string
  clothing: string
  held: string
  pose: string
  setting: string
  lighting: string
  camera: string
  style: string
  extras: string
  pronouns: Pronouns
  /** Tags no phrase rule could place, still to be rendered verbatim. */
  raw: string[]
}

const NUMBER_WORDS = ["no", "a", "two", "three", "four", "five", "six"]

const HAIR_LENGTHS = ["absurdly long", "very long", "long", "medium", "short", "very short"]
const HAIR_COLOR_RE = /^((light|dark) )?(black|white|blonde|blond|brown|red|orange|yellow|green|aqua|blue|purple|pink|grey|gray|silver|rainbow)$/
const HAIR_PATTERN = new Set(["multicolored", "two-tone", "gradient", "streaked", "colored inner", "split-color"])
const HAIR_TEXTURE = new Set(["wavy", "curly", "straight", "messy", "spiked", "drill", "fluffy"])
const HAIR_ACCESSORY_RE = /(ornament|ribbon|bow|flower|clip|band|tie|bun|pin|scrunchie|bobbles|bell|stick|tubes)$/

const BODY_ADJECTIVES = new Set([
  "curvy", "slim", "slender", "petite", "muscular", "plump", "skinny", "tall", "short", "toned", "chubby",
  "thick", "androgynous", "furry", "nude", "naked", "wet", "sweaty", "pregnant", "tan", "tanned", "pale",
])
// Body parts named because they are visible, not because the subject "has" them.
const BODY_VISIBLE = new Set([
  "navel", "midriff", "collarbone", "stomach", "armpits", "cleavage", "nipples", "thighs", "ass",
  "back", "shoulders", "abs", "ribs", "feet", "toes", "groin", "pussy", "penis", "anus", "testicles",
])
const SPECIES_RE = / (girl|boy)$/
const GENDERED_RE = /^(.+) (female|male)$/
const RELATIONS = new Set(["siblings", "sisters", "brothers", "twins", "couple", "friends", "mother and daughter", "father and daughter", "mother and son", "brother and sister"])
// More names than this read as a list, not a description.
const MAX_NAMED_CHARACTERS = 4

const CLOTHING_ORDER: SceneSlot[] = ["outfit", "top", "bottom", "underwear", "legwear", "footwear", "headwear", "eyewear", "accents"]
const POSE_ORDER: SceneSlot[] = ["posture", "kinetic", "combat", "interaction", "gesture", "physiological"]

const OUTFIT_ADJECTIVES = new Set(["sleeveless", "strapless", "backless", "see-through", "off shoulder", "off-shoulder", "single off shoulder", "highleg", "open clothes", "torn clothes", "wet clothes", "taut clothes"])
const OUTFIT_WORDING: Record<string, string> = {
  "single off shoulder": "off one shoulder",
  "off shoulder": "off-shoulder",
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

const ADVERB_PLACES = new Set(["outdoors", "indoors", "underwater", "outside", "inside"])
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
  return scene.characters.length === 1 ? PRONOUNS.her : PRONOUNS.their
}

function countPhrase(n: number, noun: string): string {
  if (n <= 0) return ""
  return `${NUMBER_WORDS[n] ?? String(n)} ${noun}${n > 1 ? "s" : ""}`
}

function subjectPhrase(scene: Scene, species: string[]): string {
  let subject = ""
  if (scene.characters.length > 0) {
    const all = scene.characters.map((c) => c.name)
    const names = all.length > MAX_NAMED_CHARACTERS
      ? `a crowd of characters including ${all.slice(0, MAX_NAMED_CHARACTERS).join(", ")} and others`
      : joinList(all)
    const series = scene.series.slice(0, 2)
    subject = series.length ? `${names} from ${joinList(series)}` : names
  } else {
    const parts = [
      countPhrase(scene.girls, "girl"),
      countPhrase(scene.boys, "boy"),
      countPhrase(scene.others, "character"),
    ].filter(Boolean)
    if (parts.length) subject = joinList(parts)
    else if ((scene.slots.demographics ?? []).includes("no humans")) subject = "a scene with no people"
  }
  if (!subject) return ""
  const appositive = [
    species.length ? joinList(species.map(withArticle)) : "",
    scene.cosplayAs.length ? `cosplaying as ${joinList(scene.cosplayAs)}` : "",
  ].filter(Boolean).join(", ")
  return appositive ? `${subject}, ${appositive}` : subject
}

function hairTraits(hair: string[]): string[] {
  const length = HAIR_LENGTHS.find((l) => hair.includes(`${l} hair`))
  const colors: string[] = []
  const descriptors: string[] = []
  const rest: string[] = []
  for (const tag of hair) {
    if (length && tag === `${length} hair`) continue
    const base = tag.endsWith(" hair") ? tag.slice(0, -5) : null
    if (base && HAIR_COLOR_RE.test(base)) colors.push(base)
    else if (base && (HAIR_TEXTURE.has(base) || HAIR_PATTERN.has(base))) descriptors.push(base)
    else rest.push(HAIR_ACCESSORY_RE.test(tag) || /^(ponytail|braid|ahoge)$/.test(tag) ? withArticle(tag) : tag)
  }
  const traits: string[] = []
  if (length || colors.length || descriptors.length) {
    traits.push(`${[length, ...descriptors, joinList(colors)].filter(Boolean).join(" ")} hair`)
  }
  return [...traits, ...rest]
}

function eyeTraits(eyes: string[]): string[] {
  const colors = eyes.filter((e) => / eyes$/.test(e)).map((e) => e.slice(0, -5))
  const rest = eyes.filter((e) => !/ eyes$/.test(e))
  return [...(colors.length ? [`${joinList(colors)} eyes`] : []), ...rest]
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
export function describeScene(scene: Scene, phrases: PhraseDictionary = {}): SceneProse {
  const p = pronounsFor(scene)
  const Subject = capitalize(p.subject)
  const Possessive = capitalize(p.possessive)
  const is = p.plural ? "are" : "is"
  const has = p.plural ? "have" : "has"
  const wears = p.plural ? "wear" : "wears"
  const raw: string[] = []
  const slot = (s: SceneSlot) => dropImplied(scene.slots[s] ?? [])
  const dictionary = (tag: string) => {
    const entry = phrases[tag]
    return entry ? { kind: entry.kind, text: entry.text.replace(/\{pos\}/g, p.possessive) } : null
  }

  // Identity: name or count, species, cosplay, hair and eyes.
  const anatomyAll = dropImplied([...(scene.slots.demographics ?? []).filter((t) => t !== "no humans"), ...(scene.slots.anatomy ?? [])])
  const species = p.plural ? [] : anatomyAll.filter((t) => SPECIES_RE.test(t))
  const traits = [...hairTraits(slot("hair")), ...eyeTraits(slot("eyes"))]
  const subject = subjectPhrase(scene, species)
  const identity = subject
    ? `${subject}${traits.length ? `, with ${joinList(traits)}` : ""}`
    : traits.length ? `A figure with ${joinList(traits)}` : ""

  // Body.
  const relations = anatomyAll.filter((t) => RELATIONS.has(t))
  const speciesSet = new Set(species)
  const anatomy = anatomyAll.filter((t) => !speciesSet.has(t) && !RELATIONS.has(t))
  const bodyAdjectives = anatomy.filter((t) => BODY_ADJECTIVES.has(t))
  const visible = anatomy.filter((t) => BODY_VISIBLE.has(t))
  const bodyNouns: string[] = []
  const bodyWith: string[] = []
  // A noun phrase ("a mature woman") cannot follow "They are"; with several people it gets its own sentence.
  const bodyRoles: string[] = []
  const hairColors = new Set(slot("hair").map((h) => h.replace(/ hair$/, "")))
  for (const tag of anatomy) {
    if (BODY_ADJECTIVES.has(tag) || BODY_VISIBLE.has(tag)) continue
    // "curvy female", "mature female": the adjective is the description; "blonde female" repeats the hair.
    const gendered = tag.match(GENDERED_RE)
    if (gendered) {
      if (!hairColors.has(gendered[1]) && !HAIR_COLOR_RE.test(gendered[1])) bodyAdjectives.push(gendered[1])
      continue
    }
    const phrase = dictionary(tag)
    if (phrase?.kind === "is" && p.plural && /^an? /.test(phrase.text)) bodyRoles.push(phrase.text)
    else if (phrase?.kind === "is") bodyAdjectives.push(phrase.text)
    else if (phrase?.kind === "with") bodyWith.push(phrase.text)
    else if (phrase) bodyNouns.push(phrase.text)
    else bodyNouns.push(isPluralNoun(tag) ? tag : withArticle(tag))
  }
  const adjectiveList = [...new Set(bodyAdjectives)]
  const body = [
    adjectiveList.length ? `${Subject} ${is} ${joinList(adjectiveList)}.` : "",
    bodyRoles.length ? `One of them is ${joinList(bodyRoles)}.` : "",
    bodyNouns.length ? `${Subject} ${has} ${joinList(bodyNouns)}.` : "",
    visible.length ? `${Possessive} ${joinList(visible)} ${visible.length > 1 || /s$/.test(visible[0]) ? "are" : "is"} visible.` : "",
    bodyWith.length ? `${Subject} ${is} shown with ${joinList(bodyWith)}.` : "",
    relations.length ? `They are ${joinList(relations)}.` : "",
  ].filter(Boolean).join(" ")

  // Clothing: garments, then how the outfit is worn.
  const clothingTags = dropImplied(CLOTHING_ORDER.flatMap((s) => scene.slots[s] ?? []))
  const states = clothingTags.filter(isClothingState)
  const worn = clothingTags.filter((t) => !isClothingState(t) && WORN_STATE_RE.test(t))
  const adjectives = states.filter((t) => OUTFIT_ADJECTIVES.has(t)).map((t) => OUTFIT_WORDING[t] ?? t.replace(/ clothes$/, ""))
  const beings = states.filter((t) => BEING_STATES[t]).map((t) => BEING_STATES[t])
  const showing = states.filter((t) => !OUTFIT_ADJECTIVES.has(t) && !BEING_STATES[t]).map((t) => (/cutout$/.test(t) ? withArticle(t) : t))
  const wornPhrases = worn.map((t) => dictionary(t)?.kind === "with" ? dictionary(t)!.text : `${p.possessive} ${t.replace(/ lift$/, " lifted").replace(/ pull$/, " pulled")}`)
  const garments: string[] = []
  for (const tag of clothingTags) {
    if (isClothingState(tag) || WORN_STATE_RE.test(tag)) continue
    const phrase = dictionary(tag)
    if (phrase?.kind === "with") wornPhrases.push(phrase.text)
    else if (phrase?.kind === "is") beings.push(phrase.text)
    else garments.push(phrase?.kind === "wears" ? phrase.text : withArticle(tag))
  }
  const clothing = [
    garments.length ? `${Subject} ${wears} ${joinList(garments)}${wornPhrases.length ? `, with ${joinList(wornPhrases)}` : ""}.` : "",
    !garments.length && wornPhrases.length ? `${Subject} ${is} shown with ${joinList(wornPhrases)}.` : "",
    adjectives.length ? `${Possessive} outfit is ${joinList(adjectives)}.` : "",
    beings.length ? `${Subject} ${is} ${joinList(beings)}.` : "",
    showing.length ? `The outfit shows ${joinList(showing)}.` : "",
  ].filter(Boolean).join(" ")

  // Held items: "holding X" names the item; the bare item tag is then redundant.
  const equipment = [...(scene.slots.weapon ?? []), ...(scene.slots.handheld ?? [])]
  const heldNames = equipment.filter((t) => t.startsWith("holding ")).map((t) => t.slice(8))
  const heldSet = new Set(heldNames)
  const loose = dropImplied(equipment.filter((t) => t !== "holding" && !t.startsWith("holding ") && !heldSet.has(t)))
  const held = [
    heldNames.length ? `${Subject} ${is} holding ${joinList(heldNames.map(withArticle))}.` : "",
    loose.length ? `${Subject} ${has} ${joinList(loose.map(withArticle))}.` : "",
  ].filter(Boolean).join(" ")

  // Pose, expression and gaze in one sentence.
  const statesOut: string[] = []
  const withs: string[] = []
  const extraFraming: string[] = []
  const extraMood: string[] = []
  const poseTags = dropImplied([...POSE_ORDER.flatMap((s) => scene.slots[s] ?? []), ...(scene.slots.expression ?? [])])
  for (const tag of poseTags) {
    if (tag === "holding") continue
    const curated = lexiconPhrase(tag, p)
    if (curated) { (curated.kind === "state" ? statesOut : withs).push(curated.text); continue }
    const phrase = dictionary(tag)
    if (phrase) {
      if (phrase.kind === "is") statesOut.push(phrase.text)
      else if (phrase.kind === "framing") extraFraming.push(phrase.text)
      else if (phrase.kind === "scene") extraMood.push(phrase.text)
      else withs.push(phrase.text)
      continue
    }
    const ruled = posePhrase(tag, p) ?? expressionPhrase(tag, p)
    if (!ruled) { raw.push(tag); continue }
    ;(ruled.kind === "state" ? statesOut : withs).push(ruled.text)
  }
  statesOut.push(...dropImplied(scene.camera.gaze).map((t) => (dictionary(t)?.kind === "is" ? dictionary(t)!.text : gazePhrase(t, p))))
  let pose = ""
  if (statesOut.length) pose = `${Subject} ${is} ${joinList(statesOut)}${withs.length ? `, with ${joinList(withs)}` : ""}.`
  else if (withs.length) pose = `${Subject} ${is} shown with ${joinList(withs)}.`

  // Setting.
  const sceneryTags = dropImplied([...(scene.slots.setting ?? []), ...(scene.slots.props ?? [])])
  const atmosphere = slot("atmosphere")
  const adverbs = sceneryTags.filter((t) => ADVERB_PLACES.has(t))
  const times = atmosphere.filter((t) => TIME_PHRASES[t]).map((t) => TIME_PHRASES[t])
  const backgrounds = sceneryTags.filter((t) => / background$/.test(t))
  // "scenery" only says the background is detailed; the place tags carry the content.
  const places = sceneryTags.filter((t) => !ADVERB_PLACES.has(t) && !/ background$/.test(t) && t !== "scenery")
  const settingParts: string[] = []
  if (adverbs.length || times.length) {
    settingParts.push(`The scene takes place ${[adverbs[0], ...times].filter(Boolean).join(" ")}${places.length ? `, with ${joinList(places.map(articleForScenery))}` : ""}.`)
  } else if (places.length) {
    settingParts.push(`The background features ${joinList(places.map(articleForScenery))}.`)
  }
  const allBackgrounds = scene.slots.setting?.filter((t) => / background$/.test(t)) ?? []
  if (backgrounds.length || allBackgrounds.length) {
    const plain = allBackgrounds.includes("simple background")
    const others = allBackgrounds.filter((b) => b !== "simple background").map((b) => b.replace(/ background$/, ""))
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
  ]
  const lighting = [
    lightingAdjectives.length ? `The lighting is ${joinList(lightingAdjectives)}.` : "",
    mood.length ? `The atmosphere includes ${joinList(mood)}.` : "",
    effects.length ? `The image has ${joinList(effects.map((t) => (/^(depth of field|bokeh|motion blur|film grain|chromatic aberration|light particles|light rays)$/.test(t) ? t : withArticle(t))))}.` : "",
  ].filter(Boolean).join(" ")

  // Camera.
  const framing = [...dropImplied(scene.camera.framing).map((t) => framingPhrase(t, dictionary(t)?.text)), ...extraFraming]
  const angle = scene.camera.angle.map((t) => anglePhrase(t, dictionary(t)?.text))
  const camera = framing.length
    ? `The image is ${joinList(framing)}${angle.length ? `, ${joinList(angle)}` : ""}.`
    : angle.length ? `The image is ${joinList(angle)}.` : ""

  // Style, layout and other elements.
  const styles = slot("style")
  const style = styles.length
    ? `The artwork uses a ${joinList(styles.map((t) => t.replace(/\s*\(medium\)$/, "")))} style.`
    : ""
  const animalTags = slot("animal")
  const animals = animalTags.map(withArticle)
  const layout = slot("layout").map((t) => (isPluralNoun(t) || / text$/.test(t) ? t : withArticle(t)))
  const extras = [
    animals.length ? `There ${animals.length > 1 || isPluralNoun(animalTags[0]) ? "are" : "is"} also ${joinList(animals)}.` : "",
    layout.length ? `The image includes ${joinList(layout)}.` : "",
  ].filter(Boolean).join(" ")

  raw.push(...scene.unclassified)
  return { identity, body, clothing, held, pose, setting, lighting, camera, style, extras, pronouns: p, raw }
}
