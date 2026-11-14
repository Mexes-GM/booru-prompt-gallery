/**
 * Scene composition: the identity of the pack's character plus a scene, written in a
 * fixed order. In `faithful` mix the scene is used whole; in `remix` mix its face,
 * camera, place and outfit are swapped for those of compatible scenes.
 *
 * Tags of one scene are never checked against each other: they appeared together in a
 * real post. Conflicts are checked where tags from different sources meet: the scene
 * against the identity (the identity wins) and every swapped unit against the rest.
 */
import { createSeededRng } from '../pack-generator'
import { resolveTagConflicts } from '../../tag-conflicts'
import { getTagSlotFromOverrides } from '../../tag-taxonomy'
import { loadedTagRelations, needsCompany, relationKey, requiredBy, requiredSlots, type TagRelations } from '../../tag-relations'
import { isQualifiedVariant } from '../character-identity'
import { conflictsWithBackground, isEnvironmentTag, isPlainBackgroundTag, isSceneTag } from '../background-coherence'
import { selectScenes } from './scene-select'
import type { ScenePool } from './scene-pool'
import { COUNT_TAG_RE, OPEN_COUNT_RE, isCompositionPattern } from './permanence'
import {
  RATING_LEVEL,
  tagGender,
  UNIT_ORDER,
  unitTags,
  type Scene,
  type SceneRating,
  type SceneUnits,
  type UnitName,
} from './scene'

export interface ComposeOptions {
  /** Fixed tags of the character, in order; they may include a people count ("1girl"). */
  identity: string[]
  subject: 'girl' | 'boy'
  mix: 'faithful' | 'remix'
  /** 'own': the identity brings the clothing, so the scene's outfit is left out. */
  clothing: 'scene' | 'own' | { library: string[][] }
  scenery: 'scene' | 'vary' | 'plain'
  /** Equipment and creatures of the scene. */
  extras: boolean
  count: number
  seed: number
  disabledSituations?: string[]
  /** tag (spaces) -> "category:subcategory"; used for conflict and garment checks. */
  overrides?: Record<string, string>
  /**
   * The own tags of the scenes the user picked (Scene ideas). A post with none of them
   * lends only the person: posture, gesture, expression, framing and (per the clothing
   * option) the outfit; never its place, objects, creatures or anything unclassified.
   * Places are never swapped in: the picked scene says where the picture is.
   */
  sceneIdeaTags?: readonly string[]
  /**
   * Garments the user imposed (they are also in `identity`). The scene keeps its own clothes
   * only when they already have every one of them, or a qualified form ("white bikini" for
   * "bikini"); otherwise its outfit and exposure are left out.
   */
  wearing?: readonly string[]
  /**
   * A place the user imposed (also in `identity`): the scene's place is left out, never swapped
   * in, and pose tags tied to a support the imposed place doesn't name ("lying on bed" at a beach) go.
   */
  where?: readonly string[]
  /**
   * With `where`: a scene whose place already has every imposed place, or a qualified form,
   * keeps its own place (as `wearing` keeps clothes that already are the garments). Off by
   * default: the imposed place replaces the scene's whatever it is.
   */
  whereKeepsPlace?: boolean
  /**
   * The exposure tags of `scene` that belong to an act the user asked for, among those `clothes`
   * (the fixed tags and the outfit in use) don't rule out. They stay whatever clothes the prompt
   * ends up with: what the act shows of the bodies is part of the act, not of the clothes it was
   * shown with. Without it, or for a scene it returns nothing for, the exposure goes with its clothes.
   */
  actBody?: (scene: Scene, clothes: readonly string[]) => string[]
  /**
   * How the people besides the named characters look (SceneRequests.others). In a picture of two
   * or more people they go after the identity, as a block of their own, and win over the scene's
   * tags about the same trait of someone of that gender (same slot); a tag that names a gender goes
   * only when the picture has someone of that gender besides the subject. Never in a picture of one.
   */
  others?: readonly string[]
}

const traitWords = (tag: string) => tag.split(/[\s-]+/).filter(Boolean)

/**
 * True when `tag` says something else about the same trait of the same kind of person as `other`:
 * both name the same gender and they are the same words but one ("pale-skinned male" for
 * "dark-skinned male", "small penis" for "large penis"). The measured relations have no exclusions
 * between these (they are traits of the other person, rare in the posts), so the words decide.
 */
