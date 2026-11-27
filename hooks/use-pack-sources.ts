"use client"

/**
 * Runs a source plan (lib/pack/source-plan.ts): fetches every scene search at
 * every rating and returns their posts joined, without repeats, preferred search
 * first. Same paging, pacing and failure handling as usePackSeedSearch, which it
 * builds on (useSingleRatingFeed), plus where each post came from and how far each
 * search has got.
 *
 * Hooks can't be called in a loop, so the plan runs on a fixed MAX_FEEDS feeds
 * (MAX_SCENE_SEARCHES searches x MAX_RATINGS ratings). assignFeedSlots keeps a feed
 * in the same slot from one plan to the next, so a search the new plan still has
 * keeps its pages and fetches nothing; an unused slot keeps its last query and stays
 * quiet. A search's random seed is fixed for the hook's life, so a search that
 * comes back after an edit finds its cached pages.
 *
 * Each search pages on its own (lib/pack/source-paging.ts): it runs out when the site
 * says so or when a page brings it nothing new, and the next page goes to the search
 * that can bring most. A page the pace doesn't allow yet waits for it and goes by itself
 * (`waiting`); nothing is refused.
 *
 * Every request goes at the site's Pack pace (lib/booru/request-pacer.ts) and counts in
 * the pack's one budget (lib/pack/request-budget.ts): the first page of each search, the
 * later pages and the page counts, a page of a two-rating search as two requests. The
 * budget lasts as long as the hook: a change of plan doesn't start a new one.
 *
 * The plan's donor searches (SourcePlan.donors) run on MAX_DONOR_FEEDS slots of their own, one
 * rating each; their posts come after the scene searches'. A donor search brings its first page;
 * it pages further only while its condition is short of different forms for the pack
 * (`shortConditions`): its posts are never scenes, so past that its pages are better spent on
 * the scene searches.
 *
 * A change of plan keeps the posts already loaded that still count: a post a search of the
 * plan before brought stays when it fits a search of the new plan (lib/pack/source-fit.ts: same
 * site, one of the plan's ratings, every tag the search asks for). It counts as that search's,
 * ahead of the pages the search brings itself, and a donor search's posts stay donors. The rest
 * go. The new searches page from the start; a page that brings nothing beyond the posts kept for
 * them ends them, as any page with nothing new does.
 *
 * Mount timing is the same as usePackSeedSearch's: this hook fetches page 1 of
 * every search on mount and has no "enabled" flag; mount the component that calls
 * it only when the pack should fetch.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import type { BooruPost } from "@/lib/api-client"
import { MAX_DONOR_FEEDS, assignFeedSlots, planDonorFeeds, planFeeds, type DonorSearch, type FeedSlot, type SceneSearchKind, type SourcePlan } from "@/lib/pack/source-plan"
import { useSingleRatingFeed, type UsePackSeedSearchResult } from "./use-pack-seed-search"
import { sitePacer } from "@/lib/booru/request-pacer"
import { PackRequestBudget, requestCaps } from "@/lib/pack/request-budget"
import { NO_PAGING, nextSearch, recordPage, searchEnded, type SearchPaging } from "@/lib/pack/source-paging"
import { firstFittingSearch, postFitsSearch, postTagSet, type LoadedPost } from "@/lib/pack/source-fit"
import type { BooruProvider } from "@/lib/booru/types"

export interface PackSourceProgress {
  /** The search's id (SceneSearch.id, or DonorSearch.id). */
  id: string
  kind: SceneSearchKind | DonorSearch["kind"]
  /** A donor search: its posts only lend clothes ('wearing') or a place ('where'). */
  donor: boolean
  /** Posts this search has brought, without repeats (some may also be in a preferred search). */
  posts: number
  /** Posts it brought that no search before it in the plan had. */
  adds: number
  /** Of `posts`, those a search the plan had before a change loaded (they fit this one): counted in, not fetched again. */
  earlier: number
  /** Pages that have arrived (per rating). */
  pages: number
  loading: boolean
  /** The search has run out: the site said so, or a page brought it nothing new. */
  exhausted: boolean
  failed: boolean
}

export interface UsePackSourcesArgs {
  plan: SourcePlan
  /**
   * The conditions (Wearing, Where) the pack is short of different forms of, for its prompt
   * count (shortConditionRoles): only their donor searches page past their first page.
   */
  shortConditions?: readonly DonorSearch["kind"][]
  /** Called once when the session's request cap is reached. The hook shows nothing itself. */
  onSessionCapReached?: () => void
}

