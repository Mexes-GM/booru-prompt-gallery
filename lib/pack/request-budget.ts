/**
 * One pack's request budget: every request its source sends (the first page of each search,
 * the later pages, the page counts), all searches and ratings together, for as long as the
 * pack's source runs. A change of plan doesn't start a new budget.
 *
 * The two caps keep what the page caps meant, counted in requests instead of pages (a page
 * of a two-rating search is two requests):
 *  - AUTO_REQUEST_CAP: what the pack loads by itself. The page cap it replaces was 15 pages,
 *    about 30 requests on a two-rating pack, plus the page-range probes it didn't count
 *    (8 or 9 per search and rating). A typical pack stops well before: its first pages
 *    and one or two more are enough.
 *  - SESSION_REQUEST_CAP: past it, "Find more scenes" stops too. The session cap it replaces
 *    was 35 pages, about 70 requests on a two-rating pack.
 *
 * Pure: a small store with subscribe/getSnapshot for useSyncExternalStore.
 */

export const AUTO_REQUEST_CAP = 30
export const SESSION_REQUEST_CAP = 70

export class PackRequestBudget {
  private spentCount = 0
  private readonly listeners = new Set<() => void>()

  /** Requests sent so far. */
  get spent(): number {
    return this.spentCount
  }

  /** Counts `n` requests sent. */
  record(n = 1): void {
    if (n <= 0) return
    this.spentCount += n
    this.listeners.forEach((listener) => listener())
  }

  /** True when `n` more requests stay within the session cap. */
  allows(n = 1): boolean {
    return this.spentCount + n <= SESSION_REQUEST_CAP
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot = (): number => this.spentCount
}
