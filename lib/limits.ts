// ---------------------------------------------------------------------------
// Unified rate-limit configuration — NEXT.js side (F3, rate-limit-antiabuse plan)
//
// SINGLE SOURCE OF TRUTH for the rate-limit thresholds enforced by the Next.js
// API routes and lib/rate-limit.ts. Before this module the numbers were bare
// literals in lib/rate-limit.ts and each route handler.
//
// ⚠️ Mirror of `workers/booru-image-proxy/src/lib/limits.ts`. The two runtimes
// are separate TS projects and cannot import across the boundary — if you change
// a shared value, change it in BOTH files.
//
// SEMANTICS:
//  - `@upstash/ratelimit` sliding-window limiters use (max, "N s|m") and reject
//    when the window is exceeded.
//  - The merged Danbooru EVAL (getDanbooruCombinedLimit) compares
//    `count > max` → reject, like the worker.
// These values are an EXACT extraction of the pre-refactor behavior.
// ---------------------------------------------------------------------------

export interface WindowLimit {
  /** Max requests allowed in the window; `count > max` → reject. */
  max: number
  /** Window length in seconds. */
  windowS: number
}

/** Thresholds for the Next.js API surface. */
export const NEXT_LIMITS = {
  /** Generic per-IP limiter (feedback + misc). */
  general: { max: 10, windowS: 10 },
  /** Auth attempts. */
  auth: { max: 5, windowS: 15 * 60 },
  /** Magic-link email sends. */
  magicLink: { max: 3, windowS: 10 * 60 },
  /**
   * Non-Danbooru providers via /api/posts + /api/download (Upstash sliding
   * window). In-memory fallback is intentionally stricter (see rate-limit.ts).
   */
  danbooruApi: { max: 15, windowS: 10 },
  /**
   * Danbooru hot path (getDanbooruCombinedLimit merged EVAL): a per-IP window
   * and a tighter 1s global burst cap. Reject when `count > max`.
   *
   * `authedMultiplier` (F4, flag-gated): when ADAPTIVE_LIMITS is on and a
   * request carries a verified Supabase session, the per-IP `max` is multiplied
   * by this and the limit is keyed by user id instead of IP. Anonymous traffic
   * is unchanged. Purely additive — logged-in users get more headroom, nobody
   * gets less. The `global` cap is NOT scaled (it's the shared origin budget).
   *
   * TIGHTENED (2026-07-03, real ~500 users/day sizing): the previous
   * perIp=15/global=8-per-1s values were sized for a much larger concurrent
   * user base than this app actually has. At 500 users/day, real concurrent
   * peak is more like 10-30 simultaneous users, not hundreds — so the caps
   * were rewritten to be ~3-4x that realistic peak instead of ~3-4x a
   * hypothetical much-bigger one. This directly reduces the Redis command
   * budget for the aggregate traffic of a normal day, not just abuse spikes.
   */
  danbooruCombined: {
    perIp: { max: 10, windowS: 10 },
    global: { max: 4, windowS: 1 },
    authedMultiplier: 3,
  },
} as const