export function sameTraitOf(other: string, tag: string, rating: Scene['rating']): boolean {
  if (other === tag) return false
  const gender = tagGender(other, rating)
  if (!gender || tagGender(tag, rating) !== gender) return false
  const a = traitWords(other)
  const b = traitWords(tag)
  if (a.length < 2 || a.length !== b.length) return false
  return a.filter((word, i) => word !== b[i]).length === 1
}

/**
 * The tags of `others` that fit a picture of `scene`: none with fewer than two people; a tag that
 * names a gender ("dark-skinned male") only when someone of that gender besides the subject is in
 * it. An open count ("multiple boys") fits anything.
 */
export function othersFor(others: readonly string[], scene: Scene, subject: 'girl' | 'boy'): string[] {
  if (others.length === 0) return []
  const people = scene.people
  if (people && people.girls + people.boys < 2) return []
  return others.filter((tag) => {
    const gender = tagGender(tag, scene.rating)
    if (!gender || !people) return true
    const present = gender === 'girl' ? people.girls : people.boys
    return present - (gender === subject ? 1 : 0) > 0
  })
}

/** True when the scene already has one of the picked scenes' own tags. */
export function sceneHasIdeaTag(scene: Scene, tags: readonly string[]): boolean {
  if (tags.length === 0) return false
  const wanted = new Set(tags)
  return unitTags(scene.units).some((tag) => wanted.has(tag))
}

/** What a post that doesn't match the picked scene lends of the person: posture, gesture, expression, framing. */
const PERSON_SLOTS = new Set(['pose:posture', 'pose:gesture', 'pose:expression', 'pose:camera'])
/** The light physiological states it may lend too: blush, sweat, tears. */
const LIGHT_STATE = /\b(blush(ing)?|sweat(ing|drop)?|tears?|teardrops?)\b/
/** Harm, dirt and intoxication: never lent, whatever their slot ("blood", "bloody", "injury", "drunk"). */
const HARM = /\b(blood\w*|bleeding|injur\w*|bruis\w*|wound\w*|dirt\w*|drunk)\b/

/** True for a tag a post that doesn't match the picked scene may lend: the person's pose, face and framing. */
export function isPersonTag(tag: string, overrides: Record<string, string>): boolean {
  if (HARM.test(tag)) return false
  const slot = getTagSlotFromOverrides(tag, overrides)?.slot
  if (!slot) return false
  if (slot === 'pose:physiological') return LIGHT_STATE.test(tag)
  return PERSON_SLOTS.has(slot)
}

/**
 * `units` reduced to the person: posture, gesture, expression and framing by the
 * taxonomy's slots (isPersonTag), and the outfit with its exposure (the clothing
 * option decides on those), less anything about harm. No place, extras, combat,
 * movement, interaction, hair state or unclassified tags.
 */
function personOnly(units: SceneUnits, overrides: Record<string, string>): void {
  units.place = []
  units.extras = []
  units.loose = []
  units.body = []
  for (const unit of ['skeleton', 'face', 'camera'] as const) units[unit] = units[unit].filter((tag) => isPersonTag(tag, overrides))
  for (const unit of ['outfit', 'exposure'] as const) {
    units[unit] = units[unit].filter((tag) => !HARM.test(tag) && !isEnvironmentTag(tag, overrides))
  }
}

export interface ScenePrompt {
  tags: string[]
  /** Header and identity tags: the cleaner must keep them as they are. */
  locked: string[]
  rating: SceneRating
  aspect?: number
  /**
   * Post each unit came from. `skeleton` is the base scene; the other units appear
   * only when they were swapped in from another scene.
   */
  sources: { skeleton: number; face?: number; camera?: number; place?: number; outfit?: number; pose?: number }
  /** With imposed garments (`ComposeOptions.wearing`): the scene's own clothes already have them, so they stayed. */
  sceneWears?: boolean
}

/** True when `outfit` has every garment of `wearing`, or a qualified form of it ("white bikini" for "bikini"). */
export function outfitWears(outfit: readonly string[], wearing: readonly string[]): boolean {
  return wearing.length > 0 && wearing.every((garment) => outfit.some((tag) => isQualifiedVariant(tag, garment)))
}


