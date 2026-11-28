/**
 * Scene extraction: a booru post seen as a coherent scene that can be transplanted
 * onto another character.
 *
 * Every post of a pool was tagged as a whole by one person, so what it shows
 * (pose, act, expression, camera, clothing, place) is consistent. `extractScene`
 * keeps that and takes out what belongs to the person who happened to be in it:
 * their name, their permanent traits, the people count (kept apart as `pairing`
 * so the prompt header can be written from the new character).
 */
import type { BooruPost, BooruProvider } from '../../booru/types'
import { genderedTrait, peopleVocabulary, postPeople, sitePeopleRole } from './people'
import { classifyPostForPack, normalizeTagForPack, postAspectLog } from '../pack-generator'
import { postCharacters } from '../character-focus'
import { splitTags } from '../../utils/tag-utils'
import { getTagSlotFromOverrides } from '../../tag-taxonomy'
import type { TagCategory } from '../../tag-taxonomy'
import { GENDER_AFFINITY } from '../../prompt/natural/gender-affinity'
import { COUNT_TAG_RE, OPEN_COUNT_RE, isKinshipTag, type Permanence } from './permanence'
import { hasGarmentQualifier, isFranchiseGarment, isQualifiedName } from './franchise'
import { isEnvironmentTag } from '../background-coherence'
import { canonicalSpelling } from './spelling'

/**
 * Types a booru gives its tags. 'deprecated' is a tag the booru retired; 'unlisted' is
 * one a complete list of the booru's tags doesn't have (a new or very rare name).
 */
export type TagKind = 'general' | 'artist' | 'copyright' | 'character' | 'meta' | 'deprecated' | 'unlisted'

export type SceneRating = 'g' | 's' | 'q' | 'e'

/** The blocks a scene is made of; each one is real inside and is swapped as a whole. */
export interface SceneUnits {
  /** Posture, act, gesture, interaction. */
  skeleton: string[]
  /** Expression and state of the eyes. */
  face: string[]
  camera: string[]
  /** Clothing and its state, and roles that come with a uniform. */
  outfit: string[]
  /** Exposure: body parts the picture shows or leaves bare. It travels with the outfit. */
  exposure: string[]
  /** State of the hair, and what the source is about when it describes the people (see THEME_SHARE). */
  body: string[]
  /** Everything about the surroundings: location, props, sky, weather, light, background. */
  place: string[]
  /** Equipment and creatures. */
  extras: string[]
  /** Unclassified tags the pool vouches for. */
  loose: string[]
}

export type UnitName = keyof SceneUnits

/** Order of the units inside a prompt (the identity goes before `skeleton`). */
export const UNIT_ORDER: readonly UnitName[] = ['skeleton', 'face', 'outfit', 'exposure', 'body', 'camera', 'place', 'extras', 'loose']

export interface Scene {
  postId: number
  rating: SceneRating
  /** width / height of the post. */
  aspect?: number
  preview?: string
  /** People of the picture by gender, or null when the count is open ("multiple girls") or unknown. */
  people: { girls: number; boys: number } | null
  /** Composition tags the scene brings that are not plain counts (hetero, yuri, solo...). */
  pairing: string[]
  units: SceneUnits
  /** Share of the state tags that at least MIN_TYPICAL_SUPPORT posts of the pool carry (set when the pool is built). */
  typicality?: number
  /** Physical supports that tie pose and place together ("bed", "wall"), plus indoors / outdoors. */
  anchors: string[]
  /** Written by the scene model, not taken from a real post (lib/pack/scene/invented.ts). */
  invented?: true
}

