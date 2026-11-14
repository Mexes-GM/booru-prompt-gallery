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
 * that can bring most. A page the pace limit doesn't allow yet waits for it and goes
 * by itself (`waiting`); nothing is refused.
 *
 * Mount timing is the same as usePackSeedSearch's: this hook fetches page 1 of
 * every search on mount and has no "enabled" flag; mount the component that calls
 * it only when the pack should fetch.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { BooruPost } from "@/lib/api-client"
import { assignFeedSlots, planFeeds, type FeedSlot, type SceneSearchKind, type SourcePlan } from "@/lib/pack/source-plan"
import { useSingleRatingFeed, type UsePackSeedSearchResult } from "./use-pack-seed-search"
import { useScrollRateLimiter, MAX_SESSION_PAGE_LOADS } from "./use-scroll-rate-limiter"
import { NO_PAGING, nextSearch, recordPage, searchEnded, type SearchPaging } from "@/lib/pack/source-paging"

export interface PackSourceProgress {
  /** The scene search's id (SceneSearch.id). */
  id: string
  kind: SceneSearchKind
  /** Posts this search has brought, without repeats (some may also be in a preferred search). */
  posts: number
  /** Posts it brought that no search before it in the plan had. */
  adds: number
  /** Pages that have arrived (per rating). */
  pages: number
  loading: boolean
  /** The search has run out: the site said so, or a page brought it nothing new. */
  exhausted: boolean
  failed: boolean
}

export interface UsePackSourcesArgs {
  plan: SourcePlan
  /** Called once when the session's page cap is reached. The hook shows nothing itself. */
  onSessionCapReached?: () => void
  /** Called once when loading is paused for going too fast. */
  onScrollLimited?: () => void
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
}

type Feed = ReturnType<typeof useSingleRatingFeed>

/** A rating feed's posts interleaved with the others of its search, so no rating outweighs the rest. */
function interleave(lists: readonly BooruPost[][]): BooruPost[] {
  const out: BooruPost[] = []
  const max = Math.max(0, ...lists.map((l) => l.length))
  for (let i = 0; i < max; i++) for (const list of lists) if (list[i]) out.push(list[i])
  return out
}

