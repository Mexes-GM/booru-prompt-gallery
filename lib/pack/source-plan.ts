/**
 * The source plan: which booru searches a pack's posts come from, worked out from
 * the brief. Scene searches give the pool the engine takes scenes from; appearance
 * searches read a named character's usual look from posts that show them alone,
 * whenever the pool doesn't only show them alone (`baseLookFromPool`).
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
import { castTurns, toSceneRequests, type PackBrief } from './brief'
import { normalizeTagForPack } from './pack-generator'
import { castPeople, compositionQuery, holdsCast, type CastRole } from './scene/cast'
import type { PackPeople } from './scene/scene-pool'

/**
 * What a scene search looks for, in the order the plan prefers them:
 *  - own: the base character's posts: alone ("name, solo"), by name only ("name": alone or with anyone),
 *    or with the first requested pose ("name, pose");
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
  /**
   * The composition this search asks for, in a pack that mixes several (one search per
   * composition of two or more). Missing elsewhere: the plan's `people` says it.
   */
  people?: PackPeople
  /** One per prompt in turn (castTurns), with nothing asked for: the character this own search is of (brief spelling). */
  character?: string
  /**
   * One per prompt in turn with clothes or a place asked for and no pose: the tag of Wearing or Where
   * this theme search looks for (brief spelling), so its posts are of that concept.
   */
  concept?: { role: 'wearing' | 'where'; tags: string[] }
  /**
   * One per prompt in turn with more characters than scene searches and nothing asked for: the one
   * search every character's scenes come from (anyone, alone when the pack has a one-person make-up).
   */
  everyone?: true
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

/** A scene search the plan wanted and had no room for: a pack runs at most MAX_SCENE_SEARCHES. */
export interface LeftOutSearch {
  kind: SceneSearchKind
  query: string
  /** The composition it would have asked for (a mixed pack's), or null. */
  people: PackPeople | null
  reason: 'search-limit'
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
  /**
   * One per named character whose look can't come from the pool (every one unless `baseLookFromPool`),
   * but past the first MAX_LOOK_SEARCHES of them, those with a trait profile (env.profiled): their
   * look comes from it, with no search.
   */
  appearance: AppearanceSearch[]
  /** The named characters (brief spelling) whose look comes from their trait profile, with no search. Missing when none. */
  lookFromProfile?: string[]
  /**
   * Whether the pool can give the base character's look: only when every scene search brings posts
   * of them alone. A search by name brings them with company too (other people's hair and eyes in
   * the same posts), and every plan with "name, solo" also has "name", so it is false for every
   * plan today, and their look comes from `appearance`.
   */
  baseLookFromPool: boolean
  /** Searches for the conditions' donors: at most MAX_DONOR_SEARCHES ('wearing' first). Empty without conditions. */
  donors: DonorSearch[]
  /** Requested tags no scene search could hold. */
  leftOut: LeftOutTag[]
  /** Scene searches past MAX_SCENE_SEARCHES, least preferred last. Empty but in a mixed pack with many compositions. */
  leftOutSearches: LeftOutSearch[]
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
   * The compositions a pack mixes (ScenePackArgs.compositions), in the order they were ticked,
   * when two or more. Each composition of two or more people gets the search a pack of only that
   * composition has (its head count, with the first pose when one is asked), between the
   * character's own search (alone, or with the pose) and the search that reaches every
   * composition (by name, or the pose without any count). The plan keeps MAX_SCENE_SEARCHES of
   * them in that order and reports the rest in `leftOutSearches`. One or missing: the plan as before.
   */
  compositions?: ReadonlyArray<PackPeople>
  /**
   * Whether each named character, in brief order, has a trait profile their look can be drawn from.
   * Past the first MAX_LOOK_SEARCHES characters, one with a profile gets no appearance search. A
   * missing entry counts as no profile.
   */
  profiled?: ReadonlyArray<boolean>
}

/**
 * Most characters whose look a plan reads from their own posts when the rest have a trait profile.
 * Every pack of up to MAX_CAST characters searches all of them, as before; past them (a pack of one
 * per prompt) a character's look comes from their profile, and only those without one are searched.
 */
export const MAX_LOOK_SEARCHES = 3

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

/**
 * Whether a plan with one named character and no pose also searches them alone ("name, solo"):
 * when the pack's compositions include one person (no head count set, one set, or a mix that has
 * one) and the booru's limit leaves room for both tags. A head count of two or more never gets
 * here (its own search).
 */
function soloSearchFits(env: SourcePlanEnv, mixed: boolean, limit: number): boolean {
  if (limit < 2) return false
  return !mixed || (env.compositions ?? []).some((people) => people.girls + people.boys === 1)
}

