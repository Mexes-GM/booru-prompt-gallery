/**
 * Shared "fetch more pages via loadMore() until a condition is met" helper,
 * extracted from hooks/use-bulk-send.ts so Pack Mode can reuse the exact same
 * seeding strategy (and its anti-abuse guard respect) without duplicating it.
 *
 * Fetching more pages is done exclusively through `search.loadMore()` (never
 * by reaching into SWR's `setSize` directly) so callers reuse — instead of
 * bypassing — useBooruSearch's existing anti-abuse guards: the sliding-window
 * scroll rate limiter (max 2 loads / 10s) and the 35-page session cap. This
 * function simply waits for a load to settle (or for those guards to signal
 * it should stop) before requesting the next page.
 */
import type { BooruPost } from "./types"

/** Minimal slice of useBooruSearch this helper needs — kept narrow so it's
 *  easy to pass a fake in tests, and so callers don't silently start
 *  depending on more of the search hook's surface over time. */
export interface SeedPagesSearchSlice {
  allPosts: BooruPost[]
  isLoadingMore: boolean
  noMoreResults: boolean
  sessionCapReached: boolean
  scrollLimited: boolean
  loadMore: () => void
}

export interface SeedPagesOptions {
  /** Max ms to wait for one loadMore() to settle before giving up on seeding further. */
  perPageTimeoutMs?: number
  /** Max ms for the whole seeding phase, across all pages. */
  totalSeedTimeoutMs?: number
}

const DEFAULT_PER_PAGE_TIMEOUT_MS = 8_000
const DEFAULT_TOTAL_SEED_TIMEOUT_MS = 45_000
const POLL_INTERVAL_MS = 150

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Requests more pages via search.loadMore() until `shouldStop(posts)` returns
 * true, or a stop condition fires: noMoreResults, sessionCapReached (both
 * existing useBooruSearch anti-abuse signals), or a timeout. Each loadMore()
 * call waits for isLoadingMore to settle (with its own per-page timeout)
 * before deciding whether to request another page — this naturally respects
 * the scroll rate limiter too, since loadMore() itself refuses to advance
 * while scrollLimited is true (this just polls and retries after the
 * cooldown like a normal caller would).
 *
 * `getSearch` is a getter, not a static snapshot: React re-renders replace
 * `allPosts` (and every other field) with new references on every fetch, so
 * a plain object captured once at call time would go stale the moment the
 * first `loadMore()` lands — this function's own `while` loop would then
 * spin on the exact same "no new posts yet" data forever. Callers should
 * back the getter with a ref that's kept in sync with the latest render (see
 * hooks/use-pack-seed.ts for the pattern), or pass `() => search` directly
 * when `search` is already a stable ref/store object.
 */
export async function seedPages(
  getSearch: () => SeedPagesSearchSlice,
  shouldStop: (posts: BooruPost[]) => boolean,
  onPage?: (pageNum: number) => void,
  options: SeedPagesOptions = {}
): Promise<BooruPost[]> {
  const {
    perPageTimeoutMs = DEFAULT_PER_PAGE_TIMEOUT_MS,
    totalSeedTimeoutMs = DEFAULT_TOTAL_SEED_TIMEOUT_MS,
  } = options

  const startedAt = Date.now()
  let pageNum = 0

  while (!shouldStop(getSearch().allPosts)) {
    const search = getSearch()
    if (search.noMoreResults || search.sessionCapReached) break
    if (Date.now() - startedAt > totalSeedTimeoutMs) break

    pageNum++
    onPage?.(pageNum)
    search.loadMore()

    // Wait for this page to settle (isLoadingMore -> false), bounded by
    // perPageTimeoutMs so a stalled/rate-limited fetch can't hang the whole
    // operation — the outer totalSeedTimeoutMs is the hard ceiling.
    const pageStartedAt = Date.now()
    // Give loadMore's own state updates a tick to land before polling.
    await sleep(POLL_INTERVAL_MS)
    while (getSearch().isLoadingMore && Date.now() - pageStartedAt < perPageTimeoutMs) {
      await sleep(POLL_INTERVAL_MS)
    }
    // If the scroll rate limiter is active, wait it out (it self-clears)
    // rather than treating it as a stop condition — it's a pace guard, not an
    // end-of-results signal.
    while (getSearch().scrollLimited && Date.now() - startedAt < totalSeedTimeoutMs) {
      await sleep(POLL_INTERVAL_MS)
    }
  }

  return getSearch().allPosts
}