export const PLAIN_BACKGROUND = 'simple background'
/** Chance that each swappable unit is replaced in `remix` mix. */
export const SWAP_CHANCE = 0.5
/** Donors tried for a swap before the scene keeps its own unit. */
const MAX_DONOR_TRIES = 6
/** Extra passes allowed to reach `count` prompts when the pool has fewer scenes. */
const ATTEMPTS_PER_PROMPT = 6

type SwapUnit = 'face' | 'camera' | 'place' | 'outfit'
/** Units that move together: exposure goes with the outfit it was shown with. */
const SWAP_PARTS: Record<SwapUnit, UnitName[]> = {
  face: ['face'],
  camera: ['camera'],
  place: ['place'],
  outfit: ['outfit', 'exposure'],
}

// ── Header ────────────────────────────────────────────────────────────────────

const countTag = (n: number, kind: 'girl' | 'boy'): string => `${n}${kind}${n > 1 ? 's' : ''}`
const isOpenCount = (tag: string): boolean => {
  const m = COUNT_TAG_RE.exec(tag)
  return OPEN_COUNT_RE.test(tag) || (!!m && (!!m[2] || m[3].startsWith('other')))
}
const exactCount = (tags: string[], kind: 'girl' | 'boy'): string | undefined =>
  tags.find((tag) => {
    const m = COUNT_TAG_RE.exec(tag)
    return !!m && !m[2] && m[3].startsWith(kind)
  })
const countOf = (tag: string | undefined): number => (tag ? Number(COUNT_TAG_RE.exec(tag)![1]) : 0)

interface Header {
  /** Count and pairing tags, written before the identity. */
  tags: string[]
  /** The identity without the tags that moved to the header. */
  identity: string[]
}

/**
 * Count and pairing tags of the prompt. Counts and pairing tags of the identity are
 * respected; what the scene adds (a partner, hetero...) is written after them. `solo`
 * and `solo focus` never stay with more than one person.
 */
function buildHeader(identity: string[], scene: Scene, subject: 'girl' | 'boy', overrides: Record<string, string>): Header {
  const fromIdentity = identity.filter(isCompositionPattern)
  const rest = identity.filter((tag) => !isCompositionPattern(tag))

  let girls = exactCount(fromIdentity, 'girl')
  let boys = exactCount(fromIdentity, 'boy')
  if (scene.people) {
    girls ??= scene.people.girls > 0 ? countTag(scene.people.girls, 'girl') : undefined
    boys ??= scene.people.boys > 0 ? countTag(scene.people.boys, 'boy') : undefined
    if (subject === 'girl') girls ??= '1girl'
    else boys ??= '1boy'
  }
  const open = [...fromIdentity.filter(isOpenCount), ...scene.pairing.filter(isOpenCount)]
  const counts = [girls, boys].flatMap((tag) => (tag ? [tag] : []))
  const scenePeople = scene.people ? scene.people.girls + scene.people.boys : 0
  const crowd = open.length > 0 || scenePeople > 1 || countOf(girls) + countOf(boys) > 1

  const header = [...counts, ...open]
  const isSolo = (tag: string) => tag === 'solo' || tag === 'solo focus'
  const pairing = fromIdentity.filter((tag) => !COUNT_TAG_RE.test(tag) && !isOpenCount(tag))
  const listed = new Set(pairing)
  for (const tag of scene.pairing) {
    if (isOpenCount(tag) || listed.has(tag)) continue
    if (isSolo(tag) && crowd) continue
    const base = [...header, ...pairing]
    if (base.length > 0 && resolveTagConflicts(base, [tag]).conflictingTags.length > 0) continue
    pairing.push(tag)
    listed.add(tag)
  }
  header.push(...pairing.filter((tag) => !(isSolo(tag) && crowd)))
  return { tags: Array.from(new Set(header)), identity: rest }
}

// ── Dangling references ───────────────────────────────────────────────────────

const AFTER_GARMENT = /^(.+) (?:lift|lifted|pull|pulled|aside|tug|tugged|removed|down|up)$/
const BEFORE_GARMENT = /^(?:open|unbuttoned|torn) (.+)$/
const AROUND = /^(.+?) around .+$/
const GENERIC_CLOTHES = new Set(['clothes', 'clothing'])

/**
 * Verbs a scene only uses with an object: "holding" needs something held. With the
 * object gone (extras off, the cleaner, another unit swapped in) the verb is left
 * pointing at nothing. The measured relations say this for most such tags ("reverse
 * grip" requires a weapon, "drinking" something in hand); these are the ones they
 * can't: verbs too general to require one kind of object, and "dual wielding",
 * which falls short of the measured threshold.
 */
