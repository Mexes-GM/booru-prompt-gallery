"use client"

/**
 * Pack Mode's OWN post-fetching source for seeding axis pools — deliberately
 * independent from useBooruSearch's global search state (searchTags/rating
 * shown in the main search bar). The source popover (see
 * components/prompt-gallery/pack-source-modal.tsx) asks the user for a
 * rating preference and a "solo character" preference specific to this pack, plus
 * which tags to sample from (the current search, a custom query, or none) —
 * none of that should silently change what the user sees in the main gallery,
 * and vice versa: changing the main search bar mid-Pack-Mode-session must not
 * retroactively alter what's already been sampled.
 *
 * Same anti-abuse posture as normal browsing: fetches go through
 * useInfinitePosts (the exact same fetcher/provider-routing/caching used
 * everywhere else) and are paced by the shared useScrollRateLimiter guard
 * (hooks/use-scroll-rate-limiter.ts) — same sliding-window burst cap and
 * per-session page cap as useBooruSearch's own loadMore(). Posts-only
 * metadata (post.json), never image bytes.
 *
 * "Both" (questionable + explicit) rating mode runs TWO independent
 * useInfinitePosts instances in parallel (one per rating) and interleaves
 * their pages, rather than relying on unverified multi-value `rating:a,b`
 * query syntax across every provider.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useInfinitePosts, isRandomOrderSafeProvider, type BooruPost } from "@/lib/api-client"
import type { BooruProvider } from "@/lib/booru/types"
import { useScrollRateLimiter } from "./use-scroll-rate-limiter"
import { useToast } from "./use-toast"

export type PackRatingMode = "sfw" | "questionable" | "explicit" | "both"

/** Maps a Pack Setup rating choice to the same rating: vocabulary
 *  useInfinitePosts/mapRatingForProvider already understand. "both" has no
 *  single value — callers fan out to two fetches (see usePackSeedSearch). */
export function packRatingToFilters(mode: PackRatingMode): string[] {
  switch (mode) {
    case "sfw": return ["rating:general"]
    case "questionable": return ["rating:questionable"]
    case "explicit": return ["rating:explicit"]
    case "both": return ["rating:questionable", "rating:explicit"]
  }
}

export interface UsePackSeedSearchArgs {
  /** Raw tags to search (e.g. "mona (genshin impact)"), or "" for none. */
  searchTags: string
  ratingMode: PackRatingMode
  booruProvider: BooruProvider
}

export interface UsePackSeedSearchResult {
  allPosts: BooruPost[]
  isLoadingMore: boolean
  noMoreResults: boolean
  sessionCapReached: boolean
  scrollLimited: boolean
  loadMore: () => void
}

function buildTags(searchTags: string): string {
  return searchTags.split(",").map((t) => t.trim()).filter(Boolean).join(", ")
}

/**
 * One rating's worth of paging state — mirrors the SWR-backed shape
 * useBooruSearch keeps for the main search, scoped down to just what seeding
 * needs (automatically defaults to "random" order on providers where it poses
 * no tag-count or pagination limitations like Gelbooru/Rule34, and "recent" on
 * providers with strict limits like Danbooru/Aibooru/e621 for stable pagination).
 */
function useSingleRatingFeed(tags: string, ratingFilter: string, provider: BooruProvider, seed: number) {
  const [size, setSize] = useState(1)
  const isRandomSafe = isRandomOrderSafeProvider(provider)
  const order = isRandomSafe ? "random" : "recent"

  const { data: pages, isValidating } = useInfinitePosts(
    tags,
    ratingFilter,
    order,
    isRandomSafe ? seed : undefined,
    provider,
    false,
  )

  // Reset pagination whenever the query itself changes (new tags/rating/
  // provider/seed) — mirrors useBooruSearch's own reset effect.
  const resetKeyRef = useRef("")
  const resetKey = `${tags}-${ratingFilter}-${provider}-${isRandomSafe ? seed : ""}`
  useEffect(() => {
    if (resetKeyRef.current !== resetKey) {
      resetKeyRef.current = resetKey
      setSize(1)
    }
  }, [resetKey])

  const allPosts = useMemo(() => {
    if (!pages) return []
    const flat = pages.flat()
    const seen = new Set<number>()
    return flat.filter((post) => {
      if (!post || seen.has(post.id)) return false
      seen.add(post.id)
      return true
    })
  }, [pages])

  const isLoadingMore = isValidating && size > 0
  const lastPage = pages && pages.length > 0 ? pages[pages.length - 1] : null
  const noMoreResults = !!pages && pages.length > 0 && lastPage !== null && lastPage.length === 0

  return { allPosts, isLoadingMore, noMoreResults, size, setSize }
}

/**
 * Pack Mode's seeding source. Returns a SeedPagesSearchSlice-compatible
 * object (lib/booru/seed-pages.ts) so the existing seedPages()/usePackSeed()
 * pipeline works unchanged — this hook only swaps out WHERE the posts come
 * from, not how paging/rate-limiting is orchestrated on top of them.
 *
 * IMPORTANT — mount timing: this hook itself has NO "enabled" flag, and
 * calling it immediately fetches page 1 (useSWRInfinite always fetches its
 * initial page on mount; there's no built-in "disabled" state to piggyback
 * on without touching the shared lib/api-client.ts). Callers MUST NOT call
 * this hook until the Pack Setup modal has been confirmed — mount the
 * component that calls it conditionally (see PackSeedFetcher in
 * prompt-gallery.tsx) rather than calling it unconditionally and trying to
 * suppress its effects with a flag. This is the standard React pattern for
 * "conditional hooks": conditionally mount the component, never the hook.
 */