export interface SceneContext {
  /** tag (spaces) -> "category:subcategory". */
  overrides: Record<string, string>
  permanence: (tag: string) => Permanence
  /** Gender of the character the scenes are transplanted onto. */
  subject: 'girl' | 'boy'
  /** People the pack names, by gender (a cast of two or three); default: the subject alone. */
  cast?: { girls: number; boys: number }
  /** Number of pool posts that carry the tag. Without it, no unclassified tag is filtered by support. */
  poolSupport?: (tag: string) => number
  /**
   * Number of different characters / series (as listed on the posts) among the posts that
   * carry the tag. A name, or a work title the database does not know, shows up only
   * with one of them. Leave it out for pools of a single character.
   */
  poolSources?: (tag: string) => number
  /**
   * What the booru itself says a tag is. A tag typed as artist, copyright, character or meta
   * is never part of a scene; `undefined` means no data and the support filter applies.
   */
  tagKind?: (tag: string) => TagKind | undefined
  /** Place tags of the pool together with their word suffixes ("bunk bed" adds "bed"). */
  poolPlace?: ReadonlySet<string>
  /**
   * Share of the pool's posts that carry the tag. A trait of the other people
   * of a picture, or a comparison between them, travels only when the source is
   * about it (THEME_SHARE): "dark-skinned male" in a pool searched for it.
   */
  poolShare?: (tag: string) => number
  /** A tag with no type and no slot that is most likely a name the booru didn't type (see names.ts). */
  looksLikeName?: (tag: string) => boolean
  /**
   * The site the posts come from: who is in a picture is read in its vocabulary (people.ts
   * postPeople; Rule34 counts with "male" / "female" and group tags), and the site's own words for
   * the people ("female", "straight", "male/female", "anthro") stay out of the scene (sitePeopleRole).
   * Missing: the Danbooru reading.
   */
  provider?: BooruProvider
}

const MULTIPLE_RE = /^multiple (girls|boys|others)$/

/** Posts, and different characters / series, a tag needs in the pool before an unclassified tag travels with its scene. */
export const MIN_LOOSE_SUPPORT = 2
/** Posts that carry a tag for it to count as typical of the pool. */
export const MIN_TYPICAL_SUPPORT = 3
/** Share of the pool's posts a tag about the people needs to be the source's theme rather than one donor's identity. */
export const THEME_SHARE = 0.5

/** Maps the rating vocabularies of the providers to g / s / q / e. */
export function normalizeRating(rating: string | undefined): SceneRating {
  switch ((rating ?? '').toLowerCase()) {
    case 'g':
    case 'general':
    case 'safe':
      return 'g'
    case 's':
    case 'sensitive':
      return 's'
    case 'e':
    case 'explicit':
      return 'e'
    default:
      // "q", "questionable" and anything unknown: the cautious middle.
      return 'q'
  }
}

export const RATING_LEVEL: Record<SceneRating, number> = { g: 0, s: 1, q: 2, e: 3 }

export function emptyUnits(): SceneUnits {
  return { skeleton: [], face: [], camera: [], outfit: [], exposure: [], body: [], place: [], extras: [], loose: [] }
}

/** Every tag of a set of units, in prompt order. */
export function unitTags(units: SceneUnits): string[] {
  return UNIT_ORDER.flatMap((unit) => units[unit])
}

/** Every tag of a scene's units, in prompt order. */
export function sceneTags(scene: Scene): string[] {
  return unitTags(scene.units)
}

/** Tags of the units that describe the picture (everything but the pairing). */
export function stateTagCount(scene: Scene): number {
  return sceneTags(scene).length
}

/** Share of tags two lists have in common (1 for two empty lists). */
export function jaccard(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a)
  const setB = new Set(b)
  if (setA.size === 0 && setB.size === 0) return 1
  let shared = 0
  setA.forEach((tag) => {
    if (setB.has(tag)) shared++
  })
  return shared / (setA.size + setB.size - shared)
}

// ── Donor gender ──────────────────────────────────────────────────────────────

const GIRL_WORD = /\b(female|girl|girls|woman|women)\b/
const BOY_WORD = /\b(male|boy|boys|man|men)\b/
/** Minimum share of solo posts for the affinity table to speak. */
const AFFINITY_MIN_SHARE = 0.01
/** How many times more common a tag must be for one gender to claim it. */
const AFFINITY_RATIO = 4

