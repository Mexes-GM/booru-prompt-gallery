/**
 * Small English helpers for turning booru tags into phrases: articles, lists,
 * pronouns, and the phrase rules for pose, expression and gaze tags.
 *
 * A rule that cannot place a tag returns null; the renderer then keeps the tag
 * verbatim and reports it, so the eval can see which tags still need a phrase.
 */
import { canonicalWord, impliedAmong, impliedBy, isKindOf, nounParents } from "./relations"

export interface Pronouns {
  subject: string
  possessive: string
  /** Third-person singular verb agreement ("is" vs "are", "has" vs "have"). */
  plural: boolean
}

export const PRONOUNS = {
  her: { subject: "she", possessive: "her", plural: false },
  his: { subject: "he", possessive: "his", plural: false },
  their: { subject: "they", possessive: "their", plural: true },
  its: { subject: "it", possessive: "its", plural: false },
} satisfies Record<string, Pronouns>

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** "a, b and c". */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ""
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}

/** A colour word as hair and eye tags use it ("blonde" in "blonde hair", "light blue" in "light blue eyes"). */
export const HAIR_COLOR_RE = /^((light|dark) )?(black|white|blonde|blond|brown|red|orange|yellow|green|aqua|blue|purple|pink|grey|gray|silver|rainbow)$/

// Plurals and pairs used without an article: "teeth", "clothes", "pantyhose".
const PLURAL_FORMS = /\b(teeth|pantyhose|clothes|bandages)$/
// Uncountable nouns: no article and a singular verb ("sand", "her cleavage is visible").
const UNCOUNTABLE = /\b(cleavage|food|sclera|grass|underwear|lingerie|clothing|armor|armour|makeup|jewelry|lipstick|eyeshadow|nail polish|fur|hair|skin|tape|swimwear|sportswear|footwear|headwear|eyewear|legwear|neckwear|sand|money|water|snow|rain|mud|dirt|smoke|steam|fog|mist|sweat|blood|milk|slime|foam|confetti|furniture|equipment|luggage|architecture|scenery|lightning|sunlight|moonlight|darkness|ice|magic|electricity|saliva|drool|semen|cum|ink|paint)$/
const SINGULAR_S = /(ss|us|is|dress|bodysuit|swimsuit|jumpsuit|tracksuit|catsuit|leotards?|thermos|canvas|lens|atlas)$/
const IRREGULAR_PLURALS = /^(feet|teeth|people|men|women)$/

// "arms around another's back", "hands on own chest": the plural body part comes first.
const PLURAL_HEAD = /^(arms|hands|legs|feet|fingers|knees|thighs|wings|ears|eyes|breasts) /

/** Verb agreement: "feet are", "breasts are", but "cleavage is", "underwear is". */
export function takesPluralVerb(phrase: string): boolean {
  return isPluralNoun(phrase) && !UNCOUNTABLE.test(phrase)
}

/** Nouns used without an article: plurals, pairs and uncountable nouns. */
export function isPluralNoun(phrase: string): boolean {
  const last = phrase.split(" ").pop() ?? phrase
  if (PLURAL_FORMS.test(phrase) || UNCOUNTABLE.test(phrase) || PLURAL_HEAD.test(phrase) || IRREGULAR_PLURALS.test(last)) return true
  return last.endsWith("s") && !SINGULAR_S.test(last)
}

// Proper words that tags write in lowercase: "japanese clothes" -> "Japanese clothes".
const PROPER_WORDS: Record<string, string> = {
  english: "English", japanese: "Japanese", chinese: "Chinese", korean: "Korean", russian: "Russian",
  french: "French", german: "German", spanish: "Spanish", italian: "Italian", arabian: "Arabian",
  american: "American", british: "British", "east asian": "East Asian", asian: "Asian", egyptian: "Egyptian",
  greek: "Greek", roman: "Roman", nordic: "Nordic", hogwarts: "Hogwarts", christmas: "Christmas",
  halloween: "Halloween", easter: "Easter", "valentine's day": "Valentine's Day", "new year": "New Year",
}
const PROPER_RE = new RegExp(`\\b(${Object.keys(PROPER_WORDS).sort((a, b) => b.length - a.length).join("|")})\\b`, "g")

/** Capitalizes the proper words a tag left in lowercase, in finished prose. */
export function properNouns(text: string): string {
  return text.replace(PROPER_RE, (word) => PROPER_WORDS[word])
}

/**
 * "kissing another person's hair", "kissing another person's head" ->
 * "kissing another person's hair and head": phrases that differ only in their
 * last word are said once. Order follows the first phrase of each group.
 */
export function mergeSharedPrefix(phrases: string[]): string[] {
  const groups = new Map<string, string[]>()
  for (const phrase of new Set(phrases)) {
    const cut = phrase.lastIndexOf(" ")
    // Phrases of one or two words ("smiling", "looking up") never merge, nor phrases
    // that share only up to an article: "resting on a knee" + "resting on a surface".
    const key = phrase.split(" ").length >= 3 && !/ (a|an|the)$/.test(phrase.slice(0, cut)) ? phrase.slice(0, cut) : `\0${phrase}`
    groups.set(key, [...(groups.get(key) ?? []), phrase.slice(cut + 1)])
  }
  return [...groups].map(([key, lasts]) => (key.startsWith("\0") ? key.slice(1) : `${key} ${joinList(lasts)}`))
}

