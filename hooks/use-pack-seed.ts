"use client"

/**
 * Pack Mode's own seeding hook: when the user picks a base card, the axis
 * pools should be sampled from more than just whatever the normal scroll
 * happened to load so far (often as few as one page / ~30 posts). Danbooru's
 * search endpoint is JSON (post.json) — no CDN image fetches are involved in
 * paginating it, so pulling a handful of extra pages here is cheap compared
 * to the image-heavy cost of normal browsing. This mirrors Bulk Send's
 * "synthetic" mode seeding (hooks/use-bulk-send.ts) via the shared
 * lib/booru/seed-pages.ts helper, so it reuses the exact same anti-abuse
 * guards (scroll rate limiter, session page cap) instead of bypassing them.
 */
import { useCallback, useMemo, useRef, useState } from "react"
import type { BooruPost } from "@/lib/booru/types"
import { seedPages, type SeedPagesSearchSlice } from "@/lib/booru/seed-pages"

/** Target pool size for Pack Mode's axis sampling — richer than a single
 *  scroll page (~30 posts) without demanding many pages. post.json has no
 *  CDN/image cost, so this is comparatively cheap to fetch upfront. */
export const PACK_SEED_TARGET_POSTS = 100

/** Fresh posts fetched per session for a source that already has a saved
 *  pool (lib/pack/pool-cache.ts) — enough to keep it growing, cheap to fetch. */
export const PACK_ENRICH_POSTS = 40

export interface UsePackSeedResult {
  /** True while actively requesting extra pages for the current base selection. */
  isSeeding: boolean
  /** Live progress while seeding: how many posts are loaded vs. the target
   *  being chased. Null when not seeding. Drives the Pack Builder's progress
   *  bar — updated on every poll tick inside ensureSeeded, not just at the
   *  end, so the UI reflects each page landing instead of jumping 0 -> 100%. */
  seedProgress: { current: number; target: number } | null
  /**
   * Fetches more pages (via search.loadMore()) until at least
   * PACK_SEED_TARGET_POSTS posts are loaded, or a stop condition
   * (noMoreResults/sessionCapReached/timeout) fires. Resolves with whatever
   * was loaded, even if short of the target. Safe to call when the target is
   * already met — resolves immediately.
   *
   * `getSearch` must be a getter (not a static object) that always returns
   * the latest search slice — pass `() => searchRef.current` backed by a ref
   * the caller keeps in sync with the current render, so this observes pages
   * loadMore() fetches while it's running instead of reading a stale
   * snapshot from the render that kicked off the call.
   */
  ensureSeeded: (
    getSearch: () => SeedPagesSearchSlice,
    targetCount?: number,
    /** Called with the posts loaded so far on every poll tick — lets the caller
     *  refill pools live while pages land instead of only once at the end. */
    onPosts?: (posts: BooruPost[]) => void
  ) => Promise<BooruPost[]>
}

/**
 * Imperative helper, no coupling to useBooruSearch's internals beyond the
 * narrow SeedPagesSearchSlice — same shape useBulkSend already takes.
 */
export function usePackSeed(): UsePackSeedResult {
  const [isSeeding, setIsSeeding] = useState(false)
  const [seedProgress, setSeedProgress] = useState<{ current: number; target: number } | null>(null)
  const runningRef = useRef(false)

  const ensureSeeded = useCallback(
    async (
      getSearch: () => SeedPagesSearchSlice,
      targetCount: number = PACK_SEED_TARGET_POSTS,
      onPosts?: (posts: BooruPost[]) => void
    ): Promise<BooruPost[]> => {
      if (getSearch().allPosts.length >= targetCount) return getSearch().allPosts
      if (runningRef.current) return getSearch().allPosts
      runningRef.current = true
      setIsSeeding(true)
      setSeedProgress({ current: getSearch().allPosts.length, target: targetCount })
      try {
        return await seedPages(getSearch, (posts) => {
          setSeedProgress({ current: posts.length, target: targetCount })
          onPosts?.(posts)
          return posts.length >= targetCount
        })
      } finally {
        runningRef.current = false
        setIsSeeding(false)
        setSeedProgress(null)
      }
    },
    []
  )

  // Memoized so the returned object's IDENTITY only changes when one of its
  // actual fields does. Without this, PromptGallery's `packSeed` value is a
  // fresh object reference on every render, which flows into
  // handlePackSeedSearchReady's useCallback deps and gives THAT a fresh
  // identity on every render too — feeding PackSeedFetcher's useEffect
  // ([result, onReady]) a changed `onReady` even when nothing real changed,
  // re-firing onReady -> setPackSeedSnapshot -> re-render -> new packSeed
  // object -> loop. Same class of bug already fixed once in
  // usePackSeedSearch's return value (see hooks/use-pack-seed-search.ts).
  return useMemo(
    () => ({ isSeeding, seedProgress, ensureSeeded }),
    [isSeeding, seedProgress, ensureSeeded]
  )
}
