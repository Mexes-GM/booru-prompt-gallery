/**
 * Tag relations measured on Danbooru posts (public/tag-relations.json): which
 * general tags exclude each other, which tag requires another, and which tag
 * requires something of a taxonomy slot ("drinking" needs something in hand).
 *
 * Exclusions depend on the picture: with one person, two tags of the same slot
 * that almost never meet in one-person posts (standing / sitting, day / night);
 * with several people, only pairs that almost never meet in any post (one person
 * may stand while another sits). Each is measured per content rating.
 *
 * The file loads lazily and is cached (loadTagRelations); the functions below are
 * pure and work on the loaded data, so synchronous code can use it once it's in
 * (loadedTagRelations) and fall back to its own rules before.
 */

export type RelationRating = 'sfw' | 'questionable' | 'explicit' | 'both'

export interface RelationContext {
  /** People in the picture: 1 (or unknown) uses the one-person exclusions, 2 or more the general ones. */
  people: number
  /** The content rating; null or undefined takes every rating. */
  rating?: RelationRating | null
}

export interface TagRelations {
  tags: readonly string[]
  /** Tag (app spelling) to its index in `tags`. */
  index: ReadonlyMap<string, number>
  /** Exclusions: key `lo * 65536 + hi` (indices) to a bit per context. */
  excluded: ReadonlyMap<number, number>
  /** Bit of each context in `excluded`. */
  bits: Readonly<Record<string, number>>
  /** Tag index to the indices it requires. */
  requires: ReadonlyMap<number, readonly number[]>
  /** Tag index to the taxonomy slots it requires something of. */
  requiresSlot: ReadonlyMap<number, readonly string[]>
}

export interface TagRelationsFile {
  v: number
  contexts: string[]
  tags: string[]
  ex: number[]
  req: number[]
  reqSlot: Record<string, number[]>
}

/** The app's spelling of a tag: lower case, spaces for underscores, single spaces. */
export function relationKey(tag: string): string {
  return tag.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
}

const pairKey = (a: number, b: number) => (a < b ? a * 65536 + b : b * 65536 + a)

export function parseTagRelations(file: TagRelationsFile): TagRelations {
  if (!file || file.v !== 1 || !Array.isArray(file.tags) || !Array.isArray(file.ex)) throw new Error('Invalid tag-relations.json')
  const index = new Map<string, number>()
  file.tags.forEach((tag, i) => index.set(tag, i))
  const excluded = new Map<number, number>()
  for (let i = 0; i + 2 < file.ex.length; i += 3) excluded.set(pairKey(file.ex[i], file.ex[i + 1]), file.ex[i + 2])
  const requires = new Map<number, number[]>()
  for (let i = 0; i + 1 < file.req.length; i += 2) {
    const list = requires.get(file.req[i])
    if (list) list.push(file.req[i + 1])
    else requires.set(file.req[i], [file.req[i + 1]])
  }
  const requiresSlot = new Map<number, string[]>()
  for (const [slot, ids] of Object.entries(file.reqSlot ?? {})) {
    for (const id of ids) {
      const list = requiresSlot.get(id)
      if (list) list.push(slot)
      else requiresSlot.set(id, [slot])
    }
  }
  const bits: Record<string, number> = {}
  file.contexts.forEach((context, i) => { bits[context] = 1 << i })
  return { tags: file.tags, index, excluded, bits, requires, requiresSlot }
}

const RATING_CLASS: Record<RelationRating, string> = { sfw: 'sfw', questionable: 'q', explicit: 'e', both: 'both' }

/** The context's bit: one person or several, and the rating ('all' when unknown). */
export function contextBit(relations: TagRelations, context: RelationContext): number {
  const who = context.people >= 2 ? 'multi' : 'solo'
  const rating = context.rating ? RATING_CLASS[context.rating] : 'all'
  return relations.bits[`${who}:${rating}`] ?? 0
}

/** True when the data says `a` and `b` (almost) never go together in this context. */
export function excludes(relations: TagRelations, a: string, b: string, context: RelationContext): boolean {
  const ia = relations.index.get(relationKey(a))
  const ib = relations.index.get(relationKey(b))
  if (ia === undefined || ib === undefined || ia === ib) return false
  return ((relations.excluded.get(pairKey(ia, ib)) ?? 0) & contextBit(relations, context)) !== 0
}

/** Tags that `tag` requires ("skirt lift" requires "skirt"). */
export function requiredBy(relations: TagRelations, tag: string): string[] {
  const i = relations.index.get(relationKey(tag))
  return i === undefined ? [] : (relations.requires.get(i) ?? []).map((j) => relations.tags[j])
}

/** Taxonomy slots `tag` requires something of ("drinking" requires "equipment:handheld"). */
export function requiredSlots(relations: TagRelations, tag: string): string[] {
  const i = relations.index.get(relationKey(tag))
  return i === undefined ? [] : [...(relations.requiresSlot.get(i) ?? [])]
}

// ── Loading ──────────────────────────────────────────────────────────────────

let loaded: TagRelations | null = null
let loading: Promise<TagRelations | null> | null = null
const listeners = new Set<() => void>()

/** The relations once loaded, else null (callers then use their own rules). */
export function loadedTagRelations(): TagRelations | null {
  return loaded
}

/** Calls `listener` once the relations load; returns the unsubscribe. */
export function subscribeTagRelations(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** For tests and scripts: sets (or clears) the loaded relations. */
export function setTagRelations(relations: TagRelations | null): void {
  loaded = relations
  listeners.forEach((listener) => listener())
}

/**
 * Loads public/tag-relations.json once (later calls share the request and the
 * result). Resolves to null when it fails; a later call tries again.
 */
export function loadTagRelations(url = '/tag-relations.json'): Promise<TagRelations | null> {
  if (loaded) return Promise.resolve(loaded)
  if (loading) return loading
  loading = fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`tag-relations.json: HTTP ${res.status}`)
      return res.json()
    })
    .then((file: TagRelationsFile) => {
      setTagRelations(parseTagRelations(file))
      return loaded
    })
    .catch((err) => {
      console.warn('Tag relations failed to load; using the built-in conflict rules:', err)
      return null
    })
    .finally(() => {
      loading = null
    })
  return loading
}