/** "white dress" -> "a white dress", "thighhighs" -> "thighhighs", "apron" -> "an apron". */
export function withArticle(phrase: string): string {
  if (isPluralNoun(phrase)) return phrase
  return `${/^[aeiou]/.test(phrase) && !/^(uni|one|eu)/.test(phrase) ? "an" : "a"} ${phrase}`
}

// Clothing tags that name a style rather than a garment: "a gothic lolita" reads as a person.
const GARMENT_WORDING: Record<string, string> = {
  "gothic lolita": "a gothic lolita outfit",
  "classic lolita": "a classic lolita outfit",
  "sweet lolita": "a sweet lolita outfit",
  "lolita fashion": "a lolita fashion outfit",
}
const WORN_ON_RE = /^(.+) (on head|on back|around waist|on shoulders)$/

// "print garter belt" (a printed pattern), "picot trim panties" (a garment's trim).
const PRINT_RE = /^print (.+)$/
const TRIM_RE = /^(.+) trim (.+)$/

/** "goggles on head" -> "goggles on her head", "gothic lolita" -> "a gothic lolita outfit", "skirt" -> "a skirt". */
export function garmentPhrase(tag: string, possessive: string): string {
  if (GARMENT_WORDING[tag]) return GARMENT_WORDING[tag]
  const print = tag.match(PRINT_RE)
  if (print) return withArticle(`patterned ${print[1]}`)
  const trim = tag.match(TRIM_RE)
  if (trim) return `${withArticle(trim[2])} with ${trim[1]} trim`
  const worn = tag.match(WORN_ON_RE)
  if (!worn) return withArticle(tag)
  const [preposition, part] = worn[2].split(" ")
  return `${withArticle(worn[1])} ${preposition} ${possessive} ${part}`
}

/** "coat on shoulders" -> "coat": the garment a worn-somewhere tag names. */
function wornItem(tag: string): string | null {
  return tag.match(WORN_ON_RE)?.[1] ?? null
}

// Clothing tags that describe the outfit instead of naming a garment.
const CLOTHING_STATES = new Set([
  "sleeveless", "strapless", "backless", "single off shoulder", "topless", "bottomless", "barefoot", "nude", "naked",
  "see-through", "wet clothes", "open clothes", "torn clothes", "no bra", "no panties", "completely nude",
  "off shoulder", "off-shoulder", "covered navel", "highleg", "sideboob", "underboob", "cleavage",
  "midriff", "navel", "bare shoulders", "single bare shoulder", "bare arms", "bare legs", "bare back", "zettai ryouiki", "clothing cutout",
  "cleavage cutout", "shoulder cutout", "taut clothes", "skindentation", "frills", "lace trim",
])

export function isClothingState(tag: string): boolean {
  return CLOTHING_STATES.has(tag) || / cutout$/.test(tag)
}

const BARE_RE = /^(single )?bare (shoulders?|arms?|legs?|back)$/

/** "bare shoulders" -> "her shoulders bare", "single bare shoulder" -> "one shoulder bare": the body, not a garment. */
export function bareState(tag: string, possessive: string): string | null {
  const m = tag.match(BARE_RE)
  if (!m) return null
  return m[1] ? `one ${m[2].replace(/s$/, "")} bare` : `${possessive} ${m[2]} bare`
}

const BODY_PART_START = /^(hand|hands|arm|arms|finger|fingers|leg|legs|knee|knees|foot|feet|head|hip|hips|elbow|elbows|thigh|thighs|own hands|both hands)\b/

/** The hand-written lexicon entry for a pose or expression tag, if any. */
export function lexiconPhrase(tag: string, p: Pronouns): { kind: "state" | "with"; text: string } | null {
  const entry = POSE_LEXICON[tag] ?? EXPRESSION_LEXICON[tag]
  return entry ? { kind: entry.kind, text: entry.text.replace(/\{pos\}/g, p.possessive) } : null
}

/**
 * A pose tag as a phrase that follows "She is ..." ("sitting on a chair") or
 * "with ..." ("with her arms up"). Returns null when no rule applies.
 */
export function posePhrase(tag: string, p: Pronouns): { kind: "state" | "with"; text: string } | null {
  const own = (s: string) => s.replace(/\bown\b/g, p.possessive)
  if (POSE_LEXICON[tag]) {
    const entry = POSE_LEXICON[tag]
    return { kind: entry.kind, text: entry.text.replace(/\{pos\}/g, p.possessive) }
  }
  if (BODY_PART_START.test(tag)) return { kind: "with", text: `${p.possessive} ${own(tag)}` }
  const [first, ...rest] = tag.split(" ")
  if (!first.endsWith("ing") || first.length <= 4) return null
  // "floating hair": the hair floats, she does not float it ("with her hair floating").
  if (rest.length === 1 && BODY_STATE_VERB_RE.test(first) && BODY_STATE_NOUN_RE.test(rest[0])) {
    return { kind: "with", text: `${p.possessive} ${rest[0]} ${first}` }
  }
  // "holding thermos" -> "holding a thermos": a bare object noun takes its article.
  const object = rest.join(" ")
  if (rest.length === 1 && !NOT_AN_OBJECT_RE.test(object)) return { kind: "state", text: `${first} ${withArticle(object)}` }
  return { kind: "state", text: own(tag) }
}

// Verbs that say what a body part does by itself, not what the person does to it.
const BODY_STATE_VERB_RE = /^(floating|flowing|fluttering|swaying|glowing|dripping|blowing|billowing)$/
const BODY_STATE_NOUN_RE = /^(hair|tail|tails|ears|wings|cape|scarf|ribbon|ribbons)$/

