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
 * Mount timing is the same as usePackSeedSearch's: this hook fetches page 1 of
 * every search on mount and has no "enabled" flag; mount the component that calls
 * it only when the pack should fetch.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { BooruPost } from "@/lib/api-client"
import { assignFeedSlots, planFeeds, type FeedSlot, type SceneSearchKind, type SourcePlan } from "@/lib/pack/source-plan"
import { useSingleRatingFeed, type UsePackSeedSearchResult } from "./use-pack-seed-search"
import { useScrollRateLimiter } from "./use-scroll-rate-limiter"

export interface PackSourceProgress {
  /** The scene search's id (SceneSearch.id). */
  id: string
  kind: SceneSearchKind
  /** Posts this search has brought, without repeats (some may also be in a preferred search). */
  posts: number
  /** Pages fetched so far (per rating). */
  pages: number
  loading: boolean
  /** Every rating of this search has run out of posts. */
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
  /** Asks for the next page; true when one was asked for. */
  loadMore: () => boolean
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

  const { allPosts, originOf, postsPerSearch } = useMemo(() => {
    const postLists = [feed0.allPosts, feed1.allPosts, feed2.allPosts, feed3.allPosts, feed4.allPosts, feed5.allPosts]
    const all: BooruPost[] = []
    const origin = new Map<number, string>()
    const perSearch: number[] = []
    plan.scenes.forEach((search, s) => {
      const own = new Set<number>()
      for (const post of interleave(slotsBySearch[s].map((i) => postLists[i]))) {
        if (!post || own.has(post.id)) continue
        own.add(post.id)
        if (origin.has(post.id)) continue
        origin.set(post.id, search.id)
        all.push(post)
      }
      perSearch.push(own.size)
    })
    return { allPosts: all, originOf: origin as ReadonlyMap<number, string>, postsPerSearch: perSearch }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneKey, slotsBySearch, feed0.allPosts, feed1.allPosts, feed2.allPosts, feed3.allPosts, feed4.allPosts, feed5.allPosts])

  // Primitive per-feed state, so the progress below changes only when one of them does.
  const feedState = feeds.map((f) => `${f.size}:${f.isLoadingMore ? 1 : 0}:${f.noMoreResults ? 1 : 0}:${f.failed ? 1 : 0}`).join("|")
  const searches = useMemo<PackSourceProgress[]>(() => plan.scenes.map((search, s) => {
    const own = slotsBySearch[s].map((i) => feeds[i])
    return {
      id: search.id,
      kind: search.kind,
      posts: postsPerSearch[s] ?? 0,
      pages: Math.max(0, ...own.map((f) => f.size)),
      loading: own.some((f) => f.isLoadingMore),
      exhausted: own.length > 0 && own.every((f) => f.noMoreResults),
      failed: own.some((f) => f.failed),
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [sceneKey, slotsBySearch, postsPerSearch, feedState])

  const isLoadingMore = searches.some((s) => s.loading)
  const noMoreResults = searches.every((s) => s.exhausted)
  const failed = searches.some((s) => s.failed)
  // One budget for every search: the pages fetched across all of them.
  const totalPages = searches.reduce((sum, s) => sum + s.pages, 0)
  // More pages come from the most preferred search that still has some.
  const target = searches.findIndex((s) => !s.exhausted && !s.failed)
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
  const { canLoadMore } = rateLimiter
  // True when a page was asked for (false: one is already on its way, nothing is left, or the pace limit said no).
  const loadMore = useCallback((): boolean => {
    if (loadMoreGuardRef.current || isLoadingMoreRef.current) return false
    if (!targetKey) return false
    if (!canLoadMore(totalPages)) return false
    loadMoreGuardRef.current = true
    const setSizes = [setSize0, setSize1, setSize2, setSize3, setSize4, setSize5]
    for (const i of targetKey.split(",").map(Number)) void setSizes[i]((size) => size + 1)
    return true
  }, [canLoadMore, totalPages, targetKey, setSize0, setSize1, setSize2, setSize3, setSize4, setSize5])

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
    failed,
    retry,
    originOf,
    searches,
  }), [allPosts, isLoadingMore, noMoreResults, rateLimiter.sessionCapReached, rateLimiter.scrollLimited, loadMore, failed, retry, originOf, searches])
}