export interface UsePackSourcesResult extends UsePackSeedSearchResult {
  /** The search each post in allPosts came from: the most preferred one that has it. */
  originOf: ReadonlyMap<number, string>
  /** One per scene search, in the plan's order. */
  searches: PackSourceProgress[]
  /** Asks for the next page; true when one was asked for (it may wait for the pace limit first). */
  loadMore: () => boolean
  /** A page is waiting for the pace limit and goes by itself. */
  waiting: boolean
  /** Pages that have arrived, all searches together (each rating's page once). */
  pages: number
  /** Requests the pack's source has sent, all searches and ratings together (its budget so far). */
  requests: number
  /**
   * Requests the pack may send by itself, compared with `requests`: requestCaps for the plan's
   * ratings plus the page-range requests sent, which the automatic cap leaves out. Past it, only by hand.
   */
  autoRequestCap: number
}

type Feed = ReturnType<typeof useSingleRatingFeed>

/** A post loaded for the pack, and the feeds (FeedSpec.feedId) that brought it. */
interface Remembered extends LoadedPost {
  post: BooruPost
  sceneFeeds: readonly string[]
  donorFeeds: readonly string[]
}
type Memory = ReadonlyMap<string, Remembered>

/** A feed of the plan in use, with its posts. */
interface LiveFeed {
  feedId: string
  donor: boolean
  ratingFilter: string
  posts: readonly BooruPost[]
}

const NO_SHORT: readonly DonorSearch["kind"][] = []

const memoryKey = (provider: BooruProvider, id: number) => `${provider}|${id}`

/** `memory` with the posts of the live feeds it doesn't have yet (or not from that feed); null when nothing is new. */
function rememberLive(memory: Memory, live: readonly LiveFeed[], provider: BooruProvider): Map<string, Remembered> | null {
  let next: Map<string, Remembered> | null = null
  for (const feed of live) {
    for (const post of feed.posts) {
      if (!post) continue
      const key = memoryKey(provider, post.id)
      const had: Remembered | undefined = (next ?? memory).get(key)
      if (had && (feed.donor ? had.donorFeeds : had.sceneFeeds).includes(feed.feedId)) continue
      next ??= new Map(memory)
      const base: Remembered = had ?? { post, tags: postTagSet(post), provider, ratings: [], sceneFeeds: [], donorFeeds: [] }
      next.set(key, {
        ...base,
        ratings: base.ratings.includes(feed.ratingFilter) ? base.ratings : [...base.ratings, feed.ratingFilter],
        sceneFeeds: feed.donor ? base.sceneFeeds : [...base.sceneFeeds, feed.feedId],
        donorFeeds: feed.donor ? [...base.donorFeeds, feed.feedId] : base.donorFeeds,
      })
    }
  }
  return next
}

/**
 * The remembered posts a feed of an earlier plan brought, by the search of this plan each one
 * fits first (scene searches, then donor searches, as `allSearches`), and the keys of those that
 * fit none and aren't in a live feed either: they go.
 */
function carryOver(memory: Memory, active: ReadonlySet<string>, plan: SourcePlan): { bySearch: BooruPost[][]; drop: string[] } {
  const scenes = plan.scenes.map((): BooruPost[] => [])
  const donors = plan.donors.map((): BooruPost[] => [])
  const drop: string[] = []
  const scenePlan = { provider: plan.provider, ratings: plan.ratings }
  memory.forEach((entry, key) => {
    let keep = entry.sceneFeeds.some((f) => active.has(f)) || entry.donorFeeds.some((f) => active.has(f))
    if (entry.sceneFeeds.some((f) => !active.has(f))) {
      const i = firstFittingSearch(entry, plan.scenes, scenePlan)
      if (i >= 0) {
        scenes[i].push(entry.post)
        keep = true
      }
    }
    // A donor's posts stay donors: only a donor search of this plan keeps them.
    if (entry.donorFeeds.some((f) => !active.has(f))) {
      const i = plan.donors.findIndex((d) => postFitsSearch(entry, d, { provider: plan.provider, ratings: [d.ratingFilter] }))
      if (i >= 0) {
        donors[i].push(entry.post)
        keep = true
      }
    }
    if (!keep) drop.push(key)
  })
  return { bySearch: [...scenes, ...donors], drop }
}

