/**
 * Picking several characters at once for a pack: the most posted ones overall, or the ones of a
 * series, by gender, as a random draw from the top or most popular first.
 *
 * The characters come from a static index (public/character-index.json): every character the app
 * has a trait profile for (public/natural-traits/), with their series, how many posts they have,
 * their gender and, where Rule34 calls them something else, Rule34's name. Picking makes no
 * request, works the same on every site, and every character it gives can be drawn from their
 * profile without searching for their look (lib/pack/source-plan.ts MAX_LOOK_SEARCHES).
 *
 * Content rule: the index file leaves out every character the data marks as young (characterAllowed,
 * with the trait data, when the file is built). Reading it checks only each name and series against
 * the blocked themes. It also holds only known characters of a series (isKnownCharacter): no
 * original characters, no player's stand-ins.
 *
 * Pure: no React, no requests.
 */
import type { BooruProvider } from '../booru/types'
import { createSeededRng, normalizeTagForPack } from './pack-generator'
import type { CastRole } from './scene/cast'
import { isBlockedTheme } from './scene/blocked'

export const CHARACTER_INDEX_URL = '/character-index.json'
export const CHARACTER_INDEX_VERSION = 1

export interface IndexedCharacter {
  /** Danbooru's name, pack-normalized ("raiden shogun"). */
  tag: string
  /** The series they are from ("genshin impact"); null only in an index written by hand. */
  series: string | null
  /** Their posts on Danbooru when the index was built: the popularity order. */
  posts: number
  role: CastRole | null
  /** Rule34's name for them, when it differs from Danbooru's. */
  rule34?: string
}

export interface CharacterIndex {
  /** Most posted first. */
  characters: IndexedCharacter[]
  /** Every series with characters in the index, most posted first. */
  series: SeriesEntry[]
}

export interface SeriesEntry {
  name: string
  /** Characters of the series in the index. */
  characters: number
  posts: number
}

/** The file as stored: short rows, series by index. */
export interface StoredCharacterIndex {
  version: number
  /** Where the data comes from, for whoever opens the file. */
  source?: string
  series: string[]
  /** [tag, series index or -1, posts, 'g' | 'b' | '', rule34 name?] */
  characters: Array<[string, number, number, string] | [string, number, number, string, string]>
}

// ── Content rule ──────────────────────────────────────────────────────────────

export interface CharacterFacts {
  tag: string
  series?: string | null
  /** Tags the data says most of their posts carry (their core tags). */
  coreTags?: readonly string[]
  /** Their trait profile: tag -> share of their posts. */
  profile?: Readonly<Record<string, number>>
  /**
   * Share of their posts Danbooru tags as drawing someone young of their gender ("loli" for a girl,
   * "shota" for a boy, the larger of the two when the gender is unknown).
   */
  youngShare?: number
}

/** Least share of a character's posts a blocked tag must have in their profile to leave them out. */
export const BLOCKED_PROFILE_SHARE = 0.1

/**
 * Least `youngShare` that leaves a character out. Low on purpose: the characters drawn as young
 * reach it, and so do a few adults who are drawn small; leaving those out costs a pack nothing.
 */
export const YOUNG_SHARE = 0.015

/**
 * False for a character the data marks as young: a name or series that is a blocked theme
 * (lib/pack/scene/blocked.ts: "loli", "child", "young"...), a blocked tag among the tags most of
 * their posts carry or on at least BLOCKED_PROFILE_SHARE of them in their profile, or a
 * `youngShare` of at least YOUNG_SHARE. There is no age field in any of the data: a character
 * none of these mark is let through.
 */
export function characterAllowed(facts: CharacterFacts): boolean {
  if (isBlockedTheme(facts.tag) || (facts.series && isBlockedTheme(facts.series))) return false
  if (facts.coreTags?.some(isBlockedTheme)) return false
  if ((facts.youngShare ?? 0) >= YOUNG_SHARE) return false
  for (const [tag, share] of Object.entries(facts.profile ?? {})) {
    if (share >= BLOCKED_PROFILE_SHARE && isBlockedTheme(tag)) return false
  }
  return true
}

// ── Known characters ──────────────────────────────────────────────────────────

/**
 * A player's stand-in: a role the game or series gives the viewer ("admiral (kancolle)", "doctor
 * (arknights)", "trainer (umamusume)"), drawn as anyone. Not a character with a look of their own.
 */
const STAND_IN_RE = /^(admiral|doctor|trainer|commander|producer|captain|protagonist|sensei|master|player|manager)( \([^)]*\))+$/

/**
 * True for a character of a known series with a look of their own: not an original character (no
 * series, or "original"), and not a player's stand-in. The index keeps only these.
 */
export function isKnownCharacter(tag: string, series: string | null | undefined): boolean {
  if (!series || series === 'original') return false
  return !STAND_IN_RE.test(tag)
}

// ── Reading the index ─────────────────────────────────────────────────────────

const ROLE_OF: Record<string, CastRole> = { g: 'girl', b: 'boy' }

