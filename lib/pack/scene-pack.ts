/**
 * Pack Mode's scenes engine as the builder uses it: the scene modules
 * (lib/pack/scene/) plus the steps every pack prompt goes through (the
 * user's prompt settings, "Always add", near-duplicate filter, suggested
 * size). Pure: the hook passes in the cleaner and the size preferences.
 *
 * The steps each composed scene goes through are listed on finishOne.
 */
import type { BooruPost } from '../booru/types'
import { getTagSlotFromOverrides } from '../tag-taxonomy'
import { splitTags } from '../utils/tag-utils'
import { finalizePackPrompt } from './always-add'
import { MAX_PACK_OVERGENERATE, createSeededRng, normalizeTagForPack, type PackPrompt } from './pack-generator'
import { NearDuplicateFilter, DEFAULT_SIMILARITY_THRESHOLD } from './prompt-similarity'
import { HAND_SLOTS, composeLent, composePack, composePackPrompts, lentScene, outfitWears, placeFits, sceneHasIdeaTag, type ComposeOptions, type ScenePrompt } from './scene/scene-compose'
import { CLOTHING_SLOTS, ConditionQueue, garmentPieces, garmentRegion, inRegion, isLibraryDonor, layersOver, libraryDonor, metCount, regionTags, lendOutfitPart, slotsTakenBy, valueKey, type GarmentRegion } from './scene/scene-conditions'
import { AXIS_SOURCE, AXIS_UNITS, DonorQueue, axisKey, axisOfTag, axisTags, canLend, lendingClashes, showsFace, type OneAxis } from './scene/scene-axis'
import { coherentPromptTags, dropRedundantTags, isCompanyAct, loneCompanyTags } from './prompt-coherence'
import { COUNT_TAG_RE, isCompositionPattern, type Permanence } from './scene/permanence'
import { UNIT_ORDER, normalizeRating, sceneTags, unitOfSlot, type Scene, type SceneRating, type TagKind, type UnitName } from './scene/scene'
import { isQualifiedVariant } from './character-identity'
import { compositionsOf, groupSituations, type PackPeople, type ScenePool } from './scene/scene-pool'
import { holdsCast } from './scene/cast'
import { genderedTrait } from './scene/people'
import { requestSpelling } from './scene/spelling'
import { garmentPrefix, lastQualifier } from './scene/franchise'
import type { ChangesAxis, SceneRequests } from './brief'
import { excludes, loadedTagRelations, needsCompany, requiredBy, type TagRelations } from '../tag-relations'
import { resolveTagConflicts } from '../tag-conflicts'

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

/**
 * The compositions a pack mixes (ScenePackArgs.compositions): two or more different ones that can
 * hold the pack's named characters (as many people as `castSize`, the subject's gender among them).
 * Null for a pack of one composition, which runs exactly as before.
 */
export function mixedCompositions(args: Pick<ScenePackArgs, 'compositions' | 'castSize' | 'subject'>): PackPeople[] | null {
  const named = args.castSize ?? 1
  const out: PackPeople[] = []
  for (const people of args.compositions ?? []) {
    const fits = people.girls + people.boys >= named && (args.subject === 'girl' ? people.girls : people.boys) >= 1
    if (fits && !out.some((have) => samePeople(have, people))) out.push({ girls: people.girls, boys: people.boys })
  }
  return out.length >= 2 ? out : null
}

/**
 * `pool` with the scenes of every composition of a mixed pack: those of `allScenes` whose people are
 * one of them, grouped into situations again as one pool. The same pool for a pack of one composition.
 */
export function poolForCompositions(pool: ScenePool, args: Pick<ScenePackArgs, 'compositions' | 'castSize' | 'subject' | 'overrides'>): ScenePool {
  const mixed = mixedCompositions(args)
  if (!mixed) return pool
  const scenes = (pool.allScenes ?? pool.scenes).filter((scene) => mixed.some((people) => samePeople(scene.people, people)))
  const situations = groupSituations(scenes, args.overrides)
  return { ...pool, scenes, situations, stats: { ...pool.stats, scenes: scenes.length, situations: situations.length } }
}

// ── Pairing by act ────────────────────────────────────────────────────────────

/** The pairing tags that say who is with whom by gender (fitsComposition reads them). */
const GENDER_PAIRING = ['hetero', 'yuri', 'yaoi'] as const

/** The pairing of a picture of `people`: a girl and a boy, two girls or more, two boys or more. */
function pairingOfPeople(people: PackPeople): string[] {
  if (people.girls >= 1 && people.boys >= 1) return ['hetero']
  if (people.girls >= 2) return ['yuri']
  if (people.boys >= 2) return ['yaoi']
  return []
}

/**
 * `scene` with its pairing ("hetero", "yuri", "yaoi") worked out from what happens in it and who is
 * there, not copied from its post (boorus tag it on some posts of an act and not on others): an act
 * between people (isCompanyAct on the scene's tags, or a selected pose) in an adult picture (the scene is rated
 * questionable or explicit), or one the measured relations say requires a pairing, gives the pairing
 * of the scene's people (pairingOfPeople), plus any the act requires that fits them. Without such an
 * act, none. Two scenes of the same people with an act get the same one. A pairing in "Never
 * include" never comes; one the user asked for (in the identity) is the header's own and none is
 * added. The rest of the post's pairing (solo, open counts) stays.
 */
function withActPairing(scene: Scene, args: ScenePackArgs, relations: TagRelations | null, asked: boolean, never: ReadonlySet<string>, selected: readonly string[]): Scene {
  const kept = scene.pairing.filter((tag) => !(GENDER_PAIRING as readonly string[]).includes(tag))
  let added: string[] = []
  if (!asked && scene.people) {
    // The act may be anywhere in the scene (an unclassified tag the pool vouches for) or asked for.
    const acts = Array.from(new Set([...sceneTags(scene), ...selected])).filter((tag) => isCompanyAct(tag, args.overrides, relations))
    const required = relations ? acts.flatMap((act) => requiredBy(relations, act)).filter((tag) => (GENDER_PAIRING as readonly string[]).includes(tag)) : []
    const adult = scene.rating === 'q' || scene.rating === 'e'
    if (acts.length > 0 && (adult || required.length > 0)) {
      const people = scene.people
      added = Array.from(new Set([...pairingOfPeople(people), ...required])).filter((tag) => fitsComposition(tag, people) && !never.has(tag))
    }
  }
  // The pairing by gender first, as the boorus list it.
  const pairing = [...added, ...kept]
  return pairing.length === scene.pairing.length && pairing.every((tag, i) => tag === scene.pairing[i]) ? scene : { ...scene, pairing }
}

/**
 * The scenes a pack is made from: the compositions it mixes (poolForCompositions), each with its
 * pairing by act (withActPairing).
 */
function packScenes(pool: ScenePool, args: ScenePackArgs): ScenePool {
  const mixed = poolForCompositions(pool, args)
  const relations = loadedTagRelations()
  const plan = requestPlan(args)
  const asked = plan.identity.some((tag) => (GENDER_PAIRING as readonly string[]).includes(normalizeTagForPack(tag)))
  const never = new Set((args.never ?? []).map(normalizeTagForPack))
  const cache = new Map<number, Scene>()
  const paired = (scene: Scene) => {
    let out = cache.get(scene.postId)
    if (!out) cache.set(scene.postId, (out = withActPairing(scene, args, relations, asked, never, plan.select)))
    return out
  }
  return { ...mixed, scenes: mixed.scenes.map(paired), ...(mixed.allScenes ? { allScenes: mixed.allScenes.map(paired) } : {}) }
}

/** How many people a prompt made from `scene` has: its own count in a mixed pack, else the pack's (or one). */
function headcountFor(args: ScenePackArgs, scene: Scene | undefined): number {
  if (mixedCompositions(args)) return Math.max(1, scene ? headcount(scene) : 1)
  return args.people ? args.people.girls + args.people.boys : 1
}

/** The composition a prompt made from `scene` is held to: its own in a mixed pack, else the pack's. */
function peopleFor(args: ScenePackArgs, scene: Scene | undefined): PackPeople | null {
  if (mixedCompositions(args)) return scene?.people ?? null
  return args.people ?? null
}

