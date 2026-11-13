/**
 * Pack Mode's scenes engine as the builder uses it: the scene modules
 * (lib/pack/scene/) plus the steps every pack prompt goes through (the
 * user's prompt settings, "Always add", near-duplicate filter, suggested
 * size). Pure: the hook passes in the cleaner and the size preferences.
 *
 * The steps each composed scene goes through are listed on finishOne.
 */
import type { BooruPost } from '../booru/types'
import { SLOT_CONSTRAINTS, getTagSlotFromOverrides } from '../tag-taxonomy'
import { splitTags } from '../utils/tag-utils'
import { finalizePackPrompt } from './always-add'
import { MAX_PACK_OVERGENERATE, normalizeTagForPack, type PackPrompt } from './pack-generator'
import { NearDuplicateFilter, DEFAULT_SIMILARITY_THRESHOLD } from './prompt-similarity'
import { composePack, composePackPrompts, sceneHasIdeaTag, type ComposeOptions, type ScenePrompt } from './scene/scene-compose'
import { coherentPromptTags, dropRedundantTags, loneCompanyTags } from './prompt-coherence'
import { COUNT_TAG_RE, isCompositionPattern, type Permanence } from './scene/permanence'
import { normalizeRating, type Scene, type SceneRating, type TagKind } from './scene/scene'
import { isQualifiedVariant } from './character-identity'
import type { PackPeople, ScenePool } from './scene/scene-pool'
import { holdsCast } from './scene/cast'
import { garmentPrefix, lastQualifier } from './scene/franchise'
import type { SceneRequests } from './brief'

declare module './pack-generator' {
  interface PackPrompt {
    /**
     * Scenes engine: the rating of the scene the prompt was built on (the highest of the posts
     * it took parts from). It is what the picture is; pack-natural.ts tells the converter so.
     */
    sceneRating?: SceneRating
  }
}

/** The pack's content rating (same values as the source dialog). */
export type ScenePackRating = 'sfw' | 'questionable' | 'explicit' | 'both'

/** What the user picks in the scenes panel; persisted with the builder config. */
export interface ScenePackSettings {
  mix: 'faithful' | 'remix'
  /**
   * 'base': the base's own clothing in every prompt (offered only when the base has some).
   * 'own': with two or more characters, each wears what is pinned in their block.
   * 'character': each character wears their own outfit (ScenePackArgs.characterOutfit);
   * without outfit data the scene's clothes stay.
   */
  clothing: 'scene' | 'library' | 'base' | 'own' | 'character'
  /** For 'character': the official outfit picked per character name ('' or missing: the usual one). */
  characterOutfits?: Readonly<Record<string, string>>
  /** 'picked': the place comes from the scenes the user picked (Scene ideas); with none, as 'scene'. */
  scenery: 'scene' | 'vary' | 'plain' | 'picked'
  extras: boolean
  /**
   * Adds scenes written by the scene model to the pool (lib/pack/scene/invented.ts).
   * Off (or missing, in configs saved before it existed): nothing is downloaded.
   */
  inventedScenes?: boolean
}

export const DEFAULT_SCENE_SETTINGS: ScenePackSettings = {
  mix: 'faithful',
  clothing: 'scene',
  scenery: 'scene',
  extras: false,
  inventedScenes: false,
}

// ── Inputs ────────────────────────────────────────────────────────────────────

/** Scene ratings a pack of `rating` draws from; null (unknown) takes every one. */
export function sceneRatingsFor(rating: ScenePackRating | null): readonly SceneRating[] {
  switch (rating) {
    case 'explicit': return ['e']
    case 'questionable': return ['q']
    case 'sfw': return ['g', 's']
    case 'both': return ['q', 'e']
    default: return ['g', 's', 'q', 'e']
  }
}

/** Posts whose rating fits the pack. */
export function postsForRating(posts: BooruPost[], rating: ScenePackRating | null): BooruPost[] {
  if (rating === null) return posts
  const allowed = new Set(sceneRatingsFor(rating))
  return posts.filter((post) => allowed.has(normalizeRating(post.rating)))
}

const TYPED_FIELDS: Array<[keyof BooruPost, TagKind]> = [
  ['tag_string_character', 'character'],
  ['tag_string_copyright', 'copyright'],
  ['tag_string_artist', 'artist'],
  ['tag_string_meta', 'meta'],
]

/**
 * What the posts themselves say a tag is: a tag listed in the character,
 * copyright, artist or meta field of any post is a name or meta. Every other
 * tag is unknown (`undefined`), so the engine's pool-support filter decides.
 */
export function tagKindsFromPosts(posts: readonly BooruPost[]): Map<string, TagKind> {
  const kinds = new Map<string, TagKind>()
  for (const post of posts) {
    for (const [field, kind] of TYPED_FIELDS) {
      const value = post[field]
      if (typeof value !== 'string' || !value) continue
      for (const raw of splitTags(value)) {
        const tag = normalizeTagForPack(raw)
        if (tag && !kinds.has(tag)) kinds.set(tag, kind)
      }
    }
  }
  return kinds
}

const GELBOORU_KINDS: Record<number, TagKind> = { 0: 'general', 1: 'artist', 3: 'copyright', 4: 'character', 5: 'meta', 6: 'deprecated' }

/**
 * Tag kinds from Gelbooru's own tag list (`gelbooru_tags`, see fetchGelbooruTagCategories):
 * its category for a listed tag, 'unlisted' for one the list doesn't have. A tag
 * neither the taxonomy nor a complete list of Gelbooru knows is almost always a
 * new or very rare name, so the scene leaves it out.
 */
export function gelbooruTagKinds(categories: ReadonlyMap<string, number | null>): Map<string, TagKind> {
  const kinds = new Map<string, TagKind>()
  categories.forEach((category, tag) => kinds.set(tag, category === null ? 'unlisted' : GELBOORU_KINDS[category] ?? 'meta'))
  return kinds
}

