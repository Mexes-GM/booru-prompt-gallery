/**
 * Scene ideas: named scenes ("Beach day", "Christmas tree") a Pack Mode user can
 * add in one go. Each has the tags that make the scene (pinned in every prompt)
 * and tags that often come with it (dashed: the scene or the sampling decides).
 *
 * The list is public/scene-ideas.json, loaded once per page when the picker
 * first opens:
 *   { v: 1, scenes: [{ id, t: title, c: category, r: lowest rating, m?: month, k: tags, o?: optional tags }] }
 * Tags use spaces, as normalizeTagForPack writes them.
 */
import type { PackRatingMode } from '@/hooks/use-pack-seed-search'
import { normalizeTagForPack } from './pack-generator'
import { isBlockedTheme } from './scene/blocked'

export const SCENE_IDEAS_URL = '/scene-ideas.json'

/** general < sensitive < questionable < explicit: the lowest content rating a scene can be offered at. */
export type SceneIdeaRating = 'g' | 's' | 'q' | 'e'
export type SceneIdeaCategory = 'place' | 'activity' | 'occasion' | 'food' | 'situation' | 'fantasy' | 'adult'

export interface SceneIdea {
  id: string
  title: string
  category: SceneIdeaCategory
  rating: SceneIdeaRating
  /** Month of the year it belongs to (1–12), for seasonal scenes. */
  month?: number
  /** Tags that make the scene. */
  tags: string[]
  /** Tags that often come with it. */
  optional: string[]
}

const RATING_LEVEL: Record<SceneIdeaRating, number> = { g: 0, s: 1, q: 2, e: 3 }
/** Display order of the categories. */
export const SCENE_IDEA_CATEGORIES: readonly SceneIdeaCategory[] = ['place', 'activity', 'occasion', 'food', 'situation', 'fantasy', 'adult']
export const SCENE_IDEA_CATEGORY_LABELS: Record<SceneIdeaCategory, string> = {
  place: 'Places',
  activity: 'Activities',
  occasion: 'Occasions',
  food: 'Food',
  situation: 'Situations',
  fantasy: 'Fantasy',
  adult: 'Mature',
}

const isRating = (value: unknown): value is SceneIdeaRating => typeof value === 'string' && value in RATING_LEVEL
const isCategory = (value: unknown): value is SceneIdeaCategory =>
  typeof value === 'string' && (SCENE_IDEA_CATEGORIES as readonly string[]).includes(value)
const tagList = (value: unknown): string[] =>
  Array.isArray(value)
    ? Array.from(new Set(value.filter((tag): tag is string => typeof tag === 'string').map(normalizeTagForPack).filter(Boolean)))
    : []

/**
 * The scenes of a scene-ideas.json, without malformed entries and without any scene
 * a title or tag of which the block list catches (the export already leaves them out).
 */
export function parseSceneIdeas(raw: unknown): SceneIdea[] {
  const scenes = raw && typeof raw === 'object' && Array.isArray((raw as { scenes?: unknown }).scenes) ? (raw as { scenes: unknown[] }).scenes : []
  const out: SceneIdea[] = []
  for (const entry of scenes) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const tags = tagList(e.k)
    if (typeof e.id !== 'string' || typeof e.t !== 'string' || !isCategory(e.c) || !isRating(e.r) || tags.length === 0) continue
    const core = new Set(tags)
    const optional = tagList(e.o).filter((tag) => !core.has(tag))
    if ([e.t, ...tags, ...optional].some(isBlockedTheme)) continue
    const month = typeof e.m === 'number' && Number.isInteger(e.m) && e.m >= 1 && e.m <= 12 ? e.m : undefined
    out.push({ id: e.id, title: e.t, category: e.c, rating: e.r, ...(month ? { month } : {}), tags, optional })
  }
  return out
}

let task: Promise<SceneIdea[]> | null = null

/** The scene ideas, fetched once per page. A failed load resolves to [] and is tried again next time. */
export function loadSceneIdeas(fetcher: typeof fetch = fetch): Promise<SceneIdea[]> {
  task ??= fetcher(SCENE_IDEAS_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`${SCENE_IDEAS_URL}: HTTP ${res.status}`)
      return res.json()
    })
    .then(parseSceneIdeas)
    .catch((err) => {
      console.warn('Scene ideas failed to load:', err)
      task = null
      return []
    })
  return task
}

