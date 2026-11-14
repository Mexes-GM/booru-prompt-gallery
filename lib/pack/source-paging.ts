/**
 * Paging across the searches of a source plan: each search keeps its own count of
 * pages, of the posts it has brought, and whether it has run out; the next page goes
 * to the search that can bring most.
 *
 * Why a search can run out without the site saying so: Rule34 and Gelbooru are read in
 * random order, a new random draw per page, so a search never returns an empty page.
 * A search with fewer posts than a page (95 posts for a character with a pose) brings
 * the same posts on every page. A page that adds no post the search hadn't brought
 * already ends it: with a random draw of a whole page, a page with nothing new means
 * the search has at most a handful of posts it hasn't shown (all 100 drawn from the
 * ones seen), so one such page is enough (DRY_PAGES_TO_END).
 *
 * Pure: no React, no requests.
 */

/** Pages in a row with no new post that end a search. See the module comment. */
export const DRY_PAGES_TO_END = 1

/**
 * Pages the pack loads by itself, all searches together (each rating's page counts
 * once). Measured: on Rule34 a page of the search without a name brings about 16
 * scenes, so 50 prompts need 3 pages; on Danbooru about 8, so 50 prompts need 7.
 * Fifteen covers a 100-prompt pack on Rule34 and most of one on Danbooru, about a
 * minute at the allowed pace. Past it, "Find more scenes" goes on by hand, up to the
 * session's own cap.
 */
export const AUTO_PAGE_CAP = 15

/** What the pack knows of one search after its last page. */
export interface SearchPaging {
  /** Pages that have arrived. */
  pages: number
  /** Posts the search has brought, without repeats. */
  posts: number
  /** Posts it brought that no search before it in the plan had (what it adds to the pack). */
  adds: number
  /** Posts the last page added to the pack, or null before a page arrived. */
  lastAdds: number | null
  /** Pages in a row that brought the search nothing new. */
  dry: number
}

export const NO_PAGING: SearchPaging = { pages: 0, posts: 0, adds: 0, lastAdds: null, dry: 0 }

/**
 * The paging after a page arrived (`pages` grew), from the search's counts now. Before
 * that (a page on its way, or the same page), it stays as it was.
 */
export function recordPage(prev: SearchPaging, now: { pages: number; posts: number; adds: number }): SearchPaging {
  if (now.pages <= prev.pages) return prev
  const fresh = now.posts - prev.posts
  return {
    pages: now.pages,
    posts: now.posts,
    adds: now.adds,
    lastAdds: now.adds - prev.adds,
    dry: fresh > 0 ? 0 : prev.dry + 1,
  }
}

/** A search has run out when the site says so (an empty page, the last page) or it stopped bringing new posts. */
export const searchEnded = (paging: SearchPaging, siteSaysEnded: boolean): boolean =>
  siteSaysEnded || paging.dry >= DRY_PAGES_TO_END

export interface SearchTurn {
  paging: SearchPaging
  ended: boolean
  failed: boolean
}

/**
 * The search the next page goes to, or -1 when none can bring anything. Never an ended
 * or failed search. Among the others, the one whose last page added most to the pack
 * (a search of 95 posts adds nothing after its first page; one of 138,845 adds about
 * 100 a page); a search that hasn't had a page yet goes first. A search far behind in
 * pages (TURN_GAP) gets its turn, so a large one doesn't keep a smaller one waiting
 * for good. Ties go to the earlier search of the plan (the preferred one).
 */
export const TURN_GAP = 3

export function nextSearch(searches: readonly SearchTurn[]): number {
  const live = searches.map((s, i) => ({ ...s, i })).filter((s) => !s.ended && !s.failed)
  if (live.length === 0) return -1
  const unread = live.find((s) => s.paging.lastAdds === null)
  if (unread) return unread.i
  const most = Math.max(...live.map((s) => s.paging.pages))
  const behind = live.find((s) => most - s.paging.pages >= TURN_GAP && (s.paging.lastAdds ?? 0) > 0)
  if (behind) return behind.i
  let best = live[0]
  for (const s of live) if ((s.paging.lastAdds ?? 0) > (best.paging.lastAdds ?? 0)) best = s
  return best.i
}
