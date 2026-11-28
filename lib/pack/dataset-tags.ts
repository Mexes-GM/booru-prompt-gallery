/**
 * Pack Mode's side of the added-tags dataset: Danbooru posts in the pool get
 * the clothing, scenery and framing tags their image shows but they aren't
 * tagged with, appended to their tag_string. Everything downstream (slot
 * classification, scene permanence, blocked themes, conflict resolution,
 * cleaning) then reads them like the post's own tags.
 *
 * The pool cache (pool-cache.ts) keeps the posts as fetched; tags are added
 * when the pool is read, so turning the setting off leaves no trace in it.
 *
 * The network never holds a pack up: prefetchPoolDatasetTags waits at most a
 * time budget, then the pack is built with whatever arrived. Requests still in
 * flight finish in the background and serve the next pack.
 */
import type { BooruPost } from "../booru/types"
import { peekDatasetTags, requestDatasetTags, wantsDatasetTags, type DatasetTagsFetcher } from "../dataset-tags-cache"

/** How long a pack waits for dataset tags at most. */
export const POOL_DATASET_BUDGET_MS = 2500
/** Posts asked about per prefetch, newest first; the rest wait for a later one. */
export const POOL_DATASET_MAX_POSTS = 150

const tagKey = (tag: string) => tag.trim().toLowerCase().replace(/\s+/g, "_")

/** The post with `tags` appended to its tag_string, minus those it already has; the same object when nothing is new. */
export function withDatasetTags(post: BooruPost, tags: readonly string[] | undefined): BooruPost {
  if (!tags || tags.length === 0) return post
  const own = new Set((post.tag_string || "").split(/\s+/).filter(Boolean).map(tagKey))
  const extra: string[] = []
  for (const tag of tags) {
    const key = tagKey(tag)
    if (!key || own.has(key)) continue
    own.add(key)
    extra.push(key)
  }
  if (extra.length === 0) return post
  return { ...post, tag_string: post.tag_string ? `${post.tag_string} ${extra.join(" ")}` : extra.join(" ") }
}

// One enriched copy per post object and tag list, so repeated reads of the
// pool hand out the same objects (memoized consumers stay put).
const enrichedCopies = new WeakMap<BooruPost, { tags: readonly string[]; post: BooruPost }>()

/**
 * The pool with dataset tags added to every post that has some loaded already.
 * Never requests anything; with the setting off or on another booru it returns
 * `posts` untouched.
 */
export function enrichPoolPosts(
  posts: BooruPost[],
  enabled: boolean,
  provider: string | undefined,
  lookup: (postId: number) => readonly string[] | undefined = peekDatasetTags,
): BooruPost[] {
  if (!enabled || provider !== "danbooru") return posts
  let changed = false
  const out = posts.map((post) => {
    if (!wantsDatasetTags(enabled, provider, post)) return post
    const tags = lookup(post.id)
    if (!tags || tags.length === 0) return post
    const hit = enrichedCopies.get(post)
    if (hit && hit.tags === tags) {
      changed ||= hit.post !== post
      return hit.post
    }
    const next = withDatasetTags(post, tags)
    enrichedCopies.set(post, { tags, post: next })
    changed ||= next !== post
    return next
  })
  return changed ? out : posts
}

/**
 * Asks for the dataset tags of the pool's posts not loaded yet (up to
 * POOL_DATASET_MAX_POSTS, in pool order) and resolves once they're all in or
 * `budgetMs` has passed, whichever comes first. Resolves at once with the
 * setting off, on another booru, or when every post is already known; requests
 * during a rate-limit pause fail straight away, so it doesn't wait then either.
 * Resolves to how many posts were looked up in time.
 */
export async function prefetchPoolDatasetTags(
  posts: BooruPost[],
  {
    enabled,
    provider,
    budgetMs = POOL_DATASET_BUDGET_MS,
    maxPosts = POOL_DATASET_MAX_POSTS,
    fetcher,
  }: { enabled: boolean; provider: string | undefined; budgetMs?: number; maxPosts?: number; fetcher?: DatasetTagsFetcher },
): Promise<number> {
  if (!enabled || provider !== "danbooru") return 0
  const pending: BooruPost[] = []
  const seen = new Set<number>()
  for (const post of posts) {
    if (pending.length >= maxPosts) break
    if (seen.has(post.id) || !wantsDatasetTags(enabled, provider, post) || peekDatasetTags(post.id)) continue
    seen.add(post.id)
    pending.push(post)
  }
  if (pending.length === 0) return 0

  let done = 0
  const all = Promise.all(pending.map((post) =>
    requestDatasetTags(enabled, provider, post, fetcher).then(() => { done++ }),
  ))
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, budgetMs) })
  await Promise.race([all, timeout])
  clearTimeout(timer)
  return done
}
