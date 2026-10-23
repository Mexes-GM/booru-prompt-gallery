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
} satisfies Record<string, Pronouns>

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** "a, b and c". */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ""
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}

// Nouns used without an article: plurals, pairs and mass nouns.
const MASS_NOUNS = /\b(teeth|cleavage|food|sclera|grass|pantyhose|underwear|lingerie|clothes|clothing|armor|armour|makeup|jewelry|lipstick|eyeshadow|nail polish|fur|hair|skin|bandages|tape|swimwear|sportswear|footwear|headwear|eyewear|legwear|neckwear)$/
const SINGULAR_S = /(ss|us|is|dress|bodysuit|swimsuit|jumpsuit|tracksuit|catsuit|leotards?)$/

export function isPluralNoun(phrase: string): boolean {
  const last = phrase.split(" ").pop() ?? phrase
  if (MASS_NOUNS.test(phrase)) return true
  return last.endsWith("s") && !SINGULAR_S.test(last)
}

/** "white dress" -> "a white dress", "thighhighs" -> "thighhighs", "apron" -> "an apron". */
export function withArticle(phrase: string): string {
  if (isPluralNoun(phrase)) return phrase
  return `${/^[aeiou]/.test(phrase) && !/^(uni|one|eu)/.test(phrase) ? "an" : "a"} ${phrase}`
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
  const first = tag.split(" ")[0]
  if (first.endsWith("ing") && first.length > 4) return { kind: "state", text: own(tag) }
  return null
}

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