/** The gender a tag clearly belongs to, from its words or from who it is used for in solo posts. */
export function tagGender(tag: string, rating: SceneRating): 'girl' | 'boy' | null {
  const girl = GIRL_WORD.test(tag)
  const boy = BOY_WORD.test(tag)
  if (girl !== boy) return girl ? 'girl' : 'boy'
  if (girl && boy) return null
  const affinity = GENDER_AFFINITY[tag]
  if (!affinity) return null
  const offset = rating === 'g' || rating === 's' ? 0 : 2
  const woman = affinity[offset]
  const man = affinity[offset + 1]
  if (man >= AFFINITY_MIN_SHARE && man >= AFFINITY_RATIO * woman) return 'boy'
  if (woman >= AFFINITY_MIN_SHARE && woman >= AFFINITY_RATIO * man) return 'girl'
  return null
}

// ── Units by slot ─────────────────────────────────────────────────────────────

const SKELETON_SLOTS = new Set([
  'pose:posture', 'pose:gesture', 'pose:kinetic', 'pose:combat', 'pose:interaction', 'pose:physiological',
])

/** Unit of a state tag that has a known slot, or null when the slot is not an axis. */
export function unitOfSlot(slot: string): UnitName | null {
  if (SKELETON_SLOTS.has(slot)) return 'skeleton'
  if (slot === 'pose:expression' || slot === 'appearance:eyes') return 'face'
  if (slot === 'pose:camera') return 'camera'
  if (slot === 'appearance:anatomy') return 'exposure'
  if (slot === 'appearance:hair') return 'body'
  if (slot === 'appearance:demographics' || slot.startsWith('clothing:')) return 'outfit'
  if (slot.startsWith('scenery:')) return 'place'
  if (slot.startsWith('equipment:') || slot.startsWith('creature:')) return 'extras'
  return null
}

/** Unit for a tag without a usable slot, from the category the classifier guessed (null: drop it). */
function unitOfCategory(category: TagCategory): UnitName | null {
  switch (category) {
    case 'clothing': return 'outfit'
    case 'scenery': return 'place'
    case 'equipment':
    case 'creature': return 'extras'
    // A permanent trait of unknown kind would leak the donor's identity: not worth the risk.
    case 'appearance': return null
    default: return 'loose'
  }
}

/** `other:*` slots that are names, meta, style or layout: never part of a scene. */
const NON_SCENE_OTHER = new Set(['character', 'copyright', 'artist', 'meta', 'style', 'layout'])
/**
 * A decade on its own ("00s", "90s", "1990s"): the era the picture is drawn in. The taxonomy files
 * it as style under another spelling ("2000s (style)"), and Gelbooru types it as a general tag, so
 * neither the slot nor the booru's type keeps it out.
 */
const DECADE_RE = /^(\d0|\d{3}0)s$/

// ── Anchors ───────────────────────────────────────────────────────────────────

const ANCHOR_RE = /(?:^|\s)(?:on|against|in|under|behind|beside)\s+(?:the |a |an )?(.+)$/

function isPlaceNoun(noun: string, ctx: SceneContext): boolean {
  const slot = getTagSlotFromOverrides(noun, ctx.overrides)?.slot
  if (slot?.startsWith('scenery:')) return true
  return ctx.poolPlace?.has(noun) ?? false
}

function anchorsOf(units: SceneUnits, ctx: SceneContext): string[] {
  const anchors = new Set<string>()
  for (const tag of [...units.skeleton, ...units.place]) {
    const noun = ANCHOR_RE.exec(tag)?.[1]?.trim()
    if (noun && isPlaceNoun(noun, ctx)) anchors.add(noun)
  }
  const all = new Set(unitTags(units))
  if (all.has('indoors')) anchors.add('indoors')
  if (all.has('outdoors')) anchors.add('outdoors')
  return Array.from(anchors)
}

