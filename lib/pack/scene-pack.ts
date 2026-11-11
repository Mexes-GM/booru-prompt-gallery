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
import { composePack, composePackPrompts, dropDanglingReferences, type ComposeOptions, type ScenePrompt } from './scene/scene-compose'
import { COUNT_TAG_RE, isCompositionPattern, type Permanence } from './scene/permanence'
import { normalizeRating, type Scene, type SceneRating, type TagKind } from './scene/scene'
import { isQualifiedVariant } from './character-identity'
import type { PackPeople, ScenePool } from './scene/scene-pool'
import { holdsCast } from './scene/cast'

/** The pack's content rating (same values as the source dialog). */
export type ScenePackRating = 'sfw' | 'questionable' | 'explicit' | 'both'

/** What the user picks in the scenes panel; persisted with the builder config. */
export interface ScenePackSettings {
  mix: 'faithful' | 'remix'
  /**
   * 'base': the base's own clothing in every prompt (offered only when the base has some).
   * 'own': with two or more characters, each wears what is pinned in their block.
   */
  clothing: 'scene' | 'library' | 'base' | 'own'
  scenery: 'scene' | 'vary' | 'plain'
  extras: boolean
}

export const DEFAULT_SCENE_SETTINGS: ScenePackSettings = {
  mix: 'faithful',
  clothing: 'scene',
  scenery: 'scene',
  extras: false,
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
      if (tag && !typed.has(tag) && !getTagSlotFromOverrides(tag, overrides)?.slot) out.add(tag)
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

/**
 * True when `longer` says everything `shorter` does: a qualified form of it
 * ("lace bra" and "bra"), or a garment it describes with a hyphenated adjective
 * ("off-shoulder sweater" and "off shoulder"). "blush stickers" is not "blush".
 */
function implies(longer: string, shorter: string): boolean {
  if (longer === shorter) return false
  if (isQualifiedVariant(longer, shorter)) return true
  const words = shorter.split(' ')
  return words.length > 1 && longer.split(' ').includes(words.join('-'))
}

/**
 * A booru tags both "lace bra" and "bra", "off-shoulder sweater" and "off shoulder":
 * the shorter one says nothing the longer doesn't, so it goes. Tags in `fixed` are
 * never dropped.
 */
export function dropRedundantSceneTags(tags: readonly string[], fixed: readonly string[]): string[] {
  const kept = new Set(fixed)
  const spaced = tags.map(normalizeTagForPack)
  return tags.filter((tag, i) => kept.has(tag) || !spaced.some((other, j) => j !== i && implies(other, spaced[i])))
}

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
}

const isCast = (args: ScenePackArgs) => (args.castSize ?? 1) >= 2
/** The base's clothing is used: the option is on, there is some, and the pack has one character. */
const wearsBaseClothing = (args: ScenePackArgs) => !isCast(args) && args.settings.clothing === 'base' && (args.baseClothing?.length ?? 0) > 0
/** Every character wears what is pinned in their block, and nothing of the scene's. */
const wearsOwnOutfits = (args: ScenePackArgs) => isCast(args) && args.settings.clothing === 'own'

/** The tags every prompt keeps, in order: the character blocks, then the base's clothing when it is worn. */
function fixedTags(args: ScenePackArgs): string[] {
  if (!wearsBaseClothing(args)) return args.identity
  const own = new Set(args.identity)
  return [...args.identity, ...args.baseClothing!.filter((tag) => !own.has(tag))]
}

function composeOptions(args: ScenePackArgs, count: number, seed: number, disabled: readonly string[] | undefined): ComposeOptions {
  const { settings } = args
  const library = !isCast(args) && settings.clothing === 'library' && args.library && args.library.length > 0
  return {
    identity: fixedTags(args),
    subject: args.subject,
    mix: settings.mix,
    clothing: wearsBaseClothing(args) || wearsOwnOutfits(args) ? 'own' : library ? { library: args.library!.map((o) => o.tags) } : 'scene',
    scenery: settings.scenery,
    extras: settings.extras,
    count,
    seed,
    disabledSituations: disabled ? [...disabled] : undefined,
    overrides: args.overrides,
  }
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
  seen: Set<string>
  filter: NearDuplicateFilter
  sceneById: Map<number, Scene>
  situationOf: Map<number, string>
}

