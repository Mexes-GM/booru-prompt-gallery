/**
 * Verification tests for the NSFW consent friction decision logic
 * (lib/nsfw-consent.ts) — Capa 2 (NSFW toggle) and Capa 3 (Rule34 provider).
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/nsfw-consent.verify.ts
 */
import {
  SAFE_RATING,
  ALL_RATING,
  ADULT_ONLY_PROVIDER,
  shouldConfirmNsfwEnable,
  nextRatingFilter,
  shouldConfirmProvider,
} from "../lib/nsfw-consent"

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

// ── Capa 2: NSFW enable confirmation ──
{
  // Safe → NSFW, not acknowledged yet => must confirm.
  assert(
    shouldConfirmNsfwEnable(SAFE_RATING, false) === true,
    "capa2: Safe→NSFW without ack requires confirmation",
  )
  // Safe → NSFW, already acknowledged => no confirmation (instant).
  assert(
    shouldConfirmNsfwEnable(SAFE_RATING, true) === false,
    "capa2: Safe→NSFW with ack is instant",
  )
  // NSFW → Safe never needs confirmation, regardless of ack state.
  assert(
    shouldConfirmNsfwEnable(ALL_RATING, false) === false,
    "capa2: NSFW→Safe never confirms (no ack)",
  )
  assert(
    shouldConfirmNsfwEnable(ALL_RATING, true) === false,
    "capa2: NSFW→Safe never confirms (with ack)",
  )
}

// ── nextRatingFilter: pure toggle value ──
{
  assert(nextRatingFilter(SAFE_RATING) === ALL_RATING, "toggle: safe → all")
  assert(nextRatingFilter(ALL_RATING) === SAFE_RATING, "toggle: all → safe")
  // Any non-safe value toggles back to safe.
  assert(nextRatingFilter("rating:explicit") === SAFE_RATING, "toggle: non-safe → safe")
}

// ── Capa 3: Rule34 provider confirmation ──
{
  // Selecting Rule34 without ack => must confirm.
  assert(
    shouldConfirmProvider(ADULT_ONLY_PROVIDER, false) === true,
    "capa3: rule34 without ack requires confirmation",
  )
  // Selecting Rule34 with ack => instant.
  assert(
    shouldConfirmProvider(ADULT_ONLY_PROVIDER, true) === false,
    "capa3: rule34 with ack is instant",
  )
  // Non-adult providers never confirm, ack irrelevant.
  for (const p of ["danbooru", "gelbooru", "aibooru", "e621"]) {
    assert(
      shouldConfirmProvider(p, false) === false,
      `capa3: ${p} never confirms (no ack)`,
    )
    assert(
      shouldConfirmProvider(p, true) === false,
      `capa3: ${p} never confirms (with ack)`,
    )
  }
}

// ── constant sanity ──
{
  assert(SAFE_RATING === "rating:general", "const: SAFE_RATING value")
  assert(ALL_RATING === "all", "const: ALL_RATING value")
  assert(ADULT_ONLY_PROVIDER === "rule34", "const: ADULT_ONLY_PROVIDER value")
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
