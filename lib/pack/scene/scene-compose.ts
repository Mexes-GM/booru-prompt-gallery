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
import { conflictsWithBackground, isPlainBackgroundTag, isSceneTag } from '../background-coherence'
import { selectScenes } from './scene-select'
import type { ScenePool } from './scene-pool'
import { COUNT_TAG_RE, OPEN_COUNT_RE, isCompositionPattern } from './permanence'
import {
  RATING_LEVEL,
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
  sources: { skeleton: number; face?: number; camera?: number; place?: number; outfit?: number }
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
 * Tags among `tags` that refer to a garment no other tag names: a lifted skirt needs a
 * skirt in the prompt. Referring tags do not count as naming the garment.
 */
export function danglingReferences(tags: string[], overrides: Record<string, string>): Set<string> {
  const references = new Map<string, string>()
  for (const tag of tags) {
    const garment = garmentReferenced(tag, overrides)
    if (garment) references.set(tag, garment)
  }
  if (references.size === 0) return new Set()
  const naming = tags.filter((tag) => !references.has(tag) && !tag.startsWith('no '))
  const named = new Set(naming.map((tag) => stem(lastWord(tag))))
  const clothing = naming.filter((tag) => getTagSlotFromOverrides(tag, overrides)?.category === 'clothing')
  // A compound garment word names its base garment too: a miniskirt is a skirt, a sundress a dress.
  const clothingWords = clothing.map((tag) => stem(lastWord(tag)))
  const isNamed = (garment: string) => named.has(garment) || clothingWords.some((word) => word.endsWith(garment))
  const dangling = new Set<string>()
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
export function dropDanglingReferences(tags: string[], keep: readonly string[], overrides: Record<string, string>): string[] {
  const dangling = danglingReferences(tags, overrides)
  if (dangling.size === 0) return tags
  const kept = new Set(keep)
  return tags.filter((tag) => kept.has(tag) || !dangling.has(tag))
}

// ── Swaps ─────────────────────────────────────────────────────────────────────

const peopleKey = (scene: Scene): string => (scene.people ? `${scene.people.girls}g${scene.people.boys}b` : 'open')

/** True when `donor` offers a place that supports the posture of `scene` without contradicting it. */
function placeFits(scene: Scene, donor: Scene): boolean {
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
  const overrides = options.overrides ?? {}
  const rng = createSeededRng(options.seed)
  const base = selectScenes(pool, options.count, { rng, disabledSituations: options.disabledSituations })
  if (base.length === 0) return { prompts: [], shortBy: Math.max(0, options.count) }

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
    const fixed = [...header.tags, ...header.identity]

    // Clothing and scenery choices that do not depend on the mix.
    if (options.clothing === 'own') units.outfit = []
    else if (typeof options.clothing === 'object') {
      const library = options.clothing.library
      units.outfit = library.length > 0 ? library[Math.floor(rng() * library.length)].slice() : []
    }
    if (options.scenery === 'plain') units.place = [PLAIN_BACKGROUND]

    const swap = (unit: SwapUnit, force: boolean) => {
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
    if (options.scenery !== 'plain') swap('place', options.scenery === 'vary')
    if (options.clothing === 'scene') swap('outfit', false)

    // The identity wins over anything the scene says about the same thing.
    const identityTags = new Set(fixed)
    for (const unit of UNIT_ORDER) units[unit] = units[unit].filter((tag) => !identityTags.has(tag))
    const clashing = new Set(
      resolveTagConflicts(fixed, unitTags(units)).conflictingTags.map((conflict) => conflict.tag)
    )
    if (clashing.size > 0) for (const unit of UNIT_ORDER) units[unit] = units[unit].filter((tag) => !clashing.has(tag))

    // A plain background leaves no room for scenery tags that survived elsewhere.
    if (units.place.length === 1 && isPlainBackgroundTag(units.place[0])) {
      for (const unit of UNIT_ORDER) {
        if (unit !== 'place') units[unit] = units[unit].filter((tag) => !isSceneTag(tag, overrides))
      }
    }

    const dangling = danglingReferences([...fixed, ...unitTags(units)], overrides)
    if (dangling.size > 0) for (const unit of UNIT_ORDER) units[unit] = units[unit].filter((tag) => !dangling.has(tag))

    const tags = Array.from(new Set([...fixed, ...unitTags(units)]))
    const rating = (['g', 's', 'q', 'e'] as const)[ratingLevel]
    return { tags, locked: fixed, rating, aspect: scene.aspect, sources }
  }

  const prompts: ScenePrompt[] = []
  const seen = new Set<string>()
  const add = (prompt: ScenePrompt) => {
    const key = prompt.tags.join('\u0000')
    if (seen.has(key)) return
    seen.add(key)
    prompts.push(prompt)
  }
  if (options.mix === 'faithful') {
    base.forEach((scene) => add(composeOne(scene)))
  } else {
    // With fewer scenes than prompts, skeletons come back with different swaps.
    for (let i = 0; prompts.length < options.count && i < options.count * ATTEMPTS_PER_PROMPT; i++) {
      add(composeOne(base[i % base.length]))
    }
  }
  return { prompts, shortBy: Math.max(0, options.count - prompts.length) }
}
