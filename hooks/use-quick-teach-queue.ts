"use client"

import { useCallback, useRef, useState } from "react"
import { PROVIDER_URLS } from "@/lib/constants"
import { cleanPrompt } from "@/lib/cleanPrompt"
import { classifyTags, type TagCategory } from "@/lib/tag-classifier"
import { getSuggestionVoteCounts, type SuggestionVoteCounts } from "@/app/actions/suggestions"

/**
 * Fields requested from Danbooru's `posts.json` for the Quick Teach queue.
 * Deliberately excludes every image field (`file_url`, `large_file_url`,
 * `preview_file_url`, `image_width`, `image_height`) — this mode never
 * displays the post, only its tags, so the response payload stays small
 * and the round trip is fast.
 */
const TAGS_ONLY_FIELDS = "id,tag_string,tag_string_artist,tag_string_character,tag_string_copyright,tag_string_meta,rating"

/** One classified candidate tag waiting to be reviewed in the Quick Teach loop. */
export interface QuickTeachCard {
  tag: string
  /** Danbooru post id the tag was sourced from (for debugging/analytics only). */
  sourcePostId: number
  /**
   * How many pending community suggestions this tag already has, per
   * suggested category (e.g. { appearance: 3, clothing: 1 }). Omitted/empty
   * when the tag has no pending suggestions yet.
   */
  voteCounts?: SuggestionVoteCounts
}

interface RawTagsOnlyPost {
  id: number
  tag_string?: string
  tag_string_artist?: string
  tag_string_character?: string
  tag_string_copyright?: string
  tag_string_meta?: string
  rating?: string
}

/** Builds a tags-only Danbooru `posts.json` random-page URL for the Quick Teach queue. */
function buildQuickTeachUrl(seed: number, pageIndex: number): string {
  const params = new URLSearchParams({
    limit: "40",
    only: TAGS_ONLY_FIELDS,
    page: "1",
    tags: "random:40 rating:general",
    _seed: `${seed}_${pageIndex}`,
  })
  return `${PROVIDER_URLS.DANBOORU}/posts.json?${params.toString()}`
}

const MIN_TAG_LENGTH = 3
const MAX_QUEUE_REFILL_ATTEMPTS = 3

/**
 * Supplies the Quick Teach modal with a deduplicated stream of "unclassified"
 * (`other`) tags sourced from random Danbooru posts — tags-only requests, no
 * images fetched or rendered. Each tag is run through the same
 * `cleanPrompt` -> `classifyTags` pipeline the per-card Teach modal uses
 * (`useCardPrompt.getClassifiedTeachTags`), so only tags the classifier
 * genuinely can't place land in the queue.
 */
export function useQuickTeachQueue(tagOverrides: Record<string, string>) {
  const [queue, setQueue] = useState<QuickTeachCard[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const seenTagsRef = useRef<Set<string>>(new Set())
  // Lazy useState initializer is the React-sanctioned way to compute a
  // non-deterministic one-time value (Math.random) without violating the
  // "components/hooks must be pure during render" rule that a bare
  // `useRef(Math.random())` (evaluated eagerly on every render before the
  // ref discards the recomputed value) trips.
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000))
  const pageIndexRef = useRef(0)

  const fetchBatch = useCallback(async (): Promise<QuickTeachCard[]> => {
    const url = buildQuickTeachUrl(seed, pageIndexRef.current)
    pageIndexRef.current += 1

    const res = await fetch(url, { headers: { Accept: "application/json" } })
    if (!res.ok) {
      throw new Error(`Danbooru request failed (${res.status})`)
    }
    const data: unknown = await res.json()
    if (!Array.isArray(data)) return []

    const candidates: QuickTeachCard[] = []

    for (const raw of data as RawTagsOnlyPost[]) {
      if (!raw || typeof raw.id !== "number" || !raw.tag_string) continue

      const classified = classifyTags(
        cleanPrompt(raw.tag_string, raw.tag_string_artist ?? "", raw.tag_string_character ?? "", raw.tag_string_copyright ?? "", {
          includeCharacters: false,
          includeCopyrights: false,
          optimizeTags: false,
          escapeOutput: false,
          metaTags: raw.tag_string_meta,
          tagOverrides,
        }).split(",").map(t => t.trim()).filter(Boolean),
        tagOverrides,
      )

      for (const tag of classified.other) {
        const key = tag.toLowerCase()
        if (tag.length < MIN_TAG_LENGTH || seenTagsRef.current.has(key)) continue
        seenTagsRef.current.add(key)
        candidates.push({ tag, sourcePostId: raw.id })
      }
    }

    return candidates
  }, [tagOverrides, seed])

  /** (Re)fills the queue, retrying a few pages if a batch has no new unclassified tags. */
  const refill = useCallback(async (targetSize = 15) => {
    setIsLoading(true)
    setError(null)
    try {
      let collected: QuickTeachCard[] = []
      let attempts = 0
      while (collected.length < targetSize && attempts < MAX_QUEUE_REFILL_ATTEMPTS) {
        const batch = await fetchBatch()
        collected = [...collected, ...batch]
        attempts += 1
      }

      // Look up how many pending community suggestions each new tag already
      // has, so the UI can show "Other users suggested: Appearance (3)…"
      // for tags that have received several votes. Best-effort — a failed
      // lookup just means no vote badges are shown, never blocks the queue.
      if (collected.length > 0) {
        try {
          const voteCountsByTag = await getSuggestionVoteCounts(collected.map(c => c.tag))
          collected = collected.map(c => {
            const counts = voteCountsByTag[c.tag]
            return counts && Object.keys(counts).length > 0 ? { ...c, voteCounts: counts } : c
          })
        } catch (voteErr) {
          console.error("[useQuickTeachQueue] vote count lookup failed:", voteErr)
        }
      }

      setQueue(prev => [...prev, ...collected])
      if (collected.length === 0) {
        setError("No new unclassified tags found right now — try again in a bit.")
      }
      return collected.length
    } catch (err) {
      console.error("[useQuickTeachQueue] refill failed:", err)
      setError("Couldn't reach Danbooru. Check your connection and try again.")
      return 0
    } finally {
      setIsLoading(false)
    }
  }, [fetchBatch])

  const dequeue = useCallback(() => {
    setQueue(prev => prev.slice(1))
  }, [])

  const reset = useCallback(() => {
    seenTagsRef.current = new Set()
    setSeed(Math.floor(Math.random() * 1_000_000))
    pageIndexRef.current = 0
    setQueue([])
    setError(null)
  }, [])

  return {
    queue,
    current: queue[0] ?? null,
    remainingInBuffer: queue.length,
    isLoading,
    error,
    refill,
    dequeue,
    reset,
  }
}

export type { TagCategory }