function finisher(pool: ScenePool, args: ScenePackArgs, seen: Set<string>, filter: NearDuplicateFilter): Finisher {
  const situationOf = new Map<number, string>()
  pool.situations.forEach((situation) => situation.sceneIds.forEach((id) => situationOf.set(id, situation.id)))
  return { pool, args, seen, filter, sceneById: new Map(pool.scenes.map((scene) => [scene.postId, scene])), situationOf }
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
  const owned = applySceneOwnership(composed.tags, composed.locked, args.never ?? [], args.overrides, !isCast(args))
  const cleaned = args.clean(owned, composed.locked)
  if (!cleaned) return null
  // One rule wherever the tags come from (character, base clothing, library, scene): a generic
  // tag next to a qualified form of the same thing gives way to it.
  // With a cast the blocks are different people: one's "long hair" is not redundant with another's "very long hair".
  const tags = dropRedundantSceneTags(cleaned.split(',').map((tag) => tag.trim()).filter(Boolean), isCast(args) ? composed.locked : [])
  const kept = dropDanglingReferences(tags, composed.locked, args.overrides)
  const prompt = finalizePackPrompt(kept.join(', '), alwaysAddFor(args.alwaysAdd, composed.locked, args.people))
  if (!prompt || f.seen.has(prompt) || !f.filter.tryAccept(prompt)) return null
  f.seen.add(prompt)
  const postId = composed.sources.skeleton
  const size = composed.aspect && args.resolution ? args.resolution(composed.aspect) : null
  const outfitId = args.settings.clothing === 'library' ? outfitOf(composed, args.library) : undefined
  return {
    prompt,
    values: [],
    ...(size ?? {}),
    ...(outfitId !== undefined ? { outfitId } : {}),
    scene: {
      postId,
      preview: f.sceneById.get(postId)?.preview,
      situation: f.situationOf.get(postId),
      donors: Array.from(new Set(Object.values(composed.sources).filter((id): id is number => id !== undefined))),
    },
  }
}

/**
 * Composed scenes for a pack of `count`, one at a time: up to a few more than asked,
 * so the duplicate filter has room. Only as many are composed as the pack takes.
 */
function composeForPack(pool: ScenePool, args: ScenePackArgs, count: number): Generator<ScenePrompt> {
  const overGenerate = Math.min(Math.max(count * 2, count + 4), MAX_PACK_OVERGENERATE)
  return composePackPrompts(pool, composeOptions(args, overGenerate, args.seed, args.disabledSituations))
}

/**
 * A pack of `args.count` prompts from `pool`. `shortBy` is how many are missing
 * (Faithful makes at most one prompt per scene).
 */
export function generateScenePack(pool: ScenePool, args: ScenePackArgs): { prompts: PackPrompt[]; shortBy: number } {
  const count = Math.max(0, Math.floor(args.count))
  if (count === 0) return { prompts: [], shortBy: 0 }
  const f = finisher(pool, args, new Set(), new NearDuplicateFilter(DEFAULT_SIMILARITY_THRESHOLD, fixedTags(args)))
  const prompts: PackPrompt[] = []
  for (const composed of composeForPack(pool, args, count)) {
    if (prompts.length >= count) break
    const prompt = finishOne(f, composed)
    if (prompt) prompts.push(prompt)
  }
  return { prompts, shortBy: count - prompts.length }
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
): Promise<{ prompts: PackPrompt[]; shortBy: number } | null> {
  const count = Math.max(0, Math.floor(args.count))
  if (count === 0) return { prompts: [], shortBy: 0 }
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
  return { prompts, shortBy: count - prompts.length }
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
