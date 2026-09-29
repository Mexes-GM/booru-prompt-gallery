"use client"

/**
 * Bulk Send orchestration hook (see
 * docs/superpowers/specs/2026-07-19-extension-bulk-send-design.md).
 *
 * Drives the "fetch enough seed posts, then build N prompts" flow for both
 * Bulk Send modes:
 *   - "real": N prompts derived directly from N real posts (derivePostPrompt),
 *     one prompt per post, with per-post generation resolution when the post
 *     has valid width/height.
 *   - "synthetic": a handful of seed posts feed lib/pack/bulk-send.ts's
 *     generateAndFilterPrompts (shared with Pack Mode), which
 *     locks the search bar tags and varies the rest, then cleans every
 *     result through the same cleaner pipeline.
 *
 * Fetching more pages is done exclusively through `search.loadMore()` (never
 * by reaching into SWR's `setSize` directly) so this reuses — instead of
 * bypassing — useBooruSearch's existing anti-abuse guards: the sliding-window
 * scroll rate limiter (max 2 loads / 10s) and the 35-page session cap. This
 * hook simply waits for a load to settle (or for those guards to signal it
 * should stop) before requesting the next page.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import type { BooruPost } from "@/lib/booru/types"
import { seedPages as seedPagesShared, type SeedPagesSearchSlice } from "@/lib/booru/seed-pages"
import { computeGenerationResolution } from "@/lib/extension/generation-resolution"
import { derivePostPrompt, type DerivePostPromptOptions } from "@/lib/prompt/derive-post-prompt"
import { extractLockedTagsFromSearch, buildAxesFromSeedPosts, detectCharacterTags, generateAndFilterPrompts, type BulkSendCleanOptions } from "@/lib/pack/bulk-send"
import { NearDuplicateFilter, DEFAULT_SIMILARITY_THRESHOLD } from "@/lib/pack/prompt-similarity"

export type BulkSendMode = "real" | "synthetic"

export interface BulkSendQueueItem {
  prompt: string
  /** Generation resolution derived from the source post, "real" mode only. */
  width?: number
  height?: number
}

export interface BulkSendResult {
  items: BulkSendQueueItem[]
  /** How many prompts were actually produced vs. requested (can be fewer — see spec §casos borde). */
  requested: number
  produced: number
}

export type BulkSendStatus = "idle" | "seeding" | "generating" | "done" | "error"

/** Minimal slice of useBooruSearch this hook needs — re-exported from the
 *  shared seed-pages helper so existing imports of this type keep working. */
export type BulkSendSearchSlice = SeedPagesSearchSlice

export interface UseBulkSendOptions {
  /** Real-posts mode: pipeline options (same bundle as PocketCard/cardPromptOptions). */
  realCleanOptions: DerivePostPromptOptions
  /** Synthetic mode: pipeline options (subset of the above, no per-post fields). */
  syntheticCleanOptions: BulkSendCleanOptions
  /** How many pages to seed for synthetic mode before generating (default 3 pages, ~90 posts). */
  syntheticSeedPages?: number
  /** Max ms to wait for one loadMore() to settle before giving up on seeding further. */
  perPageTimeoutMs?: number
  /** Max ms for the whole seeding phase, across all pages. */
  totalSeedTimeoutMs?: number
  /** Enables per-post generation resolution in "real" mode (matches "Match image resolution"). */
  matchResolution?: boolean
  maxLongSide?: number
  strictResolutionCap?: boolean
  /** When true, snap to the closest curated aspect-ratio bucket instead of
   *  each post's raw (often unusual) aspect ratio. */
  snapToBucket?: boolean
  /** Skip prompts too similar (Jaccard over tag sets) to one already accepted
   *  in this batch. Defaults to true — set false to restore the old "one
   *  prompt per post/combination, no similarity check" behavior. */
  avoidSimilarPrompts?: boolean
  /** Jaccard similarity (0..1) at/above which a candidate is rejected as a
   *  near-duplicate. Defaults to DEFAULT_SIMILARITY_THRESHOLD (0.85). */
  similarityThreshold?: number
}

