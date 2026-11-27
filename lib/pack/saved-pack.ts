/**
 * The pack of the new builder, kept in the browser so a reload brings it back: the brief, the rows
 * of results (text, locks, size) and how the pack was made (seed, slots, re-rolls, source). Never
 * the posts or the pool: those are fetched again. One pack: the current one.
 *
 * Pure: the caller reads and writes storage (userPreferences.getSavedPack / setSavedPack). A
 * stored value of another version, or one that doesn't read as a pack, is dropped; one too large
 * keeps the brief without the results.
 */
import type { BooruProvider } from '../booru/types'
import type { PackPrompt } from './pack-generator'
import type { BriefOutfit } from './brief-pack'
import type { ChangesAxis, PackBrief, RequestRole } from './brief'
import type { ScenePackIssue } from './scene-pack'

export const SAVED_PACK_VERSION = 1
/**
 * Characters of the stored JSON. A pack of 50 prompts takes a fraction of it (see
 * __tests__/pack-saved.verify.ts); the browser holds about 5 MB for the whole site.
 */
export const SAVED_PACK_MAX_CHARS = 400_000

/** How the pack was made, without the pool (PackMade in hooks/use-pack-brief-scenes.ts). */
export interface SavedMade {
  seed: number
  genCount: number
  preferredPosts: number[]
  lockedScenes: number[]
  skipScenes?: number[]
  slots: number[]
  baseScene?: number
  rerolls: Array<{ index: number; seed: number; slot?: number }>
  sourceKey: string
  /** One character per prompt: the character of each prompt the engine made, in order. */
  turns?: string[]
}

export interface SavedResult {
  prompts: PackPrompt[]
  locked: number[]
  shortBy: number
  issues: ScenePackIssue[]
  count: number
  made: SavedMade
  /** The brief the prompts were made from, when it isn't the pack's brief (the prompts are out of date). */
  brief?: PackBrief
  /** The outfit choice the prompts were made with, when it isn't the pack's. */
  outfit?: BriefOutfit
}

export interface SavedPack {
  version: typeof SAVED_PACK_VERSION
  savedAt: number
  brief: PackBrief
  outfit: BriefOutfit
  provider: BooruProvider
  gallerySearch: string
  result: SavedResult | null
  /** The results didn't fit: the brief was kept without them. */
  resultsDropped?: true
}

export type SavedPackInput = Omit<SavedPack, 'version' | 'savedAt' | 'resultsDropped'>

/** The pack's results as the builder holds them (BriefPackResult), the pool included. */
export interface LiveResult {
  prompts: PackPrompt[]
  locked: number[]
  shortBy: number
  issues: ScenePackIssue[]
  count: number
  brief: PackBrief
  outfit: BriefOutfit
  made: {
    seed: number
    genCount: number
    preferredPosts: readonly number[]
    lockedScenes: readonly number[]
    skipScenes?: readonly number[]
    slots: readonly number[]
    baseScene?: number
    rerolls: ReadonlyArray<{ index: number; seed: number; slot?: number }>
    sourceKey: string
    turns?: readonly string[]
  }
}

const sameJson = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)

/** What is kept of the results: everything but the pool; the brief and outfit only when they differ from the pack's. */
export function savedResultOf(result: LiveResult, brief: PackBrief, outfit: BriefOutfit): SavedResult {
  const m = result.made
  const made: SavedMade = {
    seed: m.seed,
    genCount: m.genCount,
    preferredPosts: [...m.preferredPosts],
    lockedScenes: [...m.lockedScenes],
    ...(m.skipScenes ? { skipScenes: [...m.skipScenes] } : {}),
    slots: [...m.slots],
    ...(m.baseScene !== undefined ? { baseScene: m.baseScene } : {}),
    rerolls: m.rerolls.map((r) => ({ ...r })),
    sourceKey: m.sourceKey,
    ...(m.turns ? { turns: [...m.turns] } : {}),
  }
  return {
    prompts: result.prompts,
    locked: result.locked,
    shortBy: result.shortBy,
    issues: result.issues,
    count: result.count,
    made,
    ...(sameJson(result.brief, brief) ? {} : { brief: result.brief }),
    ...(sameJson(result.outfit, outfit) ? {} : { outfit: result.outfit }),
  }
}

/**
 * The value to store, within `max` characters of JSON: without the results when the whole pack
 * doesn't fit (`resultsDropped`); null when even the brief doesn't.
 */
export function savedPackToStore(pack: SavedPackInput, now: number, max: number = SAVED_PACK_MAX_CHARS): SavedPack | null {
  const whole: SavedPack = { version: SAVED_PACK_VERSION, savedAt: now, ...pack }
  if (JSON.stringify(whole).length <= max) return whole
  const lean: SavedPack = { ...whole, result: null, resultsDropped: true }
  return JSON.stringify(lean).length <= max ? lean : null
}

// ── Reading ──────────────────────────────────────────────────────────────────