// After a verb, words that are not a thing it acts on: adverbs, particles,
// participles, people and body parts ("smiling faintly", "lying down", "biting lip").
const NOT_AN_OBJECT_RE = /(ly|ed|ing)$|^(forward|backward|backwards|back|down|up|away|over|out|in|off|on|around|together|apart|aside|alone|still|sideways|hard|another|someone|each|both|all|viewer|sex|ass|butt|breast|breasts|chest|penis|pussy|nipple|nipples|thigh|thighs|head|face|hair|tail|ears|neck|belly|stomach|foot|feet|hand|hands|arm|arms|leg|legs|lip|lips|mouth|tongue|teeth|finger|fingers)$/

/** "closed eyes" -> "her eyes closed"; smile/blush style words come from the lexicon. */
export function expressionPhrase(tag: string, p: Pronouns): { kind: "state" | "with"; text: string } | null {
  if (EXPRESSION_LEXICON[tag]) {
    const entry = EXPRESSION_LEXICON[tag]
    return { kind: entry.kind, text: entry.text.replace(/\{pos\}/g, p.possessive) }
  }
  const m = tag.match(/^(open|closed|half-closed|wide|narrowed|squinting|crossed|parted|clenched) (eyes|mouth|lips|teeth)$/)
  if (m) return { kind: "with", text: `${p.possessive} ${m[2]} ${m[1]}` }
  return null
}

export function gazePhrase(tag: string, p: Pronouns): string {
  if (tag === "looking at another") return p.plural ? "looking at each other" : "looking at someone"
  return tag.replace(/\bat viewer\b/, "at the viewer").replace(/^facing viewer$/, "facing the viewer")
}

/**
 * Drops tags another tag already implies, as booru posts carry both: "animal
 * ears" next to "cat ears", "lying" next to "on back", "swimsuit" next to
 * "black bikini" (Danbooru's implications, see relations.ts), "shirt" next to
 * "grey shirt", "reaching" next to "reaching towards viewer". `context` holds
 * the tags the prose says (by default the list itself): a shared "animal ears"
 * goes when one person has "cat ears", but a tag only listed raw implies
 * nothing. Prose only; tag output keeps the redundancy on purpose.
 */
export function dropImplied(tags: string[], context: Iterable<string> = tags): string[] {
  const all = [...new Set(context)]
  const implied = impliedAmong(tags, all)
  for (const tag of all) for (const other of IMPLIES[tag] ?? []) implied.add(other)
  // "colored skin" only says the skin is an unnatural colour; "grey skin" says which.
  if (all.some((tag) => SKIN_COLOR_RE.test(tag))) implied.add("colored skin")
  // A kind of thing implies the generic word, where it was placed too:
  // "parasol" -> "umbrella", "handgun" -> "gun" and "weapon", "sword on back" -> "weapon on back".
  for (const tag of all) {
    const { item, place } = splitPlacement(tag)
    for (const generic of genericsOf(item)) implied.add(place ? `${generic} ${place}` : generic)
  }
  // Several sizes of one body part ("big ass, huge ass, large ass"): keep the largest, the first of a tie.
  const largest = new Map<string, { rank: number; tag: string }>()
  for (const tag of tags) {
    const size = sizeOf(tag)
    if (size && size.rank > (largest.get(size.noun)?.rank ?? 0)) largest.set(size.noun, { rank: size.rank, tag })
  }
  return tags.filter((tag) => {
    const size = sizeOf(tag)
    if (size && largest.get(size.noun)?.tag !== tag) return false
    return !implied.has(tag) && !tags.some((other) => other !== tag && (other.endsWith(` ${tag}`) || other.startsWith(`${tag} `)))
  })
}

/** Tags that some tag of the list says already, wherever each is filed ("clothed female nude male" -> "clothed sex"). */
export function impliedTags(tags: string[]): Set<string> {
  return new Set(tags.flatMap((tag) => {
    const skinned = tag.match(/^([a-z]+)-skinned (?:female|male|futa)$/)
    return [...(IMPLIES[tag] ?? []), ...(skinned ? [`${skinned[1]} skin`] : [])]
  }))
}

// Words that add no detail of their own to a phrase.
const FILLER_WORDS = new Set(["a", "an", "the", "and", "with", "of", "is", "are", "being", "seen", "shown", "making", "having"])

/** "rolling", "rolled" -> "roll"; "eyes", "eye" -> "ey": close enough to compare two phrases' words. */
function stem(word: string): string {
  if (word.endsWith("'s")) return word
  const bare = word.replace(/(ing|ed)$/, (end, _, offset) => (offset >= 3 ? "" : end)).replace(/s$/, "").replace(/e$/, "")
  return bare.replace(/([^aeiou])\1$/, "$1")
}

// The phrase dictionary's own words for a Danbooru tag's ("buttocks" for "ass"); Danbooru's
// aliases cover the rest ("butt" -> "ass", "naked" -> "nude").
const DICTIONARY_WORDS: Record<string, string> = { buttocks: "ass" }

/** "butt", "buttocks" -> "ass": one word for one thing, whoever wrote it. */
function sameWord(word: string): string {
  return DICTIONARY_WORDS[word] ?? canonicalWord(word)
}