/** True when a people-count or pairing tag fits the pack: every composition of a mixed one, else the pack's. */
function fitsPack(tag: string, args: ScenePackArgs): boolean {
  const mixed = mixedCompositions(args)
  if (mixed) return mixed.every((people) => fitsComposition(tag, people))
  return !args.people || fitsComposition(tag, args.people)
}

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
 *  2. with a selected pose (`poses`, from poseCompositions, when it isn't empty): the most common
 *     composition among the scenes that have it;
 *  3. what the base's count tags declare;
 *  4. for a character base, that character alone;
 *  5. the most common one with someone of the character's gender;
 *  6. the most common one.
 */
export function defaultComposition(
  compositions: ReadonlyArray<{ people: PackPeople }>,
  subject: 'girl' | 'boy',
  picked?: PackPeople | null,
  base?: BaseComposition,
  poses?: readonly PoseComposition[]
): PackPeople | null {
  const has = (people: PackPeople | null | undefined): people is PackPeople =>
    !!people && compositions.some((c) => samePeople(c.people, people))
  if (has(picked)) return picked
  if (poses && poses.length > 0) return poses[0].people
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
 * With a selected pose (`poses`, from poseCompositions), the compositions whose scenes have it
 * come first; when none holds the cast, the pool's own.
 */
export function castComposition(
  compositions: ReadonlyArray<{ people: PackPeople }>,
  cast: PackPeople,
  picked?: PackPeople | null,
  poses?: readonly PoseComposition[]
): PackPeople | null {
  const fits = compositions.filter((c) => holdsCast(c.people, cast))
  if (picked && fits.some((c) => samePeople(c.people, picked))) return picked
  const posed = (poses ?? []).filter((c) => holdsCast(c.people, cast))
  if (posed.length > 0) return posed.find((c) => samePeople(c.people, cast))?.people ?? posed[0].people
  return fits.find((c) => samePeople(c.people, cast))?.people ?? fits[0]?.people ?? null
}

/** Scenes the enabled situations hold. */
export function enabledSceneCount(pool: ScenePool, disabled: readonly string[]): number {
  const off = new Set(disabled)
  return pool.situations.reduce((sum, situation) => sum + (off.has(situation.id) ? 0 : situation.sceneIds.length), 0)
}

// ── Selected poses ────────────────────────────────────────────────────────────

/** A composition the selected poses offer, with how many of its scenes have them. */
export interface PoseComposition {
  people: PackPeople
  scenes: number
}

/** The poses of `requests.select` and how they pick scenes. */
interface PoseSelection {
  /** As the engine spells them, without those in "Never include". */
  tags: string[]
  /** Poses only a scene that has them can give (poseNeedsScene); the others can be imposed. */
  needed: ReadonlySet<string>
  /** Acts that need company (isCompanyAct): a scene of fewer than two people doesn't have them, whatever its tags say. */
  company: ReadonlySet<string>
}

type PoseArgs = Pick<ScenePackArgs, 'requests' | 'never' | 'overrides'>
const selections = new WeakMap<PoseArgs, PoseSelection | null>()

/** The selected poses of `args`, or null when there are none (worked out once per args). */
function poseSelection(args: PoseArgs): PoseSelection | null {
  const cached = selections.get(args)
  if (cached !== undefined) return cached
  // In the scenes' spelling (spelling.ts), whoever calls: the engine's own args already are.
  const permanence = (args as Pick<ScenePackArgs, 'permanence'>).permanence
  const spell = (tag: string) => requestSpelling(tag, args.overrides, permanence)
  const never = (args.never ?? []).flatMap((tag) => [normalizeTagForPack(tag), spell(tag)]).filter(Boolean)
  const tags = Array.from(new Set((args.requests?.select ?? []).map(spell)))
    .filter((tag) => tag && !never.some((base) => isQualifiedVariant(tag, base)))
  let selection: PoseSelection | null = null
  if (tags.length > 0) {
    const relations = loadedTagRelations()
    selection = {
      tags,
      needed: new Set(tags.filter((tag) => poseNeedsScene(tag, args.overrides, relations))),
      company: new Set(tags.filter((tag) => isCompanyAct(tag, args.overrides, relations))),
    }
  }
  selections.set(args, selection)
  return selection
}

/**
 * True for a pose only a scene that already has it can give: an interaction between people (its
 * slot) or a tag the measured relations say needs company ("princess carry", "hug"). Imposed on
 * another scene it contradicts it. A plain posture ("sitting") can be imposed.
 */
export function poseNeedsScene(tag: string, overrides: Record<string, string>, relations: TagRelations | null = loadedTagRelations()): boolean {
  // In the scenes' spelling: "doggy style" is read as "doggystyle".
  const key = requestSpelling(tag, overrides)
  if (getTagSlotFromOverrides(key, overrides)?.slot === 'pose:interaction') return true
  return !!relations && needsCompany(relations, key)
}

const headcount = (scene: Scene): number => (scene.people ? scene.people.girls + scene.people.boys : 0)

/**
 * The selected poses `scene` has, itself or a qualified form ("reverse princess carry" for
 * "princess carry"). An act that needs company counts only in a scene of two people or more: in
 * a scene of one ("carrying" a creature in someone's arms), it is not that pose.
 */
function posesOf(scene: Scene, selection: PoseSelection): string[] {
  const tags = sceneTags(scene)
  return selection.tags.filter(
    (pose) => !(selection.company.has(pose) && headcount(scene) < 2) && tags.some((tag) => isQualifiedVariant(tag, pose))
  )
}

/** 'all': the scene has every selected pose; 'imposable': the ones it lacks can be imposed; 'none': it can't serve. */
function poseFit(scene: Scene, selection: PoseSelection): 'all' | 'imposable' | 'none' {
  const has = new Set(posesOf(scene, selection))
  const missing = selection.tags.filter((pose) => !has.has(pose))
  if (missing.length === 0) return 'all'
  return missing.some((pose) => selection.needed.has(pose)) ? 'none' : 'imposable'
}

/**
 * The compositions the selected poses offer, most scenes first, counted over every scene of the
 * pool (`pool.allScenes`: the pool built without a composition lists them all) less the removed
 * ones: those with every selected pose; when none has them all, those with every pose that can't
 * be imposed. An act that needs company leaves out the scenes of one person. Empty without a
 * selected pose, or when no scene has it: the composition is then chosen as before. Pass it to
 * defaultComposition / castComposition; the interface lists it ("With 1 boy · 41").
 */
export function poseCompositions(pool: ScenePool, args: PoseArgs & Pick<ScenePackArgs, 'removedScenes'>): PoseComposition[] {
  const selection = poseSelection(args)
  if (!selection) return []
  const removed = new Set(args.removedScenes ?? [])
  const scenes = (pool.allScenes ?? pool.scenes).filter((scene) => !removed.has(scene.postId))
  const fits = scenes.map((scene) => poseFit(scene, selection))
  const full = scenes.filter((_, i) => fits[i] === 'all')
  const counted = full.length > 0 || selection.needed.size === 0 ? full : scenes.filter((_, i) => fits[i] === 'imposable')
  return compositionsOf(counted)
}

// ── What the character owns ─────────────────────────────────────────────────

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
  /** The outfit's style (lib/outfit-swap.ts OutfitStyle): what `requests.outfitStyles` matches. */
  style?: string
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
   *  - `select`: picks the scenes. Prompts come from scenes that already have the pose (or a
   *    qualified form of it; with several, those that have them all first). With too few: those
   *    scenes again with other parts (as Remix does), then, for a plain posture only, the pose
   *    imposed on other scenes; never on a scene without it for an interaction or an act that
   *    needs company. Each step taken is in `issues`. In the prompt, owned like `also`.
   *  - `also`: owned like a pinned trait; a posture, an expression or a camera tag
   *    takes the place of the scene's.
   *  - `literal`: first, as typed (like `alwaysAdd`).
   *  - `others`: how the people besides the named characters look. In every prompt whose picture
   *    has more people than named characters, right after the characters' identity; never part of
   *    what the characters own. Left out of a prompt with no one else (see withOthers).
   */
  requests?: SceneRequests
  /** Who the identity's tags are (lib/pack/scene/permanence.ts): decides what `requests.wearing` leaves of the character. */
  permanence?: (tag: string) => Permanence
  /**
   * Posts whose scenes are used first (post ids): the character's own posts with the requested
   * pose, among the posts of anyone found by theme. Ids the pool doesn't have do nothing.
   */
  preferredPosts?: readonly number[]
  /** Scenes the user took out (post ids): never the scene of a prompt, nor a donor of its parts. */
  removedScenes?: readonly number[]
  /**
   * What changes from prompt to prompt. Missing or 'scene': each prompt is another scene, as
   * always. Another axis: every prompt is one base scene (`baseScene`) with only that part taken
   * from another scene, the donor: 'outfit' its clothes and what they show of the body, 'pose' its
   * pose, 'place' its place, 'expression' its face. The first prompt is the base as it is; no two
   * prompts share the same value of the axis; a donor that contradicts what stays is skipped, so
   * the pack may come out short (`few-variations`). The mix doesn't apply; "Only the outfit"
   * takes the clothes from the scenes whatever the Clothing option says, and "Only the place" the
   * place whatever the Scenery option says. Requests still hold: one on the axis stays in every
   * prompt and the donors vary the rest of it (`axis-requested`).
   */
  changes?: ChangesAxis
  /**
   * With `changes` on one axis: the post id of the base scene. Missing, not in the pool, removed,
   * or without a selected pose it can't take: the first scene the pack would use otherwise.
   */
  baseScene?: number
  /**
   * Posts of the pool that only lend a part to meet a condition (`requests.conditions`): the posts of
   * the condition searches (SourcePlan.donors) that no scene search brought. Never the scene of a
   * prompt; ignored without conditions (they are then left out of the pack).
   */
  donorPosts?: readonly number[]
  /**
   * Outfits of the library a condition may take a variant from (the outfit library of the pack's
   * rating, with each outfit's style), whatever the Clothing option. Without it, `library` stands in.
   */
  outfitLibrary?: readonly LibraryOutfit[]
  /**
   * Other names of the conditions, by condition (brief spelling): the aliases of the tag in the tag
   * database (auto_suggest_tags.aliases: "qipao", "cheongsam" for "china dress"). A post that carries
   * one of them meets the condition, and the prompt says it with the condition's own name.
   */
  conditionAliases?: Readonly<Record<string, readonly string[]>>
  /**
   * Two or more compositions the pack mixes (the user's choice; each must hold the named
   * characters, castComposition / holdsCast). The scenes come from any of them (the pool's
   * `allScenes`), each prompt keeps the composition of its base scene (its header, pairing, pose
   * and what depends on how many people there are), and only what doesn't depend on it (clothes,
   * place, face, framing) is lent across them. Missing or one: `people` alone, exactly as before.
   */
  compositions?: readonly PackPeople[]
}

/** A request's role for the engine (keys of SceneRequests); not brief.ts's RequestRole, which names the brief's slots. */
export type SceneRequestRole = Exclude<keyof SceneRequests, 'conditions' | 'outfitStyles'>

/**
 * What the engine could not do as asked, for the interface to say in words. One entry per
 * request (or per set of selected poses) and kind, with how many prompts of the pack it touches.
 */
export type ScenePackIssue =
  /** The request needs more than one person and the pack shows one: it stays in, contradicted. */
  | { kind: 'needs-company'; tag: string; role: SceneRequestRole; prompts: number }
  /** The request was left out of the pack, and why. */
  | { kind: 'request-dropped'; tag: string; role: SceneRequestRole; reason: RequestDropReason }
  /**
   * The pack is short: only `scenes` scenes of its composition have the selected poses (0: none)
   * and they can't be imposed on others. `prompts` were made (the pack asked for more).
   */
  | { kind: 'few-scenes'; tags: string[]; scenes: number; prompts: number }
  /** `prompts` prompts use one of the `scenes` scenes with the selected poses again, with other parts. */
  | { kind: 'scenes-reused'; tags: string[]; scenes: number; prompts: number }
  /** A plain posture imposed on `prompts` scenes that don't have it, once those that have it ran out. */
  | { kind: 'pose-imposed'; tag: string; prompts: number }
  /**
   * The pack's composition (`people`) has no scene with the selected poses; `scenes` scenes of
   * other compositions have them (poseCompositions lists which).
   */
  | { kind: 'composition-without-pose'; tags: string[]; people: PackPeople; scenes: number }
  /**
   * One-axis pack (`changes`): `tags` were asked for on the axis that changes. They stay in every
   * prompt; the donors vary the rest of it (other clothes with the garment, other places at the
   * place, other forms of the pose, other faces with the expression).
   */
  | { kind: 'axis-requested'; axis: Exclude<ChangesAxis, 'scene'>; tags: string[] }
  /**
   * One-axis pack (`changes`) that came out short: only `variations` different values of the axis
   * (the base's included) go with the base scene, so `prompts` prompts were made.
   */
  | { kind: 'few-variations'; axis: Exclude<ChangesAxis, 'scene'>; variations: number; prompts: number }
  /**
   * Requests met as conditions (`requests.conditions`, `outfitStyles`): one entry for the garments
   * and styles (role 'wearing') and one for the places ('where'), always, in a pack of whole scenes.
   * `variants` different outfit parts (or places) met them across the pack; by prompt, where the
   * variant came from: the prompt's own scene (`fromScene`), another scene that lent it
   * (`fromDonors`), a library outfit (`fromLibrary`), or none, so the tags went in as typed
   * (`imposed`). `partial` prompts had a donor that met only some of the tags (the rest as typed).
   * `styles`: the library styles asked for (role 'wearing'; [] otherwise).
   */
  | {
    kind: 'condition-variety'; role: 'wearing' | 'where'; tags: string[]; styles: string[]
    variants: number; fromScene: number; fromDonors: number; fromLibrary: number; imposed: number; partial: number
  }

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
  !isCast(args) && args.settings.clothing === 'base' && (args.baseClothing?.length ?? 0) > 0 && !asksOutfit(args)
/**
 * A whole outfit (a garment of the outfit slot) or a library style was asked for: the clothing
 * options give way to it. A garment that takes only part of the outfit (a hat, glasses, boots, a
 * top) leaves them as they are and replaces only that part.
 */
const asksOutfit = (args: ScenePackArgs) => {
  const plan = requestPlan(args)
  return plan.conditions.styles.length > 0 || garmentRegion(plan.wearing, args.overrides).slots.has('clothing:outfit')
}
/** Some requests are met as conditions (a variant per prompt). */
const hasConditions = (args: ScenePackArgs) => {
  const { wearing, where, styles } = requestPlan(args).conditions
  return wearing.length + where.length + styles.length > 0
}
/** Every character wears their own outfit (it is in the identity), and nothing of the scene's. */
const wearsCharacterOutfit = (args: ScenePackArgs) => args.settings.clothing === 'character' && (args.characterOutfit?.length ?? 0) > 0
/** Every character wears what is pinned in their block, and nothing of the scene's. */
const wearsOwnOutfits = (args: ScenePackArgs) =>
  !asksOutfit(args) && ((isCast(args) && args.settings.clothing === 'own') || wearsCharacterOutfit(args))

// ── Requests ──────────────────────────────────────────────────────────────────

/** Slots where a requested tag displaces the scene's tags it can't go with: a posture, an expression, a camera. */
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
  /** `select`: the poses that pick the scenes (see poseSelection). */
  select: string[]
  /** What the character usually wears, set aside for the garments asked for: it doesn't come back through the scene either. */
  setAside: string[]
  literal: string[]
  /**
   * The requests met as conditions (SceneRequests.conditions, outfitStyles): `wearing` and `where`
   * are subsets of the plan's own; `styles`, the library styles asked for.
   */
  conditions: { wearing: string[]; where: string[]; styles: string[] }
  roleOf: Map<string, SceneRequestRole>
  /** Requests left out before composing, and why. */
  dropped: ScenePackIssue[]
}

const NO_REQUESTS: RequestPlan = { identity: [], imposed: [], wearing: [], where: [], owning: [], select: [], setAside: [], literal: [], conditions: { wearing: [], where: [], styles: [] }, roleOf: new Map(), dropped: [] }
const plans = new WeakMap<ScenePackArgs, RequestPlan>()

/** What `args.requests` means for this pack, worked out once per args. */
function requestPlan(args: ScenePackArgs): RequestPlan {
  const requests = args.requests
  if (!requests) return { ...NO_REQUESTS, identity: args.identity }
  const cached = plans.get(args)
  if (cached) return cached
  const never = (args.never ?? []).map(normalizeTagForPack).filter(Boolean)
  const roleOf = new Map<string, SceneRequestRole>()
  const dropped: ScenePackIssue[] = []
  const take = (role: Exclude<SceneRequestRole, 'literal'>): string[] =>
    (requests[role] ?? []).flatMap((raw) => {
      const tag = normalizeTagForPack(raw)
      if (!tag || roleOf.has(tag)) return []
      roleOf.set(tag, role)
      if (never.some((base) => isQualifiedVariant(tag, base))) {
        dropped.push({ kind: 'request-dropped', tag, role, reason: 'never' })
        return []
      }
      if (isCompositionPattern(tag) && !fitsPack(tag, args)) {
        dropped.push({ kind: 'request-dropped', tag, role, reason: 'composition' })
        return []
      }
      return [tag]
    })
  const wearing = take('wearing')
  const where = take('where')
  const select = take('select')
  const owning = [...select, ...take('also')]
  const imposed = [...wearing, ...where, ...owning]
  const literal = requests.literal.filter((tag) => tag.trim())
  literal.forEach((tag) => roleOf.set(normalizeTagForPack(tag), roleOf.get(normalizeTagForPack(tag)) ?? 'literal'))
  ;(mixedCompositions(args) ? literal.filter((tag) => isCompositionPattern(tag) && !mixedCompositions(args)!.some((people) => fitsComposition(tag, people))) : alwaysAddOmitted(literal, args.people ?? null)).forEach((tag) =>
    dropped.push({ kind: 'request-dropped', tag, role: 'literal', reason: 'composition' })
  )
  const asCondition = new Set((requests.conditions ?? []).map(normalizeTagForPack).filter(Boolean))
  // What the character wears gives way to the garment asked for (or a library style); what they are stays.
  // Only what the garments take: a whole outfit (or a library style) all of it, a hat the character's hat.
  const styled = (requests.outfitStyles ?? []).some((style) => style.trim())
  const taken = styled ? null : garmentRegion(wearing, args.overrides)
  const setAside = wearing.length > 0 || styled
    ? args.identity.filter((tag) => isWornByCharacter(tag, args.overrides, args.permanence) && (!taken || inRegion(normalizeTagForPack(tag), taken, args.overrides)))
    : []
  const aside = new Set(setAside)
  const character = args.identity.filter((tag) => !aside.has(tag))
  const have = new Set(character.map(normalizeTagForPack))
  const plan: RequestPlan = {
    identity: [...character, ...imposed.filter((tag) => !have.has(tag))],
    imposed,
    wearing,
    where,
    owning,
    select,
    setAside: setAside.map(normalizeTagForPack),
    literal,
    conditions: {
      wearing: wearing.filter((tag) => asCondition.has(tag)),
      where: where.filter((tag) => asCondition.has(tag)),
      styles: Array.from(new Set((requests.outfitStyles ?? []).map((style) => style.trim().toLowerCase()).filter(Boolean))),
    },
    roleOf,
    dropped,
  }
  plans.set(args, plan)
  return plan
}