/** True when a scene search brings only posts of `character` alone: their own search with "solo". */
function showsAlone(search: SceneSearch, character: string): boolean {
  return search.kind === 'own' && search.tags[0] === toBooru(character) && search.tags.includes('solo')
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
 * The compositions of a mixed pack that get a search of their own: two or more people, room for
 * every named character (and for their roles, once all are known), each once, in the order given.
 */
function groupCompositions(compositions: ReadonlyArray<PackPeople>, roles: ReadonlyArray<CastRole | null>): PackPeople[] {
  const cast = roles.length > 0 && roles.every(Boolean) ? castPeople(roles) : null
  const out: PackPeople[] = []
  for (const people of compositions) {
    const size = people.girls + people.boys
    if (size < Math.max(2, roles.length)) continue
    if (cast && !holdsCast(people, cast)) continue
    if (out.some((have) => have.girls === people.girls && have.boys === people.boys)) continue
    out.push({ girls: people.girls, boys: people.boys })
  }
  return out
}

/**
 * The scene searches whose posts a pack uses first (ScenePackArgs.preferredPosts): the character's
 * own searches and, when the plan also has those, the searches of a mixed pack's compositions
 * without a pose. A composition's search stands for that composition as it would in a pack of
 * only that composition, which has no own search above it; placed after the own searches, its
 * posts would only be used once the character's own posts ran out, and the composition would get
 * almost none of the pack. A search with a pose ('theme') stays after the own one, as in a pack of
 * one composition. Without an own search, none: every post counts alike.
 */
export function preferredSearchIds(plan: Pick<SourcePlan, 'scenes'>): string[] {
  const own = plan.scenes.filter((s) => s.kind === 'own')
  if (own.length === 0) return []
  return plan.scenes.filter((s) => s.kind === 'own' || (s.kind === 'group' && !!s.people)).map((s) => s.id)
}

/**
 * The plan for a brief. In preference order:
 *  - no pose asked: the cast's mix of people (a cast, or a head count of two or more the user
 *    set); else, for one named character, their posts alone ("name, solo", which fills a pack of
 *    them alone quickly) whenever the pack's compositions include them alone (soloSearchFits),
 *    and their posts by name ("name": alone or with anyone, so the pool has every composition of
 *    theirs for the People line to offer); or, for an unnamed character, the gallery's search;
 *  - poses asked: the base character with the first pose ("name, pose") when the brief
 *    names one character, then the poses without any name (with the head count of a
 *    cast), then the first pose alone when the theme search asks for several.
 * The first pose written is the anchor: it goes in every pose search, and later ones
 * fill the room the limit leaves. A named character's look is read from their own
 * solo posts whenever the pool doesn't show only them alone.
 *
 * A pack that mixes compositions (env.compositions) asks for no head count in those searches,
 * and adds one search per composition of two or more people, built as a pack of only that
 * composition builds it, right after the character's own first search: without a pose,
 * "name, solo" (when the mix has them alone), each composition's group search in the order
 * ticked, then "name"; with a pose, "name, pose", each composition's theme search, then the
 * pose without any count (and the first pose alone). Past MAX_SCENE_SEARCHES the last ones go
 * to `leftOutSearches`.
 */
export function planSources(brief: PackBrief, env: SourcePlanEnv): SourcePlan {
  const { provider, rating } = env
  const limit = getProviderTagLimit(provider)
  const { ratings, sensitive } = planRatings(rating, env.includeSensitive, provider)

  const named = brief.who.filter((c): c is typeof c & { tag: string } => !!c.tag)
  if (castTurns(brief)) return planTurns(brief, env, named.map((c) => c.tag))
  const roles = named.map((c, i) => env.roles?.[i] ?? c.role ?? null)
  const mixed = (env.compositions?.length ?? 0) >= 2
  const group = groupPeople(brief, roles)
  // A mixed pack has no one head count: each of its compositions gets a search (mixGroups below).
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

  // A mixed pack's compositions of two or more people that can hold the cast, in the order ticked.
  const mixGroups = mixed ? groupCompositions(env.compositions ?? [], roles) : []
  const forGroup = (search: SceneSearch, group: PackPeople): SceneSearch => ({ ...search, people: { girls: group.girls, boys: group.boys } })

  // Every search the plan wants, preferred first; trimmed to MAX_SCENE_SEARCHES below.
  const wanted: Array<{ search: SceneSearch; galleryRest?: string[] }> = []
  if (!anchor) {
    if (people) {
      wanted.push({ search: sceneSearch(provider, 'group', groupLead(people, provider, rating, null), []) })
    } else {
      if (base && named.length === 1 && soloSearchFits(env, mixed, limit)) wanted.push({ search: sceneSearch(provider, 'own', [toBooru(base), 'solo'], []) })
      for (const group of mixGroups) wanted.push({ search: forGroup(sceneSearch(provider, 'group', groupLead(group, provider, rating, null), []), group) })
      if (base) {
        wanted.push({ search: sceneSearch(provider, 'own', [toBooru(base)], []) })
      } else {
        const { tags, rest } = gallerySearchTags(env.gallerySearch ?? '', limit)
        wanted.push({ search: sceneSearch(provider, 'gallery', tags, []), galleryRest: rest })
      }
    }
  } else {
    if (base && named.length === 1) {
      const own = fill([toBooru(base)], [anchor], limit)
      if (own.taken.length > 0) wanted.push({ search: sceneSearch(provider, 'own', own.tags, own.taken) })
    }
    // Each composition of a mixed pack: the theme search a pack of only that composition has.
    for (const group of mixGroups) {
      const own = fill(groupLead(group, provider, rating, anchor), poses, limit)
      wanted.push({ search: forGroup(sceneSearch(provider, 'theme', own.tags, own.taken), group) })
    }
    const lead = people ? groupLead(people, provider, rating, anchor) : []
    const theme = fill(lead, poses, limit)
    wanted.push({ search: sceneSearch(provider, 'theme', theme.tags, theme.taken) })
    if (theme.taken.length > 1) {
      const alone = fill(lead, [anchor], limit)
      wanted.push({ search: sceneSearch(provider, 'anchor', alone.tags, alone.taken) })
    }
  }

  return finishPlan(brief, env, { wanted, poses, people, rolesPending, ratings, sensitive, limit, base, named: named.map((c) => c.tag) })
}

/** The scene searches a plan keeps (MAX_SCENE_SEARCHES), what they leave out, and the rest of the plan around them. */
function finishPlan(brief: PackBrief, env: SourcePlanEnv, p: {
  wanted: Array<{ search: SceneSearch; galleryRest?: string[] }>
  poses: string[]
  people: PackPeople | null
  rolesPending: boolean
  ratings: string[]
  sensitive: SourcePlan['sensitive']
  limit: number
  /** The character the pool can give the look of when it shows only them alone; null: none. */
  base: string | null
  named: string[]
  /** Leaves out a donor search that asks what a scene search already does (its posts are in the pool). */
  dedupeDonors?: boolean
}): SourcePlan {
  const { provider, rating } = env
  const { wanted, poses, people, rolesPending, ratings, sensitive, limit, base } = p
  const scenes: SceneSearch[] = []
  const leftOut: LeftOutTag[] = []
  const leftOutSearches: LeftOutSearch[] = []
  for (const { search, galleryRest } of wanted) {
    // Two compositions can make the same search (the same lead on a booru with few tags): one is enough.
    if (scenes.some((s) => s.id === search.id)) continue
    if (scenes.length >= MAX_SCENE_SEARCHES) {
      leftOutSearches.push({ kind: search.kind, query: search.query, people: search.people ?? null, reason: 'search-limit' })
      continue
    }
    scenes.push(search)
    galleryRest?.forEach((tag) => leftOut.push({ tag, from: 'gallery-search', reason: 'tag-limit' }))
  }
  // A requested pose no search kept holds is reported, in the order written.
  const searched = new Set(scenes.flatMap((s) => s.poses))
  poses.filter((pose) => !searched.has(pose)).forEach((tag) => leftOut.push({ tag, from: 'pose', reason: 'tag-limit' }))

  // The pool gives the base character's look only when all of it shows them alone; everyone
  // else (a cast waiting for its roles) still has their look read apart.
  const baseLookFromPool = !!base && scenes.every((s) => showsAlone(s, base))
  // Random characters (PackBrief.randomCast) are all drawn from their profile: no look search at all.
  const fromProfile = (i: number) => !!brief.randomCast || (i >= MAX_LOOK_SEARCHES && !!env.profiled?.[i])
  const appearance = p.named
    .filter((_, i) => !(baseLookFromPool && i === 0) && !fromProfile(i))
    .map((tag) => appearanceSearch(tag, provider, ratings[0]))
  const lookFromProfile = p.named.filter((_, i) => fromProfile(i))

  const allDonors = donorSearches(brief, env, ratings[0], limit, leftOut)
  const donors = p.dedupeDonors ? allDonors.filter((d) => !scenes.some((s) => s.query === d.query)) : allDonors
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
    ...(lookFromProfile.length > 0 ? { lookFromProfile } : {}),
    baseLookFromPool,
    donors,
    leftOut,
    leftOutSearches,
    people,
    rolesPending,
    sceneKey,
    appearanceKey,
    donorKey,
    key: donorKey ? `${sceneKey}##${appearanceKey}##${donorKey}` : `${sceneKey}##${appearanceKey}`,
  }
}