/**
 * The words of a phrase that say something, stemmed. A possessive names its
 * owner too ("another person's face" mentions another person). The dictionary
 * says one thing two ways: "a partner" and "another person", "sexual
 * intercourse" and "sex".
 */
function contentWords(phrase: string): Set<string> {
  const words = phrase.toLowerCase()
    .replace(/\ba partner\b/g, "another person").replace(/\bpartner's\b/g, "another person's").replace(/\bsexual intercourse\b/g, "sex")
    .split(/[\s,]+/).filter((w) => w && !FILLER_WORDS.has(w))
  return new Set(words.flatMap((w) => (w.endsWith("'s") ? [w, stem(sameWord(w.slice(0, -2)))] : [stem(sameWord(w))])))
}

const PRONOUNS_RE = /^(her|his|their|its|own)$/
// Someone else's: "a hand on another person's shoulder" does not say "a hand on her shoulder".
const OTHER_OWNER_RE = /'s$|^(another|someone|partner|each|other)$/

/**
 * True when phrase `b` says everything `a` says: "rolling her eyes" next to
 * "making an ahegao face with eyes rolled up", "a first-person view" next to
 * "seen from a first-person point of view", "smiling" next to "smiling faintly",
 * "sitting on another person" next to "sitting on another person's face".
 * Whose it is counts only when `b` names someone else.
 */
export function saysAll(b: string, a: string): boolean {
  const [inA, inB] = [contentWords(a), contentWords(b)]
  const owned = [...inB].some((w) => OTHER_OWNER_RE.test(w))
  const said = [...inA].filter((w) => owned || !PRONOUNS_RE.test(w))
  return said.length > 0 && said.every((w) => inB.has(w))
}

/**
 * Drops phrases another phrase in the list already says, after the dictionary
 * has turned tags into words: "performing oral sex" next to "performing oral
 * sex on a penis", "rolling her eyes" next to "making an ahegao face with eyes
 * rolled up", or two tags that come out as the same words (the first stays).
 */
export function dropContainedPhrases(phrases: string[]): string[] {
  const unique = [...new Set(phrases)]
  return unique.filter((phrase, i) => !unique.some((other, j) => j !== i && saysAll(other, phrase) && (j < i || !saysAll(phrase, other))))
}

// Modifiers by kind, in the order they come before the noun: "multiple", "large", "short",
// "open", colours, patterns, materials ("leather", "fur-trimmed"), kinds ("turtleneck"), then where it is worn.
const QUANTITY_MODIFIERS = new Set(["multiple", "single", "many", "extra"])
const STATE_MODIFIERS = new Set(["open", "torn", "wet", "unworn", "unbuttoned", "unzipped", "untied", "loose", "lifted", "partially unbuttoned", "partially unzipped"])
const SIZE_MODIFIERS = new Set(["tiny", "small", "big", "large", "huge", "oversized", "giant", "gigantic", "massive", "enormous", "very large", "medium-sized"])
const LENGTH_MODIFIERS = new Set(["short", "long", "very long", "medium", "mini", "micro", "knee-length", "ankle-length", "thigh-length", "floor-length"])
const COLOR_MODIFIER_RE = /^((light|dark|pale|deep|bright|hot|navy) )?(black|white|blonde|blond|brown|red|orange|yellow|green|aqua|blue|purple|pink|grey|gray|silver|gold|golden|beige|navy|teal|cyan|magenta|maroon|violet|lavender|cream)$/
const PATTERN_MODIFIERS = new Set([
  "multicolored", "two-tone", "two-sided", "gradient", "rainbow", "striped", "vertical-striped", "horizontal-striped",
  "diagonal-striped", "plaid", "checkered", "polka dot", "argyle", "camouflage", "houndstooth", "leopard print", "floral print",
])
// What it is made of or how it is finished: one garment can be all of these ("black leather fur-trimmed").
const MATERIAL_MODIFIER_RE = /^(denim|leather|latex|lace|silk|satin|velvet|wool|woolen|knit|knitted|ribbed|cotton|metal|metallic|wooden|plastic|rubber|vinyl|fur|frilled|ruffled|pleated|studded|sequined|feathered|see-through|sheer|shiny|glossy|transparent|\S+-trimmed)$/
// Where a thing is worn or grows: "hair ribbon" and "neck ribbon" are two ribbons, never one "hair neck ribbon".
const PLACE_MODIFIERS = new Set(["hair", "neck", "wrist", "ankle", "arm", "leg", "thigh", "knee", "elbow", "waist", "back", "chest", "head", "ear", "shoulder", "hip", "finger", "toe", "foot", "footwear", "tail"])
// Two-word modifiers read as one ("light blue", "polka dot", "very large").
const PAIRED_MODIFIER_RE = /^((light|dark|pale|deep|bright|hot|navy) \S+|polka dot|leopard print|floral print|(very|partially) \S+)$/
// A phrase that is not a modifier list in front of a noun: prepositions, possessives, lists.
const NOT_A_NOUN_PHRASE_RE = /\b(on|in|into|over|under|behind|between|around|from|with|without|at|to|of|for|through|than|as|like|by|near|towards?|inside|outside|and|or|her|his|their|its|own)\b|[,()]/
const COLOR_RANK = 4
const KIND_RANK = 7

function modifierRank(word: string, head: string): number {
  if (QUANTITY_MODIFIERS.has(word)) return 0
  if (SIZE_MODIFIERS.has(word)) return 1
  // "black short shorts": the word the noun is made of stays next to it.
  if (LENGTH_MODIFIERS.has(word)) return head.startsWith(word) ? 9 : 2
  // "a large wet", "a short open": the state after size and length, before colour.
  if (STATE_MODIFIERS.has(word)) return 3
  if (COLOR_MODIFIER_RE.test(word)) return COLOR_RANK
  if (PATTERN_MODIFIERS.has(word)) return 5
  if (MATERIAL_MODIFIER_RE.test(word)) return 6
  if (PLACE_MODIFIERS.has(word)) return 8
  return KIND_RANK
}

/** "light blue fur-trimmed" -> ["light blue", "fur-trimmed"]. */
function modifierWords(words: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < words.length; i++) {
    const pair = `${words[i]} ${words[i + 1]}`
    if (i + 1 < words.length && PAIRED_MODIFIER_RE.test(pair)) { out.push(pair); i++ }
    else out.push(words[i])
  }
  return out
}