/**
 * `tags` without the scene's tags a requested posture, expression or camera tag rules out: those
 * of the same slot that can't go with it, by the measured relations for a picture of `people`
 * (`excludes`) or by the conflict resolver the composer uses, either way round ("sitting" sends
 * "standing", "kneeling" and "squatting" out but keeps "wariza"; "smile" keeps "blush" and sends
 * "crying" out; "from behind" keeps "cowboy shot"). Variants of the request already left with the
 * ownership rule. `locked` tags stay. Without the relations loaded nothing is displaced here (the
 * composer's conflict pass still applies).
 */
export function displaceRequestedSlots(
  tags: readonly string[],
  requested: readonly string[],
  locked: readonly string[],
  overrides: Record<string, string>,
  people = 1,
  relations: TagRelations | null = loadedTagRelations()
): string[] {
  if (!relations) return [...tags]
  const owners = new Map<string, string[]>()
  for (const tag of requested) {
    const slot = getTagSlotFromOverrides(tag, overrides)?.slot
    if (slot && DISPLACING_SLOTS.has(slot)) owners.set(slot, [...(owners.get(slot) ?? []), tag])
  }
  if (owners.size === 0) return [...tags]
  const kept = new Set(locked)
  return tags.filter((raw) => {
    if (kept.has(raw)) return true
    const tag = normalizeTagForPack(raw)
    const rivals = owners.get(getTagSlotFromOverrides(tag, overrides)?.slot ?? '')
    return !rivals || !rivals.some((owner) => cannotGoWith(owner, tag, people, relations))
  })
}

/** Slots of an action of the whole body (moving, fighting): what the body is doing, one at a time. */
const ACTION_SLOTS = new Set(['pose:kinetic', 'pose:combat'])
/** What an action done with something in the hand ("reading") is, for the relations and the resolver: holding it. */
const HOLD_PROBE = 'holding'

/**
 * True when `tag`, a tag of a scene's pose (its skeleton unit), contradicts a selected pose imposed
 * on that scene (`imposed`: the selected poses the scene doesn't have). The scene's pose was
 * another one, so what its body was doing gives way to what was asked:
 *  - a tag the measured relations or the conflict resolver set against an imposed pose, whatever
 *    its slot ("standing" for "sitting");
 *  - an action of the whole body, moving or fighting ("fighting stance", "walking", "stretching"),
 *    unless it is a form of the imposed pose or the other way round: the body now does what was asked;
 *  - when an imposed pose is filed with the things carried in the hand ("reading"), the hands are
 *    busy with it: a hand gesture ("clenched hands", "hand on own hip"), and what the relations or
 *    the resolver set against holding something (HOLD_PROBE: "arms behind back", "hands in pockets").
 * Postures and gestures that can go with it stay ("arms up" with "sitting"; "standing" with "reading").
 */
export function contradictsImposedPose(
  tag: string,
  imposed: readonly string[],
  overrides: Record<string, string>,
  people = 1,
  relations: TagRelations | null = loadedTagRelations()
): boolean {
  if (imposed.length === 0) return false
  const key = normalizeTagForPack(tag)
  const slot = getTagSlotFromOverrides(key, overrides)?.slot
  if (!slot || unitOfSlot(slot) !== 'skeleton') return false
  const asked = imposed.filter((pose) => !isQualifiedVariant(key, pose) && !isQualifiedVariant(pose, key))
  if (asked.length < imposed.length) return false
  if (ACTION_SLOTS.has(slot)) return true
  const inHand = asked.some((pose) => HAND_SLOTS.has(getTagSlotFromOverrides(pose, overrides)?.slot ?? ''))
  if (inHand && slot === 'pose:gesture') return true
  const against = inHand ? [...asked, HOLD_PROBE] : asked
  if (relations) return against.some((pose) => cannotGoWith(pose, key, people, relations))
  return against.some((pose) => resolveTagConflicts([pose], [key]).conflictingTags.length > 0 || resolveTagConflicts([key], [pose]).conflictingTags.length > 0)
}

/** `tags` without those of the scene's pose that contradict the poses imposed on it (contradictsImposedPose). `locked` tags stay. */
export function displaceImposedPoses(
  tags: readonly string[],
  imposed: readonly string[],
  locked: readonly string[],
  overrides: Record<string, string>,
  people = 1,
  relations: TagRelations | null = loadedTagRelations()
): string[] {
  if (imposed.length === 0) return [...tags]
  const kept = new Set(locked)
  return tags.filter((tag) => kept.has(tag) || !contradictsImposedPose(tag, imposed, overrides, people, relations))
}

/** The selected poses `scene` lacks, which a prompt made from its pose has imposed on it. */
function imposedOn(scene: Scene | undefined, selection: PoseSelection | null): string[] {
  if (!selection || !scene) return []
  const has = new Set(posesOf(scene, selection))
  return selection.tags.filter((pose) => !has.has(pose))
}

/** True when `a` and `b` can't be in one picture: the measured relations or the conflict resolver say so, either way round. */
function cannotGoWith(a: string, b: string, people: number, relations: TagRelations): boolean {
  if (excludes(relations, a, b, { people })) return true
  const base = people >= 2 ? ['2girls'] : []
  return resolveTagConflicts([...base, a], [b]).conflictingTags.length > 0 || resolveTagConflicts([...base, b], [a]).conflictingTags.length > 0
}

/** The tags every prompt keeps, in order: the character blocks (and the imposed requests), then the base's clothing when it is worn. */
function fixedTags(args: ScenePackArgs): string[] {
  const identity = requestPlan(args).identity
  if (!wearsBaseClothing(args)) return identity
  const own = new Set(identity)
  return [...identity, ...args.baseClothing!.filter((tag) => !own.has(tag))]
}

/**
 * The exposure of `scene` that stays with an act the user asked for, whatever clothes the prompt
 * wears (ComposeOptions.actBody). Only for a scene that has a selected pose only a scene can give
 * (poseNeedsScene: an act between people, "princess carry"): what that act shows of the bodies is
 * part of it. A pose that can be imposed on any scene ("sitting") doesn't depend on the scene's
 * body, and an imposed pose brings nothing of a scene that lacks it. What the clothes `clothes` rule
 * out goes ("nude" with a "bikini"), judged on one person: the clothes are worn by a character of the
 * pack, and in a picture of several people the resolver lets anyone be nude next to anyone's bikini.
 * The exposure unit holds picture state only (permanent traits never enter it), so no look of
 * another person comes in.
 */
function actBody(scene: Scene, clothes: readonly string[], selection: PoseSelection, overrides: Record<string, string>): string[] {
  if (!posesOf(scene, selection).some((pose) => selection.needed.has(pose))) return []
  const worn = clothes.map(normalizeTagForPack).filter((tag) => getTagSlotFromOverrides(tag, overrides)?.category === 'clothing')
  if (worn.length === 0) return scene.units.exposure.slice()
  const relations = loadedTagRelations()
  const clashes = (garment: string, tag: string) =>
    relations
      ? cannotGoWith(garment, tag, 1, relations)
      : resolveTagConflicts([garment], [tag]).conflictingTags.length > 0 || resolveTagConflicts([tag], [garment]).conflictingTags.length > 0
  return scene.units.exposure.filter((tag) => !worn.some((garment) => clashes(garment, normalizeTagForPack(tag))))
}

