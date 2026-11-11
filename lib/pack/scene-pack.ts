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
import { composePack, dropDanglingReferences, type ComposeOptions, type ScenePrompt } from './scene/scene-compose'
import { COUNT_TAG_RE, isCompositionPattern, type Permanence } from './scene/permanence'
import { normalizeRating, type Scene, type SceneRating, type TagKind } from './scene/scene'
import { isQualifiedVariant } from './character-identity'
import type { PackPeople, ScenePool } from './scene/scene-pool'

/** The pack's content rating (same values as the source dialog). */
export type ScenePackRating = 'sfw' | 'questionable' | 'explicit' | 'both'

/** What the user picks in the scenes panel; persisted with the builder config. */
export interface ScenePackSettings {
  mix: 'faithful' | 'remix'
  /** 'base': the base's own clothing in every prompt (offered only when the base has some). */
  clothing: 'scene' | 'library' | 'base'
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
  overrides: Record<string, string>
): string[] {
  const kept = new Set(fixed)
  const owned = fixed.map(normalizeTagForPack)
  const takenSlots = new Set(fixed.flatMap((tag) => slotsTakenBy(normalizeTagForPack(tag), overrides)))
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

/**
 * The "Always add" tags a prompt gets: all of them, as typed, except a people count
 * or pairing tag the prompt's own header doesn't have. The composition picked for
 * the pack decides who is in the picture.
 */
export function alwaysAddFor(alwaysAdd: readonly string[], header: readonly string[]): string[] {
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
  /** Tags that must not appear, nor their variants (removed chips, "Never include"). */
  never?: readonly string[]
  /** The base's clothing, for `settings.clothing === 'base'`. */
  baseClothing?: readonly string[]
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

/** The base's clothing is used: the option is on and there is some. */
const wearsBaseClothing = (args: ScenePackArgs) => args.settings.clothing === 'base' && (args.baseClothing?.length ?? 0) > 0

/** The tags every prompt keeps, in order: the character, then the base's clothing when it is worn. */
function fixedTags(args: ScenePackArgs): string[] {
  return wearsBaseClothing(args) ? Array.from(new Set([...args.identity, ...args.baseClothing!])) : args.identity
}

function composeOptions(args: ScenePackArgs, count: number, seed: number, disabled: readonly string[] | undefined): ComposeOptions {
  const { settings } = args
  const library = settings.clothing === 'library' && args.library && args.library.length > 0
  return {
    identity: fixedTags(args),
    subject: args.subject,
    mix: settings.mix,
    clothing: wearsBaseClothing(args) ? 'own' : library ? { library: args.library!.map((o) => o.tags) } : 'scene',
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
 *  3. tags a longer tag of the prompt already says;
 *  4. references left pointing at nothing (a garment the cleaner removed);
 *  5. "Always add" first, as typed;
 *  6. exact and near-duplicate filter.
 */
function finishOne(f: Finisher, composed: ScenePrompt): PackPrompt | null {
  const { args } = f
  const owned = applySceneOwnership(composed.tags, composed.locked, args.never ?? [], args.overrides)
  const cleaned = args.clean(owned, composed.locked)
  if (!cleaned) return null
  const tags = dropRedundantSceneTags(cleaned.split(',').map((tag) => tag.trim()).filter(Boolean), composed.locked)
  const kept = dropDanglingReferences(tags, composed.locked, args.overrides)
  const prompt = finalizePackPrompt(kept.join(', '), alwaysAddFor(args.alwaysAdd, composed.locked))
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
    scene: { postId, preview: f.sceneById.get(postId)?.preview, situation: f.situationOf.get(postId) },
  }
}

/** Composed scenes for a pack of `count`: a few more than asked, so the duplicate filter has room. */
function composeForPack(pool: ScenePool, args: ScenePackArgs, count: number): ScenePrompt[] {
  const overGenerate = Math.min(Math.max(count * 2, count + 4), MAX_PACK_OVERGENERATE)
  return composePack(pool, composeOptions(args, overGenerate, args.seed, args.disabledSituations)).prompts
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
  for (const item of composed) {
    if (prompts.length >= count) break
    if (Date.now() - started >= slice) {
      await control.pause()
      if (control.cancelled()) return null
      started = Date.now()
    }
    const prompt = finishOne(f, item)
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
