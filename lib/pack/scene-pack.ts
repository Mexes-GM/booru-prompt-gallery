/**
 * Pack Mode's scenes engine as the builder uses it: the scene modules
 * (lib/pack/scene/) plus the steps every pack prompt goes through (the
 * user's prompt settings, "Always add", near-duplicate filter, suggested
 * size). Pure: the hook passes in the cleaner and the size preferences.
 *
 * Order of the steps for each composed scene:
 *   1. the cleaner (the same settings every card uses), with the header and
 *      identity locked so it never reorders or drops them;
 *   2. dropDanglingReferences, because the cleaner can drop a garment that a
 *      lifted / open / pulled tag still refers to;
 *   3. finalizePackPrompt ("Always add" first, exactly as typed);
 *   4. exact and near-duplicate filter.
 */
import type { BooruPost } from '../booru/types'
import { getTagSlotFromOverrides } from '../tag-taxonomy'
import { splitTags } from '../utils/tag-utils'
import { finalizePackPrompt } from './always-add'
import { MAX_PACK_OVERGENERATE, normalizeTagForPack, type PackPrompt } from './pack-generator'
import { NearDuplicateFilter, DEFAULT_SIMILARITY_THRESHOLD } from './prompt-similarity'
import { composePack, dropDanglingReferences, type ComposeOptions, type ScenePrompt } from './scene/scene-compose'
import { COUNT_TAG_RE, isCompositionPattern, type Permanence } from './scene/permanence'
import { normalizeRating, type SceneRating, type TagKind } from './scene/scene'
import type { PackPeople, ScenePool } from './scene/scene-pool'

/** The pack's content rating (same values as the source dialog). */
export type ScenePackRating = 'sfw' | 'questionable' | 'explicit' | 'both'

/** What the user picks in the scenes panel; persisted with the builder config. */
export interface ScenePackSettings {
  mix: 'faithful' | 'remix'
  clothing: 'scene' | 'library'
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

/**
 * The composition a pack uses: the user's pick while the pool has it, else the
 * most common one that includes someone of the character's gender, else the
 * most common one.
 */
export function defaultComposition(
  compositions: ReadonlyArray<{ people: PackPeople }>,
  subject: 'girl' | 'boy',
  picked?: PackPeople | null
): PackPeople | null {
  if (picked && compositions.some((c) => samePeople(c.people, picked))) return picked
  const fits = compositions.find((c) => (subject === 'girl' ? c.people.girls : c.people.boys) > 0)
  return fits?.people ?? compositions[0]?.people ?? null
}

/** Scenes the enabled situations hold. */
export function enabledSceneCount(pool: ScenePool, disabled: readonly string[]): number {
  const off = new Set(disabled)
  return pool.situations.reduce((sum, situation) => sum + (off.has(situation.id) ? 0 : situation.sceneIds.length), 0)
}

// ── Generation ────────────────────────────────────────────────────────────────

export interface LibraryOutfit {
  outfitId: number
  tags: string[]
}

export interface ScenePackArgs {
  /** Fixed tags of the character, without people counts (see splitSceneIdentity). */
  identity: string[]
  /** "Always add" tags, as typed. */
  alwaysAdd: readonly string[]
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

function composeOptions(args: ScenePackArgs, count: number, seed: number, disabled: readonly string[] | undefined): ComposeOptions {
  const { settings } = args
  const library = settings.clothing === 'library' && args.library && args.library.length > 0
  return {
    identity: args.identity,
    subject: args.subject,
    mix: settings.mix,
    clothing: library ? { library: args.library!.map((o) => o.tags) } : 'scene',
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

/** Turns composed scenes into finished pack prompts, skipping ones the filter rejects, up to `limit`. */
function finish(
  pool: ScenePool,
  composed: ScenePrompt[],
  args: ScenePackArgs,
  limit: number,
  seen: Set<string>,
  filter: NearDuplicateFilter
): PackPrompt[] {
  const sceneById = new Map(pool.scenes.map((scene) => [scene.postId, scene]))
  const situationOf = new Map<number, string>()
  pool.situations.forEach((situation) => situation.sceneIds.forEach((id) => situationOf.set(id, situation.id)))
  const out: PackPrompt[] = []
  for (const composedPrompt of composed) {
    if (out.length >= limit) break
    const cleaned = args.clean(composedPrompt.tags, composedPrompt.locked)
    if (!cleaned) continue
    const tags = cleaned.split(',').map((tag) => tag.trim()).filter(Boolean)
    const kept = dropDanglingReferences(tags, composedPrompt.locked, args.overrides)
    const prompt = finalizePackPrompt(kept.join(', '), args.alwaysAdd)
    if (!prompt || seen.has(prompt) || !filter.tryAccept(prompt)) continue
    seen.add(prompt)
    const postId = composedPrompt.sources.skeleton
    const size = composedPrompt.aspect && args.resolution ? args.resolution(composedPrompt.aspect) : null
    const outfitId = args.settings.clothing === 'library' ? outfitOf(composedPrompt, args.library) : undefined
    out.push({
      prompt,
      values: [],
      ...(size ?? {}),
      ...(outfitId !== undefined ? { outfitId } : {}),
      scene: { postId, preview: sceneById.get(postId)?.preview, situation: situationOf.get(postId) },
    })
  }
  return out
}

/**
 * A pack of `args.count` prompts from `pool`. Composes a few more scenes than
 * asked so the duplicate filter has room; `shortBy` is how many are missing
 * (Faithful makes at most one prompt per scene).
 */
export function generateScenePack(pool: ScenePool, args: ScenePackArgs): { prompts: PackPrompt[]; shortBy: number } {
  const count = Math.max(0, Math.floor(args.count))
  if (count === 0) return { prompts: [], shortBy: 0 }
  const overGenerate = Math.min(Math.max(count * 2, count + 4), MAX_PACK_OVERGENERATE)
  const { prompts: composed } = composePack(pool, composeOptions(args, overGenerate, args.seed, args.disabledSituations))
  const filter = new NearDuplicateFilter(DEFAULT_SIMILARITY_THRESHOLD, args.identity)
  const prompts = finish(pool, composed, args, count, new Set(), filter)
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
    const filter = new NearDuplicateFilter(DEFAULT_SIMILARITY_THRESHOLD, args.identity)
    others.forEach((prompt) => filter.tryAccept(prompt))
    const seen = new Set([...others, current.prompt])
    const [replacement] = finish(pool, composed, args, 1, seen, filter)
    if (replacement) return replacement
  }
  return null
}
