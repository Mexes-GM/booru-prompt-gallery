/**
 * Undo history for the brief. Pure: every function returns a new history and leaves
 * the one it received untouched. A change is applied at once and can be taken back;
 * the history keeps the brief as it was before each change, with the change's label.
 */
import { addCharacter, briefTagName, emptyBrief, briefTags, readBriefTag, weightedTag, type PackBrief } from './brief'
import { normalizeTagForPack } from './pack-generator'
import type { PackPreferences } from '../storage'

export interface BriefChange { brief: PackBrief; label: string }
/** `past` is oldest first; each entry is the brief BEFORE a change, and that change's label. */
export interface BriefHistory { present: PackBrief; past: BriefChange[] }

export const HISTORY_LIMIT = 30

export function startHistory(brief: PackBrief): BriefHistory {
  return { present: brief, past: [] }
}

/** Structural equality that ignores key order and treats an undefined property as absent. */
function sameContent(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameContent(item, b[i]))
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    if (!sameContent(left[key], right[key])) return false
  }
  return true
}

/** Applies a change. When `next` has the same content as the present brief, nothing is recorded. */
export function commit(history: BriefHistory, next: PackBrief, label: string): BriefHistory {
  if (sameContent(history.present, next)) return history
  const past = [...history.past, { brief: history.present, label }]
  return { present: next, past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past }
}

/** Reverts the last change and says which one it was; without a past, returns the same history and null. */
export function undo(history: BriefHistory): { history: BriefHistory; undone: string | null } {
  const last = history.past[history.past.length - 1]
  if (!last) return { history, undone: null }
  return { history: { present: last.brief, past: history.past.slice(0, -1) }, undone: last.label }
}

/** The label of the change that undo would revert. */
export function lastChange(history: BriefHistory): string | null {
  return history.past[history.past.length - 1]?.label ?? null
}

/**
 * Starts the "never" list of a new pack with the user's defaults, except for tags the
 * brief itself asks for (a pasted prompt that carries one of them wins over the default).
 */
export function seedNever(brief: PackBrief, defaults: readonly string[]): PackBrief {
  const asked = new Set(briefTags(brief).map(normalizeTagForPack))
  // What the start already keeps out (a search's "-tag") stays, before the defaults.
  const never: string[] = []
  for (const tag of brief.never) {
    const name = briefTagName(tag)
    if (name && !never.includes(name)) never.push(name)
  }
  for (const tag of defaults) {
    const name = briefTagName(tag)
    if (name && !asked.has(name) && !never.includes(name)) never.push(name)
  }
  return { ...brief, never }
}

/**
 * The brief of a pack started from character names. The names enter as characters as
 * they are (nothing here asks the taxonomy, which may not know them yet): normalized,
 * without repeats, up to the cast limit. With no usable name, the unnamed character stays.
 */
export function briefFromCharacters(names: readonly string[]): PackBrief {
  return names.reduce(addCharacter, emptyBrief())
}

// ── Rows with defaults ───────────────────────────────────────────────────────

/**
 * The rows of the brief a user can give defaults: what every new pack starts with. Adding a row is
 * declaring it here (its preference and its tags in a brief).
 */
export const DEFAULT_ROWS = {
  never: { key: 'neverDefaults', tagsOf: (brief: PackBrief) => brief.never },
  // With the weight the brief gives each tag, as it was typed: a new pack starts with it.
  style: { key: 'styleDefaults', tagsOf: (brief: PackBrief) => brief.literal.map((t) => weightedTag(brief, t)) },
} as const satisfies Record<string, { key: keyof PackPreferences; tagsOf: (brief: PackBrief) => readonly string[] }>
export type DefaultRow = keyof typeof DEFAULT_ROWS

/** A row's defaults in the preferences ([] when none). */
export const rowDefaults = (prefs: PackPreferences, row: DefaultRow): string[] => [...(prefs[DEFAULT_ROWS[row].key] ?? [])]

/** The preferences with a row's defaults set to `tags` (sanitizePackPreferences cleans them). */
export function withRowDefaults(prefs: PackPreferences, row: DefaultRow, tags: readonly string[]): PackPreferences {
  return { ...prefs, [DEFAULT_ROWS[row].key]: [...tags] }
}

/** The preferences without `tag` in a row's defaults. */
export function withoutRowDefault(prefs: PackPreferences, row: DefaultRow, tag: string): PackPreferences {
  const name = briefTagName(tag)
  return withRowDefaults(prefs, row, rowDefaults(prefs, row).filter((t) => briefTagName(t) !== name))
}

/** True when a row of the brief holds exactly the row's defaults (same tags, any order). */
export function rowMatchesDefaults(brief: PackBrief, prefs: PackPreferences, row: DefaultRow): boolean {
  // The tag and its weight: "(masterpiece:1.2)" is not the same default as "masterpiece".
  const one = (tag: string) => {
    const { name, weight } = readBriefTag(tag)
    return weight === undefined || weight === 1 ? name : `${name}:${weight}`
  }
  const key = (tags: readonly string[]) => Array.from(new Set(tags.map(one))).sort().join('|')
  return key(DEFAULT_ROWS[row].tagsOf(brief)) === key(rowDefaults(prefs, row))
}

/**
 * Starts the Style row of a new pack with the user's defaults, as typed, after what the start
 * brought; a default the start already has, or keeps out (Never), is not added: the start wins.
 */
export function seedStyle(brief: PackBrief, defaults: readonly string[]): PackBrief {
  const asked = new Set([...briefTags(brief), ...brief.never].map(normalizeTagForPack))
  const literal = [...brief.literal]
  const weights = { ...(brief.weights ?? {}) }
  for (const tag of defaults) {
    // A default saved with a weight ("(masterpiece:1.2)") starts the pack with that weight.
    const { name, typed, weight } = readBriefTag(tag)
    if (name && !asked.has(name)) {
      literal.push(typed)
      asked.add(name)
      if (weight !== undefined && weight !== 1) weights[name] = weight
    }
  }
  if (literal.length === brief.literal.length) return brief
  return Object.keys(weights).length > 0 ? { ...brief, literal, weights } : { ...brief, literal }
}

/** A new pack's brief with every row's defaults: Never, then Style. */
export function seedDefaults(brief: PackBrief, prefs: PackPreferences): PackBrief {
  return seedStyle(seedNever(brief, prefs.neverDefaults), prefs.styleDefaults ?? [])
}