/**
 * Tags of `posts` that need the booru's own type: no typed field of a post lists them
 * and the taxonomy has no slot for them. Sorted, so the list works as a stable key.
 */
export function untypedTags(posts: readonly BooruPost[], typed: ReadonlyMap<string, TagKind>, overrides: Record<string, string>): string[] {
  const out = new Set<string>()
  for (const post of posts) {
    for (const raw of splitTags(post.tag_string || '')) {
      const tag = normalizeTagForPack(raw)
      if (!tag) continue
      const slot = getTagSlotFromOverrides(tag, overrides)
      if (!typed.has(tag) && !slot?.slot) out.add(tag)
      // A name qualified by a work ("... (identity) (project moon)"): ask about the qualifier too.
      const qualifier = !slot?.slot ? lastQualifier(tag) : null
      if (qualifier && !typed.has(qualifier) && !getTagSlotFromOverrides(qualifier, overrides)?.slot) out.add(qualifier)
      // A garment named after something ("summer pockets school uniform"): ask about its prefix too.
      if (!slot || slot.category === 'clothing') {
        const prefix = garmentPrefix(tag, overrides)
        if (prefix && !typed.has(prefix) && !getTagSlotFromOverrides(prefix, overrides)?.slot) out.add(prefix)
      }
    }
  }
  return Array.from(out).sort()
}

/** The character's gender from the people-count tags of their identity: a boy only when nothing says girl. */
export function subjectOfTags(tags: readonly string[]): 'girl' | 'boy' {
  let girls = 0
  let boys = 0
  for (const raw of tags) {
    const match = COUNT_TAG_RE.exec(normalizeTagForPack(raw))
    if (!match) continue
    if (match[3].startsWith('girl')) girls++
    else if (match[3].startsWith('boy')) boys++
  }
  return boys > 0 && girls === 0 ? 'boy' : 'girl'
}

/**
 * The identity the scenes are transplanted onto, and the tags of the base that
 * a scene sets instead: people counts and pairing (the engine writes the
 * header from the scene), and appearance tags the permanence data marks as
 * picture state (exposure, a closed eye, wet hair). Everything else stays,
 * in order: names, permanent traits, signature accessories, typed tags.
 */
export function splitSceneIdentity(
  tags: readonly string[],
  permanence: (tag: string) => Permanence,
  overrides: Record<string, string>
): { identity: string[]; fromScene: string[] } {
  const identity: string[] = []
  const fromScene: string[] = []
  for (const tag of tags) {
    if (isCompositionPattern(tag)) {
      fromScene.push(tag)
      continue
    }
    const slot = getTagSlotFromOverrides(tag, overrides)?.slot
    if (slot?.startsWith('appearance:') && permanence(tag) === 'state') fromScene.push(tag)
    else identity.push(tag)
  }
  return { identity, fromScene }
}

// ── The Character chips ───────────────────────────────────────────────────────

/** Pinned: in every prompt, and it replaces the scene's own version. Scene: only when the scene has it. */
export type ChipState = 'pinned' | 'scene'

export interface SceneChip {
  tag: string
  state: ChipState
  /** The character's look, a tag the user typed in, or the rest of the base (card or pasted prompt). */
  origin: 'character' | 'added' | 'base'
}

export interface SceneChipsInput {
  /** The character's name, look and signature accessories. */
  candidates: readonly string[]
  /** Tags the user added by hand. */
  added: readonly string[]
  /** The rest of the base's look and clothing. */
  extras: readonly string[]
  /** Tags the user removed. */
  removed: ReadonlySet<string>
  /** The user's choices, tag by tag. */
  choices: ReadonlyMap<string, ChipState>
  permanence: (tag: string) => Permanence
  overrides: Record<string, string>
}

/**
 * The chips of the Character section and what they mean for the engine.
 * Each tag shows once; people counts never show (who is in the picture is picked
 * apart). By default the character's permanent look is pinned and its picture
 * state (exposure, a closed eye) comes from each scene; added tags are pinned;
 * the rest of the base comes from the scene. The user's choice wins; removed
 * tags leave the chips and become `never`.
 */
export function sceneChips(input: SceneChipsInput): { chips: SceneChip[]; pinned: string[]; never: string[] } {
  const fromScene = new Set(splitSceneIdentity(input.candidates, input.permanence, input.overrides).fromScene)
  const seen = new Set<string>()
  const chips: SceneChip[] = []
  const never: string[] = []
  const add = (tag: string, origin: SceneChip['origin'], fallback: ChipState) => {
    if (!tag || seen.has(tag) || isCompositionPattern(tag)) return
    seen.add(tag)
    if (input.removed.has(tag)) {
      never.push(tag)
      return
    }
    chips.push({ tag, origin, state: input.choices.get(tag) ?? fallback })
  }
  input.candidates.forEach((tag) => add(tag, 'character', fromScene.has(tag) ? 'scene' : 'pinned'))
  input.added.forEach((tag) => add(tag, 'added', 'pinned'))
  input.extras.forEach((tag) => add(tag, 'base', 'scene'))
  return { chips, pinned: chips.filter((chip) => chip.state === 'pinned').map((chip) => chip.tag), never }
}

/** One character of a cast, as castChips reads them. */
export interface CastChipsMember {
  character: string
  /** Their name and look (for a cast member, from their own solo posts only). */
  candidates: readonly string[]
}

export interface CastChipsBlock {
  character: string
  chips: SceneChip[]
  /** The tags this block puts in every prompt, in order (the first block ends with the base's typed tags). */
  pinned: string[]
  /** Chips this character lost (they never appear in their block). */
  removed: string[]
}

/**
 * Every character's chips, each block on its own: a character's choices, additions
 * and removals never reach another's (`choices`, `added` and `removed` are per
 * character; the first character's removals are the base's). `pinned` is the blocks'
 * pinned tags in cast order (with the base's typed tags after the first block);
 * `never` is what was removed and no block still has.
 */