/** Hard ceiling on extra pages fetched while chasing `count` unique prompts,
 *  so a very repetitive search can't spin seeding forever. */
const MAX_DEDUP_SEED_ROUNDS = 6

const DEFAULT_PER_PAGE_TIMEOUT_MS = 8_000
const DEFAULT_TOTAL_SEED_TIMEOUT_MS = 45_000

/**
 * useBulkSend: imperative orchestration, no React state coupling to
 * useBooruSearch's internals beyond the narrow slice declared above.
 */
export function useBulkSend(search: BulkSendSearchSlice, options: UseBulkSendOptions) {
  const [status, setStatus] = useState<BulkSendStatus>("idle")
  const [progressLabel, setProgressLabel] = useState<string>("")
  // Guards against overlapping runs (the UI should also disable the row while
  // running, but this is the authoritative guard).
  const runningRef = useRef(false)

  // Kept in sync with the latest `search` on every render so seedPages's
  // getter-based polling (see lib/booru/seed-pages.ts) observes freshly
  // fetched posts instead of the snapshot captured when seeding started.
  // Synced in an effect (not during render) per the rules-of-hooks refs check.
  const searchRef = useRef(search)
  useEffect(() => {
    searchRef.current = search
  }, [search])

  const {
    realCleanOptions,
    syntheticCleanOptions,
    syntheticSeedPages = 3,
    perPageTimeoutMs = DEFAULT_PER_PAGE_TIMEOUT_MS,
    totalSeedTimeoutMs = DEFAULT_TOTAL_SEED_TIMEOUT_MS,
    matchResolution = false,
    maxLongSide,
    strictResolutionCap = false,
    snapToBucket = false,
    avoidSimilarPrompts = true,
    similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD,
  } = options

  const seedPages = useCallback(
    (shouldStop: (posts: BooruPost[]) => boolean, onPage?: (pageNum: number) => void): Promise<BooruPost[]> =>
      seedPagesShared(() => searchRef.current, shouldStop, onPage, { perPageTimeoutMs, totalSeedTimeoutMs }),
    [totalSeedTimeoutMs, perPageTimeoutMs]
  )

  const runReal = useCallback(
    async (count: number): Promise<BulkSendResult> => {
      setStatus("seeding")

      // Anti-duplicate loop: derive a prompt for each seeded post (in order),
      // skip prompts too similar to one already accepted, and — if that
      // leaves us short of `count` — request more pages and re-scan the
      // (now larger) post list from scratch. Re-scanning from scratch instead
      // of resuming mid-list is deliberate: it's the only way to keep the
      // NearDuplicateFilter's "already accepted" set consistent, and re-deriving
      // prompts for already-seen posts is cheap (pure string ops, no network).
      let posts = await seedPages(
        (p) => p.length >= count,
        (pageNum) => setProgressLabel(`Preparing… (page ${pageNum})`)
      )

      setStatus("generating")
      setProgressLabel("Cleaning prompts…")

      const buildItems = (candidatePosts: BooruPost[]): BulkSendQueueItem[] => {
        const dupFilter = avoidSimilarPrompts ? new NearDuplicateFilter(similarityThreshold) : null
        const built: BulkSendQueueItem[] = []
        for (const post of candidatePosts) {
          if (built.length >= count) break
          const { displayContent } = derivePostPrompt(post, realCleanOptions)
          const prompt = displayContent.trim()
          if (!prompt) continue
          if (dupFilter && !dupFilter.tryAccept(prompt)) continue
          const resolution = matchResolution
            ? computeGenerationResolution(post.width, post.height, { maxLongSide, strictCap: strictResolutionCap, snapToBucket })
            : null
          if (process.env.NODE_ENV !== "production") {
            console.log("%c[BooruMatchRes:BulkSend]", "color:#8b5cf6;font-weight:bold", `post.width=${post.width} post.height=${post.height} maxLongSide=${maxLongSide} strictResolutionCap=${strictResolutionCap} snapToBucket=${snapToBucket} -> resolution=${resolution ? `${resolution.width}x${resolution.height}` : "null"}`)
          }
          built.push({
            prompt,
            ...(resolution ? { width: resolution.width, height: resolution.height } : {}),
          })
        }
        return built
      }

      let items = buildItems(posts)

      let round = 0
      while (items.length < count && round < MAX_DEDUP_SEED_ROUNDS) {
        const search = searchRef.current
        if (search.noMoreResults || search.sessionCapReached) break
        round++
        setProgressLabel(`Finding more distinct posts… (round ${round})`)
        // Ask for at least one extra page beyond what we already have —
        // shouldStop targets a growing post count so seedPages keeps paging.
        const targetLength = posts.length + 1
        posts = await seedPages(
          (p) => p.length >= targetLength,
          (pageNum) => setProgressLabel(`Finding more distinct posts… (page ${pageNum})`)
        )
        items = buildItems(posts)
      }

      return { items, requested: count, produced: items.length }
    },
    [seedPages, realCleanOptions, matchResolution, maxLongSide, strictResolutionCap, snapToBucket, avoidSimilarPrompts, similarityThreshold]
  )

  const runSynthetic = useCallback(
    async (searchTags: string, count: number): Promise<BulkSendResult> => {
      setStatus("seeding")
      const posts = await seedPages(
        (p) => p.length > 0 && Math.ceil(p.length / 30) >= syntheticSeedPages,
        (pageNum) => setProgressLabel(`Preparing… (page ${pageNum}/${syntheticSeedPages})`)
      )

      setStatus("generating")
      setProgressLabel("Generating variations…")

      const lockedTags = extractLockedTagsFromSearch(searchTags)
      const tagOverrides = syntheticCleanOptions.tagOverrides ?? {}
      const axes = buildAxesFromSeedPosts(posts, lockedTags, tagOverrides)
      const characterTags = detectCharacterTags(lockedTags, posts, tagOverrides)

      // Over-generate candidates so the similarity filter has room to reject
      // near-duplicates and still reach `count` — generateAndFilterPrompts
      // already dedupes EXACT string matches on its own, but two distinct
      // combinations can still land extremely close in tag-set terms (e.g.
      // only a filler tag differs).
      const overGenerateCount = avoidSimilarPrompts ? Math.min(count * 3, 300) : count
      const prompts = generateAndFilterPrompts({
        lockedTags,
        axes,
        characterTags,
        count,
        cleanOptions: syntheticCleanOptions,
        overGenerateCount,
        filterNearDuplicates: avoidSimilarPrompts,
        similarityThreshold,
      })

      const items: BulkSendQueueItem[] = prompts.map((p) => ({ prompt: p.prompt }))

      return { items, requested: count, produced: items.length }
    },
    [seedPages, syntheticCleanOptions, syntheticSeedPages, avoidSimilarPrompts, similarityThreshold]
  )

  const run = useCallback(
    async (mode: BulkSendMode, count: number, searchTags: string): Promise<BulkSendResult> => {
      if (runningRef.current) {
        return { items: [], requested: count, produced: 0 }
      }
      runningRef.current = true
      try {
        const result = mode === "real" ? await runReal(count) : await runSynthetic(searchTags, count)
        setStatus("done")
        setProgressLabel("")
        return result
      } catch (err) {
        setStatus("error")
        setProgressLabel("")
        throw err
      } finally {
        runningRef.current = false
      }
    },
    [runReal, runSynthetic]
  )

  const reset = useCallback(() => {
    setStatus("idle")
    setProgressLabel("")
  }, [])

  return {
    status,
    progressLabel,
    isRunning: status === "seeding" || status === "generating",
    run,
    reset,
  }
}