/** Two lengths, sizes or places in one modifier list say two things ("hair ribbon", "neck ribbon"). */
function clash(modifiers: string[]): boolean {
  return [LENGTH_MODIFIERS, SIZE_MODIFIERS, PLACE_MODIFIERS].some((family) => new Set(modifiers.filter((m) => family.has(m))).size > 1)
}

/** "cherry hair ornament" -> "cherry": the modifiers that say which kind of thing it is. */
const kindKey = (modifiers: string[], head: string) => modifiers.filter((m) => modifierRank(m, head) === KIND_RANK).sort().join(" ")

export interface ThingPhrase {
  tag: string
  /** The phrase the tag would get on its own ("a black jacket", "elbow-length gloves"). */
  text: string
  /**
   * Things a person often has several of (accessories): two kinds of one are two
   * things ("a cherry hair ornament" and "a pearl hair ornament"), while a
   * garment's kinds describe the one garment ("a white collared dress shirt").
   */
  several?: boolean
}

/**
 * One person's tags that name one thing several ways, said as one phrase:
 * "black jacket", "red jacket", "open jacket", "two-tone jacket" -> "an open red
 * and black two-tone jacket"; "black bodysuit", "turtleneck bodysuit" -> "a black
 * turtleneck bodysuit"; "white hat" next to "mob cap" (a kind of hat) -> "a white
 * mob cap"; "coat on shoulders" next to "fur-trimmed coat" -> "a fur-trimmed coat
 * on her shoulders". Phrases that are not plain modifiers before a noun stay as
 * they are, and so do things that are two (`clash`, `several`). Each result
 * lists the tags it says, in the order of each thing's first phrase.
 */
