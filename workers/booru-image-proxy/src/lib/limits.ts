// ---------------------------------------------------------------------------
// Unified rate-limit configuration — WORKER side (F3, rate-limit-antiabuse plan)
//
// SINGLE SOURCE OF TRUTH for every rate-limit threshold enforced by the
// Cloudflare Worker. Before this module the numbers (15, 600, 90, 480, 60, 30,
// 100, 20…) lived as bare literals scattered across routes/*.ts, so tuning one
// limit meant hunting through several files. Now each route reads from here.
//
// ⚠️ Mirror of `lib/limits.ts` on the Next.js side. The two runtimes are
// separate TS projects and cannot import across the boundary, so if you change
// a shared value, change it in BOTH files (same pattern as logger.ts).
//
// SEMANTICS: every route compares `count > max` → reject (strict greater-than),
// where `count` is the post-increment value from INCR. So `max` is the last
// value that is still allowed. These values are an EXACT extraction of the
// pre-refactor behavior — no effective change.
//
// BUDGET NOTE (for F4): the `global` caps bound total outbound pressure on a
// shared origin (donmai's ~10 req/s per shared egress IP). The `perIp` caps
// bound a single client. Keep the sum of globals within the Upstash free tier
// (500K commands/month ≈ 16.6K/day) and Workers free tier (100K req/day).
//
// F4 — explicit budget calculation (2026-07-03, ~500 users/day baseline):
//
// TIGHTENED (2026-07-03, second pass): the original global caps below were
// sized for a much larger concurrent user base than this app actually has.
// At 500 users/day, real concurrent peak is more like 10-30 simultaneous
// users, not hundreds. The values were rewritten to be ~3-4x that realistic
// peak instead of ~3-4x a hypothetical much-bigger one — this reduces the
// aggregate Redis command budget for a NORMAL day's traffic, not just abuse
// spikes (which Fase 1's short-circuit already contains cheaply).
//
//   Surface          | global max | window | commands/req | worst-case cmd/day
//   -----------------|-----------:|-------:|--------------:|-------------------:
//   image             |        150 |    60s | 1 (merged EVAL)| 150 * (86400/60)  = 216,000 ceiling*
//   postsDanbooru     |        120 |    60s | 1 (merged EVAL)| 120 * (86400/60)  = 172,800 ceiling*
//   downloadDanbooru  |         40 |    60s | 1 (merged EVAL)|  40 * (86400/60)  =  57,600 ceiling*
//
//   * These are the THEORETICAL ceiling if the global bucket were saturated
//     100% of every minute, 24/7 — i.e. an ongoing attack, not real traffic.
//     They are NOT the expected spend; they are the worst-case upper bound
//     the limiter itself enforces. Real spend is bounded by actual demand
//     (~500 users/day × a few requests/session ≈ low thousands of commands/
//     day), and Fase 1 (short-circuit already-blocked keys) means a sustained
//     flood only pays the EVAL cost once per window, not once per request.
//   Sum of worst-case ceilings across the three Redis-metered surfaces above
//   is now ~450K cmd/day if all three were saturated simultaneously and
//   forever (down from ~1.7M before this pass) — still intentionally above
//   the exact 16.6K/day Upstash average, because Fase 2 (edge WAF, $0, cuts
//   floods off before they reach the Worker/Redis at all) is the layer meant
//   to actually keep sustained-attack spend low; these app-level caps are the
//   last line of defense, now sized closer to this app's real concurrency
//   instead of a generic "big app" assumption. Fase 0 telemetry
//   (`ratelimit_block` logs) is what confirms real-world spend stays in the
//   low-thousands/day range documented in redis-optimization-plan.md
//   (~77K/day was the ABUSE incident this whole plan responds to, already cut
//   by Fase 1 short-circuiting + Fase 2 edge rules pending manual WAF setup).
//
// F4 — authedMultiplier: when ADAPTIVE_LIMITS='1' and a request carries a
// verified Supabase access token (Authorization: Bearer <jwt>, checked by
// rate-limit-identity.ts), the PER-IP max for that surface is multiplied by
// `authedMultiplier` and the limiter key switches from `anon:<ip>` to
// `authed:<userId>`. The `global` cap is NEVER scaled — it is the shared
// origin budget and must hold regardless of how many callers are logged in.
// Flag off (default) → key and limit are IDENTICAL to pre-F4 behavior.
// ---------------------------------------------------------------------------

export interface WindowLimit {
  /** Max requests allowed in the window; comparison is `count > max` → reject. */
  max: number
  /** Window length in seconds (TTL of the Redis counter key). */
  windowS: number
}

export interface SurfaceLimits {
  /** Per-client (per-IP) window. */
  perIp: WindowLimit
  /** Optional shared/global window across all clients. */
  global?: WindowLimit
  /** F4 (flag-gated): multiplier applied to `perIp.max` for authed users. */
  authedMultiplier?: number
}

/** All worker rate-limit thresholds, grouped by surface + origin sensitivity. */
export const WORKER_LIMITS = {
  /** Image proxy (Gelbooru/Rule34 bytes) — cache-miss only. */
  image: {
    perIp: { max: 10, windowS: 10 },
    global: { max: 150, windowS: 60 },
    authedMultiplier: 2,
  },
  /** Posts search — Danbooru (most origin-sensitive: per-IP + global). */
  postsDanbooru: {
    perIp: { max: 40, windowS: 60 },
    global: { max: 120, windowS: 60 },
    authedMultiplier: 2,
  },
  /** Posts search — other providers (per-IP only). */
  postsOther: {
    perIp: { max: 60, windowS: 60 },
    authedMultiplier: 2,
  },
  /** Image download — Danbooru (per-IP + global). */
  downloadDanbooru: {
    perIp: { max: 30, windowS: 60 },
    global: { max: 40, windowS: 60 },
    authedMultiplier: 2,
  },
  /** Image download — other providers (per-IP only). */
  downloadOther: {
    perIp: { max: 20, windowS: 60 },
    authedMultiplier: 2,
  },
  /** Tag-count / autocomplete lookups (hits external booru APIs). */
  tags: {
    perIp: { max: 20, windowS: 60 },
    authedMultiplier: 2,
  },
} as const satisfies Record<string, SurfaceLimits>
