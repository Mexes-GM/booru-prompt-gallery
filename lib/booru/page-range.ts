/**
 * Helpers for sampling a search's pages in random order instead of newest
 * first. Pack Mode pages through providers that can't order randomly without
 * spending a tag slot (Danbooru, Aibooru); taking only the newest pages means
 * one uploader's burst of near-identical posts can fill most of the pool.
 */

/**
 * Deepest page sampled. Danbooru gets slow well before its own 1000-page
 * cap (measured: page 300 ~2s, page 600 a 500 error), and 200 pages of 30
 * already spans thousands of posts.
 */
export const MAX_RANDOM_PAGE = 200

/**
 * Last page (1..maxPage) that still has posts, found by binary search with
 * `hasPosts`. Assumes page 1 has posts. One request when the result set
 * reaches `maxPage`, about log2(maxPage) otherwise.
 */
export async function findLastPage(hasPosts: (page: number) => Promise<boolean>, maxPage = MAX_RANDOM_PAGE): Promise<number> {
  if (maxPage <= 1 || (await hasPosts(maxPage))) return Math.max(1, maxPage)
  let lo = 1 // known to have posts
  let hi = maxPage // known to be empty
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (await hasPosts(mid)) lo = mid
    else hi = mid
  }
  return lo
}

/** Pages for a result set of `total` posts at `perPage` per page, capped at maxPage. */
export function lastPageFromCount(total: number, perPage: number, maxPage = MAX_RANDOM_PAGE): number {
  return Math.max(1, Math.min(maxPage, Math.ceil(total / perPage)))
}

/** The post count in a `/counts/posts.json` answer (`{"counts":{"posts":840}}`), or null without one. */
export function countFromResponse(data: unknown): number | null {
  const total = (data as { counts?: { posts?: unknown } } | null)?.counts?.posts
  return typeof total === "number" && Number.isFinite(total) && total >= 0 ? total : null
}

/**
 * The last page of a search: from the site's post count when it gives one (one request),
 * else by binary search over `hasPosts` (findLastPage). A count that fails to arrive counts
 * as missing.
 */
export async function lastPageOf({ count, hasPosts, perPage, maxPage = MAX_RANDOM_PAGE }: {
  count: () => Promise<number | null>
  hasPosts: (page: number) => Promise<boolean>
  perPage: number
  maxPage?: number
}): Promise<{ lastPage: number; count: number | null }> {
  const total = await count().catch(() => null)
  if (total !== null) return { lastPage: lastPageFromCount(total, perPage, maxPage), count: total }
  return { lastPage: await findLastPage(hasPosts, maxPage), count: null }
}

/**
 * Page 1 first (it's what the feed fetches before the range is known, so its
 * request stays valid), then pages 2..lastPage in a seeded random order.
 */
export function randomPageOrder(lastPage: number, rng: () => number): number[] {
  const rest = Array.from({ length: Math.max(0, lastPage - 1) }, (_, i) => i + 2)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  return [1, ...rest]
}