const PROVIDERS: readonly string[] = ['danbooru', 'aibooru', 'rule34', 'e621', 'e6ai', 'gelbooru']
const ROLES: readonly string[] = ['wearing', 'doing', 'where', 'also']
const CHANGES: readonly string[] = ['scene', 'outfit', 'pose', 'place', 'expression']
const OUTFITS: readonly string[] = ['scene', 'usual', 'official', 'library']

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string')
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isNumbers = (v: unknown): v is number[] => Array.isArray(v) && v.every(isNum)
const isPeople = (v: unknown) => isObj(v) && isNum(v.girls) && isNum(v.boys)
const optional = (v: unknown, test: (v: unknown) => boolean) => v === undefined || test(v)

function isBrief(v: unknown): v is PackBrief {
  if (!isObj(v)) return false
  const who = v.who
  if (!Array.isArray(who) || who.length === 0) return false
  if (!who.every((c) => isObj(c) && (c.tag === null || typeof c.tag === 'string') && isStrings(c.addedLook) && isStrings(c.removedLook)
    && optional(c.role, (r) => r === 'girl' || r === 'boy'))) return false
  if (!Array.isArray(v.requests) || !v.requests.every((r) => isObj(r) && typeof r.tag === 'string' && ROLES.includes(r.role as RequestRole)
    && optional(r.exact, (x) => x === true) && optional(r.ambience, (x) => x === true))) return false
  return isStrings(v.never) && isStrings(v.literal) && isStrings(v.others) && isStrings(v.leftOut)
    && (v.people === null || isPeople(v.people))
    && CHANGES.includes(v.changes as ChangesAxis)
    && optional(v.baseScene, isNum)
    && optional(v.leftOutVariants, isStrings)
    && optional(v.outfitStyles, isStrings)
    && optional(v.outfitDetail, (d) => d === 'simple' || d === 'full')
    && optional(v.peopleMix, (m) => Array.isArray(m) && m.every(isPeople))
    && optional(v.castMode, (m) => m === 'together' || m === 'turns')
    && optional(v.randomCast, isRandomCast)
}

const GENDERS: readonly string[] = ['girls', 'boys', 'any', 'auto']

function isRandomCast(v: unknown): boolean {
  if (!isObj(v) || !GENDERS.includes(v.gender as string) || !Array.isArray(v.drawn)) return false
  const source = v.source
  const sourceOk = isObj(source) && (source.kind === 'popular' || (source.kind === 'series' && typeof source.series === 'string'))
  return sourceOk && v.drawn.every((m) => isObj(m) && typeof m.tag === 'string' && optional(m.role, (r) => r === null || r === 'girl' || r === 'boy'))
}

function isOutfit(v: unknown): v is BriefOutfit {
  return isObj(v) && OUTFITS.includes(v.kind as string) && (v.kind !== 'official' || typeof v.name === 'string')
}

function isMade(v: unknown): v is SavedMade {
  return isObj(v) && isNum(v.seed) && isNum(v.genCount) && isNumbers(v.preferredPosts) && isNumbers(v.lockedScenes)
    && optional(v.skipScenes, isNumbers) && isNumbers(v.slots) && optional(v.baseScene, isNum) && typeof v.sourceKey === 'string'
    && optional(v.turns, isStrings)
    && Array.isArray(v.rerolls) && v.rerolls.every((r) => isObj(r) && isNum(r.index) && isNum(r.seed) && optional(r.slot, isNum))
}

function isPrompt(p: unknown): p is PackPrompt {
  return isObj(p) && typeof p.prompt === 'string' && isStrings(p.values)
    && optional(p.width, isNum) && optional(p.height, isNum)
    && optional(p.scene, (s) => isObj(s) && isNum(s.postId))
    && optional(p.character, (c) => typeof c === 'string')
}

function isResult(v: unknown): v is SavedResult {
  return isObj(v) && Array.isArray(v.prompts) && v.prompts.every(isPrompt)
    && isNumbers(v.locked) && v.locked.every((i) => i >= 0 && i < (v.prompts as unknown[]).length)
    && isNum(v.shortBy) && Array.isArray(v.issues) && v.issues.every((i) => isObj(i) && typeof i.kind === 'string')
    && isNum(v.count) && isMade(v.made)
    && optional(v.brief, isBrief) && optional(v.outfit, isOutfit)
}

/** The stored pack, or null for anything else: another version, a broken value, a pack of no use. */
export function readSavedPack(v: unknown): SavedPack | null {
  if (!isObj(v) || v.version !== SAVED_PACK_VERSION || !isNum(v.savedAt)) return null
  if (!isBrief(v.brief) || !isOutfit(v.outfit) || !PROVIDERS.includes(v.provider as string) || typeof v.gallerySearch !== 'string') return null
  if (v.result !== null && !isResult(v.result)) return null
  return v as unknown as SavedPack
}

/** Prompts the saved pack holds: what a new pack would replace (0 for none). */
export function savedPackPromptCount(saved: SavedPack | null): number {
  return saved?.result?.prompts.length ?? 0
}
