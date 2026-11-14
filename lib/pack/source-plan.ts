/**
 * The source plan: which booru searches a pack's posts come from, worked out from
 * the brief. Scene searches give the pool the engine takes scenes from; appearance
 * searches read a named character's usual look from posts that show them alone,
 * for when the pool is not theirs.
 *
 * Only what the brief asks the characters to do (`SceneRequests.select`) goes in a
 * scene search: clothes, places and the rest are imposed later by the engine and
 * would only shrink the pool. Garments and places met as conditions get searches of
 * their own (`donors`): posts of anyone that meet them, which only lend that part to
 * the scenes (ScenePackArgs.donorPosts). Every search fits the booru's tag limit, and a
 * requested tag that doesn't fit is reported in `leftOut`, never dropped quietly.
 *
 * Pure: no React, no requests.
 */
import type { BooruProvider } from '../booru/types'
import { getProviderTagLimit, processTagsForAPI } from '../booru/tag-limits'
import type { PackRatingMode } from '../../hooks/use-pack-seed-search'
import { toSceneRequests, type PackBrief } from './brief'
import { normalizeTagForPack } from './pack-generator'
import { castPeople, compositionQuery, type CastRole } from './scene/cast'
import type { PackPeople } from './scene/scene-pool'

/**
 * What a scene search looks for, in the order the plan prefers them:
 *  - own: the base character's posts, alone ("name, solo") or with the first requested pose ("name, pose");
 *  - group: pictures with the same mix of people (a cast, or a head count the user set);
 *  - gallery: the gallery's search, for a character without a name (a pasted prompt);
 *  - theme: the requested poses (and the head count, when there is one), without any name;
 *  - anchor: the first pose alone, for when `theme` asks for several at once and finds few posts.
 */
export type SceneSearchKind = 'own' | 'group' | 'gallery' | 'theme' | 'anchor'

export interface PlannedSearch {
  /** Stable across plans while the search is the same: use it as the feed and cache key. */
  id: string
  /** Tags as the booru spells them (underscores). */
  tags: string[]
  /** `tags` joined with ", ", the form the post feeds take. */
  query: string
}

export interface SceneSearch extends PlannedSearch {
  kind: SceneSearchKind
  /** The requested poses (brief spelling) this search asks for. */
  poses: string[]
}

export interface AppearanceSearch extends PlannedSearch {
  /** The character, as the brief spells it. */
  character: string
  /** One rating, the plan's first. */
  ratingFilter: string
  /** Most-liked posts first, the same read the cast's looks use. Takes one tag slot on Danbooru-like boorus. */
  order: 'popular'
}

/**
 * A search for the posts that meet a condition (SceneRequests.conditions): every garment met as a
 * condition together ('wearing'), or every place ('where'), without any name or head count. Its
 * posts lend that part only: the hook passes the ids of the posts it brought and no scene search
 * did as ScenePackArgs.donorPosts. Fetched at one rating, the plan's first.
 */
export interface DonorSearch extends PlannedSearch {
  kind: 'wearing' | 'where'
  /** The conditions it asks for (brief spelling). */
  conditions: string[]
  /** The one rating it is fetched at (the plan's first). */
  ratingFilter: string
}

export interface LeftOutTag {
  tag: string
  /** A requested pose, a tag of the gallery's search (unnamed character), or a condition (garment or place). */
  from: 'pose' | 'gallery-search' | 'condition'
  reason: 'tag-limit'
}