export function mergeThings(items: ThingPhrase[]): { tags: string[]; text: string }[] {
  const words = items.map(({ text }) => {
    const plain = text.replace(/^an? /, "")
    return NOT_A_NOUN_PHRASE_RE.test(plain) ? null : plain.split(" ")
  })
  const owner = items.map((_, i) => i)
  const find = (i: number): number => (owner[i] === i ? i : (owner[i] = find(owner[i])))
  // What an item adds to the thing it joins, and the items whose whole phrase is the noun ("mob cap").
  const added = new Map<number, string[]>()
  const bases = new Set<number>()
  const modifiersOf = (i: number) => modifierWords(added.get(i) ?? words[i]!.slice(0, -1))

  // A generic noun with modifiers joins the one kind of it the list names: "white hat" + "mob cap".
  // "hat ribbon" implies a hat without being one, so a kind never starts with the generic word;
  // "perfect boobs" is the same noun as "large breasts", not a kind of it (see below).
  const nounOf = (phrase: string) => sameWord(phrase.split(" ").pop()!)
  items.forEach(({ tag }, i) => {
    const own = words[i]
    if (!own || own.length < 2) return
    const generic = nounParents(tag).find((g) => own.slice(-g.split(" ").length).join(" ") === g)
    if (!generic) return
    const kinds = items.flatMap((other, j) => (
      j !== i && words[j] && isKindOf(other.tag, generic) && nounOf(other.tag) !== nounOf(generic) && !other.tag.startsWith(`${generic} `) ? [j] : []
    ))
    if (kinds.length !== 1) return
    owner[find(i)] = find(kinds[0])
    added.set(i, own.slice(0, -generic.split(" ").length))
    bases.add(kinds[0])
  })
  // Phrases with the same noun are one thing. Of something people have several of,
  // each kind is one; the plain ones ("red ribbon") join the only kind there is.
  const byNoun = new Map<string, number[]>()
  words.forEach((own, i) => {
    if (!own || own.length < 2 || added.has(i)) return
    const noun = sameWord(own[own.length - 1])
    byNoun.set(noun, [...(byNoun.get(noun) ?? []), i])
  })
  for (const [head, group] of byNoun) {
    const clusters = new Map<string, number[]>()
    for (const i of group) {
      const key = items[i].several ? kindKey(modifierWords(words[i]!.slice(0, -1)), head) : ""
      clusters.set(key, [...(clusters.get(key) ?? []), i])
    }
    const kinds = [...clusters.keys()].filter(Boolean)
    if (kinds.length === 1 && clusters.has("")) {
      clusters.set(kinds[0], [...clusters.get("")!, ...clusters.get(kinds[0])!])
      clusters.delete("")
    }
    for (const cluster of clusters.values()) {
      if (cluster.length < 2 || clash(cluster.flatMap((i) => modifierWords(words[i]!.slice(0, -1))))) continue
      for (const i of cluster.slice(1)) owner[find(i)] = find(cluster[0])
    }
  }

  const members = new Map<number, number[]>()
  items.forEach((_, i) => members.set(find(i), [...(members.get(find(i)) ?? []), i]))
  const things: { tags: string[]; text: string }[] = []
  for (const group of members.values()) {
    const base = group.find((j) => bases.has(j))
    const first = words[group[0]]
    // The noun as the dictionary or Danbooru writes it when one of the phrases has it ("buttocks" over "butt").
    const nouns = group.map((j) => words[j]?.[words[j]!.length - 1]).filter((w): w is string => !!w)
    const spelled = nouns.find((w) => DICTIONARY_WORDS[w]) ?? nouns.find((w) => canonicalWord(w) === w)
    const nounWords = base !== undefined ? words[base]! : first ? [spelled ?? first[first.length - 1]] : undefined
    const inNoun = new Set(nounWords)
    const modifiers = group.length > 1 ? [...new Set(group.filter((j) => j !== base).flatMap(modifiersOf))].filter((m) => !inNoun.has(m)) : []
    if (group.length === 1 || !nounWords || clash(modifiers)) {
      things.push(...group.map((j) => ({ tags: [items[j].tag], text: items[j].text })))
      continue
    }
    const head = nounWords[nounWords.length - 1]
    // "diagonal-striped" already says "striped", and any pattern says "multicolored".
    const said = (m: string) => modifiers.some((other) => other !== m && (other.endsWith(`-${m}`) || (m === "multicolored" && PATTERN_MODIFIERS.has(other))))
    const noun = nounWords.filter((w, i) => i === nounWords.length - 1 || !said(w))
    const ranked = modifiers.filter((m) => !said(m)).map((m, order) => ({ m, order, rank: modifierRank(m, head) })).sort((a, b) => a.rank - b.rank || a.order - b.order)
    const colors = ranked.filter((r) => r.rank === COLOR_RANK).map((r) => r.m)
    const phrase = [
      ...ranked.filter((r) => r.rank < COLOR_RANK).map((r) => r.m),
      ...(colors.length ? [joinList(colors)] : []),
      ...ranked.filter((r) => r.rank > COLOR_RANK).map((r) => r.m),
      ...noun,
    ].join(" ")
    things.push({ tags: group.map((j) => items[j].tag), text: withArticle(phrase) })
  }

  // "coat on shoulders" says where the one coat the list names is worn.
  for (let w = things.length - 1; w >= 0; w--) {
    const item = things[w].tags.length === 1 ? wornItem(things[w].tags[0]) : null
    const { text } = things[w]
    if (!item || !text.startsWith(`${withArticle(item)} `)) continue
    const garments = things.filter((t, i) => i !== w && t.tags.some((tag) => tag === item || isKindOf(tag, item)))
    if (garments.length !== 1) continue
    garments[0].text += text.slice(withArticle(item).length)
    garments[0].tags.push(things[w].tags[0])
    things.splice(w, 1)
  }
  return things
}

/** mergeThings, as phrases. */
export function mergeSameThing(items: ThingPhrase[]): string[] {
  return mergeThings(items).map((thing) => thing.text)
}

// Rule34 writes sizes Danbooru does not use ("massive breasts", "hyper penis", "absurdly large cock").
const SIZE_RANK: Record<string, number> = {
  flat: 1, small: 2, medium: 3, big: 4, thick: 4, large: 5, huge: 6, "very large": 6, gigantic: 7, enormous: 7, massive: 7, giant: 7,
  colossal: 8, humongous: 8, "absurdly large": 8, "extremely large": 8, hyper: 9,
}

/** "huge breasts" -> { noun: "breasts", rank: 6 }; "absurdly large cock" -> { noun: "penis", rank: 8 }. */
function sizeOf(tag: string): { noun: string; rank: number } | null {
  const words = tag.split(" ")
  const size = SIZE_RANK[words.slice(0, 2).join(" ")] ? 2 : SIZE_RANK[words[0]] ? 1 : 0
  if (!size || words.length <= size) return null
  return { noun: words.slice(size).map(canonicalWord).join(" "), rank: SIZE_RANK[words.slice(0, size).join(" ")] }
}

// What Danbooru's implications (relations.ts) do not say.
const IMPLIES: Record<string, string[]> = {
  ":d": ["open mouth"],
  ";d": ["open mouth"],
  "husband and wife": ["couple"],
  // Who is clothed during sex is said by the pair: "The woman is clothed. The man is nude."
  "clothed female nude male": ["clothed sex"],
  "clothed male nude female": ["clothed sex"],
}

const SKIN_COLOR_RE = /^(grey|gray|blue|green|red|purple|pink|orange|yellow|black|white|aqua|multicolored|two-tone) skin$/

// Kinds of a thing Danbooru implies nothing for (its implications cover "parasol" -> "umbrella" and the like).
const HYPONYMS: Record<string, string> = { pistol: "gun", saber: "sword", sabre: "sword", claymore: "sword" }
// Weapons by their last word; "bow" alone is a ribbon, so only "bow (weapon)" counts.
const WEAPON_RE = /(^|\s)(sword|katana|knife|dagger|gun|handgun|pistol|revolver|rifle|shotgun|spear|polearm|lance|axe|scythe|staff|mace|whip|trident|halberd|naginata|kunai|shuriken|blade|rapier|saber|sabre|scimitar|claymore|crossbow|bow \(weapon\))$/
const PLACEMENT_RE = /^(.+?) (over shoulder|on shoulder|on back|on hip|at hip|in mouth)$/

