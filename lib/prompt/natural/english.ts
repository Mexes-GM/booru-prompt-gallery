/**
 * Small English helpers for turning booru tags into phrases: articles, lists,
 * pronouns, and the phrase rules for pose, expression and gaze tags.
 *
 * A rule that cannot place a tag returns null; the renderer then keeps the tag
 * verbatim and reports it, so the eval can see which tags still need a phrase.
 */

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
    // Phrases of one or two words ("smiling", "looking up") never merge.
    const key = phrase.split(" ").length >= 3 ? phrase.slice(0, cut) : `\0${phrase}`
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
const WORN_ON_RE = /^(.+) (on head|on back|around waist)$/

/** "goggles on head" -> "goggles on her head", "gothic lolita" -> "a gothic lolita outfit", "skirt" -> "a skirt". */
export function garmentPhrase(tag: string, possessive: string): string {
  if (GARMENT_WORDING[tag]) return GARMENT_WORDING[tag]
  const worn = tag.match(WORN_ON_RE)
  if (!worn) return withArticle(tag)
  const [preposition, part] = worn[2].split(" ")
  return `${withArticle(worn[1])} ${preposition} ${possessive} ${part}`
}

// Clothing tags that describe the outfit instead of naming a garment.
const CLOTHING_STATES = new Set([
  "sleeveless", "strapless", "backless", "single off shoulder", "topless", "bottomless", "barefoot", "nude", "naked",
  "see-through", "wet clothes", "open clothes", "torn clothes", "no bra", "no panties", "completely nude",
  "off shoulder", "off-shoulder", "covered navel", "highleg", "sideboob", "underboob", "cleavage",
  "midriff", "navel", "bare shoulders", "bare arms", "bare legs", "zettai ryouiki", "clothing cutout",
  "cleavage cutout", "shoulder cutout", "taut clothes", "skindentation", "frills", "lace trim",
])

export function isClothingState(tag: string): boolean {
  return CLOTHING_STATES.has(tag) || / cutout$/.test(tag)
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
  // "holding thermos" -> "holding a thermos": a bare object noun takes its article.
  const object = rest.join(" ")
  if (rest.length === 1 && !NOT_AN_OBJECT_RE.test(object)) return { kind: "state", text: `${first} ${withArticle(object)}` }
  return { kind: "state", text: own(tag) }
}

// After a verb, words that are not a thing it acts on: adverbs, particles,
// participles, people and body parts ("smiling faintly", "lying down", "biting lip").
const NOT_AN_OBJECT_RE = /(ly|ed|ing)$|^(forward|backward|backwards|back|down|up|away|over|out|in|off|on|around|together|apart|aside|alone|still|sideways|hard|another|someone|each|both|all|viewer|ass|butt|breast|breasts|chest|penis|pussy|nipple|nipples|thigh|thighs|head|face|hair|tail|ears|neck|belly|stomach|foot|feet|hand|hands|arm|arms|leg|legs|lip|lips|mouth|tongue|teeth|finger|fingers)$/

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
 * Drops tags another tag in the list already implies, as Danbooru tags both:
 * "shirt" next to "grey shirt", "long hair" next to "very long hair",
 * "reaching" next to "reaching towards viewer". Prose only; tag output keeps
 * the redundancy on purpose.
 */
export function dropImplied(tags: string[]): string[] {
  const implied = new Set<string>()
  for (const tag of tags) for (const other of IMPLIES[tag] ?? []) implied.add(other)
  // "colored skin" only says the skin is an unnatural colour; "grey skin" says which.
  if (tags.some((tag) => SKIN_COLOR_RE.test(tag))) implied.add("colored skin")
  // A kind of thing implies the generic word, where it was placed too:
  // "parasol" -> "umbrella", "handgun" -> "gun" and "weapon", "sword on back" -> "weapon on back".
  for (const tag of tags) {
    const { item, place } = splitPlacement(tag)
    for (const generic of genericsOf(item)) implied.add(place ? `${generic} ${place}` : generic)
  }
  // Several sizes of one body part ("big ass, huge ass, large ass"): keep the largest.
  const largest = new Map<string, number>()
  for (const tag of tags) {
    const size = sizeOf(tag)
    if (size) largest.set(size.noun, Math.max(largest.get(size.noun) ?? 0, size.rank))
  }
  return tags.filter((tag) => {
    const size = sizeOf(tag)
    if (size && size.rank < (largest.get(size.noun) ?? 0)) return false
    return !implied.has(tag) && !tags.some((other) => other !== tag && (other.endsWith(` ${tag}`) || other.startsWith(`${tag} `)))
  })
}

/**
 * Drops phrases another phrase in the list already says, after the dictionary
 * has turned tags into words: "performing oral sex" next to "performing oral
 * sex on a penis", or two tags that map to the same phrase.
 */
export function dropContainedPhrases(phrases: string[]): string[] {
  const unique = [...new Set(phrases)]
  return unique.filter((phrase) => !unique.some((other) => other !== phrase && ` ${other} `.includes(` ${phrase} `)))
}

const SIZE_RANK: Record<string, number> = { flat: 1, small: 2, medium: 3, big: 4, large: 5, huge: 6, gigantic: 7, enormous: 7 }

function sizeOf(tag: string): { noun: string; rank: number } | null {
  const [first, ...rest] = tag.split(" ")
  return SIZE_RANK[first] && rest.length ? { noun: rest.join(" "), rank: SIZE_RANK[first] } : null
}

const IMPLIES: Record<string, string[]> = {
  ":d": ["smile", "open mouth"],
  ";d": ["smile", "open mouth", "one eye closed"],
  grin: ["smile"],
  "completely nude": ["nude"],
  "double v": ["v"],
  "husband and wife": ["couple"],
  "dark-skinned female": ["dark skin"],
  "dark-skinned male": ["dark skin"],
  "gothic lolita": ["lolita fashion"],
  "classic lolita": ["lolita fashion"],
  "sweet lolita": ["lolita fashion"],
}

const SKIN_COLOR_RE = /^(grey|gray|blue|green|red|purple|pink|orange|yellow|black|white|aqua|multicolored|two-tone) skin$/

// Kinds of a thing that Danbooru tags next to the generic word (a suffix match already covers "transparent umbrella").
const HYPONYMS: Record<string, string> = {
  wristwatch: "watch", parasol: "umbrella",
  handgun: "gun", pistol: "gun", revolver: "gun", rifle: "gun", shotgun: "gun",
  katana: "sword", rapier: "sword", saber: "sword", sabre: "sword", scimitar: "sword", claymore: "sword",
}
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
  const out = generic ? [generic] : []
  if (item !== "weapon" && WEAPON_RE.test(item)) out.push("weapon")
  return out
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