export function castChips(input: {
  members: readonly CastChipsMember[]
  choices: (character: string) => ReadonlyMap<string, ChipState>
  added: (character: string) => readonly string[]
  removed: (character: string, index: number) => ReadonlySet<string>
  baseExtras: readonly string[]
  baseFixed: readonly string[]
  permanence: (tag: string) => Permanence
  overrides: Record<string, string>
}): { blocks: CastChipsBlock[]; pinned: string[]; never: string[] } {
  const blocks: CastChipsBlock[] = []
  const pinned: string[] = []
  const removedAll: string[] = []
  input.members.forEach((member, index) => {
    const removed = input.removed(member.character, index)
    const result = sceneChips({
      candidates: member.candidates,
      added: input.added(member.character),
      // The rest of a card or pasted prompt belongs to the base character.
      extras: index === 0 ? input.baseExtras : [],
      removed,
      choices: input.choices(member.character),
      permanence: input.permanence,
      overrides: input.overrides,
    })
    const own = [...result.pinned, ...(index === 0 ? input.baseFixed.filter((tag) => !removed.has(tag)) : [])]
    blocks.push({ character: member.character, chips: result.chips, removed: result.never, pinned: own })
    pinned.push(...own)
    removedAll.push(...result.never)
  })
  // A tag one character lost still belongs to another who keeps it: it isn't banned from the prompt.
  const kept = new Set(blocks.flatMap((block) => block.chips.map((chip) => chip.tag)))
  return { blocks, pinned, never: Array.from(new Set(removedAll.filter((tag) => !kept.has(tag)))) }
}

/**
 * The tags every prompt keeps when each character wears their own outfit: each block's
 * pinned tags followed by that character's outfit, minus what the block already has
 * (or a qualified form of it) and what is never wanted. A character without an outfit
 * keeps just their pinned tags.
 */
export function identityWithOutfits(
  blocks: ReadonlyArray<{ pinned: readonly string[]; outfit: readonly string[] }>,
  never: readonly string[]
): string[] {
  const unwanted = never.map(normalizeTagForPack).filter(Boolean)
  return blocks.flatMap((block) => {
    const own = block.pinned.map(normalizeTagForPack)
    const outfit = block.outfit.filter((raw) => {
      const tag = normalizeTagForPack(raw)
      if (!tag || unwanted.some((base) => isQualifiedVariant(tag, base))) return false
      return !own.some((have) => have === tag || isQualifiedVariant(have, tag))
    })
    return [...block.pinned, ...Array.from(new Set(outfit))]
  })
}

/** Same composition. */
export const samePeople = (a: PackPeople | null | undefined, b: PackPeople | null | undefined): boolean =>
  !!a && !!b && a.girls === b.girls && a.boys === b.boys

/** What the base says about who is in the picture. */
export interface BaseComposition {
  /** The people the base's count tags declare ("1girl, solo" is one girl), or null when they don't. */
  declared: PackPeople | null
  /** The base is a character chosen by name (no card): one person of their gender is the natural default. */
  character: boolean
}

/**
 * The composition a pack uses, first one the pool has:
 *  1. the user's pick;
 *  2. what the base's count tags declare;
 *  3. for a character base, that character alone;
 *  4. the most common one with someone of the character's gender;
 *  5. the most common one.
 */
export function defaultComposition(
  compositions: ReadonlyArray<{ people: PackPeople }>,
  subject: 'girl' | 'boy',
  picked?: PackPeople | null,
  base?: BaseComposition
): PackPeople | null {
  const has = (people: PackPeople | null | undefined): people is PackPeople =>
    !!people && compositions.some((c) => samePeople(c.people, people))
  if (has(picked)) return picked
  if (has(base?.declared)) return base!.declared
  if (base?.character) {
    const alone: PackPeople = subject === 'girl' ? { girls: 1, boys: 0 } : { girls: 0, boys: 1 }
    if (has(alone)) return alone
  }
  const fits = compositions.find((c) => (subject === 'girl' ? c.people.girls : c.people.boys) > 0)
  return fits?.people ?? compositions[0]?.people ?? null
}

/**
 * The composition a cast's pack uses: the user's pick while the pool has it and it
 * holds the cast, else the one that matches the cast exactly, else the most common
 * one with room for everyone. Null when no composition of the pool holds the cast.
 */
export function castComposition(
  compositions: ReadonlyArray<{ people: PackPeople }>,
  cast: PackPeople,
  picked?: PackPeople | null
): PackPeople | null {
  const fits = compositions.filter((c) => holdsCast(c.people, cast))
  if (picked && fits.some((c) => samePeople(c.people, picked))) return picked
  return fits.find((c) => samePeople(c.people, cast))?.people ?? fits[0]?.people ?? null
}

/** Scenes the enabled situations hold. */
export function enabledSceneCount(pool: ScenePool, disabled: readonly string[]): number {
  const off = new Set(disabled)
  return pool.situations.reduce((sum, situation) => sum + (off.has(situation.id) ? 0 : situation.sceneIds.length), 0)
}

// ── What the character owns ─────────────────────────────────────────────────

/** Garment slots that hold one piece at a time (taxonomy SLOT_CONSTRAINTS); accessories are left out. */
const BODY_SLOTS = new Set(['clothing:outfit', 'clothing:top', 'clothing:bottom', 'clothing:underwear', 'clothing:legwear', 'clothing:footwear'])

/** Body slots a garment takes up: its own, and those the taxonomy says it can't share a prompt with. */
function slotsTakenBy(tag: string, overrides: Record<string, string>): string[] {
  const slot = getTagSlotFromOverrides(tag, overrides)?.slot
  if (!slot || !BODY_SLOTS.has(slot)) return []
  const constraint = SLOT_CONSTRAINTS[slot]
  return constraint && constraint.maxCount === 1 ? [slot, ...(constraint.incompatibleWith ?? [])] : []
}