const OBJECT_VERBS = new Set(['holding', 'carrying', 'riding', 'wielding'])
const HANDLING_TAGS = new Set(['dual wielding'])
/** Until the measured relations load, the tags they cover that the composer used to list by hand. */
const HANDLING_BEFORE_LOAD = new Set(['reverse grip'])
/** Categories whose tags can be the object of those verbs (a sword, a horse). */
const OBJECT_CATEGORIES = new Set(['equipment', 'creature'])
/** Slots of things carried in the hand: what a generic grip verb ("holding") can refer to. */
export const HAND_SLOTS: ReadonlySet<string> = new Set(['equipment:handheld', 'equipment:weapon'])
/** Verbs a creature can be the object of ("riding" a horse, "carrying" a cat). */
const CREATURE_VERBS = new Set(['riding', 'carrying'])

/**
 * Whether `tag` can be what `verb` refers to. A hand object or a weapon can; a prop or a
 * creature only when the measured relations say people hold it (a flower, a rabbit; not a
 * bed or a dog), or a creature for "riding" and "carrying". Before the relations load,
 * any object or creature counts.
 */
function canBeHeld(tag: string, verb: string, overrides: Record<string, string>, relations: TagRelations | null): boolean {
  const info = getTagSlotFromOverrides(tag, overrides)
  if (!relations) return OBJECT_CATEGORIES.has(info?.category ?? '')
  if (info?.slot && HAND_SLOTS.has(info.slot)) return true
  if (info?.category === 'creature' && CREATURE_VERBS.has(verb)) return true
  return relations.held.has(relations.index.get(relationKey(tag)) ?? -1)
}

/** A one-word gerund ("carrying", "reading"): an action, whatever slot the taxonomy files it under. */
const GERUND = /^[a-z]{3,}ing$/

/** True for a tag that names an action rather than a thing: the grip verbs, and one-word gerunds. */
export function isVerbTag(tag: string): boolean {
  return OBJECT_VERBS.has(tag) || GERUND.test(tag)
}

/**
 * Whether the measured relations say `tag` needs an object: it requires something of an
 * equipment or creature slot. For an interaction between people (it needs company, or its
 * slot is an interaction), the requirement counts only when a thing backs it ("shared
 * umbrella" requires "umbrella"): one backed only by a verb filed in that slot is not an
 * object. "princess carry" requires "carrying", filed with the hand objects, and what is
 * carried is the other person.
 */
export function needsObject(tag: string, overrides: Record<string, string>, relations: TagRelations | null): boolean {
  if (!relations) return false
  const slots = requiredSlots(relations, tag).filter((slot) => OBJECT_CATEGORIES.has(slot.slice(0, slot.indexOf(':'))))
  if (slots.length === 0) return false
  const interaction = needsCompany(relations, tag) || getTagSlotFromOverrides(tag, overrides)?.slot === 'pose:interaction'
  if (!interaction) return true
  const required = requiredBy(relations, tag)
  return slots.some((slot) => {
    const inSlot = required.filter((needed) => getTagSlotFromOverrides(needed, overrides)?.slot === slot)
    return inSlot.length === 0 || inSlot.some((needed) => !isVerbTag(needed))
  })
}

/**
 * Whether `tag` is something `verb` can refer to in a prompt: an object it can hold, or a tag
 * that names what the verb acts on ("holding sword"; "holding hands" is an interaction, not an object).
 */
function objectOf(verb: string, tag: string, overrides: Record<string, string>, relations: TagRelations | null): boolean {
  if (canBeHeld(tag, verb, overrides, relations)) return true
  return OBJECT_VERBS.has(verb) && tag.startsWith(`${verb} `) && getTagSlotFromOverrides(tag, overrides)?.category !== 'pose'
}