export function usePackSources({ plan, onSessionCapReached, onScrollLimited }: UsePackSourcesArgs): UsePackSourcesResult {
  const { provider, sceneKey } = plan
  const [sessionSeed] = useState(() => Date.now())

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

  const feed0 = useSingleRatingFeed(slots[0].query, slots[0].ratingFilter, provider, slots[0].seed)
  const feed1 = useSingleRatingFeed(slots[1].query, slots[1].ratingFilter, provider, slots[1].seed)
  const feed2 = useSingleRatingFeed(slots[2].query, slots[2].ratingFilter, provider, slots[2].seed)
  const feed3 = useSingleRatingFeed(slots[3].query, slots[3].ratingFilter, provider, slots[3].seed)
  const feed4 = useSingleRatingFeed(slots[4].query, slots[4].ratingFilter, provider, slots[4].seed)
  const feed5 = useSingleRatingFeed(slots[5].query, slots[5].ratingFilter, provider, slots[5].seed)
  const feeds: Feed[] = [feed0, feed1, feed2, feed3, feed4, feed5]

  // Callers needn't pass stable callbacks: the limiter memoizes on them (see usePackSeedSearch).
  const callbacksRef = useRef({ onSessionCapReached, onScrollLimited })
  useEffect(() => { callbacksRef.current = { onSessionCapReached, onScrollLimited } }, [onSessionCapReached, onScrollLimited])
  const handleSessionCap = useCallback(() => callbacksRef.current.onSessionCapReached?.(), [])
  const handleScrollLimited = useCallback(() => callbacksRef.current.onScrollLimited?.(), [])
  const rateLimiter = useScrollRateLimiter({ onSessionCapReached: handleSessionCap, onScrollLimited: handleScrollLimited })

  // A new set of searches starts a new page budget, as a new source does in usePackSeedSearch.
  const limiterKeyRef = useRef(sceneKey)
  useEffect(() => {
    if (limiterKeyRef.current !== sceneKey) {
      limiterKeyRef.current = sceneKey
      rateLimiter.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneKey])

  // Each search's slots, in rating order.
  const slotsBySearch = useMemo(() => plan.scenes.map((search) =>
    plan.ratings.map((rating) => slots.findIndex((s) => s.active && s.searchId === search.id && s.ratingFilter === rating)).filter((i) => i >= 0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [sceneKey, slots])

  const { allPosts, originOf, postsPerSearch, addsPerSearch } = useMemo(() => {
    const postLists = [feed0.allPosts, feed1.allPosts, feed2.allPosts, feed3.allPosts, feed4.allPosts, feed5.allPosts]
    const all: BooruPost[] = []
    const origin = new Map<number, string>()
    const perSearch: number[] = []
    const adds: number[] = []
    plan.scenes.forEach((search, s) => {
      const own = new Set<number>()
      let added = 0
      for (const post of interleave(slotsBySearch[s].map((i) => postLists[i]))) {
        if (!post || own.has(post.id)) continue
        own.add(post.id)
        if (origin.has(post.id)) continue
        origin.set(post.id, search.id)
        all.push(post)
        added++
      }
      perSearch.push(own.size)
      adds.push(added)
    })
    return { allPosts: all, originOf: origin as ReadonlyMap<number, string>, postsPerSearch: perSearch, addsPerSearch: adds }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneKey, slotsBySearch, feed0.allPosts, feed1.allPosts, feed2.allPosts, feed3.allPosts, feed4.allPosts, feed5.allPosts])

  // Each search's paging, by search id (a search the next plan keeps keeps its record).
  // Recorded while rendering once a page has arrived for every rating of the search.
  const [paging, setPaging] = useState<Readonly<Record<string, SearchPaging>>>({})
  const arrived = plan.scenes.map((search, s) => {
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
    const prev = paging[a.id] ?? NO_PAGING
    const rec = recordPage(prev, { pages: a.pages, posts: postsPerSearch[s] ?? 0, adds: addsPerSearch[s] ?? 0 })
    if (rec !== prev) nextPaging = { ...(nextPaging ?? paging), [a.id]: rec }
  })
  if (nextPaging) setPaging(nextPaging)
  const pagingNow: Readonly<Record<string, SearchPaging>> = nextPaging ?? paging

  // Primitive per-search state, so the progress below changes only when one of them does.
  const searchState = arrived.map((a, s) => {
    const p = pagingNow[a.id] ?? NO_PAGING
    return [a.id, a.loading, a.failed, a.siteEnded, p.pages, p.dry, p.lastAdds, postsPerSearch[s] ?? 0, addsPerSearch[s] ?? 0].join(":")
  }).join("|")
  const searches = useMemo<PackSourceProgress[]>(() => plan.scenes.map((search, s) => {
    const a = arrived[s]
    const p = pagingNow[search.id] ?? NO_PAGING
    return {
      id: search.id,
      kind: search.kind,
      posts: postsPerSearch[s] ?? 0,
      adds: addsPerSearch[s] ?? 0,
      pages: p.pages,
      loading: a.loading,
      exhausted: searchEnded(p, a.siteEnded),
      failed: a.failed,
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [sceneKey, searchState])

  const isLoadingMore = searches.some((s) => s.loading)
  const noMoreResults = searches.every((s) => s.exhausted)
  const failed = searches.some((s) => s.failed)
  // One budget for every search: the pages fetched across all of them.
  const totalPages = searches.reduce((sum, s) => sum + s.pages, 0)
  // The next page goes to the search that can bring most (lib/pack/source-paging.ts).
  const target = nextSearch(searches.map((s) => ({ paging: pagingNow[s.id] ?? NO_PAGING, ended: s.exhausted, failed: s.failed })))
  const targetKey = target >= 0 ? slotsBySearch[target].join(",") : ""

  const loadMoreGuardRef = useRef(false)
  const isLoadingMoreRef = useRef(isLoadingMore)
  useEffect(() => { isLoadingMoreRef.current = isLoadingMore }, [isLoadingMore])
  useEffect(() => {
    if (isLoadingMore) loadMoreGuardRef.current = false
  }, [isLoadingMore])
  // A page asked for that never starts loading must not lock loadMore for good: a new
  // target search (the old one ran out) or a new plan frees it.
  useEffect(() => { loadMoreGuardRef.current = false }, [targetKey, sceneKey])

  const { setSize: setSize0 } = feed0
  const { setSize: setSize1 } = feed1
  const { setSize: setSize2 } = feed2
  const { setSize: setSize3 } = feed3
  const { setSize: setSize4 } = feed4
  const { setSize: setSize5 } = feed5
  const { canLoadMore, msUntilAllowed } = rateLimiter
  // Fetches the target search's next page now; false when the guards say no.
  const startPage = useCallback((): boolean => {
    if (loadMoreGuardRef.current || isLoadingMoreRef.current) return false
    if (!targetKey) return false
    if (!canLoadMore(totalPages)) return false
    loadMoreGuardRef.current = true
    const setSizes = [setSize0, setSize1, setSize2, setSize3, setSize4, setSize5]
    for (const i of targetKey.split(",").map(Number)) void setSizes[i]((size) => size + 1)
    return true
  }, [canLoadMore, totalPages, targetKey, setSize0, setSize1, setSize2, setSize3, setSize4, setSize5])
  // A page that waits for the pace limit starts with the latest target when its turn comes.
  const startRef = useRef(startPage)
  useEffect(() => { startRef.current = startPage }, [startPage])
  const [waiting, setWaiting] = useState(false)
  const waitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearWait = useCallback(() => {
    if (waitTimerRef.current) clearTimeout(waitTimerRef.current)
    waitTimerRef.current = null
    setWaiting(false)
  }, [])
  // Another plan, or unmounting: a waiting page is not for it.
  useEffect(() => clearWait, [sceneKey, clearWait])
  // True when a page was asked for, now or once the pace limit allows it (false: one is
  // already on its way or waiting, nothing is left, or the session's page cap is reached).
  const loadMore = useCallback((): boolean => {
    if (waitTimerRef.current || loadMoreGuardRef.current || isLoadingMoreRef.current) return false
    if (!targetKey) return false
    if (totalPages >= MAX_SESSION_PAGE_LOADS) return canLoadMore(totalPages)
    const wait = msUntilAllowed()
    if (wait <= 0) return startPage()
    setWaiting(true)
    waitTimerRef.current = setTimeout(() => {
      waitTimerRef.current = null
      setWaiting(false)
      startRef.current()
    }, wait + 50)
    return true
  }, [targetKey, totalPages, canLoadMore, msUntilAllowed, startPage])

  const { retry: retry0 } = feed0
  const { retry: retry1 } = feed1
  const { retry: retry2 } = feed2
  const { retry: retry3 } = feed3
  const { retry: retry4 } = feed4
  const { retry: retry5 } = feed5
  const failedKey = slotsBySearch.flat().filter((i) => feeds[i].failed).join(",")
  const retry = useCallback(() => {
    if (!failedKey) return
    const retries = [retry0, retry1, retry2, retry3, retry4, retry5]
    for (const i of failedKey.split(",").map(Number)) retries[i]()
  }, [failedKey, retry0, retry1, retry2, retry3, retry4, retry5])

  // Memoized for the same reason as usePackSeedSearch's result: callers put it in effect deps.
  return useMemo(() => ({
    allPosts,
    isLoadingMore,
    noMoreResults,
    sessionCapReached: rateLimiter.sessionCapReached,
    scrollLimited: rateLimiter.scrollLimited,
    loadMore,
    waiting,
    pages: totalPages,
    failed,
    retry,
    originOf,
    searches,
  }), [allPosts, isLoadingMore, noMoreResults, rateLimiter.sessionCapReached, rateLimiter.scrollLimited, loadMore, waiting, totalPages, failed, retry, originOf, searches])
}