/**
 * `tags` without what the character's own tags rule out. `fixed` are the tags
 * every prompt keeps (they stay whatever they say); then, among the rest:
 *  - another variant of something the character has ("white hairband" when the
 *    character wears a "hairband");
 *  - another garment for a body slot a fixed garment takes ("shirt" when the
 *    character wears a "dress"); accessories only by the variant rule;
 *  - anything in `never`, and its variants ("gold jewelry" when "jewelry" is never wanted).
 */
export function applySceneOwnership(
  tags: readonly string[],
  fixed: readonly string[],
  never: readonly string[],
  overrides: Record<string, string>,
  /**
   * Whether a fixed garment takes its body slot. Off for a cast of two or more: the
   * scene's shirt may be the other character's, so only variants of the same thing go.
   */
  bodySlots = true
): string[] {
  const kept = new Set(fixed)
  const owned = fixed.map(normalizeTagForPack)
  const takenSlots = new Set(bodySlots ? fixed.flatMap((tag) => slotsTakenBy(normalizeTagForPack(tag), overrides)) : [])
  const unwanted = never.map(normalizeTagForPack).filter(Boolean)
  return tags.filter((raw) => {
    if (kept.has(raw)) return true
    const tag = normalizeTagForPack(raw)
    if (unwanted.some((base) => isQualifiedVariant(tag, base))) return false
    if (owned.some((base) => isQualifiedVariant(tag, base))) return false
    const slot = getTagSlotFromOverrides(tag, overrides)?.slot
    return !(slot && takenSlots.has(slot))
  })
}

/** The redundancy rule of the shared last pass (lib/pack/prompt-coherence.ts), kept under its old name. */
export const dropRedundantSceneTags = (tags: readonly string[], fixed: readonly string[]): string[] => dropRedundantTags(tags, fixed)

const OPEN_GIRLS = /^(multiple girls|\d+\+girls)$/
const OPEN_BOYS = /^(multiple boys|\d+\+boys)$/

/**
 * False when a people-count or pairing tag says something the composition
 * contradicts: "solo" with two people, "1boy" with no boy, "hetero" without a
 * girl and a boy. Tags it can't judge ("male focus", "couple") fit.
 */
export function fitsComposition(raw: string, people: PackPeople): boolean {
  const tag = normalizeTagForPack(raw)
  const total = people.girls + people.boys
  const count = COUNT_TAG_RE.exec(tag)
  if (count && !count[2]) {
    if (count[3].startsWith('girl')) return Number(count[1]) === people.girls
    if (count[3].startsWith('boy')) return Number(count[1]) === people.boys
    return true
  }
  if (OPEN_GIRLS.test(tag)) return people.girls >= 2
  if (OPEN_BOYS.test(tag)) return people.boys >= 2
  switch (tag) {
    case 'solo': return total === 1
    case 'solo focus': return total >= 2
    case 'hetero': return people.girls >= 1 && people.boys >= 1
    case 'yuri': return people.girls >= 2
    case 'yaoi': return people.boys >= 2
    default: return true
  }
}

/** The "Always add" tags the composition contradicts: they're left out of the pack. */
export function alwaysAddOmitted(alwaysAdd: readonly string[], people: PackPeople | null): string[] {
  return people ? alwaysAdd.filter((tag) => isCompositionPattern(tag) && !fitsComposition(tag, people)) : []
}

/**
 * The "Always add" tags a prompt gets: all of them, as typed, except a people count
 * or pairing tag that contradicts who is in the picture (`people`, the pack's
 * composition). Without a composition, a count tag stays only when the prompt's own
 * header has it.
 */
export function alwaysAddFor(alwaysAdd: readonly string[], header: readonly string[], people?: PackPeople | null): string[] {
  if (people) return alwaysAdd.filter((tag) => !isCompositionPattern(tag) || fitsComposition(tag, people))
  const present = new Set(header.map(normalizeTagForPack))
  return alwaysAdd.filter((tag) => !isCompositionPattern(tag) || present.has(normalizeTagForPack(tag)))
}

// ── Generation ────────────────────────────────────────────────────────────────

export interface LibraryOutfit {
  outfitId: number
  tags: string[]
}

export interface ScenePackArgs {
  /**
   * The character as the user fixed it, without people counts: name, look,
   * accessories, pinned and added traits. These tags own their kind of thing in
   * every scene (applySceneOwnership).
   */
  identity: string[]
  /** "Always add" tags, as typed: first in every prompt, never interpreted. */
  alwaysAdd: readonly string[]
  /** Who is in the picture: decides which people-count tags of "Always add" fit. */
  people?: PackPeople | null
  /** Tags that must not appear, nor their variants (removed chips, "Never include"). */
  never?: readonly string[]
  /** The base's clothing, for `settings.clothing === 'base'`. */
  baseClothing?: readonly string[]
  /**
   * For `settings.clothing === 'character'`: the outfit tags the characters wear, already
   * placed in `identity` (identityWithOutfits). Empty or missing: no outfit data, so the
   * scene's clothes stay.
   */
  characterOutfit?: readonly string[]
  /**
   * The picked scenes (Scene ideas): their own tags still in use, and their dashed tags.
   * Their pinned tags are already in `identity`.
   */
  sceneIdea?: { core: readonly string[]; dashed: readonly string[] }
  /** Characters the pack names (1 by default). With two or more, pinned garments don't take body slots. */
  castSize?: number
  subject: 'girl' | 'boy'
  settings: ScenePackSettings
  count: number
  seed: number
  disabledSituations?: readonly string[]
  overrides: Record<string, string>
  /** Library outfits, for `settings.clothing === 'library'`. */
  library?: readonly LibraryOutfit[]
  /** The user's prompt settings: tags in, prompt out ('' drops the prompt). Must keep `locked` as it is. */
  clean: (tags: string[], locked: string[]) => string
  /** Suggested size for a post's proportions (width / height), or null. */
  resolution?: (aspect: number) => { width: number; height: number } | null
  /**
   * What the user asked for, by role (lib/pack/brief.ts). Each request is a condition every
   * prompt meets, not a tag pasted on top: what contradicts it leaves the prompt. Without it,
   * the engine runs as before (`alwaysAdd`, traits in `identity`, the clothing and scenery options).
   *  - `wearing`: in every prompt; the scene's clothes and what the character usually wears (in
   *    `identity`) go, unless the scene's clothes already are it ("white bikini" for "bikini").
   *    What the character is stays: names, look, signature accessories (`permanence`).
   *  - `where`: replaces the scene's place.
   *  - `select`, `also`: owned like a pinned trait; a posture, an expression or a camera tag
   *    takes the place of the scene's.
   *  - `literal`: first, as typed (like `alwaysAdd`).
   */
  requests?: SceneRequests
  /** Who the identity's tags are (lib/pack/scene/permanence.ts): decides what `requests.wearing` leaves of the character. */
  permanence?: (tag: string) => Permanence
}

