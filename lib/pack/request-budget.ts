/**
 * One pack's request budget: every request its source sends (the first page of each search,
 * the later pages, the page counts), all searches and ratings together, for as long as the
 * pack's source runs. A change of plan doesn't start a new budget.
 *
 * The caps keep the page caps they replace, counted in requests: a page of a search is one
 * request per rating the source asks for, so each cap is its old page count times the
 * plan's ratings (requestCaps). No pack goes past what the page caps allowed, and a
 * one-rating pack doesn't get twice the pages of a two-rating one.
 *  - Automatic: what the pack loads by itself. The page cap was 15 pages, plus the
 *    page-range probes it didn't count (8 or 9 per search and rating). A typical pack stops
 *    well before: its first pages and one or two more are enough.
 *  - Session: past it, "Find more scenes" stops too. The session cap was 35 pages.
 *
 * Pure: a small store with subscribe/getSnapshot for useSyncExternalStore.
 */
import { MAX_RATINGS } from "./source-plan"

/** Old AUTO_PAGE_CAP: requests the pack loads by itself, per rating. */
export const AUTO_REQUESTS_PER_RATING = 15
/** Old MAX_SESSION_PAGE_LOADS: requests by hand and by itself together, per rating. */
export const SESSION_REQUESTS_PER_RATING = 35

export interface RequestCaps {
  auto: number
  session: number
}

/** The caps of a source that asks for `ratings` ratings (1..MAX_RATINGS). The one place they are worked out. */
export function requestCaps(ratings: number): RequestCaps {
  const r = Math.min(MAX_RATINGS, Math.max(1, Math.floor(ratings) || 1))
  return { auto: AUTO_REQUESTS_PER_RATING * r, session: SESSION_REQUESTS_PER_RATING * r }
}

/** The caps of a two-rating pack: the largest a pack gets. */
export const AUTO_REQUEST_CAP = requestCaps(MAX_RATINGS).auto
export const SESSION_REQUEST_CAP = requestCaps(MAX_RATINGS).session

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

  /** True when `n` more requests stay within the session cap (by default, a two-rating pack's). */
  allows(n = 1, sessionCap = SESSION_REQUEST_CAP): boolean {
    return this.spentCount + n <= sessionCap
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot = (): number => this.spentCount
}
