/**
 * Verification tests for History display ordering (lib/history-order.ts).
 *
 * Regression: History stopped being sorted newest→oldest because
 * `useHistoryPosts` (hooks/use-history-posts.ts) used to freeze each post's
 * display slot the first time it was shown (`orderRef`), to work around
 * MasonryGrid mis-animating existing cards as "new" on reorder. That
 * workaround silently broke the newest-first contract: re-copying an
 * already-present post no longer moved it to the front. The real fix was in
 * MasonryGrid (ID-based new-item diffing instead of index-based), which let
 * `useHistoryPosts` go back to exposing the raw deduped newest-first order
 * untouched.
 *
 * These tests cover `dedupeHistoryKeys`, the pure function that directly
 * produces the History display order.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/history-order.verify.ts
 */
import { dedupeHistoryKeys } from "../lib/history-order"
import type { BooruProvider } from "../lib/booru/types"

let passed = 0
let failed = 0

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++
  } else {
    failed++
    console.error(`FAIL: ${label}`)
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  assert(a === e, `${label} (got ${a}, expected ${e})`)
}

// "Danbooru" (mixed case) is intentionally allowed through as `any` for the
// case-insensitivity test below — BooruProvider values are normally
// lowercase already, but the key-matching must not break if that ever slips.
function mk(provider: BooruProvider | string, postId: number) {
  return { provider: provider as BooruProvider, postId }
}

// ── Basic newest-first passthrough ──
{
  const history = [
    mk("danbooru", 3),
    mk("danbooru", 2),
    mk("danbooru", 1),
  ]
  assertDeepEqual(
    dedupeHistoryKeys(history),
    ["danbooru:3", "danbooru:2", "danbooru:1"],
    "newest-first order preserved with no duplicates",
  )
}

// ── Re-copying an existing post moves it to the front (the actual bug) ──
{
  // Simulates: copy A, copy B, copy C, then re-copy A. addToHistory always
  // prepends, so the raw history (as read from storage) looks like this:
  const history = [
    mk("danbooru", 1), // re-copy of A (newest)
    mk("danbooru", 3), // C
    mk("danbooru", 2), // B
    mk("danbooru", 1), // original copy of A (oldest)
  ]
  assertDeepEqual(
    dedupeHistoryKeys(history),
    ["danbooru:1", "danbooru:3", "danbooru:2"],
    "re-copying an existing post moves it to the front, not frozen at its original slot",
  )
}

// ── Dedup keeps only the first (newest) occurrence ──
{
  const history = [
    mk("danbooru", 5),
    mk("danbooru", 5),
    mk("danbooru", 5),
  ]
  assertDeepEqual(
    dedupeHistoryKeys(history),
    ["danbooru:5"],
    "duplicate copies of the same post collapse to a single entry",
  )
}

// ── Provider is part of the identity (same postId, different provider) ──
{
  const history = [
    mk("gelbooru", 1),
    mk("danbooru", 1),
  ]
  assertDeepEqual(
    dedupeHistoryKeys(history),
    ["gelbooru:1", "danbooru:1"],
    "same postId on different providers are distinct entries",
  )
}

// ── Case-insensitive key matching ──
{
  const history = [
    mk("Danbooru", 1),
    mk("danbooru", 1),
  ]
  assertDeepEqual(
    dedupeHistoryKeys(history),
    ["danbooru:1"],
    "provider casing does not create duplicate keys",
  )
}

// ── Empty history ──
{
  assertDeepEqual(dedupeHistoryKeys([]), [], "empty history yields empty key list")
}

// ── Snapshot's own _provider wins over a stale/wrong `provider` field ──
// Regression: `item.provider` used to be written from whichever provider TAB
// was active at copy time, not the copied post's actual provider. A post
// that only exists on Gelbooru could end up with `provider: "aibooru"` while
// its embedded snapshot correctly says `_provider: "gelbooru"`. The key must
// follow the snapshot so "View original post" links (built from this same
// provider) point at the booru the post actually lives on.
{
  const history = [
    { provider: "aibooru" as BooruProvider, postId: 42, post: { _provider: "gelbooru" } as any },
  ]
  assertDeepEqual(
    dedupeHistoryKeys(history),
    ["gelbooru:42"],
    "mismatched item.provider is overridden by the snapshot's own _provider",
  )
}

// ── No snapshot falls back to item.provider unchanged ──
{
  const history = [
    mk("rule34", 7),
  ]
  assertDeepEqual(
    dedupeHistoryKeys(history),
    ["rule34:7"],
    "legacy entries with no snapshot still key off item.provider",
  )
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