// ── Extraction ────────────────────────────────────────────────────────────────

/**
 * The scene of a post for a character of gender `ctx.subject`, or null when the post
 * has no person in it.
 */
export function extractScene(post: BooruPost, ctx: SceneContext): Scene | null {
  const classified = classifyPostForPack(post, ctx.overrides)
  const bucket = new Map<string, TagCategory>()
  for (const category of Object.keys(classified) as TagCategory[]) {
    for (const tag of classified[category]) bucket.set(tag, category)
  }
  const characters = new Set(postCharacters(post))
  const rating = normalizeRating(post.rating)
  const ordered = Array.from(new Set(splitTags(post.tag_string || '').map(normalizeTagForPack)))
    .filter((tag) => tag && bucket.has(tag) && !characters.has(tag))

  // A site that writes the people its own way (Rule34, e621): its words for who is there are read
  // below and said by the prompt's header; the kind of being someone is ("human", "anthro") is part
  // of who they are, like a hair colour.
  const vocabulary = peopleVocabulary(ctx.provider)
  const siteRole = (tag: string) => sitePeopleRole(tag, vocabulary)

  // Pass 1: people and pairing.
  let girls = 0
  let boys = 0
  let openCount = false
  // Boorus tag "multiple girls" next to "2girls": it's open only when no number says how many.
  const multiple: string[] = []
  const pairing: string[] = []
  const rest: string[] = []
  // Danbooru spellings already taken: two spellings of one tag in a post make one tag.
  const spelledSeen = new Set<string>()
  for (const tag of ordered) {
    if (tag === 'no humans') return null
    const count = COUNT_TAG_RE.exec(tag)
    if (count && !count[2] && !count[3].startsWith('other')) {
      const n = Number(count[1])
      if (count[3].startsWith('girl')) girls += n
      else boys += n
      continue
    }
    if (MULTIPLE_RE.test(tag)) {
      multiple.push(tag)
      continue
    }
    if (count || OPEN_COUNT_RE.test(tag)) {
      openCount = true
      pairing.push(tag)
      continue
    }
    const role = siteRole(tag)
    if (role === 'people') continue
    // From here on the scene speaks Danbooru's spelling ("cum inside" is "cum in pussy"); the site's
    // own words for the people are read above in its own.
    const spelled = role ? tag : canonicalSpelling(tag, ctx.overrides, ctx.permanence)
    if (spelled !== tag) {
      if (spelled === 'no humans') return null
      if (spelledSeen.has(spelled) || ordered.includes(spelled)) continue
      spelledSeen.add(spelled)
      if (!bucket.has(spelled)) bucket.set(spelled, bucket.get(tag)!)
    }
    if (ctx.permanence(spelled) === 'composition') {
      if (!isKinshipTag(spelled)) pairing.push(spelled)
      continue
    }
    rest.push(spelled)
  }
  for (const tag of multiple) {
    const counted = tag.endsWith('girls') ? girls > 1 : tag.endsWith('boys') ? boys > 1 : false
    if (counted) continue
    openCount = true
    pairing.push(tag)
  }
  const isTheme = (tag: string) => (ctx.poolShare?.(tag) ?? 0) >= THEME_SHARE
  let people = openCount || girls + boys === 0 ? null : { girls, boys }
  // A site that writes who is there its own way (Rule34): its vocabulary decides; once the people are
  // known, the open counts it also carries say nothing more.
  if (vocabulary === 'rule34') {
    people = postPeople(ordered, ctx.provider).people
    if (people) {
      const answered = pairing.filter((tag) => OPEN_COUNT_RE.test(tag) || COUNT_TAG_RE.test(tag) || /^multiple (girls|boys|others)$/.test(tag))
      for (const tag of answered) pairing.splice(pairing.indexOf(tag), 1)
    }
  }

  // A signature accessory (glasses, hat) travels only with a complete costume.
  const hasFullOutfit = rest.some(
    (tag) => ctx.permanence(tag) === 'state' && getTagSlotFromOverrides(tag, ctx.overrides)?.slot === 'clothing:outfit'
  )
  // Another person's traits are their identity, like the subject's. They stay only for someone
  // nobody in the pack plays (an anonymous partner), when the source is about them, and only when
  // no named person shares that gender (else nobody can tell whose trait it is).
  const named = ctx.cast ?? (ctx.subject === 'girl' ? { girls: 1, boys: 0 } : { girls: 0, boys: 1 })
  const anonymousTraitsOf = (gender: 'girl' | 'boy') => {
    if (!people) return false
    const [present, cast] = gender === 'girl' ? [people.girls, named.girls] : [people.boys, named.boys]
    return cast === 0 && present > 0
  }

  const units = emptyUnits()
  const seen = new Set<string>()
  const supported = (tag: string) =>
    (!ctx.poolSupport || ctx.poolSupport(tag) >= MIN_LOOSE_SUPPORT) &&
    (!ctx.poolSources || ctx.poolSources(tag) >= MIN_LOOSE_SUPPORT)
  const put = (unit: UnitName, tag: string) => {
    if (seen.has(tag)) return
    seen.add(tag)
    units[unit].push(tag)
  }

  for (const tag of rest) {
    const kind = ctx.tagKind?.(tag)
    if (kind && kind !== 'general') continue
    const info = getTagSlotFromOverrides(tag, ctx.overrides)
    const slot = info?.slot
    if (info?.category === 'other' && slot && NON_SCENE_OTHER.has(slot.slice('other:'.length))) continue
    if (!slot && DECADE_RE.test(tag)) continue
    if (!kind && !slot && ctx.looksLikeName?.(tag)) continue
    // A general tag qualified by a work or a character is a name tied to it ("... (project moon)").
    if (!slot && isQualifiedName(tag, ctx.tagKind)) continue

    // A trait written with a gender ("light-skinned female", "nude male") is that person's trait,
    // read as the trait on its own: lasting like skin or hair, or of this picture like nudity.
    const trait = genderedTrait(tag, ctx.overrides, ctx.permanence)
    const permanence = siteRole(tag) === 'kind' ? 'identity' : trait ? trait.permanence : ctx.permanence(tag)
    if (permanence === 'identity') {
      const gender = tagGender(tag, rating)
      if (gender && anonymousTraitsOf(gender) && isTheme(tag)) put('body', tag)
      continue
    }
    // Comparisons with someone else (the partner, the donor's canon) mean nothing once moved.
    if (permanence === 'relative') {
      if (isTheme(tag)) put('body', tag)
      continue
    }
    if (permanence === 'signature') {
      if (hasFullOutfit) put('outfit', tag)
      continue
    }

    const fallback = unitOfCategory(info?.category ?? bucket.get(tag) ?? 'other')
    // Surroundings all belong to the place, so a swapped or plain place leaves none of the old one behind.
    if (isEnvironmentTag(tag, ctx.overrides)) {
      if (slot || supported(tag)) put('place', tag)
      continue
    }
    const unit = trait ? unitOfSlot(trait.slot) : slot ? unitOfSlot(slot) : null
    const garment = unit === 'outfit' || (!unit && (fallback === 'outfit' || hasGarmentQualifier(tag)))
    if (garment && isFranchiseGarment(tag, ctx.overrides, ctx.tagKind)) continue
    if (unit) {
      put(unit, tag)
      continue
    }
    // No axis slot: the pool has to vouch for it.
    if (fallback && supported(tag)) put(fallback, tag)
  }

  const aspectLog = postAspectLog(post)
  return {
    postId: post.id,
    rating,
    aspect: aspectLog === null ? undefined : Math.exp(aspectLog),
    preview: post.preview_file_url || undefined,
    people,
    pairing,
    units,
    anchors: anchorsOf(units, ctx),
    ...(post._invented ? { invented: true as const } : {}),
  }
}
