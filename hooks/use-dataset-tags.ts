"use client"

import { useEffect, useReducer } from "react"
import type { BooruPost } from "@/lib/booru/types"

/** Highest Danbooru post id the added-tags dataset covers (mirrors ADDED_TAGS_MAX_POST_ID in lib/added-tags.ts). */
const MAX_POST_ID = 11_581_021

/** Loads the dataset tags of one post. The loader module is fetched on first use, outside the initial bundle. */
export type DatasetTagsFetcher = (postId: number) => Promise<string[] | null>

const defaultFetcher: DatasetTagsFetcher = (postId) =>
  import("@/lib/added-tags").then((m) => m.getDatasetTags(postId))

/** Whether a card may ask the dataset for its post: setting on, a Danbooru post the dataset covers. */
export function wantsDatasetTags(enabled: boolean, provider: string | undefined, post: Pick<BooruPost, "id" | "ai_metadata">): boolean {
  return enabled && provider === "danbooru" && !post.ai_metadata
    && Number.isInteger(post.id) && post.id >= 1 && post.id <= MAX_POST_ID
}

// Results per post id for the whole page, so a card scrolled back into view
// (the grid unmounts off-screen cards) renders its tags on the first paint.
// Arrays are kept by identity: useCardPrompt's cache compares them with Object.is.
const resolved = new Map<number, readonly string[]>()
const EMPTY: readonly string[] = []

/**
 * Requests a post's dataset tags (see wantsDatasetTags) and resolves to them,
 * or to null without asking anything. Failures resolve to null and aren't
 * remembered here; the loader decides when a block may be tried again.
 */
export async function requestDatasetTags(
  enabled: boolean,
  provider: string | undefined,
  post: Pick<BooruPost, "id" | "ai_metadata">,
  fetcher: DatasetTagsFetcher = defaultFetcher,
): Promise<readonly string[] | null> {
  if (!wantsDatasetTags(enabled, provider, post)) return null
  const known = resolved.get(post.id)
  if (known) return known
  const tags = await fetcher(post.id).catch(() => null)
  if (!tags) return null
  const value = tags.length > 0 ? tags : EMPTY
  resolved.set(post.id, value)
  return value
}

/**
 * The dataset tags of a card's post, once loaded; undefined before that, on
 * failure, or when wantsDatasetTags says no (then nothing is requested).
 * Cards mount only near the viewport (MasonryGrid virtualizes), so mounting is
 * the visibility signal: no observer of its own.
 */
export function useDatasetTags(post: BooruPost, provider: string | undefined, enabled: boolean): readonly string[] | undefined {
  const wanted = wantsDatasetTags(enabled, provider, post)
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const postId = post.id
  const aiMetadata = post.ai_metadata

  useEffect(() => {
    if (!wanted || resolved.has(postId)) return
    let cancelled = false
    void requestDatasetTags(true, provider, { id: postId, ai_metadata: aiMetadata }).then((tags) => {
      if (!cancelled && tags && tags.length > 0) rerender()
    })
    return () => { cancelled = true }
  }, [wanted, provider, postId, aiMetadata])

  if (!wanted) return undefined
  const tags = resolved.get(postId)
  return tags && tags.length > 0 ? tags : undefined
}