/** "umbrella over shoulder" -> { item: "umbrella", place: "over shoulder" }. */
export function splitPlacement(tag: string): { item: string; place: string | null } {
  const m = tag.match(PLACEMENT_RE)
  return m ? { item: m[1], place: m[2] } : { item: tag, place: null }
}

/** The generic words an item implies: "handgun" -> ["gun", "weapon"]. */
export function genericsOf(item: string): string[] {
  const last = item.split(" ").pop() ?? item
  const generic = HYPONYMS[item] ?? HYPONYMS[last]
  const out = new Set(impliedBy(item))
  if (generic) out.add(generic)
  if (item !== "weapon" && WEAPON_RE.test(item)) out.add("weapon")
  return [...out]
}

const HAIR_LENGTH_WORDS = new Set(["absurdly long", "very long", "very short", "long", "medium", "short"])
const HAIR_WORD_RE = /^((light|dark) )?(black|white|blonde|blond|brown|red|orange|yellow|green|aqua|blue|purple|pink|grey|gray|silver)$|^(wavy|curly|straight|messy|spiked|fluffy|multicolored|two-tone|gradient|streaked)$/
const isHairWord = (words: string) => HAIR_LENGTH_WORDS.has(words) || HAIR_WORD_RE.test(words)

/**
 * "blue long hair" -> ["blue hair", "long hair"]. The site's prompt cleanup
 * merges the adjectives of one noun into a single tag, in post order; the hair
 * description (and per-character attribution) needs the plain tags back. Null
 * when the tag is not made only of length, colour and texture words.
 */
export function splitHairCompound(tag: string): string[] | null {
  if (!tag.endsWith(" hair")) return null
  const words = tag.slice(0, -" hair".length).split(" ")
  const parts: string[] = []
  for (let i = 0; i < words.length;) {
    const pair = i + 1 < words.length ? `${words[i]} ${words[i + 1]}` : null
    if (pair && isHairWord(pair)) { parts.push(pair); i += 2 }
    else if (isHairWord(words[i])) { parts.push(words[i]); i += 1 }
    else return null
  }
  return parts.length >= 2 ? parts.map((part) => `${part} hair`) : null
}

const ANGLE_PHRASES: Record<string, string> = {
  "from above": "seen from above",
  "from below": "seen from below",
  "from side": "seen from the side",
  "from behind": "seen from behind",
  "dutch angle": "framed at a tilted angle",
  pov: "seen from a first-person point of view",
}

/** Curated wording first, then the phrase dictionary, then the tag itself. */
export function anglePhrase(tag: string, dictionaryText?: string): string {
  return ANGLE_PHRASES[tag] ?? dictionaryText ?? tag
}

const FRAMING_PHRASES: Record<string, string> = {
  "cowboy shot": "a cowboy shot from the thighs up",
  "upper body": "an upper-body shot",
  "full body": "a full-body shot",
  portrait: "a portrait",
  "close-up": "a close-up",
  "lower body": "a lower-body shot",
  "wide shot": "a wide shot",
  profile: "a profile view",
}

export function framingPhrase(tag: string, dictionaryText?: string): string {
  return FRAMING_PHRASES[tag] ?? dictionaryText ?? withArticle(tag)
}

type LexiconEntry = { kind: "state" | "with"; text: string }

// Seed phrases for frequent pose tags whose wording the rules above get wrong.
// The full dictionary (generated once and reviewed) replaces this list later.
const POSE_LEXICON: Record<string, LexiconEntry> = {
  sitting: { kind: "state", text: "sitting" },
  standing: { kind: "state", text: "standing" },
  lying: { kind: "state", text: "lying down" },
  kneeling: { kind: "state", text: "kneeling" },
  squatting: { kind: "state", text: "squatting" },
  "on back": { kind: "state", text: "lying on {pos} back" },
  "on stomach": { kind: "state", text: "lying on {pos} stomach" },
  "on side": { kind: "state", text: "lying on {pos} side" },
  "on bed": { kind: "state", text: "on a bed" },
  "on floor": { kind: "state", text: "on the floor" },
  "on chair": { kind: "state", text: "on a chair" },
  seiza: { kind: "state", text: "sitting in seiza" },
  "wariza": { kind: "state", text: "sitting with {pos} legs splayed to the sides" },
  "indian style": { kind: "state", text: "sitting cross-legged" },
  "crossed legs": { kind: "with", text: "{pos} legs crossed" },
  "crossed arms": { kind: "with", text: "{pos} arms crossed" },
  "spread legs": { kind: "with", text: "{pos} legs spread" },
  "spread arms": { kind: "with", text: "{pos} arms spread wide" },
  "outstretched arms": { kind: "with", text: "{pos} arms outstretched" },
  "outstretched arm": { kind: "with", text: "one arm outstretched" },
  "arm up": { kind: "with", text: "one arm raised" },
  "arms up": { kind: "with", text: "{pos} arms raised" },
  "hand up": { kind: "with", text: "one hand raised" },
  "hands up": { kind: "with", text: "{pos} hands raised" },
  "arm behind back": { kind: "with", text: "one arm behind {pos} back" },
  "arms behind back": { kind: "with", text: "{pos} arms behind {pos} back" },
  "arm behind head": { kind: "with", text: "one arm behind {pos} head" },
  "arms behind head": { kind: "with", text: "{pos} arms behind {pos} head" },
  "knees up": { kind: "with", text: "{pos} knees drawn up" },
  "leg up": { kind: "with", text: "one leg raised" },
  "v": { kind: "state", text: "making a peace sign" },
  "double v": { kind: "state", text: "making peace signs with both hands" },
  "peace sign": { kind: "state", text: "making a peace sign" },
  "thumbs up": { kind: "state", text: "giving a thumbs up" },
  "pointing": { kind: "state", text: "pointing" },
  "waving": { kind: "state", text: "waving" },
  salute: { kind: "state", text: "saluting" },
  "w": { kind: "state", text: "making a W sign with {pos} fingers" },
  "contrapposto": { kind: "state", text: "standing in a relaxed contrapposto pose" },
  "leaning forward": { kind: "state", text: "leaning forward" },
  "leaning back": { kind: "state", text: "leaning back" },
  "bent over": { kind: "state", text: "bent over" },
  "all fours": { kind: "state", text: "on all fours" },
  "head tilt": { kind: "with", text: "{pos} head tilted" },
  "against wall": { kind: "state", text: "leaning against a wall" },
  "looking back": { kind: "state", text: "looking back over {pos} shoulder" },
  "hug": { kind: "state", text: "hugging" },
  "hugging own legs": { kind: "state", text: "hugging {pos} legs" },
  "selfie": { kind: "state", text: "taking a selfie" },
  "stretching": { kind: "state", text: "stretching" },
  "dancing": { kind: "state", text: "dancing" },
  "sleeping": { kind: "state", text: "sleeping" },
  "flying": { kind: "state", text: "flying" },
  "floating": { kind: "state", text: "floating" },
  "jumping": { kind: "state", text: "jumping" },
  "running": { kind: "state", text: "running" },
  "walking": { kind: "state", text: "walking" },
  // The tag says who is penetrated, not by whom: "by a man" adds a man who may not be there.
  "male penetrated": { kind: "state", text: "being penetrated" },
  "female penetrated": { kind: "state", text: "being penetrated" },
}