/** A rating feed's posts interleaved with the others of its search, so no rating outweighs the rest. */
function interleave(lists: readonly BooruPost[][]): BooruPost[] {
  const out: BooruPost[] = []
  const max = Math.max(0, ...lists.map((l) => l.length))
  for (let i = 0; i < max; i++) for (const list of lists) if (list[i]) out.push(list[i])
  return out
}

export function usePackSources({ plan, shortConditions = NO_SHORT, onSessionCapReached }: UsePackSourcesArgs): UsePackSourcesResult {
  const { provider, sceneKey, donorKey } = plan
  // Every search the hook runs: the scene searches, then the donor searches.
  const feedKey = `${sceneKey}##${donorKey}`
  const [sessionSeed] = useState(() => Date.now())
  // One budget for the pack, whatever plans it goes through.
  const [{ budget, record }] = useState(() => {
    const budget = new PackRequestBudget()
    return { budget, record: (n: number) => budget.record(n) }
  })
  const spent = useSyncExternalStore(budget.subscribe, budget.getSnapshot, budget.getSnapshot)
  const rangeSpent = useSyncExternalStore(budget.subscribe, budget.getRangeSnapshot, budget.getRangeSnapshot)
  const feedOptions = useMemo(() => ({ budget }), [budget])
  // Its caps follow the plan's ratings: a page is one request per rating (lib/pack/request-budget.ts).
  // The automatic cap leaves the page-range requests out: it grows by as many as were sent.
  const { auto: autoPageCap, session: sessionRequestCap } = requestCaps(plan.ratings.length)
  const autoRequestCap = autoPageCap + rangeSpent

  // The plan's feeds change only with its scene key.
  const wanted = useMemo(
    () => planFeeds(plan, sessionSeed),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sceneKey, sessionSeed]
  )

  // Slots follow the plan during render (React's "adjust state while rendering"), so
  // the feeds below get their new queries in the same render the plan changes.
  const [slotState, setSlotState] = useState<{ key: string; slots: FeedSlot[] }>(() => ({ key: sceneKey, slots: assignFeedSlots(null, wanted) }))
  let slots = slotState.slots
  if (slotState.key !== sceneKey) {
    slots = assignFeedSlots(slotState.slots, wanted)
    setSlotState({ key: sceneKey, slots })
  }

  const feed0 = useSingleRatingFeed(slots[0].query, slots[0].ratingFilter, provider, slots[0].seed, feedOptions)
  const feed1 = useSingleRatingFeed(slots[1].query, slots[1].ratingFilter, provider, slots[1].seed, feedOptions)
  const feed2 = useSingleRatingFeed(slots[2].query, slots[2].ratingFilter, provider, slots[2].seed, feedOptions)
  const feed3 = useSingleRatingFeed(slots[3].query, slots[3].ratingFilter, provider, slots[3].seed, feedOptions)
  const feed4 = useSingleRatingFeed(slots[4].query, slots[4].ratingFilter, provider, slots[4].seed, feedOptions)
  const feed5 = useSingleRatingFeed(slots[5].query, slots[5].ratingFilter, provider, slots[5].seed, feedOptions)

  // The donor searches' slots, kept the same way.
  const wantedDonors = useMemo(
    () => planDonorFeeds(plan, sessionSeed),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [donorKey, sessionSeed]
  )
  const [donorState, setDonorState] = useState<{ key: string; slots: FeedSlot[] }>(() => ({ key: donorKey, slots: assignFeedSlots(null, wantedDonors, MAX_DONOR_FEEDS) }))
  let donorSlots = donorState.slots
  if (donorState.key !== donorKey) {
    donorSlots = assignFeedSlots(donorState.slots, wantedDonors, MAX_DONOR_FEEDS)
    setDonorState({ key: donorKey, slots: donorSlots })
  }
  // An unused donor slot asks for nothing: it keeps the query of a scene slot that runs anyway.
  const donorSpec = (i: number) => (donorSlots[i].active || donorSlots[i].query ? donorSlots[i] : slots[0])
  const feed6 = useSingleRatingFeed(donorSpec(0).query, donorSpec(0).ratingFilter, provider, donorSpec(0).seed, feedOptions)
  const feed7 = useSingleRatingFeed(donorSpec(1).query, donorSpec(1).ratingFilter, provider, donorSpec(1).seed, feedOptions)
  const feeds: Feed[] = [feed0, feed1, feed2, feed3, feed4, feed5, feed6, feed7]
  const allSearches = useMemo(
    () => [
      ...plan.scenes.map((search) => ({ id: search.id, kind: search.kind as PackSourceProgress["kind"], donor: false })),
      ...plan.donors.map((search) => ({ id: search.id, kind: search.kind as PackSourceProgress["kind"], donor: true })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feedKey]
  )

  // Callers needn't pass a stable callback.
  const capCallbackRef = useRef(onSessionCapReached)
  useEffect(() => { capCallbackRef.current = onSessionCapReached }, [onSessionCapReached])

  // Each search's slots, in rating order (a donor search's one slot is after the scene slots).
  const slotsBySearch = useMemo(() => [
    ...plan.scenes.map((search) =>
      plan.ratings.map((rating) => slots.findIndex((s) => s.active && s.searchId === search.id && s.ratingFilter === rating)).filter((i) => i >= 0)),
    ...plan.donors.map((search) => {
      const i = donorSlots.findIndex((s) => s.active && s.searchId === search.id)
      return i >= 0 ? [slots.length + i] : []
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [feedKey, slots, donorSlots])

  const postLists = useMemo(
    () => [feed0.allPosts, feed1.allPosts, feed2.allPosts, feed3.allPosts, feed4.allPosts, feed5.allPosts, feed6.allPosts, feed7.allPosts],
    [feed0.allPosts, feed1.allPosts, feed2.allPosts, feed3.allPosts, feed4.allPosts, feed5.allPosts, feed6.allPosts, feed7.allPosts]
  )

  // ── Posts loaded for the pack, kept across a change of plan while they fit it ──
  // Remembered while rendering, as the paging below: every post of the plan's live feeds, with
  // where and at which rating it was fetched.
  const [memory, setMemory] = useState<Memory>(() => new Map())
  const liveFeeds = useMemo<LiveFeed[]>(() => [
    ...slots.flatMap((slot, i) => (slot.active ? [{ feedId: slot.feedId, donor: false, ratingFilter: slot.ratingFilter, posts: postLists[i] }] : [])),
    ...donorSlots.flatMap((slot, i) => (slot.active ? [{ feedId: slot.feedId, donor: true, ratingFilter: slot.ratingFilter, posts: postLists[slots.length + i] }] : [])),
  ], [slots, donorSlots, postLists])
  const activeFeeds = useMemo(() => new Set(liveFeeds.map((f) => f.feedId)), [liveFeeds])
  const remembered = useMemo(() => rememberLive(memory, liveFeeds, provider), [memory, liveFeeds, provider])
  const carried = useMemo(
    () => carryOver(memory, activeFeeds, plan),
    // The plan's searches, ratings and site are all in its keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [memory, activeFeeds, feedKey]
  )
  if (remembered || carried.drop.length > 0) {
    const next = remembered ?? new Map(memory)
    // A post dropped as left over that a live feed has just brought again stays.
    carried.drop.forEach((key) => {
      const entry = next.get(key)
      if (!entry || ![...entry.sceneFeeds, ...entry.donorFeeds].some((f) => activeFeeds.has(f))) next.delete(key)
    })
    setMemory(next)
  }

  const { allPosts, originOf, postsPerSearch, addsPerSearch, carriedPerSearch, carriedAddsPerSearch } = useMemo(() => {
    const all: BooruPost[] = []
    const origin = new Map<number, string>()
    const perSearch: number[] = []
    const adds: number[] = []
    const keptPosts: number[] = []
    const keptAdds: number[] = []
    allSearches.forEach((search, s) => {
      const own = new Set<number>()
      let added = 0
      const take = (post: BooruPost | undefined) => {
        if (!post || own.has(post.id)) return
        own.add(post.id)
        if (origin.has(post.id)) return
        origin.set(post.id, search.id)
        all.push(post)
        added++
      }
      // The posts kept for this search first: they were on the sheet already.
      for (const post of carried.bySearch[s] ?? []) take(post)
      keptPosts.push(own.size)
      keptAdds.push(added)
      for (const post of interleave(slotsBySearch[s].map((i) => postLists[i]))) take(post)
      perSearch.push(own.size)
      adds.push(added)
    })
    return {
      allPosts: all,
      originOf: origin as ReadonlyMap<number, string>,
      postsPerSearch: perSearch,
      addsPerSearch: adds,
      carriedPerSearch: keptPosts,
      carriedAddsPerSearch: keptAdds,
    }
  }, [allSearches, slotsBySearch, postLists, carried])

  // Each search's paging, by search id (a search the next plan keeps keeps its record).
  // Recorded while rendering once a page has arrived for every rating of the search.
  const [paging, setPaging] = useState<Readonly<Record<string, SearchPaging>>>({})
  const arrived = allSearches.map((search, s) => {
    const own = slotsBySearch[s].map((i) => feeds[i])
    const pages = own.length > 0 ? Math.min(...own.map((f) => f.loadedPages)) : 0
    return {
      id: search.id,
      loading: own.some((f) => f.isLoadingMore),
      failed: own.some((f) => f.failed),
      pages,
      siteEnded: own.length > 0 && own.every((f) => f.noMoreResults),
    }
  })
  let nextPaging: Record<string, SearchPaging> | null = null
  arrived.forEach((a, s) => {
    if (a.loading || a.failed) return
    // A search new to the pack starts from the posts kept for it: a first page with nothing beyond them ends it.
    const kept = carriedPerSearch[s] ?? 0
    const prev = paging[a.id] ?? (kept > 0 ? { ...NO_PAGING, posts: kept, adds: carriedAddsPerSearch[s] ?? 0 } : NO_PAGING)
    const rec = recordPage(prev, { pages: a.pages, posts: postsPerSearch[s] ?? 0, adds: addsPerSearch[s] ?? 0 })
    if (rec !== prev) nextPaging = { ...(nextPaging ?? paging), [a.id]: rec }
  })
  if (nextPaging) setPaging(nextPaging)
  const pagingNow: Readonly<Record<string, SearchPaging>> = nextPaging ?? paging

  // Primitive per-search state, so the progress below changes only when one of them does.
  const searchState = arrived.map((a, s) => {
    const p = pagingNow[a.id] ?? NO_PAGING
    return [a.id, a.loading, a.failed, a.siteEnded, p.pages, p.dry, p.lastAdds, postsPerSearch[s] ?? 0, addsPerSearch[s] ?? 0, carriedPerSearch[s] ?? 0].join(":")
  }).join("|")
  const searches = useMemo<PackSourceProgress[]>(() => allSearches.map((search, s) => {
    const a = arrived[s]
    const p = pagingNow[search.id] ?? NO_PAGING
    return {
      id: search.id,
      kind: search.kind,
      donor: search.donor,
      posts: postsPerSearch[s] ?? 0,
      adds: addsPerSearch[s] ?? 0,
      earlier: carriedPerSearch[s] ?? 0,
      pages: p.pages,
      loading: a.loading,
      exhausted: searchEnded(p, a.siteEnded),
      failed: a.failed,
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [allSearches, searchState])

  const isLoadingMore = searches.some((s) => s.loading)
  const noMoreResults = searches.every((s) => s.exhausted)
  const failed = searches.some((s) => s.failed)
  const totalPages = searches.reduce((sum, s) => sum + s.pages, 0)
  // The next page goes to the search that can bring most (lib/pack/source-paging.ts); a donor
  // search only while its condition is short.
  const target = nextSearch(searches.map((s) => ({
    paging: pagingNow[s.id] ?? NO_PAGING,
    ended: s.exhausted,
    failed: s.failed,
    firstPageOnly: s.donor && !shortConditions.includes(s.kind as DonorSearch["kind"]),
  })))
  // Its feeds that still have pages: one request each.
  const endedFeeds = feeds.map((f) => (f.noMoreResults ? "1" : "0")).join("")
  const targetKey = target >= 0 ? slotsBySearch[target].filter((i) => endedFeeds[i] !== "1").join(",") : ""
  const targetRequests = targetKey ? targetKey.split(",").length : 0
  // The session's cap: the next page would take the pack past it.
  const sessionCapReached = spent + Math.max(1, targetRequests) > sessionRequestCap
  useEffect(() => { if (sessionCapReached) capCallbackRef.current?.() }, [sessionCapReached])

  const loadMoreGuardRef = useRef(false)
  const isLoadingMoreRef = useRef(isLoadingMore)
  useEffect(() => { isLoadingMoreRef.current = isLoadingMore }, [isLoadingMore])
  useEffect(() => {
    if (isLoadingMore) loadMoreGuardRef.current = false
  }, [isLoadingMore])
  // A page asked for that never starts loading must not lock loadMore for good: a new
  // target search (the old one ran out) or a new plan frees it.
  useEffect(() => { loadMoreGuardRef.current = false }, [targetKey, feedKey])

  const { addPages: addPages0 } = feed0
  const { addPages: addPages1 } = feed1
  const { addPages: addPages2 } = feed2
  const { addPages: addPages3 } = feed3
  const { addPages: addPages4 } = feed4
  const { addPages: addPages5 } = feed5
  const { addPages: addPages6 } = feed6
  const { addPages: addPages7 } = feed7
  // Fetches the target search's next page now; false when the guards or the pace say no.
  const startPage = useCallback((): boolean => {
    if (loadMoreGuardRef.current || isLoadingMoreRef.current) return false
    if (!targetKey || spent + targetRequests > sessionRequestCap) return false
    const pacer = sitePacer(provider)
    if (pacer.msUntil(targetRequests) > 0) return false
    pacer.take(targetRequests)
    record(targetRequests)
    loadMoreGuardRef.current = true
    const adds = [addPages0, addPages1, addPages2, addPages3, addPages4, addPages5, addPages6, addPages7]
    for (const i of targetKey.split(",").map(Number)) adds[i](1)
    return true
  }, [targetKey, targetRequests, spent, sessionRequestCap, record, provider, addPages0, addPages1, addPages2, addPages3, addPages4, addPages5, addPages6, addPages7])
  const [waiting, setWaiting] = useState(false)
  const waitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearWait = useCallback(() => {
    if (waitTimerRef.current) clearTimeout(waitTimerRef.current)
    waitTimerRef.current = null
    setWaiting(false)
  }, [])
  // Another plan, or unmounting: a waiting page is not for it.
  useEffect(() => clearWait, [feedKey, clearWait])
  // True when a page was asked for, now or once the pace allows it (false: one is already
  // on its way or waiting, nothing is left, or the session's request cap is reached).
  const loadMoreRef = useRef<() => boolean>(() => false)
  const loadMore = useCallback((): boolean => {
    if (waitTimerRef.current || loadMoreGuardRef.current || isLoadingMoreRef.current) return false
    if (!targetKey || spent + targetRequests > sessionRequestCap) return false
    const wait = sitePacer(provider).msUntil(targetRequests)
    if (wait <= 0 && startPage()) return true
    // Waits for the pace, then asks again with the target of that moment (another request
    // may have taken the turn meanwhile: then it waits again).
    setWaiting(true)
    waitTimerRef.current = setTimeout(() => {
      waitTimerRef.current = null
      setWaiting(false)
      loadMoreRef.current()
    }, Math.max(wait, 100) + 50)
    return true
  }, [targetKey, targetRequests, spent, sessionRequestCap, provider, startPage])
  useEffect(() => { loadMoreRef.current = loadMore }, [loadMore])

  const { retry: retry0 } = feed0
  const { retry: retry1 } = feed1
  const { retry: retry2 } = feed2
  const { retry: retry3 } = feed3
  const { retry: retry4 } = feed4
  const { retry: retry5 } = feed5
  const { retry: retry6 } = feed6
  const { retry: retry7 } = feed7
  const failedKey = slotsBySearch.flat().filter((i) => feeds[i].failed).join(",")
  const retry = useCallback(() => {
    if (!failedKey) return
    const retries = [retry0, retry1, retry2, retry3, retry4, retry5, retry6, retry7]
    for (const i of failedKey.split(",").map(Number)) retries[i]()
  }, [failedKey, retry0, retry1, retry2, retry3, retry4, retry5, retry6, retry7])

  // Memoized for the same reason as usePackSeedSearch's result: callers put it in effect deps.
  return useMemo(() => ({
    allPosts,
    isLoadingMore,
    noMoreResults,
    sessionCapReached,
    // Nothing is refused for going too fast: a page waits for the pace (`waiting`).
    scrollLimited: waiting,
    loadMore,
    waiting,
    pages: totalPages,
    requests: spent,
    autoRequestCap,
    failed,
    retry,
    originOf,
    searches,
  }), [allPosts, isLoadingMore, noMoreResults, sessionCapReached, loadMore, waiting, totalPages, spent, autoRequestCap, failed, retry, originOf, searches])
}