export interface SourcePlan {
  provider: BooruProvider
  rating: PackRatingMode
  /** Rating filters; every scene search is fetched once per rating. */
  ratings: string[]
  /**
   * For a safe pack, whether sensitive posts are drawn from: 'unavailable' where the
   * booru has no separate sensitive rating (e621). Null for other ratings.
   */
  sensitive: 'included' | 'excluded' | 'unavailable' | null
  /** Scene searches, preferred first. Never empty, at most MAX_SCENE_SEARCHES. */
  scenes: SceneSearch[]
  /** One per named character whose look can't come from the pool. */
  appearance: AppearanceSearch[]
  /** Searches for the conditions' donors: at most MAX_DONOR_SEARCHES ('wearing' first). Empty without conditions. */
  donors: DonorSearch[]
  /** Requested tags no scene search could hold. */
  leftOut: LeftOutTag[]
  /** The head count the scene searches ask for, or null (the character's own posts, or any). */
  people: PackPeople | null
  /** A cast whose roles aren't all known yet: the base character's own search stands in until they are. */
  rolesPending: boolean
  /** Changes only when the scene searches or the ratings do: a new value means new posts to fetch. */
  sceneKey: string
  /** Changes only when the appearance searches do. */
  appearanceKey: string
  /** Changes only when the donor searches do ('' without them). */
  donorKey: string
  /** All of the above (without donor searches, the scene and appearance keys only, as before). */
  key: string
}

export interface SourcePlanEnv {
  provider: BooruProvider
  rating: PackRatingMode
  /** The saved "include sensitive" preference; only read for a safe pack. */
  includeSensitive: boolean
  /**
   * Roles of the named characters, in brief order (from castMemberRole). A missing or
   * null entry falls back to the role set in the brief.
   */
  roles?: ReadonlyArray<CastRole | null | undefined>
  /** The gallery's current search: the source an unnamed character starts from. */
  gallerySearch?: string
  /**
   * Tags of the brief's Wearing and Where met as conditions: the same list the hook passes the engine
   * as SceneRequests.conditions. Each kind gets a donor search. Missing or empty: none.
   */
  conditions?: readonly string[]
  /**
   * The compositions a pack mixes (ScenePackArgs.compositions), when two or more: no search asks
   * for a head count (one count would leave the others out). The scene searches are those of a
   * single character: its own posts by name (without "solo") with no pose, the pose without any
   * count with one. One or missing: the plan as before.
   */
  compositions?: ReadonlyArray<PackPeople>
}

/** Most scene searches a plan has (own, theme, anchor). */
export const MAX_SCENE_SEARCHES = 3
/** Most ratings a plan fetches ("both", or safe with sensitive). */
export const MAX_RATINGS = 2
/** Feeds a hook needs to run any plan: one per scene search and rating. */
export const MAX_FEEDS = MAX_SCENE_SEARCHES * MAX_RATINGS
/** Most donor searches a plan has (one for the garments, one for the places). */
export const MAX_DONOR_SEARCHES = 2
/** Feeds a hook needs for the donor searches: one rating each (planDonorFeeds). */
export const MAX_DONOR_FEEDS = MAX_DONOR_SEARCHES

/** Booru spelling of a brief tag. */
const toBooru = (tag: string) => tag.trim().replace(/\s+/g, '_')

/**
 * True for a metatag the booru doesn't count against its limit ("rating:", "score:").
 * processTagsForAPI keeps free metatags and trims counted tags to the limit, so with
 * the whole Danbooru limit taken up front only a free tag survives.
 */
const isFreeTag = (tag: string) => processTagsForAPI(tag, 'danbooru', getProviderTagLimit('danbooru')) !== ''

const countedTags = (tags: readonly string[]) => tags.filter((tag) => !isFreeTag(tag)).length

const sceneSearch = (provider: BooruProvider, kind: SceneSearchKind, tags: string[], poses: string[]): SceneSearch => ({
  id: `scene|${provider}|${tags.join(' ')}`,
  tags,
  query: tags.join(', '),
  kind,
  poses,
})

/** The rating filters for a pack rating; a safe pack adds sensitive posts when asked and the booru has them. */
export function planRatings(
  rating: PackRatingMode,
  includeSensitive: boolean,
  provider: BooruProvider
): Pick<SourcePlan, 'ratings' | 'sensitive'> {
  switch (rating) {
    case 'sfw': {
      // e621 and e6ai have no sensitive tier: their "safe" (what rating:general maps to) is all there is.
      if (provider === 'e621' || provider === 'e6ai') return { ratings: ['rating:general'], sensitive: 'unavailable' }
      return includeSensitive
        ? { ratings: ['rating:general', 'rating:sensitive'], sensitive: 'included' }
        : { ratings: ['rating:general'], sensitive: 'excluded' }
    }
    case 'questionable': return { ratings: ['rating:questionable'], sensitive: null }
    case 'explicit': return { ratings: ['rating:explicit'], sensitive: null }
    case 'both': return { ratings: ['rating:questionable', 'rating:explicit'], sensitive: null }
  }
}