/** Comparable form of a garment word: "panties" and "panty" match, "shorts" and "short" too. */
function stem(word: string): string {
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`
  return word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word
}
const lastWord = (phrase: string): string => phrase.slice(phrase.lastIndexOf(' ') + 1)

/**
 * The garment a clothing-state tag refers to ("skirt lift" -> "skirt", "open shirt" -> "shirt"),
 * or null when the tag is not a reference. `*` stands for any clothing ("torn clothes").
 */
function garmentReferenced(tag: string, overrides: Record<string, string>): string | null {
  if (tag.startsWith('no ')) return null
  const phrase = AFTER_GARMENT.exec(tag)?.[1] ?? BEFORE_GARMENT.exec(tag)?.[1] ?? AROUND.exec(tag)?.[1]
  if (!phrase) return null
  const word = lastWord(phrase)
  if (GENERIC_CLOTHES.has(word)) return '*'
  const isClothing = getTagSlotFromOverrides(phrase, overrides)?.category === 'clothing'
  return isClothing ? stem(word) : null
}

/**
 * The garment a tag refers to by the measured relations: a clothing tag it requires and
 * names ("skirt lift" requires "skirt"; "panties aside" requires "panties"). Null when the
 * relations don't say ("open shirt" only requires "open clothes": the shape rules decide).
 */
function measuredGarment(tag: string, relations: TagRelations, overrides: Record<string, string>): string | null {
  if (tag.startsWith('no ')) return null
  // A tag that ends in a garment is one ("white shirt", "turtleneck shirt"), whatever it requires.
  if (getTagSlotFromOverrides(lastWord(tag), overrides)?.category === 'clothing') return null
  const words = new Set(tag.split(' ').map(stem))
  for (const needed of requiredBy(relations, tag)) {
    // Only a garment counts: "shirt lift" also requires "clothes lift", a state, not something worn.
    if (AFTER_GARMENT.test(needed) || BEFORE_GARMENT.test(needed) || AROUND.test(needed)) continue
    const word = stem(lastWord(needed))
    if (needed !== tag && words.has(word) && getTagSlotFromOverrides(needed, overrides)?.category === 'clothing') return word
  }
  return null
}

/** Tags of `tags` that only make sense with an object: the bare grip verbs, and what the measured relations say needs one. */
function objectVerbs(tags: readonly string[], overrides: Record<string, string>, relations: TagRelations | null): string[] {
  return tags.filter(
    (tag) =>
      OBJECT_VERBS.has(tag) ||
      HANDLING_TAGS.has(tag) ||
      (!relations && HANDLING_BEFORE_LOAD.has(tag)) ||
      // The measured relations: a tag that requires an object ("drinking" needs something in hand).
      needsObject(tag, overrides, relations)
  )
}

/**
 * Tags among `tags` that refer to something nothing else names: a lifted skirt needs a
 * skirt in the prompt, a bare "holding" needs a "holding X" or an object. Referring
 * tags do not count as naming the garment.
 */
export function danglingReferences(
  tags: string[],
  overrides: Record<string, string>,
  relations: TagRelations | null = loadedTagRelations()
): Set<string> {
  const dangling = new Set<string>()
  for (const verb of objectVerbs(tags, overrides, relations)) {
    if (!tags.some((tag) => objectOf(verb, tag, overrides, relations))) dangling.add(verb)
  }
  const references = new Map<string, string>()
  for (const tag of tags) {
    const garment = (relations && measuredGarment(tag, relations, overrides)) ?? garmentReferenced(tag, overrides)
    if (garment) references.set(tag, garment)
  }
  if (references.size === 0) return dangling
  const naming = tags.filter((tag) => !references.has(tag) && !tag.startsWith('no '))
  const named = new Set(naming.map((tag) => stem(lastWord(tag))))
  const clothing = naming.filter((tag) => getTagSlotFromOverrides(tag, overrides)?.category === 'clothing')
  // A compound garment word names its base garment too: a miniskirt is a skirt, a sundress a dress.
  const clothingWords = clothing.map((tag) => stem(lastWord(tag)))
  const isNamed = (garment: string) => named.has(garment) || clothingWords.some((word) => word.endsWith(garment))
  references.forEach((garment, tag) => {
    if (garment === '*' ? clothing.length === 0 : !isNamed(garment)) dangling.add(tag)
  })
  return dangling
}

/**
 * `tags` without the references to garments nothing else names. Tags in `keep` (the
 * header and the identity) stay whatever they say. The rule composePack applies, for
 * callers that change the tags afterwards (a cleanup step may drop the garment).
 */
export function dropDanglingReferences(
  tags: string[],
  keep: readonly string[],
  overrides: Record<string, string>,
  relations: TagRelations | null = loadedTagRelations()
): string[] {
  const dangling = danglingReferences(tags, overrides, relations)
  if (dangling.size === 0) return tags
  const kept = new Set(keep)
  return tags.filter((tag) => kept.has(tag) || !dangling.has(tag))
}

// ── Swaps ─────────────────────────────────────────────────────────────────────

const peopleKey = (scene: Scene): string => (scene.people ? `${scene.people.girls}g${scene.people.boys}b` : 'open')

/** True when `donor` offers a place that supports the posture of `scene` without contradicting it. */
export function placeFits(scene: Scene, donor: Scene): boolean {
  if (donor.units.place.length === 0) return false
  const has = (tag: string) => donor.anchors.includes(tag) || donor.units.place.includes(tag)
  const covered = (anchor: string) =>
    donor.anchors.includes(anchor) || donor.units.place.some((tag) => tag === anchor || tag.endsWith(` ${anchor}`))
  const supports = scene.anchors.filter((anchor) => anchor !== 'indoors' && anchor !== 'outdoors')
  if (!supports.every(covered)) return false
  if (scene.anchors.includes('indoors') && has('outdoors')) return false
  if (scene.anchors.includes('outdoors') && has('indoors')) return false
  return true
}

function shuffled<T>(items: T[], rng: () => number): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// ── Composition ───────────────────────────────────────────────────────────────

export function composePack(pool: ScenePool, options: ComposeOptions): { prompts: ScenePrompt[]; shortBy: number } {
  const prompts = Array.from(composePackPrompts(pool, options))
  return { prompts, shortBy: Math.max(0, options.count - prompts.length) }
}

/**
 * The prompts of composePack one at a time, in the same order: a caller that
 * stops early skips the work of the rest, and one that pauses between them keeps
 * the page responsive.
 */
export function* composePackPrompts(pool: ScenePool, options: ComposeOptions): Generator<ScenePrompt> {
  const overrides = options.overrides ?? {}
  const rng = createSeededRng(options.seed)
  const base = selectScenes(pool, options.count, { rng, disabledSituations: options.disabledSituations })
  if (base.length === 0) return

  const situationOf = new Map<number, string>()
  const members = new Map<string, Scene[]>()
  const byId = new Map(pool.scenes.map((scene) => [scene.postId, scene]))
  for (const situation of pool.situations) {
    members.set(situation.id, situation.sceneIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])))
    for (const id of situation.sceneIds) situationOf.set(id, situation.id)
  }

  /** Scenes that can lend `unit` to `scene`, best source first. */
  const donorsFor = (scene: Scene, unit: SwapUnit): Scene[] => {
    const others = (list: Scene[]) => list.filter((donor) => donor.postId !== scene.postId && donor.units[unit].length > 0)
    const sameSituation = others(members.get(situationOf.get(scene.postId) ?? '') ?? [])
    switch (unit) {
      case 'face': {
        if (sameSituation.length > 0) return sameSituation
        return others(pool.scenes).filter((donor) => donor.rating === scene.rating)
      }
      case 'camera':
        return sameSituation
      case 'place':
        return others(pool.scenes).filter((donor) => placeFits(scene, donor))
      case 'outfit':
        return others(pool.scenes).filter((donor) => donor.rating === scene.rating && peopleKey(donor) === peopleKey(scene))
    }
  }

  const composeOne = (scene: Scene): ScenePrompt => {
    const units: SceneUnits = {
      skeleton: scene.units.skeleton.slice(),
      face: scene.units.face.slice(),
      camera: scene.units.camera.slice(),
      outfit: scene.units.outfit.slice(),
      exposure: scene.units.exposure.slice(),
      body: scene.units.body.slice(),
      place: scene.units.place.slice(),
      extras: options.extras ? scene.units.extras.slice() : [],
      loose: scene.units.loose.slice(),
    }
    const sources: ScenePrompt['sources'] = { skeleton: scene.postId }
    let ratingLevel = RATING_LEVEL[scene.rating]
    const header = buildHeader(options.identity, scene, options.subject, overrides)
    const own = new Set(header.identity)
    const others = othersFor(options.others ?? [], scene, options.subject).filter((tag) => !own.has(tag))
    const fixed = [...header.tags, ...header.identity, ...others]
    // The others' look wins over what the scene says about the same trait of someone of that gender.
    if (others.length > 0) {
      const sameTrait = (tag: string) => others.some((other) => sameTraitOf(other, tag, scene.rating))
      for (const unit of UNIT_ORDER) units[unit] = units[unit].filter((tag) => !sameTrait(tag))
    }

    // A post that has nothing of the picked scene lends only the person.
    const ideaTags = options.sceneIdeaTags ?? []
    if (ideaTags.length > 0 && !sceneHasIdeaTag(scene, ideaTags)) personOnly(units, overrides)

    // Clothing and scenery choices that do not depend on the mix. What the scene's
    // character showed went with their clothes: another outfit leaves it behind.
    if (options.clothing === 'own') {
      units.outfit = []
      units.exposure = []
    } else if (typeof options.clothing === 'object') {
      const library = options.clothing.library
      units.outfit = library.length > 0 ? library[Math.floor(rng() * library.length)].slice() : []
      units.exposure = []
    }
    if (options.scenery === 'plain') units.place = [PLAIN_BACKGROUND]
    // An imposed place replaces the scene's, with what the pose leaned on there.
    const where = options.where ?? []
    if (where.length > 0) {
      const atPlace = options.whereKeepsPlace === true && where.every((tag) => units.place.some((own) => isQualifiedVariant(own, tag)))
      if (!atPlace) units.place = []
      const named = (noun: string) => where.some((tag) => tag === noun || tag.endsWith(` ${noun}`))
      const lost = new Set(scene.anchors.filter((anchor) => anchor !== 'indoors' && anchor !== 'outdoors' && !named(anchor)))
      if (lost.size > 0) units.skeleton = units.skeleton.filter((tag) => ![...lost].some((noun) => tag.endsWith(` ${noun}`)))
    }

    const swap =(unit: SwapUnit, force: boolean) => {
      const roll = rng()
      const wanted = force || (options.mix === 'remix' && roll < SWAP_CHANCE)
      if (!wanted) return
      const parts = SWAP_PARTS[unit]
      const current = parts.flatMap((part) => units[part])
      const donors = shuffled(donorsFor(scene, unit), rng).slice(0, MAX_DONOR_TRIES)
      for (const donor of donors) {
        const candidate = parts.flatMap((part) => donor.units[part])
        if (candidate.join('|') === current.join('|')) continue
        const emptied = { ...units }
        for (const part of parts) emptied[part] = []
        const rest = [...fixed, ...unitTags(emptied)]
        const clash =
          resolveTagConflicts(rest, candidate).conflictingTags.length > 0 ||
          candidate.some((tag) => conflictsWithBackground(tag, rest, overrides))
        if (clash) continue
        for (const part of parts) units[part] = donor.units[part].slice()
        sources[unit] = donor.postId
        ratingLevel = Math.max(ratingLevel, RATING_LEVEL[donor.rating])
        return
      }
    }
    swap('face', false)
    swap('camera', false)
    if (options.scenery !== 'plain' && ideaTags.length === 0 && where.length === 0) swap('place', options.scenery === 'vary')
    if (options.clothing === 'scene') swap('outfit', false)

    // Imposed garments: the scene's clothes stay only when they already are what was asked for.
    const wearing = options.wearing ?? []
    const sceneWears = outfitWears(units.outfit, wearing)
    if (wearing.length > 0 && !sceneWears) {
      units.outfit = []
      units.exposure = []
    }
    // What an asked-for act shows of the bodies stays with the act, whatever clothes replaced the scene's.
    if (options.actBody) {
      const shown = new Set(units.exposure)
      const act = options.actBody(scene, [...fixed, ...units.outfit]).filter((tag) => !shown.has(tag))
      if (act.length > 0) units.exposure = [...units.exposure, ...act]
    }

    // The identity wins over anything the scene says about the same thing.
    const identityTags = new Set(fixed)
    for (const unit of UNIT_ORDER) units[unit] = units[unit].filter((tag) => !identityTags.has(tag))
    // Clothes that already are the imposed garments don't clash with them.
    const wearingSet = new Set(wearing)
    const rivals = sceneWears ? fixed.filter((tag) => !wearingSet.has(tag)) : fixed
    const clashing = new Set(
      resolveTagConflicts(rivals, unitTags(units)).conflictingTags.map((conflict) => conflict.tag)
    )
    if (clashing.size > 0) for (const unit of UNIT_ORDER) units[unit] = units[unit].filter((tag) => !clashing.has(tag))

    // A place the identity pins (a scene idea's "beach") wins over a plain background
    // (Scenery: Plain, or the scene's own), as the identity wins any other clash.
    if (fixed.some((tag) => isSceneTag(tag, overrides))) {
      for (const unit of UNIT_ORDER) units[unit] = units[unit].filter((tag) => !isPlainBackgroundTag(tag))
    }

    // A plain background leaves no room for surroundings that survived elsewhere.
    if (units.place.length === 1 && isPlainBackgroundTag(units.place[0])) {
      for (const unit of UNIT_ORDER) {
        if (unit !== 'place') units[unit] = units[unit].filter((tag) => !isEnvironmentTag(tag, overrides))
      }
    }

    const dangling = danglingReferences([...fixed, ...unitTags(units)], overrides)
    if (dangling.size > 0) for (const unit of UNIT_ORDER) units[unit] = units[unit].filter((tag) => !dangling.has(tag))

    // Each character's block stays whole, even where two blocks share a tag: they are different people.
    const fixedSet = new Set(fixed)
    const tags = [...fixed, ...Array.from(new Set(unitTags(units))).filter((tag) => !fixedSet.has(tag))]
    const rating = (['g', 's', 'q', 'e'] as const)[ratingLevel]
    return { tags, locked: fixed, rating, aspect: scene.aspect, sources, ...(sceneWears ? { sceneWears } : {}) }
  }

  const seen = new Set<string>()
  const fresh = (prompt: ScenePrompt) => {
    const key = prompt.tags.join('\u0000')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }
  if (options.mix === 'faithful') {
    for (const scene of base) {
      const prompt = composeOne(scene)
      if (fresh(prompt)) yield prompt
    }
    return
  }
  // With fewer scenes than prompts, skeletons come back with different swaps.
  let made = 0
  for (let i = 0; made < options.count && i < options.count * ATTEMPTS_PER_PROMPT; i++) {
    const prompt = composeOne(base[i % base.length])
    if (!fresh(prompt)) continue
    made++
    yield prompt
  }
}

// ── One unit from another scene ───────────────────────────────────────────────

/** Where a lent unit's scene is recorded in ScenePrompt.sources. */
export type LentSource = Exclude<keyof ScenePrompt['sources'], 'skeleton'>

/** Supports that `units` still lean on, among `anchors`: a noun a pose or place tag names, indoors / outdoors when tagged. */
function anchorsIn(units: SceneUnits, anchors: readonly string[]): string[] {
  const tags = [...units.skeleton, ...units.place]
  const all = new Set(unitTags(units))
  return Array.from(new Set(anchors)).filter((anchor) =>
    anchor === 'indoors' || anchor === 'outdoors' ? all.has(anchor) : tags.some((tag) => tag === anchor || tag.endsWith(` ${anchor}`))
  )
}

/** `base` with the units in `parts` taken from `donor`: a scene of its own, rated as the higher of the two. */
export function lentScene(base: Scene, donor: Scene, parts: readonly UnitName[]): Scene {
  const units: SceneUnits = { ...base.units }
  for (const part of parts) units[part] = donor.units[part].slice()
  const rating = RATING_LEVEL[donor.rating] > RATING_LEVEL[base.rating] ? donor.rating : base.rating
  return { ...base, units, rating, anchors: anchorsIn(units, [...base.anchors, ...donor.anchors]) }
}

/**
 * `base` with the units in `parts` taken from `donor` (null: the base as it is), composed as a
 * Faithful prompt of its own: the same steps as any scene (identity, imposed garments and place,
 * conflicts against the identity, dangling references), and no swaps. `source` records the donor
 * in `sources`. Null when the composer gives nothing.
 */
export function composeLent(
  pool: ScenePool,
  base: Scene,
  donor: Scene | null,
  parts: readonly UnitName[],
  source: LentSource,
  options: ComposeOptions
): ScenePrompt | null {
  const scene = donor ? lentScene(base, donor, parts) : base
  const single: ScenePool = {
    ...pool,
    scenes: [scene],
    allScenes: undefined,
    situations: [{ id: 'lent', label: [], sceneIds: [scene.postId], previews: [] }],
  }
  const first = composePackPrompts(single, { ...options, mix: 'faithful', count: 1, disabledSituations: undefined }).next()
  if (first.done) return null
  return donor ? { ...first.value, sources: { ...first.value.sources, [source]: donor.postId } } : first.value
}