/** A request's role in the brief (keys of SceneRequests). */
export type RequestRole = keyof SceneRequests

/**
 * What the engine could not do as asked, for the interface to say in words. One entry per
 * request and kind, with how many prompts of the pack it touches. Planned next: 'few-scenes'
 * (the pool has few scenes with a selected pose) and 'scenes-reused'.
 */
export type ScenePackIssue =
  /** The request needs more than one person and the pack shows one: it stays in, contradicted. */
  | { kind: 'needs-company'; tag: string; role: RequestRole; prompts: number }
  /** The request was left out of the pack, and why. */
  | { kind: 'request-dropped'; tag: string; role: RequestRole; reason: RequestDropReason }

export type RequestDropReason =
  /** The same tag is in "Never include" (or a removed chip). */
  | 'never'
  /** A people-count or pairing tag the pack's composition contradicts ("2girls" in a pack of one). */
  | 'composition'

export interface ScenePackResult {
  prompts: PackPrompt[]
  /** How many prompts are missing (Faithful makes at most one prompt per scene). */
  shortBy: number
  issues: ScenePackIssue[]
}

const isCast = (args: ScenePackArgs) => (args.castSize ?? 1) >= 2
/** The base's clothing is used: the option is on, there is some, the pack has one character, and no garment was asked for. */
const wearsBaseClothing = (args: ScenePackArgs) =>
  !isCast(args) && args.settings.clothing === 'base' && (args.baseClothing?.length ?? 0) > 0 && requestPlan(args).wearing.length === 0
/** Every character wears their own outfit (it is in the identity), and nothing of the scene's. */
const wearsCharacterOutfit = (args: ScenePackArgs) => args.settings.clothing === 'character' && (args.characterOutfit?.length ?? 0) > 0
/** Every character wears what is pinned in their block, and nothing of the scene's. */
const wearsOwnOutfits = (args: ScenePackArgs) =>
  requestPlan(args).wearing.length === 0 && ((isCast(args) && args.settings.clothing === 'own') || wearsCharacterOutfit(args))

// ── Requests ──────────────────────────────────────────────────────────────────

/** Slots that hold one thing at a time and that a requested tag takes from the scene: a posture, an expression, a camera. */
const DISPLACING_SLOTS = new Set(['pose:posture', 'pose:expression', 'pose:camera'])
/** Slots whose items the permanence data may mark as the character's own (signature) when `permanence` is missing. */
const SIGNATURE_SLOTS = new Set(['clothing:headwear', 'clothing:eyewear'])

/**
 * True for a tag of the character's identity that is something they wear, not something they
 * are: a clothing tag the permanence data marks as picture state ("crop top", "suspenders",
 * "fingerless gloves", "earrings"). Signature accessories ("glasses", "hairband", "hat") and
 * every non-clothing tag (name, hair, eyes, body) are the character. Without permanence data,
 * headwear and eyewear count as signature.
 */
export function isWornByCharacter(tag: string, overrides: Record<string, string>, permanence?: (tag: string) => Permanence): boolean {
  const info = getTagSlotFromOverrides(normalizeTagForPack(tag), overrides)
  if (info?.category !== 'clothing') return false
  if (permanence) return permanence(tag) === 'state'
  return !(info.slot && SIGNATURE_SLOTS.has(info.slot))
}

interface RequestPlan {
  /** The identity the scenes are composed onto: the character (less what they wear, when a garment is asked for) and every imposed request. */
  identity: string[]
  /** Imposed requests (every role but `literal`), as the engine spells them. */
  imposed: string[]
  wearing: string[]
  where: string[]
  /** `select` and `also`: owned like pinned traits; they take the place of the scene's posture, expression or camera. */
  owning: string[]
  /** What the character usually wears, set aside for the garments asked for: it doesn't come back through the scene either. */
  setAside: string[]
  literal: string[]
  roleOf: Map<string, RequestRole>
  /** Requests left out before composing, and why. */
  dropped: ScenePackIssue[]
}

const NO_REQUESTS: RequestPlan = { identity: [], imposed: [], wearing: [], where: [], owning: [], setAside: [], literal: [], roleOf: new Map(), dropped: [] }
const plans = new WeakMap<ScenePackArgs, RequestPlan>()

