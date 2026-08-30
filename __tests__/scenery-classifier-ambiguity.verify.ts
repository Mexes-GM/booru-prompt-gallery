/**
 * Regression tests for the scenery keyword-matching false-positive fix
 * (lib/tag-classifier.ts).
 *
 * Bug found via a real-data audit of Pack Mode output against the e621 API
 * (2026-08-27): standalone-word matching on ambiguous scenery keywords
 * ("star", "night", "day") pulled unrelated tags into the scenery axis pool:
 *   - "friday night funkin" (a copyright/crossover tag) matched via "night".
 *   - "star ear ring" (an accessory) matched via "star", because it didn't
 *     end in any of CLOTHING_SUFFIXES, so the Clothing check never got a
 *     chance to claim it first.
 * A generated pack's scenery axis then visibly mixed real scenery with this
 * noise (e.g. "sky, friday night funkin'" in one prompt).
 *
 * Covers:
 *   1. The two real false positives no longer classify as 'scenery'.
 *   2. Accessory tags with an ambiguous scenery word are caught by the new
 *      CLOTHING_SUFFIXES entries (ring, pendant, etc.) instead.
 *   3. Legitimate multi-word scenery PHRASES using the same ambiguous words
 *      ("starry sky", "night sky") still classify as 'scenery'.
 *   4. Unambiguous scenery keywords that were never touched by this fix
 *      (sky, water, beach, forest, ...) are unaffected.
 *   5. A bare "star"/"night"/"day" tag (no longer scenery on its own) falls
 *      through to whatever the other rules decide, same as any other
 *      unmatched word — it does not silently disappear or crash.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/scenery-classifier-ambiguity.verify.ts
 */
import { classifyTag } from "../lib/tag-classifier"

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

// ── 1) The two real false positives found in the audit no longer land in 'scenery' ──
{
  const cat = classifyTag("friday night funkin")
  assert(cat !== "scenery", `'friday night funkin' is no longer classified as scenery (got '${cat}')`)
}
{
  const cat = classifyTag("star ear ring")
  assert(cat !== "scenery", `'star ear ring' is no longer classified as scenery (got '${cat}')`)
}

// ── 2) Accessory tags with an ambiguous scenery word are now caught as clothing ──
{
  assert(classifyTag("star ear ring") === "clothing", "'star ear ring' classifies as clothing (jewelry suffix 'ring')")
  assert(classifyTag("moon pendant") === "clothing", "'moon pendant' classifies as clothing (jewelry suffix 'pendant')")
  assert(classifyTag("star bracelet") === "clothing", "'star bracelet' classifies as clothing (jewelry suffix 'bracelet')")
}

// ── 3) Legitimate scenery PHRASES using the same ambiguous words still work ──
{
  assert(classifyTag("starry sky") === "scenery", "'starry sky' still classifies as scenery")
  assert(classifyTag("night sky") === "scenery", "'night sky' still classifies as scenery")
  assert(classifyTag("starry night") === "scenery", "'starry night' still classifies as scenery")
  assert(classifyTag("shooting star") === "scenery", "'shooting star' still classifies as scenery")
  assert(classifyTag("sunny day") === "scenery", "'sunny day' still classifies as scenery")
}

// ── 4) Unambiguous scenery keywords (never touched by this fix) are unaffected ──
{
  assert(classifyTag("sky") === "scenery", "'sky' alone still classifies as scenery")
  assert(classifyTag("water") === "scenery", "'water' alone still classifies as scenery")
  assert(classifyTag("beach") === "scenery", "'beach' still classifies as scenery")
  assert(classifyTag("forest") === "scenery", "'forest' still classifies as scenery")
  assert(classifyTag("mountain") === "scenery", "'mountain' still classifies as scenery")
  assert(classifyTag("indoors") === "scenery", "'indoors' still classifies as scenery")
}

// ── 5) A bare ambiguous word (no longer auto-scenery) doesn't crash and just
//      falls through to whatever else it matches (or 'other') ──
{
  const starCat = classifyTag("star")
  assert(typeof starCat === "string" && starCat.length > 0, `bare 'star' still returns a valid category (got '${starCat}')`)
  const nightCat = classifyTag("night")
  assert(typeof nightCat === "string" && nightCat.length > 0, `bare 'night' still returns a valid category (got '${nightCat}')`)
  const dayCat = classifyTag("day")
  assert(typeof dayCat === "string" && dayCat.length > 0, `bare 'day' still returns a valid category (got '${dayCat}')`)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