function composeOptions(args: ScenePackArgs, count: number, seed: number, disabled: readonly string[] | undefined): ComposeOptions {
  const { settings } = args
  const plan = requestPlan(args)
  const selection = args.requests ? poseSelection(args) : null
  const library = !isCast(args) && settings.clothing === 'library' && args.library && args.library.length > 0 && !asksOutfit(args)
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
    ...(hasConditions(args) ? { conditions: true } : {}),
    ...(selection && selection.needed.size > 0
      ? { actBody: (scene: Scene, clothes: readonly string[]) => actBody(scene, clothes, selection, args.overrides) }
      : {}),
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

// ── The other people ──────────────────────────────────────────────────────────

interface OthersPlan {
  /** `requests.others` as the engine spells them, less what "Never include" rules out. */
  tags: string[]
  /** Those left out for "Never include". */
  dropped: ScenePackIssue[]
}

const othersPlans = new WeakMap<ScenePackArgs, OthersPlan>()

/** What `args.requests.others` means for this pack, worked out once per args. */
function othersPlan(args: ScenePackArgs): OthersPlan {
  const cached = othersPlans.get(args)
  if (cached) return cached
  const never = (args.never ?? []).map(normalizeTagForPack).filter(Boolean)
  const plan: OthersPlan = { tags: [], dropped: [] }
  for (const raw of args.requests?.others ?? []) {
    const tag = normalizeTagForPack(raw)
    if (!tag || plan.tags.includes(tag) || plan.dropped.some((issue) => issue.kind === 'request-dropped' && issue.tag === tag)) continue
    if (never.some((base) => isQualifiedVariant(tag, base))) plan.dropped.push({ kind: 'request-dropped', tag, role: 'others', reason: 'never' })
    else plan.tags.push(tag)
  }
  othersPlans.set(args, plan)
  return plan
}

/** The tags the near-duplicate filter leaves aside: the fixed ones and the other people's look, the same in every prompt. */
const filterIgnores = (args: ScenePackArgs): string[] => [...fixedTags(args), ...othersPlan(args).tags]

/** Per finisher: prompts with room for the other people, and without. */
const othersTally = new WeakMap<Finisher, { room: number; none: number }>()

/**
 * True when the picture of `composed` has more people than the pack's named characters: the
 * scene's count, else the pack's; with an open count ("multiple boys"), when its header says
 * there is more than one person and the pack names one character.
 */
function hasOthers(f: Finisher, composed: ScenePrompt): boolean {
  const named = f.args.castSize ?? 1
  const people = f.sceneById.get(composed.sources.skeleton)?.people ?? f.args.people
  if (people) return people.girls + people.boys > named
  const crowd = composed.locked.some((tag) => isCompositionPattern(tag) && !fitsComposition(tag, { girls: 1, boys: 0 }) && !fitsComposition(tag, { girls: 0, boys: 1 }))
  return crowd && named < 2
}

/** A tag that is a lasting trait of someone (permanence identity, a trait written with a gender read as its core). */
function isLastingTrait(tag: string, args: ScenePackArgs): boolean {
  const permanence = args.permanence
  if (!permanence) return false
  const trait = genderedTrait(tag, args.overrides, permanence)
  return (trait ? trait.permanence : permanence(tag)) === 'identity'
}

/**
 * `tags` (a composed prompt after the ownership rules, `locked` its fixed tags) with the other
 * people's look (`requests.others`) as a block of its own right after the header and the named
 * characters' identity, before the requests and the scene's tags; the scene's own copy of one of
 * them, and the companion's lasting look the scene brought (isLastingTrait), go. They join the locked tags, so the cleaner and the last pass keep them, but they never
 * reach the ownership rule: a companion's look takes nothing of the characters'. A prompt with no
 * one besides the characters gets none of them (packIssues says so when no prompt had room).
 */
function withOthers(f: Finisher, composed: ScenePrompt, tags: readonly string[]): { tags: string[]; locked: string[] } {
  const others = othersPlan(f.args).tags
  if (others.length === 0) return { tags: [...tags], locked: composed.locked }
  const tally = othersTally.get(f) ?? { room: 0, none: 0 }
  othersTally.set(f, tally)
  if (!hasOthers(f, composed)) {
    tally.none++
    return { tags: [...tags], locked: composed.locked }
  }
  tally.room++
  const plan = requestPlan(f.args)
  const aside = new Set(plan.setAside)
  const character = new Set(f.args.identity.filter((tag) => !aside.has(normalizeTagForPack(tag))))
  const fixed = new Set(fixedTags(f.args))
  const locked = new Set(composed.locked)
  const block = new Set(others)
  // The user said how the others look: the scene's own say about it (a companion's lasting trait,
  // which travels only when it is the source's theme) gives way to it.
  const theirs = new Set(f.sceneById.get(composed.sources.skeleton)?.units.body.filter((tag) => isLastingTrait(tag, f.args)) ?? [])
  const rest = tags.filter((tag) => locked.has(tag) || (!block.has(normalizeTagForPack(tag)) && !theirs.has(tag)))
  // Header (locked, not one of the pack's fixed tags) and the characters' identity come first.
  let at = 0
  while (at < rest.length && locked.has(rest[at]) && (character.has(rest[at]) || !fixed.has(rest[at]))) at++
  const add = others.filter((tag) => !locked.has(tag))
  const before = composed.locked.filter((tag) => rest.indexOf(tag) < at)
  // The cleaner writes the locked tags in their order: the block keeps its place there too.
  return { tags: [...rest.slice(0, at), ...add, ...rest.slice(at)], locked: [...before, ...add, ...composed.locked.slice(before.length)] }
}

/** The issues of `requests.others`: those in "Never include", and all of them when no prompt had room for anyone else. */
function othersIssues(f: Finisher): ScenePackIssue[] {
  const plan = othersPlan(f.args)
  const tally = othersTally.get(f)
  const unseen = tally && tally.room === 0 && tally.none > 0
  return [
    ...plan.dropped,
    ...(unseen ? plan.tags.map((tag): ScenePackIssue => ({ kind: 'request-dropped', tag, role: 'others', reason: 'composition' })) : []),
  ]
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
  /** With selected poses: the scenes the pack used and the steps it took. */
  pose: PoseTally | null
  /** With conditions: their donors and what they did. */
  cond: ConditionRun | null
}

interface PoseTally {
  plan: PosePlan
  /** Base scenes of the prompts made so far. */
  used: Set<number>
  /** Prompts whose base scene an earlier prompt already used. */
  reused: number
  /** Selected pose -> prompts it was imposed on (a scene without it). */
  imposed: Map<string, number>
}

function finisher(pool: ScenePool, args: ScenePackArgs, seen: Set<string>, filter: NearDuplicateFilter, pose: PosePlan | null = null, cond: ConditionRun | null = null): Finisher {
  const situationOf = new Map<number, string>()
  pool.situations.forEach((situation) => situation.sceneIds.forEach((id) => situationOf.set(id, situation.id)))
  return {
    pool, args, leftOut: ideaClothesLeftOut(args), seen, filter,
    sceneById: new Map(pool.scenes.map((scene) => [scene.postId, scene])), situationOf, lonely: new Map(),
    pose: pose ? { plan: pose, used: new Set(), reused: 0, imposed: new Map() } : null,
    cond,
  }
}

/** Notes a prompt made from `composed` in a phase of `kind`: a scene used again, a pose imposed. */
function tallyPose(f: Finisher, kind: PhaseKind, composed: ScenePrompt): void {
  const tally = f.pose
  if (!tally) return
  const id = composed.sources.skeleton
  if (tally.used.has(id)) tally.reused++
  tally.used.add(id)
  if (kind !== 'imposed') return
  const { selection } = tally.plan
  const scene = f.sceneById.get(id)
  const has = new Set(scene ? posesOf(scene, selection) : [])
  selection.tags.forEach((pose) => {
    if (!has.has(pose)) tally.imposed.set(pose, (tally.imposed.get(pose) ?? 0) + 1)
  })
}

/**
 * The issues of a finished pack of `made` prompts (of `count` asked): requests left out before
 * composing, requests that needed company, then what the selected poses could not give.
 */
function packIssues(f: Finisher, made: number, count: number): ScenePackIssue[] {
  const plan = requestPlan(f.args)
  const issues = [...plan.dropped, ...othersIssues(f)]
  f.lonely.forEach((prompts, tag) => issues.push({ kind: 'needs-company', tag, role: plan.roleOf.get(normalizeTagForPack(tag)) ?? 'literal', prompts }))
  issues.push(...conditionIssues(f.cond))
  const tally = f.pose
  if (!tally) return issues
  const { selection, carriers, elsewhere } = tally.plan
  const tags = selection.tags
  const people = f.args.people ?? f.pool.stats.composition
  if (carriers.length === 0 && elsewhere > 0 && people) issues.push({ kind: 'composition-without-pose', tags, people, scenes: elsewhere })
  if (tally.reused > 0) issues.push({ kind: 'scenes-reused', tags, scenes: carriers.length, prompts: tally.reused })
  tally.imposed.forEach((prompts, tag) => issues.push({ kind: 'pose-imposed', tag, prompts }))
  if (made < count && selection.needed.size > 0) issues.push({ kind: 'few-scenes', tags, scenes: carriers.length, prompts: made })
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
  const baseScene = f.sceneById.get(composed.sources.skeleton)
  const people = headcountFor(args, baseScene)
  const requested = displaceRequestedSlots(ownedTags, plan.owning, composed.locked, args.overrides, people)
  // A selected pose the scene of the prompt's pose lacks is imposed on it: what of that pose contradicts it goes.
  const imposed = args.requests ? imposedOn(f.sceneById.get(composed.sources.pose ?? composed.sources.skeleton), poseSelection(args)) : []
  const displaced = displaceImposedPoses(requested, imposed, composed.locked, args.overrides, people)
  const company = withOthers(f, composed, displaced)
  const cleaned = args.clean(company.tags, company.locked)
  if (!cleaned) return null
  // One rule wherever the tags come from (character, base clothing, library, scene): a generic
  // tag next to a qualified form of the same thing gives way to it. A request never does.
  // With a cast the blocks are different people: one's "long hair" is not redundant with another's "very long hair".
  // The last pass shared with Classic: redundant generics, tags that need company in a
  // one-person prompt, then references to nothing.
  const kept = coherentPromptTags(cleaned.split(',').map((tag) => tag.trim()).filter(Boolean), {
    keep: company.locked,
    fixed: [...(isCast(args) ? composed.locked : []), ...plan.imposed],
    overrides: args.overrides,
    people: true,
  })
  const front = Array.from(new Set([...plan.literal, ...args.alwaysAdd]))
  const prompt = finalizePackPrompt(kept.join(', '), alwaysAddFor(front, composed.locked, peopleFor(args, baseScene)))
  if (!prompt || f.seen.has(prompt) || !f.filter.tryAccept(prompt)) return null
  f.seen.add(prompt)
  // A request that needs company stays in a one-person prompt; the pack says so.
  if (args.requests) {
    const finalTags = prompt.split(',').map((tag) => tag.trim()).filter(Boolean)
    loneCompanyTags(finalTags, args.overrides).forEach((tag) => {
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
      // Library outfits lend with negative ids (PackPrompt.outfitId says which): never a post's.
      donors: Array.from(new Set(Object.values(composed.sources).filter((id): id is number => id !== undefined && id >= 0))),
    },
  }
}

/**
 * How many more prompts each scene with the selected poses may make once they have all been used.
 * Remix can make dozens of different prompts from one scene; past one more each, the pack is
 * mostly the same few pictures, and a plain posture is better imposed on other scenes.
 */
export const REUSES_PER_SCENE = 1

/** What a phase of the pack is: plain scenes, scenes with the selected poses, those again (reuse), or a pose imposed. */
type PhaseKind = 'scene' | 'pose' | 'reuse' | 'imposed'

/** One run of the composer over part of the pool. */
interface Phase {
  pool: ScenePool
  /** How many prompts the composer makes at most (Faithful: one per scene). A reuse phase sets its own. */
  count: number
  kind: PhaseKind
  seed: number
  /** The phase's own mix: reusing scenes swaps their parts, as Remix does. */
  mix?: 'remix'
}

/** What the selected poses make of the pool, for one pack. */
interface PosePlan {
  selection: PoseSelection
  /** Scenes in play (enabled, not removed) with every selected pose, in the order they are used. */
  carriers: Scene[]
  /** Scenes in play that lack only poses that can be imposed, most selected poses first. */
  imposable: Scene[]
  /** Scenes of other compositions with every selected pose (the pool's `allScenes`). */
  elsewhere: number
}

interface PackPlan {
  phases: Phase[]
  pose: PosePlan | null
}

/** `pool` without the scenes in `removed`, as skeletons and as donors. */
function withoutScenes(pool: ScenePool, removed: ReadonlySet<number>): ScenePool {
  return {
    ...pool,
    scenes: pool.scenes.filter((scene) => !removed.has(scene.postId)),
    situations: pool.situations.map((situation) => ({ ...situation, sceneIds: situation.sceneIds.filter((id) => !removed.has(id)) })),
  }
}

/** The scenes of the enabled situations, situation by situation. */
function scenesInPlay(pool: ScenePool, disabled: readonly string[] | undefined): Scene[] {
  const off = new Set(disabled ?? [])
  const byId = new Map(pool.scenes.map((scene) => [scene.postId, scene]))
  return pool.situations.filter((situation) => !off.has(situation.id)).flatMap((situation) => situation.sceneIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])))
}

const idsOf = (scenes: readonly Scene[]): Set<number> => new Set(scenes.map((scene) => scene.postId))

/**
 * The phases of a pack of `count`, in order. Without selected poses, preferred posts or removed
 * scenes, as always: the pool (split for the picked scenes, sceneIdeaPhases), up to a few more
 * prompts than asked, so the duplicate filter has room. With preferred posts, their scenes first.
 * With selected poses, the ladder (each step it takes goes to `issues`):
 *  1. the scenes with every selected pose, each once (preferred posts first);
 *  2. those of them that made a prompt, once more each (REUSES_PER_SCENE) with other parts, as
 *     Remix does (a scene whose own prompt didn't pass, a near-duplicate of another, doesn't
 *     come back this way);
 *  3. only when the poses they lack can be imposed (a plain posture): the other scenes, those with
 *     the most selected poses first, with the poses imposed;
 *  4. nothing more: the pack is short. A pose that needs a scene with it is never imposed.
 */
function packPlan(pool: ScenePool, args: ScenePackArgs, count: number): PackPlan {
  const overGenerate = Math.min(Math.max(count * 2, count + 4), MAX_PACK_OVERGENERATE)
  const removed = new Set(args.removedScenes ?? [])
  const preferred = new Set(args.preferredPosts ?? [])
  const selection = args.requests ? poseSelection(args) : null
  const phases: Phase[] = []
  const add = (phasePool: ScenePool, phaseCount: number, kind: PhaseKind, mix?: 'remix') =>
    phases.push({ pool: phasePool, count: phaseCount, kind, seed: args.seed + phases.length, ...(mix ? { mix } : {}) })
  if (!selection && removed.size === 0 && preferred.size === 0) {
    // With picked scenes, the posts that have them come first (see sceneIdeaPhases).
    ;(sceneIdeaPhases(pool, args.sceneIdea?.core) ?? [pool]).forEach((phasePool) => add(phasePool, overGenerate, 'scene'))
    return { phases, pose: null }
  }
  const base = removed.size > 0 ? withoutScenes(pool, removed) : pool
  const inPlay = scenesInPlay(base, args.disabledSituations)
  /** Preferred scenes first, then the rest; empty groups left out. */
  const preferredFirst = (scenes: Scene[]): Scene[][] =>
    [scenes.filter((scene) => preferred.has(scene.postId)), scenes.filter((scene) => !preferred.has(scene.postId))].filter((group) => group.length > 0)

  if (!selection) {
    const groups = preferredFirst(inPlay)
    groups.forEach((group, i) => {
      const view = groups.length > 1 ? restrictPool(base, idsOf(group)) : base
      // Only the last group may come back with other swaps (Remix with fewer scenes than prompts).
      const last = i === groups.length - 1
      ;(sceneIdeaPhases(view, args.sceneIdea?.core) ?? [view]).forEach((phasePool) => add(phasePool, last ? overGenerate : group.length, 'scene'))
    })
    return { phases, pose: null }
  }

  const fit = new Map(inPlay.map((scene) => [scene.postId, poseFit(scene, selection)]))
  const carriers = inPlay.filter((scene) => fit.get(scene.postId) === 'all')
  const carried = (scene: Scene) => posesOf(scene, selection).length
  const imposable = inPlay.filter((scene) => fit.get(scene.postId) === 'imposable').sort((a, b) => carried(b) - carried(a))
  const inPool = idsOf(base.scenes)
  const elsewhere = (pool.allScenes ?? []).filter(
    (scene) => !inPool.has(scene.postId) && !removed.has(scene.postId) && poseFit(scene, selection) === 'all'
  ).length

  const ordered: Scene[] = []
  preferredFirst(carriers).forEach((group) => {
    add(restrictPool(base, idsOf(group)), group.length, 'pose')
    ordered.push(...group)
  })
  if (carriers.length > 0) add(restrictPool(base, idsOf(carriers)), 0, 'reuse', 'remix')
  // Among the scenes a pose is imposed on, those whose own pose has nothing that contradicts it come first.
  const relations = loadedTagRelations()
  const clashes = (scene: Scene) => {
    const imposed = imposedOn(scene, selection)
    const people = headcountFor(args, scene)
    return scene.units.skeleton.some((tag) => contradictsImposedPose(tag, imposed, args.overrides, people, relations))
  }
  const levels = Array.from(new Set(imposable.map(carried)))
  levels.forEach((level) => {
    const atLevel = imposable.filter((scene) => carried(scene) === level)
    const clashing = new Set(atLevel.filter(clashes).map((scene) => scene.postId))
    ;[atLevel.filter((scene) => !clashing.has(scene.postId)), atLevel.filter((scene) => clashing.has(scene.postId))].forEach((hosts) =>
      preferredFirst(hosts).forEach((group) => add(restrictPool(base, idsOf(group)), group.length, 'imposed'))
    )
  })
  return { phases, pose: { selection, carriers: ordered, imposable, elsewhere } }
}

/**
 * Composed scenes for a pack, phase by phase, one at a time: only as many are composed as the pack
 * takes. A reuse phase works on the scenes of `used` (those that made a prompt so far).
 */