/**
 * The plan of a pack with one character per prompt, in turn (castTurns). The scenes come from what
 * the pack asks for, not from any one character, searched as for a pack without a named character:
 *  - a pose: the theme search (and the first pose alone, when several), with the head count of
 *    People when it sets two or more, and each composition's theme search in a mixed pack;
 *  - no pose, but clothes or a place: a theme search for the first garment of Wearing (else the
 *    first place of Where), with the same head count; the conditions keep their donor searches, but
 *    one that asks the same as that search (its posts are already scenes);
 *  - nothing asked: each character's own search, alone ("name, solo") when the pack has a one-person
 *    make-up, else by name, in brief order; with more characters than MAX_SCENE_SEARCHES, one search
 *    for all of them instead (`everyone`: "solo", or the head count of People), so no character's
 *    scenes come from another's posts and the searches don't grow with the cast; the same for
 *    random characters (PackBrief.randomCast), which get no search of their own at all.
 * Every character's look is read from their own appearance search, but past MAX_LOOK_SEARCHES
 * (finishPlan).
 */
function planTurns(brief: PackBrief, env: SourcePlanEnv, named: string[]): SourcePlan {
  const { provider, rating } = env
  const limit = getProviderTagLimit(provider)
  const { ratings, sensitive } = planRatings(rating, env.includeSensitive, provider)
  const requests = toSceneRequests(brief)
  const seen = new Set<string>()
  const poses = requests.select.filter((tag) => {
    const key = normalizeTagForPack(tag)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
  const mixed = (env.compositions?.length ?? 0) >= 2
  const set = brief.people
  const people = !mixed && set && set.girls + set.boys >= 2 ? { girls: set.girls, boys: set.boys } : null
  // Each composition of two or more of a mixed pack, once: every prompt has one named person.
  const mixGroups: PackPeople[] = []
  for (const group of mixed ? env.compositions ?? [] : []) {
    if (group.girls + group.boys < 2 || mixGroups.some((g) => g.girls === group.girls && g.boys === group.boys)) continue
    mixGroups.push({ girls: group.girls, boys: group.boys })
  }
  const forGroup = (search: SceneSearch, group: PackPeople): SceneSearch => ({ ...search, people: { girls: group.girls, boys: group.boys } })

  const wanted: Array<{ search: SceneSearch }> = []
  const anchor = poses[0] ?? null
  const conceptRole: 'wearing' | 'where' | null = requests.wearing.length > 0 ? 'wearing' : requests.where.length > 0 ? 'where' : null
  const conceptTag = conceptRole ? requests[conceptRole][0] : null
  if (anchor) {
    for (const group of mixGroups) {
      const own = fill(groupLead(group, provider, rating, anchor), poses, limit)
      wanted.push({ search: forGroup(sceneSearch(provider, 'theme', own.tags, own.taken), group) })
    }
    const lead = people ? groupLead(people, provider, rating, anchor) : []
    const theme = fill(lead, poses, limit)
    wanted.push({ search: sceneSearch(provider, 'theme', theme.tags, theme.taken) })
    if (theme.taken.length > 1) {
      const alone = fill(lead, [anchor], limit)
      wanted.push({ search: sceneSearch(provider, 'anchor', alone.tags, alone.taken) })
    }
  } else if (conceptRole && conceptTag) {
    const concept = (lead: string[]): SceneSearch | null => {
      const theme = fill(lead, [conceptTag], limit)
      return theme.taken.length > 0 ? { ...sceneSearch(provider, 'theme', theme.tags, []), concept: { role: conceptRole, tags: theme.taken } } : null
    }
    for (const group of mixGroups) {
      const search = concept(groupLead(group, provider, rating, conceptTag))
      if (search) wanted.push({ search: forGroup(search, group) })
    }
    const search = concept(people ? groupLead(people, provider, rating, conceptTag) : [])
    if (search) wanted.push({ search })
  }
  if (wanted.length === 0) {
    // Nothing to search the scenes by: each character's own posts.
    const onePerson = mixed ? (env.compositions ?? []).some((g) => g.girls + g.boys === 1) : !people
    const alone = limit >= 2 && onePerson
    if (named.length > MAX_SCENE_SEARCHES || brief.randomCast) {
      // More characters than searches, or random ones: one search the scenes of all of them come from.
      for (const group of mixGroups) wanted.push({ search: { ...forGroup(sceneSearch(provider, 'theme', groupLead(group, provider, rating, null), []), group), everyone: true } })
      const lead = people ? groupLead(people, provider, rating, null) : onePerson ? ['solo'] : []
      if (lead.length > 0 || wanted.length === 0) wanted.push({ search: { ...sceneSearch(provider, 'theme', lead, []), everyone: true } })
    } else {
      for (const tag of named) {
        wanted.push({ search: { ...sceneSearch(provider, 'own', alone ? [toBooru(tag), 'solo'] : [toBooru(tag)], []), character: tag } })
      }
    }
  }
  return finishPlan(brief, env, { wanted, poses, people, rolesPending: false, ratings, sensitive, limit, base: null, named, dedupeDonors: true })
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