/** What `args.requests` means for this pack, worked out once per args. */
function requestPlan(args: ScenePackArgs): RequestPlan {
  const requests = args.requests
  if (!requests) return { ...NO_REQUESTS, identity: args.identity }
  const cached = plans.get(args)
  if (cached) return cached
  const never = (args.never ?? []).map(normalizeTagForPack).filter(Boolean)
  const roleOf = new Map<string, RequestRole>()
  const dropped: ScenePackIssue[] = []
  const take = (role: Exclude<RequestRole, 'literal'>): string[] =>
    requests[role].flatMap((raw) => {
      const tag = normalizeTagForPack(raw)
      if (!tag || roleOf.has(tag)) return []
      roleOf.set(tag, role)
      if (never.some((base) => isQualifiedVariant(tag, base))) {
        dropped.push({ kind: 'request-dropped', tag, role, reason: 'never' })
        return []
      }
      if (args.people && isCompositionPattern(tag) && !fitsComposition(tag, args.people)) {
        dropped.push({ kind: 'request-dropped', tag, role, reason: 'composition' })
        return []
      }
      return [tag]
    })
  const wearing = take('wearing')
  const where = take('where')
  const owning = [...take('select'), ...take('also')]
  const imposed = [...wearing, ...where, ...owning]
  const literal = requests.literal.filter((tag) => tag.trim())
  literal.forEach((tag) => roleOf.set(normalizeTagForPack(tag), roleOf.get(normalizeTagForPack(tag)) ?? 'literal'))
  alwaysAddOmitted(literal, args.people ?? null).forEach((tag) =>
    dropped.push({ kind: 'request-dropped', tag, role: 'literal', reason: 'composition' })
  )
  // What the character wears gives way to the garment asked for; what they are stays.
  const setAside = wearing.length > 0 ? args.identity.filter((tag) => isWornByCharacter(tag, args.overrides, args.permanence)) : []
  const character = args.identity.filter((tag) => !setAside.includes(tag))
  const have = new Set(character.map(normalizeTagForPack))
  const plan: RequestPlan = {
    identity: [...character, ...imposed.filter((tag) => !have.has(tag))],
    imposed,
    wearing,
    where,
    owning,
    setAside: setAside.map(normalizeTagForPack),
    literal,
    roleOf,
    dropped,
  }
  plans.set(args, plan)
  return plan
}

/**
 * `tags` without the scene's tags of a slot a request takes: a requested posture, expression or
 * camera tag stands for the scene's ("sitting" sends "standing" out). A longer form of the request
 * ("sitting on chair" for "sitting") stays, and so do `locked` tags.
 */
export function displaceRequestedSlots(
  tags: readonly string[],
  requested: readonly string[],
  locked: readonly string[],
  overrides: Record<string, string>
): string[] {
  const taken = new Map<string, string[]>()
  for (const tag of requested) {
    const slot = getTagSlotFromOverrides(tag, overrides)?.slot
    if (slot && DISPLACING_SLOTS.has(slot)) taken.set(slot, [...(taken.get(slot) ?? []), tag])
  }
  if (taken.size === 0) return [...tags]
  const kept = new Set(locked)
  return tags.filter((raw) => {
    if (kept.has(raw)) return true
    const tag = normalizeTagForPack(raw)
    const owners = taken.get(getTagSlotFromOverrides(tag, overrides)?.slot ?? '')
    return !owners || owners.some((owner) => tag === owner || tag.startsWith(`${owner} `) || isQualifiedVariant(tag, owner))
  })
}

/** The tags every prompt keeps, in order: the character blocks (and the imposed requests), then the base's clothing when it is worn. */
function fixedTags(args: ScenePackArgs): string[] {
  const identity = requestPlan(args).identity
  if (!wearsBaseClothing(args)) return identity
  const own = new Set(identity)
  return [...identity, ...args.baseClothing!.filter((tag) => !own.has(tag))]
}

function composeOptions(args: ScenePackArgs, count: number, seed: number, disabled: readonly string[] | undefined): ComposeOptions {
  const { settings } = args
  const plan = requestPlan(args)
  const library = !isCast(args) && settings.clothing === 'library' && args.library && args.library.length > 0 && plan.wearing.length === 0
  return {
    identity: fixedTags(args),
    subject: args.subject,
    mix: settings.mix,
    clothing: wearsBaseClothing(args) || wearsOwnOutfits(args) ? 'own' : library ? { library: args.library!.map((o) => o.tags) } : 'scene',
    // "Pick a scene" with no scene picked keeps each scene's place, like the default.
    scenery: settings.scenery === 'picked' ? 'scene' : settings.scenery,
    extras: settings.extras,
    count,
    seed,
    disabledSituations: disabled ? [...disabled] : undefined,
    overrides: args.overrides,
    sceneIdeaTags: args.sceneIdea?.core.length ? args.sceneIdea.core : undefined,
    ...(plan.wearing.length > 0 ? { wearing: plan.wearing } : {}),
    ...(plan.where.length > 0 ? { where: plan.where } : {}),
  }
}

/**
 * Posts that already have one of the picked scenes' own tags are used first, when the
 * pool has at least this many of them; the rest follow, lending only the person.
 */
export const MIN_IDEA_DONORS = 3

/**
 * The pool split for the picked scenes: the matching posts first, then the others; null when
 * there's no split. Among the matching ones, real posts come before invented scenes (which are
 * written with the picked scene's tags, so they all match).
 */
export function sceneIdeaPhases(pool: ScenePool, core: readonly string[] | undefined): ScenePool[] | null {
  if (!core || core.length === 0) return null
  const matchingScenes = pool.scenes.filter((scene) => sceneHasIdeaTag(scene, core))
  if (matchingScenes.length < MIN_IDEA_DONORS) return null
  const matching = new Set(matchingScenes.map((scene) => scene.postId))
  const realMatching = new Set(matchingScenes.filter((scene) => !scene.invented).map((scene) => scene.postId))
  const inventedMatching = new Set(matchingScenes.filter((scene) => scene.invented).map((scene) => scene.postId))
  const others = new Set(pool.scenes.map((scene) => scene.postId).filter((id) => !matching.has(id)))
  const phases = realMatching.size > 0 && inventedMatching.size > 0 ? [realMatching, inventedMatching, others] : [matching, others]
  return phases.map((ids) => restrictPool(pool, ids))
}