function* composeForPack(args: ScenePackArgs, phases: readonly Phase[], used?: ReadonlySet<number>): Generator<{ prompt: ScenePrompt; kind: PhaseKind }> {
  for (const phase of phases) {
    const phasePool = phase.kind === 'reuse' ? restrictPool(phase.pool, used ?? new Set()) : phase.pool
    const reusable = phase.kind === 'reuse' ? phasePool.situations.reduce((sum, situation) => sum + situation.sceneIds.length, 0) : 0
    if (phase.kind === 'reuse' && reusable === 0) continue
    const options = composeOptions(args, phase.kind === 'reuse' ? reusable * REUSES_PER_SCENE : phase.count, phase.seed, args.disabledSituations)
    for (const prompt of composePackPrompts(phasePool, phase.mix ? { ...options, mix: phase.mix } : options)) yield { prompt, kind: phase.kind }
  }
}

// ── Requests as conditions ────────────────────────────────────────────────────

/** Where the variant of a condition in one prompt came from. */
type VariantSource = 'scene' | 'donor' | 'library' | 'imposed'

/** What one condition (the garments and styles, or the places) did across the pack. */
interface ConditionTally {
  /** Prompts by where their variant came from. */
  from: Record<VariantSource, number>
  /** Prompts whose donor met only some of the tags (the rest went in as typed). */
  partial: number
  /** Different variants in the pack (the tags lent or kept, as a set). */
  values: Set<string>
}

const newTally = (): ConditionTally => ({ from: { scene: 0, donor: 0, library: 0, imposed: 0 }, partial: 0, values: new Set() })

/** The conditions of a pack and the donors that can meet them. */
interface ConditionRun {
  wearing: string[]
  where: string[]
  styles: string[]
  /** The part of an outfit the garments (or a style: the whole outfit) take; null without them. */
  region: GarmentRegion | null
  outfits: ConditionQueue | null
  places: ConditionQueue | null
  outfitTally: ConditionTally
  placeTally: ConditionTally
  /** Every scene by post id (the pool's own and the donors'), for the swaps a composed prompt records. */
  byId: Map<number, Scene>
  /** The pieces of each garment of the outfit slot asked for (garmentPieces), measured on those scenes. */
  pieces: Map<string, Set<string>>
  /** The variants of the last prompt finishWithConditions made, until the pack keeps it (commitVariant). */
  last: { outfit: VariantOption; place: VariantOption } | null
}

/** Most donors tried for one prompt before the condition's tag goes in as typed. */
export const MAX_CONDITION_TRIES = 16
/** Most places tried with each outfit. */
const MAX_PLACE_TRIES = 3

/** Every clothing slot: the region a library style takes (the whole outfit). */
const ALL_CLOTHING: GarmentRegion = { garments: [], slots: CLOTHING_SLOTS, torso: true }

/** The garments' layers in an outfit part (layersOver, with the measured relations). */
function layered(value: readonly string[], garments: readonly string[], overrides: Record<string, string>, pieces?: ReadonlyMap<string, ReadonlySet<string>>): boolean {
  const relations = loadedTagRelations()
  const none: ReadonlySet<string> = new Set()
  return layersOver(value, garments, overrides, relations ? (garment) => requiredBy(relations, garment) : undefined, (garment) => pieces?.get(garment) ?? none).length > 0
}

/** The pool a pack takes its scenes from: without the posts that only lend (`donorPosts`). */
function basesOf(pool: ScenePool, args: ScenePackArgs): ScenePool {
  const donors = args.donorPosts ?? []
  return donors.length > 0 ? withoutScenes(pool, new Set(donors)) : pool
}

/**
 * `scene` with every other name of a condition (ScenePackArgs.conditionAliases) written as the
 * condition, in its outfit (a garment) or place (a place) whatever unit the unknown name fell in, qualified forms too ("red qipao" -> "red china dress"): a post
 * the booru tagged with another name of the garment or place meets it like one tagged with its own.
 * The same scene when it has none.
 */
function conditionNames(args: ScenePackArgs, wearing: readonly string[], where: readonly string[]): (scene: Scene) => Scene {
  const canonical = new Map<string, string>()
  for (const [tag, names] of Object.entries(args.conditionAliases ?? {})) {
    const condition = normalizeTagForPack(tag)
    if (!wearing.includes(condition) && !where.includes(condition)) continue
    for (const name of names) {
      const alias = normalizeTagForPack(name)
      if (alias && alias !== condition) canonical.set(alias, condition)
    }
  }
  if (canonical.size === 0) return (scene) => scene
  /** The tag with the condition's own name, and the condition it names; null when it names none. */
  const rename = (tag: string): { tag: string; condition: string } | null => {
    const exact = canonical.get(tag)
    if (exact) return { tag: exact, condition: exact }
    for (const [alias, condition] of canonical) if (tag.endsWith(` ${alias}`)) return { tag: `${tag.slice(0, -alias.length)}${condition}`, condition }
    return null
  }
  return (scene) => {
    let changed = false
    const units = { ...scene.units }
    const moved: { outfit: string[]; place: string[] } = { outfit: [], place: [] }
    for (const unit of UNIT_ORDER) {
      units[unit] = units[unit].filter((tag) => {
        const named = rename(tag)
        if (!named) return true
        changed = true
        // Another name of a garment is a garment, of a place a place, whatever unit an unknown tag fell in.
        moved[wearing.includes(named.condition) ? 'outfit' : 'place'].push(named.tag)
        return false
      })
    }
    if (!changed) return scene
    units.outfit = Array.from(new Set([...units.outfit, ...moved.outfit]))
    units.place = Array.from(new Set([...units.place, ...moved.place]))
    return { ...scene, units }
  }
}

/** The conditions of `args` with their donors from `pool` (the whole pool: donor posts and every composition), or null. */
function conditionRun(pool: ScenePool, args: ScenePackArgs): ConditionRun | null {
  if (!hasConditions(args)) return null
  const { wearing, where, styles } = requestPlan(args).conditions
  const removed = new Set(args.removedScenes ?? [])
  const byId = new Map<number, Scene>()
  const named = conditionNames(args, wearing, where)
  for (const scene of [...pool.scenes, ...(pool.allScenes ?? [])]) {
    if (!removed.has(scene.postId) && !byId.has(scene.postId)) byId.set(scene.postId, named(scene))
  }
  const scenes = Array.from(byId.values())
  const own = new Set(basesOf(pool, args).scenes.map((scene) => scene.postId))
  const group = (scene: Scene) => (own.has(scene.postId) ? 0 : 1)
  const rng = createSeededRng(args.seed + 7919)

  const outfitsOfScenes = scenes.map((scene) => scene.units.outfit)
  const pieces = new Map(wearing.map((garment) => [garment, garmentPieces(garment, outfitsOfScenes, args.overrides)]))
  let region: GarmentRegion | null = null
  let outfits: ConditionQueue | null = null
  if (wearing.length > 0 || styles.length > 0) {
    const taken = styles.length > 0 ? { ...ALL_CLOTHING, garments: wearing } : garmentRegion(wearing, args.overrides)
    region = taken
    const library = (args.outfitLibrary ?? args.library ?? [])
      .filter((outfit) => styles.length === 0 || (!!outfit.style && styles.includes(outfit.style)))
      .map(libraryDonor)
    // A style is met only by the library; garments by any scene's outfit too.
    const sources: Scene[] = styles.length > 0 ? library : [...scenes, ...library]
    const candidates = sources.flatMap((scene) => {
      const value = regionTags(scene.units.outfit, taken, args.overrides)
      const met = metCount(value, wearing)
      if (value.length === 0 || (wearing.length > 0 && met === 0) || layered(value, wearing, args.overrides, pieces)) return []
      const kind = isLibraryDonor(scene) ? 2 : group(scene)
      return [{ scene, value, group: (wearing.length - met) * 10 + kind }]
    })
    outfits = new ConditionQueue(candidates, rng)
  }
  let places: ConditionQueue | null = null
  if (where.length > 0) {
    const candidates = scenes.flatMap((scene) => {
      const met = metCount(scene.units.place, where)
      return met === 0 ? [] : [{ scene, value: scene.units.place.slice(), group: (where.length - met) * 10 + group(scene) }]
    })
    places = new ConditionQueue(candidates, rng)
  }
  return { wearing, where, styles, region, outfits, places, outfitTally: newTally(), placeTally: newTally(), byId, pieces, last: null }
}

const peopleKeyOf = (scene: Scene) => (scene.people ? `${scene.people.girls}g${scene.people.boys}b` : 'open')

/** True when `donor`'s clothes can be the character's in a picture of `base`: the subject alone in it, the same people, or the library. */
function outfitFitsPeople(donor: Scene, base: Scene, subject: 'girl' | 'boy'): boolean {
  if (isLibraryDonor(donor)) return true
  const p = donor.people
  if (p && p.girls + p.boys === 1 && (subject === 'girl' ? p.girls : p.boys) === 1) return true
  return peopleKeyOf(donor) === peopleKeyOf(base)
}

/** The scene of a composed prompt with the swaps it recorded (Remix): its face, camera, and the outfit or place no condition replaces. */
function sceneOfPrompt(run: ConditionRun, composed: ScenePrompt): Scene | null {
  let scene = run.byId.get(composed.sources.skeleton)
  if (!scene) return null
  const swap = (id: number | undefined, parts: UnitName[]) => {
    const donor = id !== undefined ? run.byId.get(id) : undefined
    if (donor && scene) scene = lentScene(scene, donor, parts)
  }
  swap(composed.sources.face, ['face'])
  swap(composed.sources.camera, ['camera'])
  if (!run.places) swap(composed.sources.place, ['place'])
  if (!run.outfits) swap(composed.sources.outfit, ['outfit', 'exposure'])
  return scene
}

interface VariantOption {
  donor: Scene | null
  /** The tags it lends or keeps for the condition ([] for the tag as typed). */
  value: string[]
  source: VariantSource
  /** It meets only some of the tags. */
  partial: boolean
}

const AS_IT_IS: VariantOption = { donor: null, value: [], source: 'scene', partial: false }

/** The ways one prompt of `base` may meet the outfit condition, in the order to try them. */
function outfitOptions(run: ConditionRun, base: Scene, args: ScenePackArgs): VariantOption[] {
  if (!run.outfits || !run.region) return [AS_IT_IS]
  const own = regionTags(base.units.outfit, run.region, args.overrides)
  const ownMeets = run.styles.length === 0 && own.length > 0 && metCount(own, run.wearing) === run.wearing.length && !layered(own, run.wearing, args.overrides, run.pieces)
  const options: VariantOption[] = []
  if (ownMeets && !run.outfits.isUsed(own)) options.push({ donor: null, value: own, source: 'scene', partial: false })
  const donors = run.outfits.ordered((donor) => donor.postId !== base.postId && outfitFitsPeople(donor, base, args.subject))
  donors.slice(0, MAX_CONDITION_TRIES).forEach(({ scene, value }) => options.push({
    donor: scene,
    value,
    source: isLibraryDonor(scene) ? 'library' : 'donor',
    partial: run.wearing.length > 0 && metCount(value, run.wearing) < run.wearing.length,
  }))
  // The scene's own variant again, then the tag as typed.
  if (ownMeets && run.outfits.isUsed(own)) options.push({ donor: null, value: own, source: 'scene', partial: false })
  options.push({ donor: null, value: [], source: 'imposed', partial: false })
  // A full variant before a partial one.
  return [...options.filter((o) => !o.partial), ...options.filter((o) => o.partial)]
}

/** The ways one prompt of `base` may meet the place condition, in the order to try them. */
function placeOptions(run: ConditionRun, base: Scene): VariantOption[] {
  if (!run.places) return [AS_IT_IS]
  const own = base.units.place
  const ownMeets = metCount(own, run.where) === run.where.length
  const options: VariantOption[] = []
  if (ownMeets && !run.places.isUsed(own)) options.push({ donor: null, value: own.slice(), source: 'scene', partial: false })
  run.places.ordered((donor) => donor.postId !== base.postId && placeFits(base, donor)).slice(0, MAX_CONDITION_TRIES).forEach(({ scene, value }) =>
    options.push({ donor: scene, value, source: 'donor', partial: metCount(value, run.where) < run.where.length }))
  if (ownMeets && run.places.isUsed(own)) options.push({ donor: null, value: own.slice(), source: 'scene', partial: false })
  options.push({ donor: null, value: [], source: 'imposed', partial: false })
  return [...options.filter((o) => !o.partial), ...options.filter((o) => o.partial)]
}

/**
 * `base` meeting the conditions, in the order a prompt tries them: each outfit variant (the scene's
 * own, a donor's part, a library outfit, the tag as typed) with each place variant, skipping a
 * variant that contradicts what stays of the scene (lendingClashes, the rule of the one-axis donors).
 */