/**
 * The highest scene rating a pack allows: an SFW pack (rating:general) only general
 * scenes; a questionable one up to questionable; explicit or both, every scene. With
 * no rating known, only general.
 */
export function maxSceneIdeaRating(rating: PackRatingMode | null): SceneIdeaRating {
  switch (rating) {
    case 'questionable': return 'q'
    case 'explicit':
    case 'both': return 'e'
    default: return 'g'
  }
}

/** Scenes the pack's rating allows. */
export function sceneIdeasForRating(ideas: readonly SceneIdea[], rating: PackRatingMode | null): SceneIdea[] {
  const max = RATING_LEVEL[maxSceneIdeaRating(rating)]
  return ideas.filter((idea) => RATING_LEVEL[idea.rating] <= max)
}

/** True for a scene of the given month (1–12). */
export const isInSeason = (idea: SceneIdea, month: number): boolean => idea.month === month

export interface SceneIdeaGroup {
  /** 'season' for this month's scenes, else the category. */
  key: 'season' | SceneIdeaCategory
  ideas: SceneIdea[]
}

/**
 * Scenes in display order, grouped: this month's scenes first (whatever their
 * category), then each category in SCENE_IDEA_CATEGORIES order; by title inside a group.
 */
export function groupSceneIdeas(ideas: readonly SceneIdea[], month: number): SceneIdeaGroup[] {
  const byTitle = (a: SceneIdea, b: SceneIdea) => a.title.localeCompare(b.title, 'en')
  const season = ideas.filter((idea) => isInSeason(idea, month)).sort(byTitle)
  const groups: SceneIdeaGroup[] = season.length > 0 ? [{ key: 'season', ideas: season }] : []
  for (const category of SCENE_IDEA_CATEGORIES) {
    const list = ideas.filter((idea) => idea.category === category && !isInSeason(idea, month)).sort(byTitle)
    if (list.length > 0) groups.push({ key: category, ideas: list })
  }
  return groups
}

/** The scenes in the order groupSceneIdeas shows them. */
export const sortSceneIdeas = (ideas: readonly SceneIdea[], month: number): SceneIdea[] =>
  groupSceneIdeas(ideas, month).flatMap((group) => group.ideas)

const words = (text: string): string[] => text.toLowerCase().replace(/[_-]+/g, ' ').split(/\s+/).filter(Boolean)

/**
 * Scenes matching a search: every word of the query starts a word of the title, a
 * tag or the category name ("xmas" finds nothing, "christ" finds "Christmas tree").
 * An empty query matches everything.
 */
export function searchSceneIdeas(ideas: readonly SceneIdea[], query: string): SceneIdea[] {
  const wanted = words(query)
  if (wanted.length === 0) return ideas.slice()
  return ideas.filter((idea) => {
    const haystack = [
      ...words(idea.title),
      ...idea.tags.flatMap(words),
      ...idea.optional.flatMap(words),
      ...words(SCENE_IDEA_CATEGORY_LABELS[idea.category]),
    ]
    return wanted.every((w) => haystack.some((h) => h.startsWith(w)))
  })
}

/** What adding a scene does to the chips: its own tags pinned, the rest dashed. */
export interface SceneIdeaChips {
  pinned: string[]
  /** Optional tags that aren't a trait already (an existing trait keeps its pin or dash). */
  dashed: string[]
}

export function sceneIdeaChips(idea: SceneIdea, added: readonly string[]): SceneIdeaChips {
  const existing = new Set(added)
  return { pinned: idea.tags.slice(), dashed: idea.optional.filter((tag) => !existing.has(tag)) }
}

/** A scene counts as added while every one of its own tags is an added trait. */
export function isSceneIdeaAdded(idea: SceneIdea, added: readonly string[]): boolean {
  const existing = new Set(added)
  return idea.tags.every((tag) => existing.has(tag))
}

/**
 * Tags to take back when a scene is removed: its tags and optional tags that are
 * added traits, except those another added scene also has.
 */
export function sceneIdeaRemoval(idea: SceneIdea, added: readonly string[], others: readonly SceneIdea[]): string[] {
  const existing = new Set(added)
  const shared = new Set(others.filter((o) => o.id !== idea.id).flatMap((o) => [...o.tags, ...o.optional]))
  return [...idea.tags, ...idea.optional].filter((tag) => existing.has(tag) && !shared.has(tag))
}
