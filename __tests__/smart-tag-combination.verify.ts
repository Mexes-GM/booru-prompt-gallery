/**
 * Regression tests for the "Smart Tag Combination" optimization (lib/cleanPrompt.ts).
 *
 * Covers the quality bugs found in the 2026-07-01 audit:
 *   1. Contradictory adjectives must NOT be merged ("long skirt" + "short skirt").
 *   2. Competing hair lengths collapse to the most specific one (hierarchy),
 *      preventing the "short long hair" contradiction.
 *   3. Action/gerund tags ("grabbing shirt") must NOT be merged as descriptors.
 *   4. parseTagList keeps a cleaned multi-word tag intact -> cleanPrompt is idempotent.
 *   5. Legitimate merges and existing behavior (breasts, multi-subject) still work.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/smart-tag-combination.verify.ts
 */
import { cleanPrompt, parseTagList } from "../lib/cleanPrompt"

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

const BASE_OPTS = { optimizeTags: true, includeCharacters: false, includeCopyrights: false }

// Return the cleaned output as an array of tags.
function cleanTags(input: string, opts: any = {}): string[] {
  const out = cleanPrompt(input, "", "", "", { ...BASE_OPTS, ...opts })
  return out.split(",").map((t) => t.trim()).filter(Boolean)
}
function has(tags: string[], tag: string) {
  return tags.includes(tag)
}

// ── 1) Canonical merge still works ──
{
  const t = cleanTags("hair, long hair, white hair")
  assert(has(t, "long white hair"), "canonical: merges into 'long white hair'")
  assert(!has(t, "hair"), "canonical: standalone 'hair' removed")
  assert(!has(t, "long hair") && !has(t, "white hair"), "canonical: component tags removed")
}

// ── 2) Contradictory clothing lengths must NOT merge ──
{
  const t = cleanTags("1girl, long skirt, short skirt")
  assert(!has(t, "long short skirt"), "skirt: no contradictory 'long short skirt'")
  assert(has(t, "long skirt") && has(t, "short skirt"), "skirt: both length tags preserved as-is")
}

// ── 3) Competing hair lengths collapse to most specific (hierarchy) ──
{
  const t = cleanTags("1girl, short hair, long hair")
  assert(!has(t, "short long hair"), "hair: no contradictory 'short long hair'")
  assert(has(t, "long hair"), "hair: keeps the more specific 'long hair'")
  assert(!has(t, "short hair"), "hair: drops the less specific 'short hair'")
}
{
  const t = cleanTags("1girl, medium hair, very long hair")
  assert(has(t, "very long hair") && !has(t, "medium hair"), "hair: keeps 'very long hair' over 'medium hair'")
}

// ── 4) Action / gerund tags must NOT be merged as adjectives ──
{
  const t = cleanTags("1girl, grabbing shirt, red shirt")
  assert(!has(t, "grabbing red shirt"), "action: no 'grabbing red shirt'")
  assert(has(t, "grabbing shirt") && has(t, "red shirt"), "action: both tags preserved")
}
{
  const t = cleanTags("1girl, holding hat, red hat")
  assert(!has(t, "holding red hat"), "action: 'holding hat' not merged")
}

// ── 5) Legitimate merges still work ──
{
  const t = cleanTags("1girl, red skirt, pleated skirt")
  assert(has(t, "red pleated skirt"), "merge: compatible adjectives combine ('red pleated skirt')")
}

// ── 6) Existing behavior preserved: breast hierarchy ──
{
  const t = cleanTags("1girl, small breasts, large breasts, huge breasts")
  assert(has(t, "huge breasts"), "breasts: keeps most specific 'huge breasts'")
  assert(!has(t, "small breasts") && !has(t, "large breasts"), "breasts: drops smaller sizes")
}

// ── 7) Existing behavior preserved: multi-subject disables combination ──
{
  const t = cleanTags("2girls, red skirt, blue skirt")
  assert(has(t, "red skirt") && has(t, "blue skirt"), "multi-subject: combination disabled")
  assert(!has(t, "red blue skirt"), "multi-subject: no merged skirt")
}

// ── 8) Idempotency: cleanPrompt output is safe to re-parse ──
{
  const once = cleanPrompt("hair, long hair, white hair", "", "", "", BASE_OPTS)
  const twice = cleanPrompt(once, "", "", "", BASE_OPTS)
  assert(once === twice, `idempotency (single-tag): stable ('${once}' === '${twice}')`)
}
{
  const bigInput = "1girl, solo, long_hair, white_hair, red_skirt, pleated_skirt, blue_eyes, smile"
  const once = cleanPrompt(bigInput, "", "", "", BASE_OPTS)
  const twice = cleanPrompt(once, "", "", "", BASE_OPTS)
  assert(once === twice, `idempotency (multi-tag): stable ('${once}')`)
}

// ── 9) parseTagList unit behavior ──
assert(JSON.stringify(parseTagList("long white hair")) === JSON.stringify(["long white hair"]),
  "parseTagList: cleaned multi-word single tag kept intact")
assert(parseTagList("1girl long_hair blue_eyes").length === 3,
  "parseTagList: raw booru (underscored) split on whitespace")
assert(parseTagList("a, b, c").length === 3,
  "parseTagList: comma-separated split on comma")
assert(JSON.stringify(parseTagList("1girl")) === JSON.stringify(["1girl"]),
  "parseTagList: single word tag")
assert(parseTagList("a,, b ,").length === 2,
  "parseTagList: tolerates empty/whitespace tokens")

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