function* conditionScenes(f: Finisher, base: Scene): Generator<{ scene: Scene; outfit: VariantOption; place: VariantOption }> {
  const run = f.cond!
  const { args } = f
  const people = mixedCompositions(args) ? headcountFor(args, base) : args.people ? args.people.girls + args.people.boys : Math.max(1, headcount(base))
  const relations = loadedTagRelations()
  const fixed = fixedTags(args)
  const fixedSet = new Set(fixed)
  for (const outfit of outfitOptions(run, base, args)) {
    const dressed = outfit.donor && run.region
      ? lendOutfitPart(base, outfit.donor, run.region, args.overrides)
      : outfit.source === 'imposed' && run.region ? withoutOutfitPart(base, run.region, args.overrides) : base
    // With an outfit condition too, a few places per outfit; with a place condition alone, as many as outfits.
    const placeTries = run.outfits ? MAX_PLACE_TRIES : MAX_CONDITION_TRIES
    let places = 0
    for (const place of placeOptions(run, dressed)) {
      if (place.donor && ++places > placeTries) continue
      const scene = place.donor ? lentScene(dressed, place.donor, ['place']) : dressed
      // What the identity already says (the requested tag itself) is not lent: it is checked as what stays.
      const lent = [...(outfit.donor ? outfit.value : []), ...(place.donor ? place.value : [])].filter((tag) => !fixedSet.has(tag))
      if (lent.length > 0) {
        const lentSet = new Set(lent)
        const rest = [...fixed, ...sceneTags(scene).filter((tag) => !lentSet.has(tag))]
        if (lendingClashes(lent, rest, people, args.overrides, relations, true)) continue
      }
      yield { scene, outfit, place }
    }
  }
}

/**
 * `base` without its part of the outfit for `region` (and its exposure, for the torso): the tag as typed
 * then takes it. A scene whose own variant has a layer over the garment gives up that part too,
 * instead of keeping it as a scene that already wears the garment would.
 */
function withoutOutfitPart(base: Scene, region: GarmentRegion, overrides: Record<string, string>): Scene {
  const outfit = base.units.outfit.filter((tag) => !regionTags([tag], region, overrides).length)
  if (outfit.length === base.units.outfit.length) return base
  return { ...base, units: { ...base.units, outfit, exposure: region.torso ? [] : base.units.exposure } }
}

/** Notes the variant a prompt used. */
function tallyVariant(queue: ConditionQueue | null, tally: ConditionTally, option: VariantOption): void {
  if (!queue) return
  tally.from[option.source]++
  if (option.partial) tally.partial++
  if (option.value.length > 0) {
    queue.accept(option.value)
    tally.values.add(valueKey(option.value))
  }
}

/**
 * One composed scene of the pack as a finished prompt that meets the conditions (conditionScenes),
 * or null: the first variant whose prompt passes finishOne. Its sources record the donor posts; a
 * library outfit's id goes to `outfitId`.
 */
function finishWithConditions(f: Finisher, composed: ScenePrompt): PackPrompt | null {
  const run = f.cond!
  const base = sceneOfPrompt(run, composed)
  if (!base) return finishOne(f, composed)
  const options = composeOptions(f.args, 1, f.args.seed, undefined)
  // The characters wear their own clothes (Usual outfit, own, base clothing): the garment's part is
  // the only clothing that comes from a donor; the rest is theirs, in the identity.
  const ownClothes = options.clothing === 'own' && !!run.outfits && !!run.region
  const scenic: ComposeOptions = ownClothes ? { ...options, clothing: 'scene' } : options
  for (const { scene: dressed, outfit, place } of conditionScenes(f, base)) {
    const scene = ownClothes
      ? { ...dressed, units: { ...dressed.units, outfit: outfit.donor ? regionTags(outfit.donor.units.outfit, run.region!, f.args.overrides) : [], exposure: outfit.donor && run.region!.torso ? outfit.donor.units.exposure.slice() : [] } }
      : dressed
    const lent = composeLent(f.pool, scene, null, [], 'outfit', scenic)
    if (!lent) continue
    const sources: ScenePrompt['sources'] = { ...composed.sources }
    if (run.outfits) delete sources.outfit
    if (run.places) delete sources.place
    if (outfit.donor && !isLibraryDonor(outfit.donor)) sources.outfit = outfit.donor.postId
    if (place.donor) sources.place = place.donor.postId
    const prompt = finishOne(f, { ...lent, sources })
    if (!prompt) continue
    run.last = { outfit, place }
    return outfit.donor && isLibraryDonor(outfit.donor) ? { ...prompt, outfitId: outfit.donor.outfitId } : prompt
  }
  return null
}

/** Marks as used every donor value a finished prompt (`tags`) already shows whole. */
function acceptShown(run: ConditionRun, tags: readonly string[]): void {
  const shown = new Set(tags)
  const accept = (queue: ConditionQueue | null, value: readonly string[]) => {
    if (queue && value.length > 0 && value.every((tag) => shown.has(tag))) queue.accept(value)
  }
  for (const { value } of run.outfits?.ordered() ?? []) accept(run.outfits, value)
  for (const { value } of run.places?.ordered() ?? []) accept(run.places, value)
}

/** The pack keeps the last prompt finishWithConditions made: its variants count as used. */
function commitVariant(run: ConditionRun): void {
  if (!run.last) return
  tallyVariant(run.outfits, run.outfitTally, run.last.outfit)
  tallyVariant(run.places, run.placeTally, run.last.place)
  run.last = null
}

/**
 * True when the last prompt took a condition's tag as typed while variants that meet it fully are
 * still unused: none fitted this scene (its pose leans on something no such place has, its people
 * can't wear them). The pack keeps such a prompt for last and tries its other scenes first.
 */
function typedTooSoon(run: ConditionRun): boolean {
  if (!run.last) return false
  const unused = (queue: ConditionQueue | null) => !!queue && queue.ordered().some((entry) => entry.group < 10)
  return (run.last.outfit.source === 'imposed' && unused(run.outfits)) || (run.last.place.source === 'imposed' && unused(run.places))
}

/** A composed scene as a pack prompt: through the conditions when the pack has some (its variants count as used). */
function finishItem(f: Finisher, composed: ScenePrompt): PackPrompt | null {
  if (!f.cond) return finishOne(f, composed)
  const prompt = finishWithConditions(f, composed)
  if (prompt) commitVariant(f.cond)
  return prompt
}

/** A prompt a pack with conditions set aside (typedTooSoon), with what it needs to be kept later. */
interface Deferred { prompt: PackPrompt; kind: PhaseKind; composed: ScenePrompt; last: ConditionRun['last'] }

/**
 * The pack's next prompt from `composed`, or null: with conditions, one that took a tag as typed while
 * variants were left goes to `deferred` instead (keepDeferred adds them at the end if the pack is short).
 */
function packItem(f: Finisher, composed: ScenePrompt, kind: PhaseKind, deferred: Deferred[]): PackPrompt | null {
  if (!f.cond) return finishOne(f, composed)
  const prompt = finishWithConditions(f, composed)
  if (!prompt) return null
  if (typedTooSoon(f.cond)) {
    deferred.push({ prompt, kind, composed, last: f.cond.last })
    f.cond.last = null
    return null
  }
  commitVariant(f.cond)
  return prompt
}

/** Adds the set-aside prompts while the pack is short of `count`. */
function keepDeferred(f: Finisher, prompts: PackPrompt[], deferred: readonly Deferred[], count: number): void {
  for (const item of deferred) {
    if (prompts.length >= count) break
    if (f.cond) {
      f.cond.last = item.last
      commitVariant(f.cond)
    }
    prompts.push(item.prompt)
    tallyPose(f, item.kind, item.composed)
  }
}

/** The `condition-variety` issues of a pack with conditions. */
function conditionIssues(run: ConditionRun | null): ScenePackIssue[] {
  if (!run) return []
  const issue = (role: 'wearing' | 'where', tags: string[], styles: string[], tally: ConditionTally): ScenePackIssue => ({
    kind: 'condition-variety', role, tags, styles, variants: tally.values.size,
    fromScene: tally.from.scene, fromDonors: tally.from.donor, fromLibrary: tally.from.library, imposed: tally.from.imposed, partial: tally.partial,
  })
  const out: ScenePackIssue[] = []
  if (run.outfits) out.push(issue('wearing', run.wearing, run.styles, run.outfitTally))
  if (run.places) out.push(issue('where', run.where, [], run.placeTally))
  return out
}

// ── Only one thing changes ────────────────────────────────────────────────────

/** The axis of a one-axis pack, or null for a pack of whole scenes. */
const oneAxis = (args: ScenePackArgs): OneAxis | null => (args.changes && args.changes !== 'scene' ? args.changes : null)

/**
 * The args a one-axis pack composes with: always Faithful (the mix doesn't apply), and the option
 * that would take the axis away from the scenes off: "Only the outfit" takes the clothes from the
 * scenes, "Only the place" the place.
 */
function axisArgs(args: ScenePackArgs, axis: OneAxis): ScenePackArgs {
  const { settings } = args
  return {
    ...args,
    settings: {
      ...settings,
      mix: 'faithful',
      ...(axis === 'outfit' ? { clothing: 'scene' as const } : {}),
      ...(axis === 'place' ? { scenery: 'scene' as const } : {}),
    },
  }
}

/** A prompt's tags as the scenes spell them (the cleaner may escape brackets). */
const promptTagsOf = (prompt: string): string[] =>
  prompt.split(',').map((tag) => normalizeTagForPack(tag.replace(/\\/g, ''))).filter(Boolean)

interface AxisBase {
  scene: Scene
  /** The phase of the plain pack it comes from: 'imposed' when a selected posture is imposed on it. */
  kind: PhaseKind
}

/** The base the user picked (`baseScene`), when the pool has it, it isn't removed and it can take the selected poses. */
function pickedBase(pool: ScenePool, args: ScenePackArgs): AxisBase | null {
  const id = args.baseScene
  if (id === undefined || (args.removedScenes ?? []).includes(id)) return null
  const scene = pool.scenes.find((s) => s.postId === id)
  if (!scene) return null
  const selection = args.requests ? poseSelection(args) : null
  const fit = selection ? poseFit(scene, selection) : 'all'
  if (fit === 'none') return null
  return { scene, kind: fit === 'imposable' ? 'imposed' : selection ? 'pose' : 'scene' }
}

/**
 * The first scene the plain pack (Faithful, same args) makes a prompt from: preferred posts first,
 * a scene with the selected poses when there are some. Every prompt of the pack repeats the base,
 * so a scene whose prompt contradicts a request ("smile" on a picture "from behind") is passed
 * over for the next one (lendingClashes, the rule the donors go through), and so is one that hides
 * the face when the expression is what changes (showsFace); when they all are, the first. Null,
 * with the plain pack's issues (no scene has the poses...), when it makes none.
 */
function defaultBase(pool: ScenePool, args: ScenePackArgs, axis: OneAxis, count: number): { base: AxisBase | null; issues: ScenePackIssue[] } {
  const plain: ScenePackArgs = { ...args, changes: undefined, baseScene: undefined }
  // The same base whatever the pack's size (sceneCandidates asks for every prompt).
  const plan = packPlan(pool, plain, Math.max(count, MAX_PACK_OVERGENERATE))
  const f = finisher(pool, plain, new Set(), new NearDuplicateFilter(DEFAULT_SIMILARITY_THRESHOLD, filterIgnores(plain)), plan.pose)
  const requested = new Set(requestPlan(plain).imposed)
  const relations = loadedTagRelations()
  let first: AxisBase | null = null
  for (const item of composeForPack(plain, plan.phases, f.pose?.used)) {
    const prompt = finishOne(f, item.prompt)
    const scene = prompt && f.sceneById.get(item.prompt.sources.skeleton)
    if (!prompt || !scene) continue
    const base = { scene, kind: item.kind }
    first ??= base
    const tags = promptTagsOf(prompt.prompt)
    const face = new Set(scene.units.face)
    if (axis === 'expression' && !showsFace(tags.filter((tag) => !face.has(tag)))) continue
    const asked = tags.filter((tag) => requested.has(tag))
    if (asked.length === 0 || !lendingClashes(asked, tags.filter((tag) => !requested.has(tag)), headcountFor(plain, scene), plain.overrides, relations)) return { base, issues: [] }
  }
  return first ? { base: first, issues: [] } : { base: null, issues: packIssues(f, 0, count) }
}

/**
 * True when a donor's prompt (`tags`) keeps the rest of the base's prompt (`base`): off the axis
 * (`onAxis`, the base's and the donor's units), nothing of the base is missing and nothing new
 * came in, except a tag of the base scene itself (`composed`) that the base's own prompt left out
 * because its unit on the axis already said it ("armpits" next to "presenting own armpit").
 */
function sameRest(tags: readonly string[], base: readonly string[], onAxis: ReadonlySet<string>, composed: ReadonlySet<string>): boolean {
  const mine = new Set(tags.filter((tag) => !onAxis.has(tag)))
  const theirs = new Set(base.filter((tag) => !onAxis.has(tag)))
  return Array.from(theirs).every((tag) => mine.has(tag)) && Array.from(mine).every((tag) => theirs.has(tag) || composed.has(tag))
}

interface AxisRunOptions {
  /** Keep this base (a reroll keeps the pack's). */
  base?: number
  /** Don't make the base's own prompt (a reroll). */
  skipBase?: boolean
  /** Donors the pack already uses. */
  usedDonors?: ReadonlySet<number>
  /** Prompts the pack already has: their values of the axis aren't repeated. */
  usedPrompts?: readonly string[]
}

interface AxisRun {
  base: AxisBase | null
  /** The pack's prompts one at a time: the base as it is, then one per donor that passes. */
  prompts: Generator<{ prompt: PackPrompt; donor: Scene | null }>
  /** The issues of a pack of `made` prompts, `count` asked. */
  issues: (made: number, count: number) => ScenePackIssue[]
}