/** A dashed clothing tag of a picked scene is the scene's clothes: only "From the scene" keeps it. */
function ideaClothesLeftOut(args: ScenePackArgs): Set<string> {
  const dashed = args.sceneIdea?.dashed ?? []
  if (dashed.length === 0 || composeOptions(args, 0, 0, undefined).clothing === 'scene') return new Set()
  return new Set(dashed.filter((tag) => getTagSlotFromOverrides(tag, args.overrides)?.category === 'clothing'))
}

/** The library outfit a composed prompt wears: the one most of whose tags it has (at least half). */
function outfitOf(prompt: ScenePrompt, library: readonly LibraryOutfit[] | undefined): number | undefined {
  if (!library || library.length === 0) return undefined
  const tags = new Set(prompt.tags.map(normalizeTagForPack))
  let best: number | undefined
  let bestShare = 0.5
  for (const outfit of library) {
    if (outfit.tags.length === 0) continue
    const share = outfit.tags.filter((tag) => tags.has(normalizeTagForPack(tag))).length / outfit.tags.length
    if (share > bestShare) {
      best = outfit.outfitId
      bestShare = share
    }
  }
  return best
}

/** Shared state while turning composed scenes into pack prompts. */
interface Finisher {
  pool: ScenePool
  args: ScenePackArgs
  /** Dashed clothing tags of the picked scenes that the clothing option leaves out. */
  leftOut: ReadonlySet<string>
  seen: Set<string>
  filter: NearDuplicateFilter
  sceneById: Map<number, Scene>
  situationOf: Map<number, string>
  /** Requests that need company, kept in a one-person prompt: prompts each was in. */
  lonely: Map<string, number>
}

function finisher(pool: ScenePool, args: ScenePackArgs, seen: Set<string>, filter: NearDuplicateFilter): Finisher {
  const situationOf = new Map<number, string>()
  pool.situations.forEach((situation) => situation.sceneIds.forEach((id) => situationOf.set(id, situation.id)))
  return {
    pool, args, leftOut: ideaClothesLeftOut(args), seen, filter,
    sceneById: new Map(pool.scenes.map((scene) => [scene.postId, scene])), situationOf, lonely: new Map(),
  }
}

/** The issues of a finished pack: requests left out before composing, then requests that needed company. */
function packIssues(f: Finisher): ScenePackIssue[] {
  const plan = requestPlan(f.args)
  const issues = [...plan.dropped]
  f.lonely.forEach((prompts, tag) => issues.push({ kind: 'needs-company', tag, role: plan.roleOf.get(normalizeTagForPack(tag)) ?? 'literal', prompts }))
  return issues
}

/**
 * One composed scene as a finished pack prompt, or null when it's dropped:
 *  1. what the character owns and what is never wanted comes out of the scene;
 *  2. the user's prompt settings (the cleaner), with the header and identity locked;
 *  3. tags a longer tag of the prompt already says, fixed ones included ("hairband" next to "white hairband");
 *  4. references left pointing at nothing (a garment the cleaner removed);
 *  5. "Always add" first, as typed;
 *  6. exact and near-duplicate filter.
 */
function finishOne(f: Finisher, composed: ScenePrompt): PackPrompt | null {
  const { args } = f
  const plan = requestPlan(args)
  const locked = new Set(composed.locked)
  const tags = f.leftOut.size > 0 ? composed.tags.filter((tag) => locked.has(tag) || !f.leftOut.has(tag)) : composed.tags
  // Clothes of the scene that already are the garments asked for stay whole: the request doesn't own them.
  const wearing = new Set(composed.sceneWears ? plan.wearing : [])
  const owner = wearing.size > 0 ? composed.locked.filter((tag) => !wearing.has(tag)) : composed.locked
  const owned = new Set(applySceneOwnership(tags, owner, [...(args.never ?? []), ...plan.setAside], args.overrides, !isCast(args)))
  const ownedTags = tags.filter((tag) => locked.has(tag) || owned.has(tag))
  const displaced = displaceRequestedSlots(ownedTags, plan.owning, composed.locked, args.overrides)
  const cleaned = args.clean(displaced, composed.locked)
  if (!cleaned) return null
  // One rule wherever the tags come from (character, base clothing, library, scene): a generic
  // tag next to a qualified form of the same thing gives way to it. A request never does.
  // With a cast the blocks are different people: one's "long hair" is not redundant with another's "very long hair".
  // The last pass shared with Classic: redundant generics, tags that need company in a
  // one-person prompt, then references to nothing.
  const kept = coherentPromptTags(cleaned.split(',').map((tag) => tag.trim()).filter(Boolean), {
    keep: composed.locked,
    fixed: [...(isCast(args) ? composed.locked : []), ...plan.imposed],
    overrides: args.overrides,
    people: true,
  })
  const front = Array.from(new Set([...plan.literal, ...args.alwaysAdd]))
  const prompt = finalizePackPrompt(kept.join(', '), alwaysAddFor(front, composed.locked, args.people))
  if (!prompt || f.seen.has(prompt) || !f.filter.tryAccept(prompt)) return null
  f.seen.add(prompt)
  // A request that needs company stays in a one-person prompt; the pack says so.
  if (args.requests) {
    const finalTags = prompt.split(',').map((tag) => tag.trim()).filter(Boolean)
    loneCompanyTags(finalTags).forEach((tag) => {
      if (plan.roleOf.has(normalizeTagForPack(tag))) f.lonely.set(tag, (f.lonely.get(tag) ?? 0) + 1)
    })
  }
  const postId = composed.sources.skeleton
  const size = composed.aspect && args.resolution ? args.resolution(composed.aspect) : null
  const outfitId = args.settings.clothing === 'library' ? outfitOf(composed, args.library) : undefined
  return {
    prompt,
    values: [],
    sceneRating: composed.rating,
    ...(size ?? {}),
    ...(outfitId !== undefined ? { outfitId } : {}),
    scene: {
      postId,
      preview: f.sceneById.get(postId)?.preview,
      ...(f.sceneById.get(postId)?.invented ? { invented: true } : {}),
      situation: f.situationOf.get(postId),
      donors: Array.from(new Set(Object.values(composed.sources).filter((id): id is number => id !== undefined))),
    },
  }
}

