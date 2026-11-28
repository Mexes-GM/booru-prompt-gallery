/**
 * Page-wide results of the added-tags dataset (lib/added-tags.ts), shared by
 * the gallery cards (hooks/use-dataset-tags.ts) and Pack Mode's pool
 * (lib/pack/dataset-tags.ts). Small and React-free: the loader itself is
 * imported only when a post is first requested, outside the initial bundle.
 */
import type { BooruPost } from "@/lib/booru/types"

/** Highest Danbooru post id the dataset covers (mirrors ADDED_TAGS_MAX_POST_ID in lib/added-tags.ts). */
const MAX_POST_ID = 11_581_021

/** Loads the dataset tags of one post; null when they couldn't be read. */
export type DatasetTagsFetcher = (postId: number) => Promise<string[] | null>

const defaultFetcher: DatasetTagsFetcher = (postId) =>
  import("@/lib/added-tags").then((m) => m.getDatasetTags(postId))

/** Whether a post may be looked up: setting on, a Danbooru post the dataset covers. */
export function wantsDatasetTags(enabled: boolean, provider: string | undefined, post: Pick<BooruPost, "id" | "ai_metadata">): boolean {
  return enabled && provider === "danbooru" && !post.ai_metadata
    && Number.isInteger(post.id) && post.id >= 1 && post.id <= MAX_POST_ID
}

// Results per post id for the whole page. Arrays are kept by identity: callers
// compare them with Object.is to know when to recompute.
const resolved = new Map<number, readonly string[]>()
const EMPTY: readonly string[] = []
let version = 0

/** The post's dataset tags if already loaded on this page (possibly []), else undefined. Never requests. */
export function peekDatasetTags(postId: number): readonly string[] | undefined {
  return resolved.get(postId)
}

/** Grows each time a post's tags arrive, so derived lists know to rebuild. */
export function datasetTagsVersion(): number {
  return version
}

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
  if (!resolved.has(post.id)) {
    resolved.set(post.id, value)
    version++
  }
  return resolved.get(post.id)!
}