/**
 * A one-axis pack, prompt by prompt. The base is the picked one or the plain pack's first scene.
 * Donors: the scenes in play (enabled, not removed) with something on the axis, the same people
 * for a pose or an outfit, a place that holds the base's pose, a pose its place supports
 * (canLend); with a request on the axis, only those that already have it (a pose's scenes for
 * a selected pose, an outfit with the garment, a place at the requested place). Each is tried in
 * DonorQueue order and skipped when:
 *  - its value of the axis is already in the pack;
 *  - its unit clashes with what stays of the base (lendingClashes);
 *  - once composed and finished, anything off the axis changed (a reference left dangling, a tag
 *    another rule took out): the donor would have been patched, not lent;
 *  - the prompt's tags on the axis repeat another prompt's (the near-duplicate filter doesn't
 *    apply: every prompt shares the base on purpose).
 */
function axisRun(pool: ScenePool, args: ScenePackArgs, axis: OneAxis, count: number, run: AxisRunOptions = {}): AxisRun {
  const a = axisArgs(args, axis)
  const plan = requestPlan(a)
  let base: AxisBase | null = null
  let missing: ScenePackIssue[] = []
  if (run.base !== undefined) {
    const scene = pool.scenes.find((s) => s.postId === run.base)
    base = scene ? { scene, kind: 'scene' } : null
  } else {
    const bases = basesOf(pool, a)
    base = pickedBase(bases, a)
    if (!base) ({ base, issues: missing } = defaultBase(bases, a, axis, count))
  }
  // Every prompt shares the base on purpose: only exact repeats go through the finisher's filter.
  const f = finisher(pool, a, new Set(), new NearDuplicateFilter(Number.POSITIVE_INFINITY), null)
  // Conditions: the one on the axis picks and widens the donors; one on another part is met once, by the base.
  const cond = conditionRun(pool, a)
  const onAxisCond = !!cond && ((axis === 'outfit' && !!cond.outfits) || (axis === 'place' && !!cond.places))
  const offAxis: ConditionRun | null = cond && {
    ...cond,
    outfits: axis === 'outfit' ? null : cond.outfits,
    places: axis === 'place' ? null : cond.places,
  }
  if (base && offAxis && (offAxis.outfits || offAxis.places)) {
    const g = finisher(pool, a, new Set(), new NearDuplicateFilter(Number.POSITIVE_INFINITY), null, offAxis)
    const first = conditionScenes(g, base.scene).next()
    if (!first.done) {
      base = { ...base, scene: first.value.scene }
      offAxis.last = { outfit: first.value.outfit, place: first.value.place }
      commitVariant(offAxis)
    }
  }
  const selection = a.requests ? poseSelection(a) : null
  const parts = AXIS_UNITS[axis]
  const options: ComposeOptions = { ...composeOptions(a, 1, a.seed, undefined), ...(axis === 'place' && plan.where.length > 0 ? { whereKeepsPlace: true } : {}) }

  function* prompts(): Generator<{ prompt: PackPrompt; donor: Scene | null }> {
    if (!base) return
    const scene = base.scene
    const composed = composeLent(pool, scene, null, parts, AXIS_SOURCE[axis], options)
    const own = composed && finishOne(f, composed)
    if (!composed || !own) return
    const baseValue = axisTags(scene, axis)
    const onBase = new Set(baseValue)
    const fixed = new Set(composed.locked)
    const rest = composed.tags.filter((tag) => !onBase.has(tag))
    const final = promptTagsOf(own.prompt)
    const composedBase = new Set(composed.tags)
    const restOfBase = new Set(final.filter((tag) => !onBase.has(tag)))
    const keyOf = (tags: readonly string[]) => axisKey(tags.filter((tag) => !restOfBase.has(tag)))
    const usedKeys = new Set([keyOf(final)])
    for (const prompt of run.usedPrompts ?? []) {
      usedKeys.add(keyOf(promptTagsOf(prompt)))
      f.seen.add(prompt)
    }
    if (!run.skipBase) yield { prompt: own, donor: null }

    const removed = new Set(a.removedScenes ?? [])
    const lendsTo = (donor: Scene): boolean => {
      if (donor.postId === scene.postId || removed.has(donor.postId) || run.usedDonors?.has(donor.postId)) return false
      if (axisTags(donor, axis).length === 0) return false
      if (axis === 'pose' && selection && poseFit(donor, selection) !== 'all') return false
      if (axis === 'outfit' && plan.wearing.length > 0 && !outfitWears(donor.units.outfit, plan.wearing)) return false
      if (axis === 'place' && plan.where.length > 0 && !plan.where.every((tag) => donor.units.place.some((at) => isQualifiedVariant(at, tag)))) return false
      if (onAxisCond && axis === 'outfit') {
        // A condition's outfit: no layer over the garment (layersOver); a style, only the library's.
        if (layered(donor.units.outfit, cond!.wearing, a.overrides, cond!.pieces)) return false
        if (cond!.styles.length > 0 && !(isLibraryDonor(donor) && !!donor.style && cond!.styles.includes(donor.style))) return false
        if (isLibraryDonor(donor)) return true
      }
      return canLend(scene, donor, axis, axis === 'place' ? [] : plan.where)
    }
    // With a condition on the axis, the donors are every scene that can meet it (the donor posts and
    // other compositions too: canLend decides) and, for an outfit, the library's outfits.
    // With conditions, the scenes as the conditions read them (their other names written as the condition).
    const inPlay = scenesInPlay(pool, a.disabledSituations).map((s) => (onAxisCond ? cond!.byId.get(s.postId) ?? s : s))
    const playing = new Set(inPlay.map((s) => s.postId))
    const extra = onAxisCond
      ? [
        ...Array.from(cond!.byId.values()).filter((s) => !playing.has(s.postId)),
        ...(axis === 'outfit' ? (a.outfitLibrary ?? a.library ?? []).map(libraryDonor) : []),
      ]
      : []
    // A face lent to a picture that doesn't show it contradicts it, whatever the expression.
    const shown = axis !== 'expression' || showsFace(rest)
    const queue = new DonorQueue(
      shown ? [...inPlay, ...extra].filter(lendsTo) : [],
      (donor) => axisTags(donor, axis),
      [baseValue],
      new Set(a.preferredPosts ?? []),
      createSeededRng(a.seed)
    )
    const people = mixedCompositions(a) ? headcountFor(a, scene) : a.people ? a.people.girls + a.people.boys : Math.max(1, headcount(scene))
    const relations = loadedTagRelations()
    const lentValues = new Set([axisKey(baseValue)])
    for (let donor = queue.next(); donor; donor = queue.next()) {
      const value = axisTags(donor, axis)
      if (lentValues.has(axisKey(value))) continue
      if (lendingClashes(value.filter((tag) => !fixed.has(tag)), rest, people, a.overrides, relations)) continue
      const lent = composeLent(pool, scene, donor, parts, AXIS_SOURCE[axis], options)
      if (!lent) continue
      const lonely = new Map(f.lonely)
      const prompt = finishOne(f, lent)
      if (!prompt) continue
      const tags = promptTagsOf(prompt.prompt)
      const onAxis = new Set([...baseValue, ...value])
      const key = keyOf(tags)
      if (!sameRest(tags, final, onAxis, composedBase) || !key || usedKeys.has(key)) {
        f.lonely = lonely
        f.seen.delete(prompt.prompt)
        continue
      }
      usedKeys.add(key)
      lentValues.add(axisKey(value))
      queue.accept(value)
      yield { prompt: isLibraryDonor(donor) ? { ...prompt, outfitId: donor.outfitId } : prompt, donor }
    }
  }

  /** The requests on the axis: a selected pose, the garments, the place, an expression (or anything else) by its slot. */
  const onAxis = plan.imposed.filter((tag) => {
    switch (plan.roleOf.get(tag)) {
      case 'select': return axis === 'pose'
      case 'wearing': return axis === 'outfit'
      case 'where': return axis === 'place'
      default: return axisOfTag(tag, a.overrides) === axis
    }
  })
  const issues = (made: number, total: number): ScenePackIssue[] => {
    const out = base ? packIssues(f, made, total) : [...missing]
    if (base?.kind === 'imposed' && selection) {
      const has = new Set(posesOf(base.scene, selection))
      selection.tags.forEach((tag) => {
        if (!has.has(tag) && made > 0) out.push({ kind: 'pose-imposed', tag, prompts: made })
      })
    }
    if (offAxis) out.push(...conditionIssues(offAxis))
    if (onAxis.length > 0) out.push({ kind: 'axis-requested', axis, tags: onAxis })
    if (made < total) out.push({ kind: 'few-variations', axis, variations: made, prompts: made })
    return out
  }
  return { base, prompts: prompts(), issues }
}

/** A one-axis pack of `count` prompts (see axisRun). */
function axisPack(pool: ScenePool, args: ScenePackArgs, axis: OneAxis, count: number): ScenePackResult {
  const run = axisRun(pool, args, axis, count)
  const prompts: PackPrompt[] = []
  for (const item of run.prompts) {
    prompts.push(item.prompt)
    if (prompts.length >= count) break
  }
  return { prompts, shortBy: count - prompts.length, issues: run.issues(prompts.length, count) }
}

/** A new prompt for row `index` of a one-axis pack: the same base with a donor the pack doesn't use yet. */
function rerollAxisPrompt(pool: ScenePool, prompts: readonly PackPrompt[], index: number, args: ScenePackArgs, axis: OneAxis): PackPrompt | null {
  const current = prompts[index]
  const base = current?.scene?.postId
  if (base === undefined) return null
  const usedDonors = new Set(prompts.flatMap((p) => (p.scene?.donors ?? []).filter((id) => id !== base)))
  const usedPrompts = prompts.map((p) => p.prompt)
  const next = axisRun(pool, args, axis, 1, { base, skipBase: true, usedDonors, usedPrompts }).prompts.next()
  return next.done ? null : next.value.prompt
}

/**
 * A pack of `args.count` prompts from `pool`. `shortBy` is how many are missing
 * (Faithful makes at most one prompt per scene); `issues`, what was asked and not met.
 * With `args.changes` on one axis, a one-axis pack (see ScenePackArgs.changes).
 */
// ── The user's spelling and the scenes' ──────────────────────────────────────

/**
 * The engine's view of `args`: what the user asked for (requests, conditions, "Never include",
 * the others' look) in the spelling the scenes use (spelling.ts: "stockings" is "thighhighs",
 * "doggy style" "doggystyle"), so every comparison with scenes and donors (poses, conditions and
 * their variants, slots, ownership, never) sees one tag. What the prompt says stays what the user
 * wrote: a tag asked for exactly (Wearing or Where as typed, Also, the others' look) is written back
 * in the user's spelling (`exact`), whether the scene brought it too or not; one met in any form (a
 * pose of Doing, a condition) is the scene's, as the scene spells it. Issues name the user's tags.
 */
interface SpellingView {
  args: ScenePackArgs
  /** Scenes' spelling -> the user's, for the tags written back into prompts. */
  exact: ReadonlyMap<string, string>
  /** Scenes' spelling -> the user's, for every respelled tag (issues). */
  typed: ReadonlyMap<string, string>
}
const spellingViews = new WeakMap<ScenePackArgs, SpellingView>()

function spellingView(args: ScenePackArgs): SpellingView {
  const cached = spellingViews.get(args)
  if (cached) return cached
  const exact = new Map<string, string>()
  const typed = new Map<string, string>()
  const spell = (raw: string) => requestSpelling(raw, args.overrides, args.permanence)
  const respell = (list: readonly string[], writtenBack: (raw: string) => boolean): string[] =>
    list.map((raw) => {
      const to = spell(raw)
      if (!to || to === normalizeTagForPack(raw)) return raw
      if (!typed.has(to)) typed.set(to, raw)
      if (writtenBack(raw) && !exact.has(to)) exact.set(to, raw)
      return to
    })
  // "Never include" keeps the user's spelling too: a scene's tag in either is left out.
  const never = args.never ? Array.from(new Set([...args.never, ...respell(args.never, () => false)])) : undefined
  const r = args.requests
  let requests = r
  if (r) {
    const conditions = new Set((r.conditions ?? []).map(normalizeTagForPack))
    const asTyped = (raw: string) => !conditions.has(normalizeTagForPack(raw))
    requests = {
      ...r,
      select: respell(r.select, () => false),
      wearing: respell(r.wearing, asTyped),
      where: respell(r.where, asTyped),
      also: respell(r.also, () => true),
      ...(r.others ? { others: respell(r.others, () => true) } : {}),
      ...(r.conditions ? { conditions: respell(r.conditions, () => false) } : {}),
    }
  }
  const aliases = args.conditionAliases
    ? Object.fromEntries(Object.entries(args.conditionAliases).map(([tag, names]) => [spell(tag) || tag, names]))
    : undefined
  const view: SpellingView = typed.size === 0
    ? { args, exact, typed }
    : { args: { ...args, ...(requests ? { requests } : {}), ...(never ? { never } : {}), ...(aliases ? { conditionAliases: aliases } : {}) }, exact, typed }
  spellingViews.set(args, view)
  return view
}

/** A prompt tag as a key: escapes off, pack form. */
const promptKey = (tag: string) => normalizeTagForPack(tag.replace(/\\/g, ''))