/** `lead` plus as many `poses` as the limit leaves room for; the rest come back apart. */
function fill(lead: string[], poses: readonly string[], limit: number): { tags: string[]; taken: string[]; rest: string[] } {
  const room = Number.isFinite(limit) ? Math.max(0, limit - countedTags(lead)) : poses.length
  const taken = poses.slice(0, room)
  return { tags: [...lead, ...taken.map(toBooru)], taken, rest: poses.slice(room) }
}

/** A character's solo posts for their look, within the limit left once the "popular" order takes its slot. */
function appearanceSearch(character: string, provider: BooruProvider, ratingFilter: string): AppearanceSearch {
  const limit = getProviderTagLimit(provider)
  const name = toBooru(character)
  // The same search the cast's looks use (characterSearchTags), less "solo" when the order
  // tag leaves no room for it: the booru client would drop it anyway. typicalLook keeps
  // only the posts that show the character alone either way.
  const tags = !Number.isFinite(limit) || limit - 1 >= 2 ? [name, 'solo'] : [name]
  return {
    id: `look|${provider}|${ratingFilter}|${tags.join(' ')}`,
    tags,
    query: tags.join(', '),
    character,
    ratingFilter,
    order: 'popular',
  }
}

/** The tags of the gallery's search that fit the limit, and those that don't. */
function gallerySearchTags(search: string, limit: number): { tags: string[]; rest: string[] } {
  const all = search.split(',').map((tag) => tag.trim()).filter(Boolean).map(toBooru)
  const tags: string[] = []
  const rest: string[] = []
  let used = 0
  for (const tag of all) {
    if (isFreeTag(tag)) tags.push(tag)
    else if (!Number.isFinite(limit) || used < limit) { tags.push(tag); used++ }
    else rest.push(tag)
  }
  return { tags, rest }
}

/** The head count of a cast, or the one the user set; null for one person. */
function groupPeople(brief: PackBrief, roles: ReadonlyArray<CastRole | null>): { people: PackPeople | null; rolesPending: boolean } {
  const set = brief.people
  if (set && set.girls + set.boys >= 2) return { people: { ...set }, rolesPending: false }
  if (roles.length < 2) return { people: null, rolesPending: false }
  if (roles.some((role) => !role)) return { people: null, rolesPending: true }
  return { people: castPeople(roles), rolesPending: false }
}

/** The lead tags (head count, pairing) of a group search with room for at least one pose. */
function groupLead(people: PackPeople, provider: BooruProvider, rating: PackRatingMode, firstPose: string | null): string[] {
  if (!firstPose) return compositionQuery(people, provider, '', rating).split(', ').filter(Boolean)
  const pose = toBooru(firstPose)
  // compositionQuery picks the lead that leaves room for one extra tag; the poses are
  // added here, so none is cut without being reported.
  return compositionQuery(people, provider, pose, rating).split(', ').filter((tag) => tag && tag !== pose)
}

/**
 * The plan for a brief. In preference order:
 *  - no pose asked: the character's own posts ("name, solo"), the cast's mix of people,
 *    or, for an unnamed character, the gallery's search;
 *  - poses asked: the base character with the first pose ("name, pose") when the brief
 *    names one character, then the poses without any name (with the head count of a
 *    cast), then the first pose alone when the theme search asks for several.
 * The first pose written is the anchor: it goes in every pose search, and later ones
 * fill the room the limit leaves. A named character's look is read from their own
 * solo posts whenever the pool is not their own.
 */