/** The index from its file, or null for anything else. Characters whose name or series is a blocked theme are dropped here too; the rest of the content rule was applied when the file was built. */
export function readCharacterIndex(raw: unknown): CharacterIndex | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Partial<StoredCharacterIndex>
  if (v.version !== CHARACTER_INDEX_VERSION || !Array.isArray(v.series) || !Array.isArray(v.characters)) return null
  const names = v.series.map((s) => (typeof s === 'string' ? normalizeTagForPack(s) : ''))
  const characters: IndexedCharacter[] = []
  const totals = new Map<string, SeriesEntry>()
  for (const row of v.characters) {
    if (!Array.isArray(row) || typeof row[0] !== 'string' || typeof row[2] !== 'number') continue
    const tag = normalizeTagForPack(row[0])
    const series = typeof row[1] === 'number' && row[1] >= 0 ? names[row[1]] || null : null
    if (!tag || !characterAllowed({ tag, series }) || !isKnownCharacter(tag, series)) continue
    const character: IndexedCharacter = { tag, series, posts: row[2], role: ROLE_OF[row[3] as string] ?? null }
    if (typeof row[4] === 'string' && row[4]) character.rule34 = normalizeTagForPack(row[4])
    characters.push(character)
    if (series) {
      const entry = totals.get(series) ?? { name: series, characters: 0, posts: 0 }
      entry.characters++
      entry.posts += character.posts
      totals.set(series, entry)
    }
  }
  characters.sort((a, b) => b.posts - a.posts || a.tag.localeCompare(b.tag))
  const series = [...totals.values()].sort((a, b) => b.posts - a.posts || a.name.localeCompare(b.name))
  return { characters, series }
}

let indexTask: Promise<CharacterIndex | null> | null = null

/** The index, fetched once per page life. Null when it can't be read. */
export function loadCharacterIndex(fetcher: typeof fetch = fetch): Promise<CharacterIndex | null> {
  indexTask ??= fetcher(CHARACTER_INDEX_URL)
    .then((res) => (res.ok ? res.json() : null))
    .then(readCharacterIndex)
    .catch(() => {
      indexTask = null
      return null
    })
  return indexTask
}

// ── Series lookup ─────────────────────────────────────────────────────────────

/**
 * Series whose name matches what was typed, best first: the whole name, then a name starting with
 * it, then one with a word starting with it ("impact" finds "genshin impact"); within each, the most
 * posted. Underscores and case don't matter. Empty under two letters.
 */
export function findSeries(index: Pick<CharacterIndex, 'series'>, query: string, limit = 8): SeriesEntry[] {
  const q = normalizeTagForPack(query)
  if (q.length < 2) return []
  const rank = (name: string): number => {
    if (name === q) return 0
    if (name.startsWith(q)) return 1
    if (name.split(/[\s:()/-]+/).some((word) => word.startsWith(q))) return 2
    if (name.includes(q)) return 3
    return -1
  }
  return index.series
    .map((entry) => ({ entry, rank: rank(entry.name) }))
    .filter((x) => x.rank >= 0)
    .sort((a, b) => a.rank - b.rank || b.entry.posts - a.entry.posts)
    .slice(0, limit)
    .map((x) => x.entry)
}

// ── Picking ───────────────────────────────────────────────────────────────────

export type CastSource = { kind: 'popular' } | { kind: 'series'; series: string }
export type CastGender = 'girls' | 'boys' | 'any'
export type CastOrder = 'random' | 'popular'

export interface CastQuery {
  source: CastSource
  gender: CastGender
  /** Names already in the pack: never picked again (any site's spelling). */
  exclude?: readonly string[]
}

/**
 * The characters a query can pick from, most posted first. "Any" gender keeps those whose gender
 * the data doesn't know; Girls and Boys only those it knows to be one.
 */
export function castCandidates(index: Pick<CharacterIndex, 'characters'>, query: CastQuery): IndexedCharacter[] {
  const excluded = new Set((query.exclude ?? []).map(normalizeTagForPack))
  const series = query.source.kind === 'series' ? normalizeTagForPack(query.source.series) : null
  const role: CastRole | null = query.gender === 'girls' ? 'girl' : query.gender === 'boys' ? 'boy' : null
  return index.characters.filter((c) =>
    (series === null || c.series === series)
    && (role === null || c.role === role)
    && !excluded.has(c.tag) && !(c.rule34 && excluded.has(c.rule34)))
}

/** How far down the list a random draw of `count` reaches: three times the count, and at least 24. */
export const drawReach = (count: number): number => Math.max(24, count * 3)

/**
 * `count` of the candidates (most posted first): the first ones ('popular'), or a random draw from
 * the top drawReach(count) ('random'), the same for the same seed. Either way they come back most
 * posted first: the first characters of a pack are the ones whose look is read from their posts.
 */
export function drawCast(candidates: readonly IndexedCharacter[], count: number, order: CastOrder, seed: number): IndexedCharacter[] {
  const n = Math.max(0, Math.min(Math.floor(count), candidates.length))
  if (order === 'popular' || n === candidates.length) return candidates.slice(0, n)
  const top = candidates.slice(0, Math.min(candidates.length, drawReach(n)))
  const rng = createSeededRng(seed)
  const picked: number[] = []
  const left = top.map((_, i) => i)
  for (let k = 0; k < n; k++) {
    const at = Math.floor(rng() * left.length)
    picked.push(left[at])
    left.splice(at, 1)
  }
  return picked.sort((a, b) => a - b).map((i) => top[i])
}

/** Danbooru-like sites name characters as Danbooru does; Rule34 has its own names for some. */
export function siteCharacterName(character: Pick<IndexedCharacter, 'tag' | 'rule34'>, provider: BooruProvider): string {
  return provider === 'rule34' && character.rule34 ? character.rule34 : character.tag
}

/** The characters as the pack takes them: their name on the pack's site and their gender. */
export function castMembers(picked: readonly IndexedCharacter[], provider: BooruProvider): Array<{ tag: string; role: CastRole | null }> {
  return picked.map((c) => ({ tag: siteCharacterName(c, provider), role: c.role }))
}