/** A prompt of the engine with the tags asked for exactly in the user's spelling. */
function inUserSpelling(prompt: PackPrompt, view: SpellingView): PackPrompt {
  if (view.exact.size === 0) return prompt
  let changed = false
  const tags = prompt.prompt.split(', ').map((tag) => {
    const typed = view.exact.get(promptKey(tag))
    if (!typed) return tag
    changed = true
    return typed
  })
  return changed ? { ...prompt, prompt: Array.from(new Set(tags)).join(', ') } : prompt
}

/** Issues naming the user's tags as they wrote them. */
function issuesInUserSpelling(issues: ScenePackIssue[], view: SpellingView): ScenePackIssue[] {
  if (view.typed.size === 0) return issues
  const name = (tag: string) => view.typed.get(tag) ?? tag
  return issues.map((issue) => ({
    ...issue,
    ...('tag' in issue ? { tag: name(issue.tag) } : {}),
    ...('tags' in issue ? { tags: issue.tags.map(name) } : {}),
  }) as ScenePackIssue)
}

function resultInUserSpelling(result: ScenePackResult, view: SpellingView): ScenePackResult {
  if (view.typed.size === 0) return result
  return { ...result, prompts: result.prompts.map((p) => inUserSpelling(p, view)), issues: issuesInUserSpelling(result.issues, view) }
}

export function generateScenePack(pool: ScenePool, args: ScenePackArgs): ScenePackResult {
  const view = spellingView(args)
  return resultInUserSpelling(generateSpelled(pool, view.args), view)
}

function generateSpelled(pool: ScenePool, args: ScenePackArgs): ScenePackResult {
  const count = Math.max(0, Math.floor(args.count))
  if (count === 0) return { prompts: [], shortBy: 0, issues: [] }
  pool = packScenes(pool, args)
  const axis = oneAxis(args)
  if (axis) return axisPack(pool, args, axis, count)
  const bases = basesOf(pool, args)
  const plan = packPlan(bases, args, count)
  const f = finisher(bases, args, new Set(), new NearDuplicateFilter(DEFAULT_SIMILARITY_THRESHOLD, filterIgnores(args)), plan.pose, conditionRun(pool, args))
  const prompts: PackPrompt[] = []
  const deferred: Deferred[] = []
  for (const item of composeForPack(args, plan.phases, f.pose?.used)) {
    if (prompts.length >= count) break
    const prompt = packItem(f, item.prompt, item.kind, deferred)
    if (!prompt) continue
    prompts.push(prompt)
    tallyPose(f, item.kind, item.prompt)
  }
  keepDeferred(f, prompts, deferred, count)
  return { prompts, shortBy: count - prompts.length, issues: packIssues(f, prompts.length, count) }
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
async function generateSpelledAsync(
  pool: ScenePool,
  args: ScenePackArgs,
  control: AsyncControl
): Promise<ScenePackResult | null> {
  const count = Math.max(0, Math.floor(args.count))
  if (count === 0) return { prompts: [], shortBy: 0, issues: [] }
  const slice = control.slice ?? 12
  pool = packScenes(pool, args)
  await control.pause()
  if (control.cancelled()) return null
  const axis = oneAxis(args)
  if (axis) {
    const run = axisRun(pool, args, axis, count)
    const made: PackPrompt[] = []
    let start = Date.now()
    while (made.length < count) {
      if (Date.now() - start >= slice) {
        await control.pause()
        if (control.cancelled()) return null
        start = Date.now()
      }
      const next = run.prompts.next()
      if (next.done) break
      made.push(next.value.prompt)
    }
    return { prompts: made, shortBy: count - made.length, issues: run.issues(made.length, count) }
  }
  const bases = basesOf(pool, args)
  const plan = packPlan(bases, args, count)
  const f = finisher(bases, args, new Set(), new NearDuplicateFilter(DEFAULT_SIMILARITY_THRESHOLD, filterIgnores(args)), plan.pose, conditionRun(pool, args))
  const composed = composeForPack(args, plan.phases, f.pose?.used)
  const prompts: PackPrompt[] = []
  const deferred: Deferred[] = []
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
    const prompt = packItem(f, next.value.prompt, next.value.kind, deferred)
    if (!prompt) continue
    prompts.push(prompt)
    tallyPose(f, next.value.kind, next.value.prompt)
  }
  keepDeferred(f, prompts, deferred, count)
  return { prompts, shortBy: count - prompts.length, issues: packIssues(f, prompts.length, count) }
}

/** A scene a pack can be made from, for the interface's sheet of scenes (sceneCandidates). */
export interface SceneCandidate {
  postId: number
  /** Thumbnail of the post. */
  preview?: string
  /** Who is in it; null for an open count. */
  people: PackPeople | null
  /** It has every selected pose (or a qualified form); true when no pose is selected. False: a plain posture would be imposed on it. */
  hasPose: boolean
  /** It comes from one of `ScenePackArgs.preferredPosts`. */
  preferred: boolean
  situation?: string
  invented?: boolean
  /** One-axis pack (`ScenePackArgs.changes`): 'base' for the base scene, 'donor' for a scene that lends it the axis. */
  axisRole?: 'base' | 'donor'
  /**
   * A donor that is an outfit of the library (a one-axis outfit pack with a condition): its id in
   * the library. `postId` is then negative (-1 - outfitId) and there is no post nor preview.
   */
  outfitId?: number
}

/**
 * The scenes a pack would be made from, in the order it first uses them, given the same pool and
 * args as generateScenePack: the scenes with the selected poses (preferred posts first), then, for
 * a plain posture, the ones it would be imposed on. Only the scenes that really make a prompt
 * (it runs the pack in Faithful with no limit and lists the different base scenes), so its length
 * is how many different scenes generateScenePack can show ("41 scenes fit"); prompts that reuse a
 * scene don't add to it.
 * Scenes in `args.removedScenes` are left out. Pure, but it composes every scene of the pool once
 * (a few milliseconds each): call it when the pool or the args change, not on every render.
 * With `args.changes` on one axis: the base scene first (`axisRole: 'base'`), then the donors in
 * the order the pack uses them (`'donor'`); its length is the most prompts that pack can make.
 */
export function sceneCandidates(pool: ScenePool, args: ScenePackArgs): SceneCandidate[] {
  args = spellingView(args).args
  pool = packScenes(pool, args)
  // Enough to take every phase to its end: the composer never makes more than MAX_PACK_OVERGENERATE per phase.
  const count = Math.max(pool.scenes.length, MAX_PACK_OVERGENERATE)
  const axis = oneAxis(args)
  if (axis) return axisCandidates(pool, args, axis, count)
  const faithful: ScenePackArgs = { ...args, settings: { ...args.settings, mix: 'faithful' }, count }
  const bases = basesOf(pool, faithful)
  const plan = packPlan(bases, faithful, count)
  const f = finisher(bases, faithful, new Set(), new NearDuplicateFilter(DEFAULT_SIMILARITY_THRESHOLD, filterIgnores(faithful)), plan.pose, conditionRun(pool, faithful))
  const order: number[] = []
  const seen = new Set<number>()
  for (const item of composeForPack(faithful, plan.phases, f.pose?.used)) {
    if (!finishItem(f, item.prompt)) continue
    tallyPose(f, item.kind, item.prompt)
    const id = item.prompt.sources.skeleton
    if (seen.has(id)) continue
    seen.add(id)
    order.push(id)
  }
  const preferred = new Set(args.preferredPosts ?? [])
  const selection = plan.pose?.selection ?? null
  return order.flatMap((id) => {
    const scene = f.sceneById.get(id)
    if (!scene) return []
    return [{
      postId: id,
      preview: scene.preview,
      people: scene.people ? { girls: scene.people.girls, boys: scene.people.boys } : null,
      hasPose: !selection || poseFit(scene, selection) === 'all',
      preferred: preferred.has(id),
      situation: f.situationOf.get(id),
      ...(scene.invented ? { invented: true } : {}),
    }]
  })
}

/**
 * sceneCandidates of a one-axis pack: the base scene first, then the donors in the order the pack
 * uses them; its length is the most prompts the pack can make.
 */
function axisCandidates(pool: ScenePool, args: ScenePackArgs, axis: OneAxis, count: number): SceneCandidate[] {
  const run = axisRun(pool, args, axis, count)
  const base = run.base?.scene
  if (!base) return []
  const preferred = new Set(args.preferredPosts ?? [])
  const selection = args.requests ? poseSelection(args) : null
  const situationOf = new Map<number, string>()
  pool.situations.forEach((situation) => situation.sceneIds.forEach((id) => situationOf.set(id, situation.id)))
  const list: SceneCandidate[] = []
  for (const item of run.prompts) {
    const scene = item.donor ?? base
    list.push({
      postId: scene.postId,
      preview: scene.preview,
      people: scene.people ? { girls: scene.people.girls, boys: scene.people.boys } : null,
      hasPose: !selection || poseFit(scene, selection) === 'all',
      preferred: preferred.has(scene.postId),
      situation: situationOf.get(scene.postId),
      ...(scene.invented ? { invented: true } : {}),
      axisRole: item.donor ? 'donor' : 'base',
      ...(item.donor && isLibraryDonor(item.donor) ? { outfitId: item.donor.outfitId } : {}),
    })
    if (list.length >= count) break
  }
  return list
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
 * With `args.changes` on one axis: the pack's base with a donor the pack doesn't use yet and a
 * value of the axis it doesn't have (also for the base's own row: the base never changes); null
 * when none is left.
 */
function rerollSpelled(pool: ScenePool, prompts: readonly PackPrompt[], index: number, args: ScenePackArgs): PackPrompt | null {
  pool = packScenes(pool, args)
  const current = prompts[index]
  if (!current) return null
  // One-axis pack: the same base with another donor the pack doesn't use yet (the base's own row too).
  const axis = oneAxis(args)
  if (axis) return rerollAxisPrompt(pool, prompts, index, args, axis)
  const full = pool
  const bases = basesOf(full, args)
  const disabled = new Set(args.disabledSituations ?? [])
  const enabled = bases.situations.filter((situation) => !disabled.has(situation.id))
  const used = new Set(prompts.flatMap((p) => (p.scene ? [p.scene.postId] : [])))
  const situation = enabled.find((s) => s.id === current.scene?.situation)
  // Never a removed scene; with selected poses, only a scene that has them or can take them.
  const removed = new Set(args.removedScenes ?? [])
  const selection = args.requests ? poseSelection(args) : null
  const byId = new Map(bases.scenes.map((scene) => [scene.postId, scene]))
  const serves = (id: number) => {
    if (removed.has(id)) return false
    const scene = byId.get(id)
    return !selection || (!!scene && poseFit(scene, selection) !== 'none')
  }
  const unused = (ids: number[]) => ids.filter((id) => !used.has(id) && serves(id))

  const attempts: Array<{ scenes: number[]; situations: string[] }> = []
  if (situation) attempts.push({ scenes: unused(situation.sceneIds), situations: [situation.id] })
  attempts.push({ scenes: enabled.flatMap((s) => unused(s.sceneIds)), situations: enabled.map((s) => s.id) })
  if (args.settings.mix === 'remix') {
    const reuse = situation ? [situation] : enabled
    attempts.push({ scenes: reuse.flatMap((s) => s.sceneIds.filter(serves)), situations: reuse.map((s) => s.id) })
  }

  const others = prompts.filter((_, i) => i !== index).map((p) => p.prompt)
  for (const attempt of attempts) {
    if (attempt.scenes.length === 0) continue
    const view = restrictPool(bases, new Set(attempt.scenes))
    const keep = new Set(attempt.situations)
    const off = bases.situations.filter((s) => !keep.has(s.id)).map((s) => s.id)
    const { prompts: composed } = composePack(view, composeOptions(args, 6, args.seed, off))
    const filter = new NearDuplicateFilter(DEFAULT_SIMILARITY_THRESHOLD, filterIgnores(args))
    others.forEach((prompt) => filter.tryAccept(prompt))
    const cond = conditionRun(full, args)
    // The variants the other prompts already wear (or are at) aren't lent again.
    if (cond) others.forEach((prompt) => acceptShown(cond, promptTagsOf(prompt)))
    const f = finisher(bases, args, new Set([...others, current.prompt]), filter, null, cond)
    for (const item of composed) {
      const replacement = finishItem(f, item)
      if (replacement) return replacement
    }
  }
  return null
}

export async function generateScenePackAsync(pool: ScenePool, args: ScenePackArgs, control: AsyncControl): Promise<ScenePackResult | null> {
  const view = spellingView(args)
  const result = await generateSpelledAsync(pool, view.args, control)
  return result && resultInUserSpelling(result, view)
}

/**
 * A new prompt for row `index` (rerollSpelled): the pack's prompts are read back in the scenes'
 * spelling, as the engine compares them, and the new prompt is written in the user's.
 */
export function rerollScenePrompt(pool: ScenePool, prompts: readonly PackPrompt[], index: number, args: ScenePackArgs): PackPrompt | null {
  const view = spellingView(args)
  if (view.exact.size === 0) return rerollSpelled(pool, prompts, index, view.args)
  const back = new Map(Array.from(view.exact, ([scene, user]) => [normalizeTagForPack(user), scene]))
  const spelled = prompts.map((p) => {
    const tags = p.prompt.split(', ').map((tag) => back.get(promptKey(tag)) ?? tag)
    return { ...p, prompt: Array.from(new Set(tags)).join(', ') }
  })
  const made = rerollSpelled(pool, spelled, index, view.args)
  return made && inUserSpelling(made, view)
}