/**
 * Composed scenes for a pack of `count`, one at a time: up to a few more than asked,
 * so the duplicate filter has room. Only as many are composed as the pack takes.
 */
function* composeForPack(pool: ScenePool, args: ScenePackArgs, count: number): Generator<ScenePrompt> {
  const overGenerate = Math.min(Math.max(count * 2, count + 4), MAX_PACK_OVERGENERATE)
  // With picked scenes, the posts that have them come first (see sceneIdeaPhases).
  const phases = sceneIdeaPhases(pool, args.sceneIdea?.core) ?? [pool]
  for (let i = 0; i < phases.length; i++) {
    yield* composePackPrompts(phases[i], composeOptions(args, overGenerate, args.seed + i, args.disabledSituations))
  }
}

/**
 * A pack of `args.count` prompts from `pool`. `shortBy` is how many are missing
 * (Faithful makes at most one prompt per scene); `issues`, what was asked and not met.
 */
export function generateScenePack(pool: ScenePool, args: ScenePackArgs): ScenePackResult {
  const count = Math.max(0, Math.floor(args.count))
  if (count === 0) return { prompts: [], shortBy: 0, issues: [] }
  const f = finisher(pool, args, new Set(), new NearDuplicateFilter(DEFAULT_SIMILARITY_THRESHOLD, fixedTags(args)))
  const prompts: PackPrompt[] = []
  for (const composed of composeForPack(pool, args, count)) {
    if (prompts.length >= count) break
    const prompt = finishOne(f, composed)
    if (prompt) prompts.push(prompt)
  }
  return { prompts, shortBy: count - prompts.length, issues: packIssues(f) }
}

export interface AsyncControl {
  /** Lets the page breathe; called between prompts once a slice of work is done. */
  pause: () => Promise<void>
  /** True once a newer request replaced this one: the work stops and resolves to null. */
  cancelled: () => boolean
  /** Milliseconds of work between pauses (default 12). */
  slice?: number
}

/**
 * `generateScenePack` in slices: pauses between prompts so the page keeps
 * responding, and stops early (null) when the request is cancelled.
 */
export async function generateScenePackAsync(
  pool: ScenePool,
  args: ScenePackArgs,
  control: AsyncControl
): Promise<ScenePackResult | null> {
  const count = Math.max(0, Math.floor(args.count))
  if (count === 0) return { prompts: [], shortBy: 0, issues: [] }
  const slice = control.slice ?? 12
  await control.pause()
  if (control.cancelled()) return null
  const f = finisher(pool, args, new Set(), new NearDuplicateFilter(DEFAULT_SIMILARITY_THRESHOLD, fixedTags(args)))
  const composed = composeForPack(pool, args, count)
  const prompts: PackPrompt[] = []
  let started = Date.now()
  // Composing a scene is the costly part, so the pause comes before pulling the next one.
  while (prompts.length < count) {
    if (Date.now() - started >= slice) {
      await control.pause()
      if (control.cancelled()) return null
      started = Date.now()
    }
    const next = composed.next()
    if (next.done) break
    const prompt = finishOne(f, next.value)
    if (prompt) prompts.push(prompt)
  }
  return { prompts, shortBy: count - prompts.length, issues: packIssues(f) }
}

/** `pool` with each situation reduced to the scenes in `allowed`. */
function restrictPool(pool: ScenePool, allowed: ReadonlySet<number>): ScenePool {
  return {
    ...pool,
    situations: pool.situations.map((situation) => ({
      ...situation,
      sceneIds: situation.sceneIds.filter((id) => allowed.has(id)),
    })),
  }
}

/**
 * A new prompt for row `index`: another scene of the same situation that the
 * pack does not use yet, then an unused scene of any enabled situation. In
 * Remix, the same situation's scenes may come back with other swaps once every
 * scene is used. Null when nothing new and different enough is left.
 */
export function rerollScenePrompt(pool: ScenePool, prompts: readonly PackPrompt[], index: number, args: ScenePackArgs): PackPrompt | null {
  const current = prompts[index]
  if (!current) return null
  const disabled = new Set(args.disabledSituations ?? [])
  const enabled = pool.situations.filter((situation) => !disabled.has(situation.id))
  const used = new Set(prompts.flatMap((p) => (p.scene ? [p.scene.postId] : [])))
  const situation = enabled.find((s) => s.id === current.scene?.situation)
  const unused = (ids: number[]) => ids.filter((id) => !used.has(id))

  const attempts: Array<{ scenes: number[]; situations: string[] }> = []
  if (situation) attempts.push({ scenes: unused(situation.sceneIds), situations: [situation.id] })
  attempts.push({ scenes: enabled.flatMap((s) => unused(s.sceneIds)), situations: enabled.map((s) => s.id) })
  if (args.settings.mix === 'remix') {
    const reuse = situation ? [situation] : enabled
    attempts.push({ scenes: reuse.flatMap((s) => s.sceneIds), situations: reuse.map((s) => s.id) })
  }

  const others = prompts.filter((_, i) => i !== index).map((p) => p.prompt)
  for (const attempt of attempts) {
    if (attempt.scenes.length === 0) continue
    const view = restrictPool(pool, new Set(attempt.scenes))
    const keep = new Set(attempt.situations)
    const off = pool.situations.filter((s) => !keep.has(s.id)).map((s) => s.id)
    const { prompts: composed } = composePack(view, composeOptions(args, 6, args.seed, off))
    const filter = new NearDuplicateFilter(DEFAULT_SIMILARITY_THRESHOLD, fixedTags(args))
    others.forEach((prompt) => filter.tryAccept(prompt))
    const f = finisher(pool, args, new Set([...others, current.prompt]), filter)
    for (const item of composed) {
      const replacement = finishOne(f, item)
      if (replacement) return replacement
    }
  }
  return null
}