export function usePackSeedSearch(args: UsePackSeedSearchArgs): UsePackSeedSearchResult {
  const { searchTags, ratingMode, booruProvider } = args
  const { toast } = useToast()
  const tags = buildTags(searchTags)
  const ratingFilters = packRatingToFilters(ratingMode)
  const isBoth = ratingFilters.length > 1

  const [randomSeed, setRandomSeed] = useState(() => Date.now())

  const feedA = useSingleRatingFeed(tags, ratingFilters[0], booruProvider, randomSeed)
  // Second feed only matters in "both" mode. When not "both" it's given the
  // EXACT same (tags, rating, provider, seed) key as feedA, so SWR dedupes it
  // against feedA's own in-flight/cached request instead of firing a second
  // real network call — see useInfinitePosts's dedupingInterval.
  const feedB = useSingleRatingFeed(tags, ratingFilters[1] ?? ratingFilters[0], booruProvider, randomSeed)

  // Stable callbacks — useScrollRateLimiter memoizes canLoadMore off these
  // (see its own [onSessionCapReached, onScrollLimited] deps), so passing
  // fresh inline arrows here would make canLoadMore (and everything
  // downstream: loadMore, this hook's own returned object) a new reference
  // on every render, which is exactly what caused the "Maximum update depth
  // exceeded" loop via PackSeedFetcher's useEffect in prompt-gallery.tsx.
  const onSessionCapReached = useCallback(() => {
    toast({
      title: "Session Limit Reached",
      description: "You've loaded a lot of pages for this pack. Try adjusting the pack's search or rating to keep sampling.",
      variant: "default",
    })
  }, [toast])
  const onScrollLimited = useCallback(() => {
    toast({
      title: "Loading Too Fast",
      description: "Loading more posts is paused briefly to avoid overloading the provider.",
      variant: "default",
    })
  }, [toast])
  const rateLimiter = useScrollRateLimiter({ onSessionCapReached, onScrollLimited })

  // Reset the rate limiter's own guards whenever the underlying query changes,
  // same as useBooruSearch's "Reset pagination" effect.
  const rateLimiterResetKeyRef = useRef("")
  const rateLimiterResetKey = `${tags}-${ratingMode}-${booruProvider}`
  useEffect(() => {
    if (rateLimiterResetKeyRef.current !== rateLimiterResetKey) {
      rateLimiterResetKeyRef.current = rateLimiterResetKey
      rateLimiter.reset()
      setRandomSeed(Date.now())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rateLimiterResetKey])

  const loadMoreGuardRef = useRef(false)
  const isLoadingMore = feedA.isLoadingMore || feedB.isLoadingMore
  const isLoadingMoreRef = useRef(isLoadingMore)
  useEffect(() => { isLoadingMoreRef.current = isLoadingMore }, [isLoadingMore])
  useEffect(() => {
    if (isLoadingMore) loadMoreGuardRef.current = false
  }, [isLoadingMore])

  const loadMore = useCallback(() => {
    if (loadMoreGuardRef.current || isLoadingMoreRef.current) return
    // Both feeds share one session-cap/burst budget — checked once against
    // feedA's page count (both advance together in "both" mode).
    if (!rateLimiter.canLoadMore(feedA.size)) return

    loadMoreGuardRef.current = true
    feedA.setSize((s) => s + 1)
    if (isBoth) feedB.setSize((s) => s + 1)
  }, [rateLimiter.canLoadMore, feedA.size, feedA.setSize, feedB.setSize, isBoth])

  // Interleave so a "both" pack doesn't skew toward whichever rating's page
  // happens to load first — sampling downstream (extractAxisValues) ranks by
  // frequency, so an unbalanced input pool would quietly bias variety.
  // Also deduplicate posts across feeds to prevent duplicate entries from inflating frequency.
  const allPosts = useMemo(() => {
    const raw: BooruPost[] = []
    if (!isBoth) {
      raw.push(...feedA.allPosts)
    } else {
      const max = Math.max(feedA.allPosts.length, feedB.allPosts.length)
      for (let i = 0; i < max; i++) {
        if (feedA.allPosts[i]) raw.push(feedA.allPosts[i])
        if (feedB.allPosts[i]) raw.push(feedB.allPosts[i])
      }
    }
    const seen = new Set<number>()
    return raw.filter((post) => {
      if (!post || seen.has(post.id)) return false
      seen.add(post.id)
      return true
    })
  }, [feedA.allPosts, feedB.allPosts, isBoth])

  const noMoreResults = isBoth ? (feedA.noMoreResults && feedB.noMoreResults) : feedA.noMoreResults

  // Memoized so the returned object's IDENTITY only changes when one of its
  // actual fields does. Without this, callers that plug the result straight
  // into a useEffect dependency (see PackSeedFetcher in prompt-gallery.tsx)
  // would re-run that effect on every render — including renders caused BY
  // that effect's own setState — producing an infinite "Maximum update depth
  // exceeded" loop. loadMore is already a stable useCallback; every other
  // field here is a primitive/array that's itself already memoized upstream
  // (allPosts) or a fresh primitive each render (fine as a dep, just not as
  // a fresh wrapper object).
  return useMemo(() => ({
    allPosts,
    isLoadingMore,
    noMoreResults,
    sessionCapReached: rateLimiter.sessionCapReached,
    scrollLimited: rateLimiter.scrollLimited,
    loadMore,
  }), [allPosts, isLoadingMore, noMoreResults, rateLimiter.sessionCapReached, rateLimiter.scrollLimited, loadMore])
}