export function planSources(brief: PackBrief, env: SourcePlanEnv): SourcePlan {
  const { provider, rating } = env
  const limit = getProviderTagLimit(provider)
  const { ratings, sensitive } = planRatings(rating, env.includeSensitive, provider)

  const named = brief.who.filter((c): c is typeof c & { tag: string } => !!c.tag)
  const roles = named.map((c, i) => env.roles?.[i] ?? c.role ?? null)
  const mixed = (env.compositions?.length ?? 0) >= 2
  const group = groupPeople(brief, roles)
  // A mixed pack asks for no head count: every search reaches all its compositions.
  const people = mixed ? null : group.people
  const rolesPending = mixed ? false : group.rolesPending

  const seen = new Set<string>()
  const poses = toSceneRequests(brief).select.filter((tag) => {
    const key = normalizeTagForPack(tag)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
  const anchor = poses[0] ?? null
  const base = named[0]?.tag ?? null

  const scenes: SceneSearch[] = []
  const leftOut: LeftOutTag[] = []

  if (!anchor) {
    if (people) {
      scenes.push(sceneSearch(provider, 'group', groupLead(people, provider, rating, null), []))
    } else if (base) {
      scenes.push(sceneSearch(provider, 'own', mixed ? [toBooru(base)] : ownSoloTags(base, limit), []))
    } else {
      const { tags, rest } = gallerySearchTags(env.gallerySearch ?? '', limit)
      scenes.push(sceneSearch(provider, 'gallery', tags, []))
      rest.forEach((tag) => leftOut.push({ tag, from: 'gallery-search', reason: 'tag-limit' }))
    }
  } else {
    if (base && named.length === 1) {
      const own = fill([toBooru(base)], [anchor], limit)
      if (own.taken.length > 0) scenes.push(sceneSearch(provider, 'own', own.tags, own.taken))
    }
    const lead = people ? groupLead(people, provider, rating, anchor) : []
    const theme = fill(lead, poses, limit)
    scenes.push(sceneSearch(provider, 'theme', theme.tags, theme.taken))
    theme.rest.forEach((tag) => leftOut.push({ tag, from: 'pose', reason: 'tag-limit' }))
    if (theme.taken.length > 1) {
      const alone = fill(lead, [anchor], limit)
      scenes.push(sceneSearch(provider, 'anchor', alone.tags, alone.taken))
    }
  }

  // The pool is the base character's own only in the "name, solo" case; everyone else
  // (a cast waiting for its roles) still has their look read apart.
  const poolIsOwn = scenes.length === 1 && scenes[0].kind === 'own'
  const appearance = named
    .filter((_, i) => !(poolIsOwn && i === 0))
    .map((c) => appearanceSearch(c.tag, provider, ratings[0]))

  const donors = donorSearches(brief, env, ratings[0], limit, leftOut)
  const sceneKey = `${provider}|${ratings.join('+')}|${scenes.map((s) => s.id).join('||')}`
  const appearanceKey = appearance.map((s) => `${s.id}|${normalizeTagForPack(s.character)}`).join('||')
  const donorKey = donors.map((s) => s.id).join('||')
  return {
    provider,
    rating,
    ratings,
    sensitive,
    scenes,
    appearance,
    donors,
    leftOut,
    people,
    rolesPending,
    sceneKey,
    appearanceKey,
    donorKey,
    key: donorKey ? `${sceneKey}##${appearanceKey}##${donorKey}` : `${sceneKey}##${appearanceKey}`,
  }
}

/**
 * The donor searches of a brief: the garments of Wearing met as conditions, all in one search (a
 * donor must meet them together), and the places of Where, in another. The first tags written fill
 * the limit; the rest go to `leftOut` (from 'condition').
 */
function donorSearches(brief: PackBrief, env: SourcePlanEnv, ratingFilter: string, limit: number, leftOut: LeftOutTag[]): DonorSearch[] {
  const conditions = new Set((env.conditions ?? []).map(normalizeTagForPack).filter(Boolean))
  if (conditions.size === 0) return []
  const requests = toSceneRequests(brief)
  const out: DonorSearch[] = []
  for (const kind of ['wearing', 'where'] as const) {
    const seen = new Set<string>()
    const tags = requests[kind].filter((tag) => {
      const key = normalizeTagForPack(tag)
      if (!conditions.has(key) || seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (tags.length === 0) continue
    const { tags: query, taken, rest } = fill([], tags, limit)
    rest.forEach((tag) => leftOut.push({ tag, from: 'condition', reason: 'tag-limit' }))
    if (taken.length === 0) continue
    out.push({
      id: `donor|${env.provider}|${ratingFilter}|${query.join(' ')}`,
      tags: query,
      query: query.join(', '),
      kind,
      conditions: taken,
      ratingFilter,
    })
  }
  return out.slice(0, MAX_DONOR_SEARCHES)
}

/** The feeds of a plan's donor searches, one rating each, garments first. A hook runs them on MAX_DONOR_FEEDS slots of their own. */
export function planDonorFeeds(plan: Pick<SourcePlan, 'donors'>, sessionSeed: number): FeedSpec[] {
  return plan.donors.slice(0, MAX_DONOR_SEARCHES).map((search) => ({
    feedId: `${search.id}|${search.ratingFilter}`,
    searchId: search.id,
    query: search.query,
    ratingFilter: search.ratingFilter,
    seed: feedSeed(search.id, sessionSeed),
  }))
}

/** The tags of a character's own search: their name, and "solo" when the limit allows (characterSearchTags). */
function ownSoloTags(character: string, limit: number): string[] {
  const name = toBooru(character)
  return limit >= 2 ? [name, 'solo'] : [name]
}

/** One feed of a plan: a scene search at one rating. */
export interface FeedSpec {
  /** `<search id>|<rating>`. */
  feedId: string
  searchId: string
  query: string
  ratingFilter: string
  seed: number
}

export interface FeedSlot extends FeedSpec {
  /** False: the slot is unused and keeps the last spec it had, so it fetches nothing new. */
  active: boolean
}

/** A per-search seed: stable for a session, so a search that comes back finds its cached pages. */
export function feedSeed(searchId: string, sessionSeed: number): number {
  let hash = 0
  for (let i = 0; i < searchId.length; i++) hash = (Math.imul(hash, 31) + searchId.charCodeAt(i)) | 0
  return (sessionSeed + hash) >>> 0
}

/** The feeds a plan needs, preferred search first and its ratings in order. */
export function planFeeds(plan: Pick<SourcePlan, 'scenes' | 'ratings'>, sessionSeed: number): FeedSpec[] {
  return plan.scenes.slice(0, MAX_SCENE_SEARCHES).flatMap((search) =>
    plan.ratings.slice(0, MAX_RATINGS).map((ratingFilter) => ({
      feedId: `${search.id}|${ratingFilter}`,
      searchId: search.id,
      query: search.query,
      ratingFilter,
      seed: feedSeed(search.id, sessionSeed),
    }))
  )
}

/**
 * Places the wanted feeds in a fixed number of slots (hooks can't be called in a
 * loop). A feed already in a slot stays there, so its pages are kept; new feeds take
 * free slots. A slot left without a feed keeps its last spec: switching it to another
 * feed's query would make it reset that feed's pages, and to a new one, fetch it.
 * On the first call, unused slots copy the first feed (the same request, deduped).
 */
export function assignFeedSlots(prev: readonly FeedSlot[] | null, wanted: readonly FeedSpec[], count: number = MAX_FEEDS): FeedSlot[] {
  const slots: Array<FeedSlot | null> = prev
    ? Array.from({ length: count }, (_, i) => (prev[i] ? { ...prev[i], active: false } : null))
    : Array.from({ length: count }, () => null)
  const taken = new Set<number>()
  const placed = new Set<number>()

  wanted.slice(0, count).forEach((feed, w) => {
    const i = slots.findIndex((slot, j) => !taken.has(j) && slot?.feedId === feed.feedId)
    if (i < 0) return
    slots[i] = { ...feed, active: true }
    taken.add(i)
    placed.add(w)
  })
  wanted.slice(0, count).forEach((feed, w) => {
    if (placed.has(w)) return
    const i = slots.findIndex((_, j) => !taken.has(j))
    if (i < 0) return
    slots[i] = { ...feed, active: true }
    taken.add(i)
  })

  const filler: FeedSlot = wanted[0]
    ? { ...wanted[0], active: false }
    : { feedId: '', searchId: '', query: '', ratingFilter: 'rating:general', seed: 0, active: false }
  return slots.map((slot) => slot ?? { ...filler })
}
