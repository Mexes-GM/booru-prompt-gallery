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
   * F4 — budget calculation (2026-07-03, ~500 users/day baseline): the
   * `global` cap (8 req/1s) bounds this Next.js surface's outbound pressure on
   * Danbooru independently of the Worker's own `postsDanbooru.global` (this
   * app has two origins hitting Danbooru: the Worker for /api/posts+download,
   * and this Next.js API for the same routes when NEXT_PUBLIC_IMAGE_PROXY_URL
   * is unset, i.e. local dev / same-origin fallback — the two are never both
   * "live" for the same request, so their ceilings aren't additive in
   * practice). Worst-case ceiling if saturated 24/7: 8/s * 86400s = 691,200
   * req/day — again a theoretical upper bound the limiter enforces, not the
   * expected spend (see workers/booru-image-proxy/src/lib/limits.ts for the
   * full explanation of why this ceiling deliberately exceeds a byte-for-byte
   * Upstash budget: Fase 2's free edge WAF is the layer that actually keeps
   * real spend near the ~sub-1% low-thousands/day documented in
   * redis-optimization-plan.md, not this app-level cap alone).
   */
  danbooruCombined: {
    perIp: { max: 15, windowS: 10 },
    global: { max: 8, windowS: 1 },
    authedMultiplier: 3,
  },
} as const
