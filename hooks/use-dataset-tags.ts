"use client"

import { useEffect, useReducer } from "react"
import type { BooruPost } from "@/lib/booru/types"
import { peekDatasetTags, requestDatasetTags, wantsDatasetTags } from "@/lib/dataset-tags-cache"

/**
 * The dataset tags of a card's post, once loaded; undefined before that, on
 * failure, or when wantsDatasetTags says no (then nothing is requested).
 * Cards mount only near the viewport (MasonryGrid virtualizes), so mounting is
 * the visibility signal: no observer of its own. A card scrolled back into
 * view renders its tags on the first paint from the page-wide results.
 */
export function useDatasetTags(post: BooruPost, provider: string | undefined, enabled: boolean): readonly string[] | undefined {
  const wanted = wantsDatasetTags(enabled, provider, post)
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const postId = post.id
  const aiMetadata = post.ai_metadata

  useEffect(() => {
    if (!wanted || peekDatasetTags(postId)) return
    let cancelled = false
    void requestDatasetTags(true, provider, { id: postId, ai_metadata: aiMetadata }).then((tags) => {
      if (!cancelled && tags && tags.length > 0) rerender()
    })
    return () => { cancelled = true }
  }, [wanted, provider, postId, aiMetadata])

  if (!wanted) return undefined
  const tags = peekDatasetTags(postId)
  return tags && tags.length > 0 ? tags : undefined
}
