/**
 * Undo history for the brief. Pure: every function returns a new history and leaves
 * the one it received untouched. A change is applied at once and can be taken back;
 * the history keeps the brief as it was before each change, with the change's label.
 */
import { addCharacter, emptyBrief, briefTags, type PackBrief } from './brief'
import { normalizeTagForPack } from './pack-generator'

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
  const never: string[] = []
  for (const tag of defaults) {
    const name = normalizeTagForPack(tag)
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
