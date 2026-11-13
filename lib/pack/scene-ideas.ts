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
import { isCompositionPattern } from './scene/permanence'

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

/**
 * Optional tags a search matched through, for the words the title, the scene's own
 * tags and the category don't explain ("tray" finds "Pouring tea" by its "tray").
 */
export function matchedOptionalTags(idea: SceneIdea, query: string): string[] {
  const wanted = words(query)
  if (wanted.length === 0) return []
  const main = [...words(idea.title), ...idea.tags.flatMap(words), ...words(SCENE_IDEA_CATEGORY_LABELS[idea.category])]
  const unexplained = wanted.filter((w) => !main.some((h) => h.startsWith(w)))
  return idea.optional.filter((tag) => words(tag).some((h) => unexplained.some((w) => h.startsWith(w))))
}

/**
 * The scenes the picker offers: those the pack's rating allows, each title once. A
 * title with entries at several ratings ("Library shelves" is general, questionable
 * and explicit) shows the highest one the rating allows: the general one in an SFW
 * pack, the explicit one in an explicit pack.
 */
export function offeredSceneIdeas(ideas: readonly SceneIdea[], rating: PackRatingMode | null): SceneIdea[] {
  const best = new Map<string, SceneIdea>()
  for (const idea of sceneIdeasForRating(ideas, rating)) {
    const key = idea.title.trim().toLowerCase()
    const current = best.get(key)
    if (!current || RATING_LEVEL[idea.rating] > RATING_LEVEL[current.rating]) best.set(key, idea)
  }
  return Array.from(best.values())
}

/** A scene chip: pinned (every prompt), dashed (the scene or the sampling decides) or removed (never). */
export type SceneIdeaChipState = 'pinned' | 'scene' | 'removed'

export interface SceneIdeaChip {
  tag: string
  state: SceneIdeaChipState
  /** One of the scene's own tags (pinned by default), else one that often comes with it (dashed). */
  core: boolean
}

/**
 * The chips of an added scene: its own tags pinned and the others dashed unless the
 * user chose otherwise. People counts ("solo focus") are left out: who is in the
 * picture is chosen apart.
 */
export function sceneIdeaChips(idea: SceneIdea, stateOf: (tag: string) => SceneIdeaChipState | undefined): SceneIdeaChip[] {
  const out: SceneIdeaChip[] = []
  const seen = new Set<string>()
  const add = (tag: string, core: boolean) => {
    if (seen.has(tag) || isCompositionPattern(tag)) return
    seen.add(tag)
    out.push({ tag, core, state: stateOf(tag) ?? (core ? 'pinned' : 'scene') })
  }
  idea.tags.forEach((tag) => add(tag, true))
  idea.optional.forEach((tag) => add(tag, false))
  return out
}

/** What the added scenes mean for the prompts. */
export interface ActiveSceneIdeas {
  /** Tags in every prompt. */
  pinned: string[]
  /** Tags the scene or the sampling decides (Classic: its category's pool). */
  dashed: string[]
  /** Tags the user removed: in no prompt. */
  never: string[]
  /** The scenes' own tags still in use: Scenes prefers donor posts that have one. */
  core: string[]
}

export const NO_ACTIVE_SCENE_IDEAS: ActiveSceneIdeas = { pinned: [], dashed: [], never: [], core: [] }

/**
 * The added scenes' tags by state. A scene above the pack's rating (added before the
 * rating changed) has no effect; a tag that is one scene's own and another's optional
 * is pinned by default.
 */
export function activeSceneIdeas(
  applied: readonly SceneIdea[],
  stateOf: (tag: string) => SceneIdeaChipState | undefined,
  rating: PackRatingMode | null
): ActiveSceneIdeas {
  const inRating = sceneIdeasForRating(applied, rating)
  if (inRating.length === 0) return NO_ACTIVE_SCENE_IDEAS
  const coreTags = new Set(inRating.flatMap((idea) => idea.tags))
  const states = new Map<string, SceneIdeaChipState>()
  for (const idea of inRating) {
    for (const chip of sceneIdeaChips(idea, stateOf)) {
      const state = stateOf(chip.tag) ?? (coreTags.has(chip.tag) ? 'pinned' : 'scene')
      states.set(chip.tag, state)
    }
  }
  const of = (state: SceneIdeaChipState) => Array.from(states).filter(([, s]) => s === state).map(([tag]) => tag)
  return {
    pinned: of('pinned'),
    dashed: of('scene'),
    never: of('removed'),
    core: Array.from(coreTags).filter((tag) => states.has(tag) && states.get(tag) !== 'removed'),
  }
}

/**
 * The added scenes a method uses. `scenery` is the Scenery setting of that method:
 * Scenes' option ('picked' is "Pick a scene"), Classic's category state ('keep',
 * 'vary', 'off'). Scenes uses them only on Pick a scene; Classic unless its Scenery
 * category is Off. Otherwise they stay added but put nothing in the prompts (no
 * pinned, dashed or removed tag), and apply again when the setting comes back.
 */
export function sceneIdeasInUse(engine: 'scenes' | 'classic', scenery: string | undefined, active: ActiveSceneIdeas): ActiveSceneIdeas {
  const on = engine === 'classic' ? scenery !== 'off' : scenery === 'picked'
  return on ? active : NO_ACTIVE_SCENE_IDEAS
}

/** Tags whose chip state can be forgotten when a scene goes: those no other added scene has. */
export function sceneIdeaOwnTags(idea: SceneIdea, others: readonly SceneIdea[]): string[] {
  const shared = new Set(others.filter((o) => o.id !== idea.id).flatMap((o) => [...o.tags, ...o.optional]))
  return [...idea.tags, ...idea.optional].filter((tag) => !shared.has(tag))
}