const EXPRESSION_LEXICON: Record<string, LexiconEntry> = {
  smile: { kind: "state", text: "smiling" },
  "light smile": { kind: "state", text: "smiling faintly" },
  grin: { kind: "state", text: "grinning" },
  "evil smile": { kind: "with", text: "an evil smile" },
  smirk: { kind: "state", text: "smirking" },
  blush: { kind: "state", text: "blushing" },
  "light blush": { kind: "with", text: "a light blush" },
  "full-face blush": { kind: "with", text: "a deep blush across {pos} face" },
  "nose blush": { kind: "with", text: "a blush across {pos} nose" },
  frown: { kind: "state", text: "frowning" },
  pout: { kind: "state", text: "pouting" },
  crying: { kind: "state", text: "crying" },
  tears: { kind: "with", text: "tears in {pos} eyes" },
  "crying with eyes open": { kind: "state", text: "crying with {pos} eyes open" },
  "streaming tears": { kind: "with", text: "tears streaming down {pos} face" },
  sweat: { kind: "state", text: "sweating" },
  sweatdrop: { kind: "with", text: "a sweat drop" },
  "one eye closed": { kind: "state", text: "winking" },
  wink: { kind: "state", text: "winking" },
  expressionless: { kind: "with", text: "a blank expression" },
  serious: { kind: "with", text: "a serious expression" },
  angry: { kind: "with", text: "an angry expression" },
  annoyed: { kind: "with", text: "an annoyed expression" },
  embarrassed: { kind: "with", text: "an embarrassed expression" },
  surprised: { kind: "with", text: "a surprised expression" },
  sad: { kind: "with", text: "a sad expression" },
  happy: { kind: "with", text: "a happy expression" },
  scared: { kind: "with", text: "a frightened expression" },
  nervous: { kind: "with", text: "a nervous expression" },
  "naughty face": { kind: "with", text: "a mischievous expression" },
  "parted lips": { kind: "with", text: "{pos} lips parted" },
  ":d": { kind: "state", text: "smiling with {pos} mouth open" },
  ":o": { kind: "with", text: "{pos} mouth open in surprise" },
  ":p": { kind: "state", text: "sticking out {pos} tongue" },
  ";d": { kind: "state", text: "winking with an open-mouthed smile" },
  ":3": { kind: "with", text: "a cat-like smile" },
  ":<": { kind: "state", text: "frowning" },
  "tongue out": { kind: "state", text: "sticking out {pos} tongue" },
  "fang": { kind: "with", text: "a visible fang" },
  "skin fang": { kind: "with", text: "a small fang" },
  "teeth": { kind: "with", text: "{pos} teeth showing" },
  "upper teeth only": { kind: "with", text: "{pos} upper teeth showing" },
  "furrowed brow": { kind: "with", text: "a furrowed brow" },
  "raised eyebrows": { kind: "with", text: "raised eyebrows" },
  "v-shaped eyebrows": { kind: "with", text: "angry v-shaped eyebrows" },
  "half-closed eyes": { kind: "with", text: "half-closed eyes" },
  "heart-shaped pupils": { kind: "with", text: "heart-shaped pupils" },
  "empty eyes": { kind: "with", text: "empty, lifeless eyes" },
  "jitome": { kind: "with", text: "a flat, unimpressed stare" },
  "drooling": { kind: "state", text: "drooling" },
  "saliva": { kind: "with", text: "saliva on {pos} lips" },
}
