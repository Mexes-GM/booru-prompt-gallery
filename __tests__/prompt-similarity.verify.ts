/**
 * Tests for lib/pack/prompt-similarity.ts, the near-duplicate detector used
 * by Bulk Send (both "Real posts" and "Synthetic" modes) to avoid queuing
 * prompts that are almost the same tag set.
 *
 * Covers:
 *   1. promptToTagSet normalizes weights/brackets/underscores and dedupes.
 *   2. jaccardSimilarity: identical sets -> 1, disjoint sets -> 0, partial
 *      overlap -> the expected ratio, both-empty edge case -> 1.
 *   3. NearDuplicateFilter accepts the first prompt, rejects a near-duplicate
 *      above the threshold, and accepts one still below it.
 *   4. NearDuplicateFilter compares against EVERY previously accepted prompt,
 *      not just the most recent one.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/prompt-similarity.verify.ts
 */
import {
  promptToTagSet,
  jaccardSimilarity,
  NearDuplicateFilter,
} from "../lib/pack/prompt-similarity"

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

// ── 1) promptToTagSet: normalization + dedup ──
{
  const set = promptToTagSet("1girl, (blue_eyes:1.3), ((long hair)), Solo, 1girl")
  assert(set.has("1girl"), "keeps plain tag '1girl'")
  assert(set.has("blue eyes"), "strips weight syntax + underscores from '(blue_eyes:1.3)'")
  assert(set.has("long hair"), "strips nested parens from '((long hair))'")
  assert(set.has("solo"), "lowercases 'Solo'")
  assert(set.size === 4, `dedupes repeated '1girl' (got size ${set.size})`)
}

// ── 2) jaccardSimilarity ──
{
  const a = promptToTagSet("1girl, solo, blue eyes")
  const b = promptToTagSet("1girl, solo, blue eyes")
  assert(jaccardSimilarity(a, b) === 1, "identical sets -> similarity 1")
}
{
  const a = promptToTagSet("1girl, solo")
  const b = promptToTagSet("dog, outdoors")
  assert(jaccardSimilarity(a, b) === 0, "disjoint sets -> similarity 0")
}
{
  // {a,b,c} vs {a,b,d}: intersection=2 (a,b), union=4 (a,b,c,d) -> 0.5
  const a = new Set(["a", "b", "c"])
  const b = new Set(["a", "b", "d"])
  assert(jaccardSimilarity(a, b) === 0.5, `partial overlap yields expected ratio (got ${jaccardSimilarity(a, b)})`)
}
{
  assert(jaccardSimilarity(new Set(), new Set()) === 1, "both-empty edge case -> 1 (treated as identical)")
  assert(jaccardSimilarity(new Set(["a"]), new Set()) === 0, "one empty, one non-empty -> 0")
}

// ── 3) NearDuplicateFilter: threshold behavior ──
{
  const filter = new NearDuplicateFilter(0.85)
  assert(filter.tryAccept("1girl, solo, blue eyes, long hair, school uniform"), "first prompt is always accepted")
  // Near-duplicate: same 5 tags minus one, plus one filler -> shares 4/6 = 0.667, below 0.85 -> should be accepted
  assert(
    filter.tryAccept("1girl, solo, blue eyes, long hair, casual clothes"),
    "a moderately different prompt (below threshold) is accepted"
  )
  // Now try an almost-identical prompt: same 5 tags plus one extra filler tag.
  // Intersection=5, union=6 -> 0.833, still below 0.85 -> accepted.
  assert(
    filter.tryAccept("1girl, solo, blue eyes, long hair, school uniform, smiling"),
    "5/6 overlap (0.833) is still below the 0.85 threshold -> accepted"
  )
  // Exact duplicate of the first prompt -> similarity 1 -> rejected.
  assert(
    !filter.tryAccept("1girl, solo, blue eyes, long hair, school uniform"),
    "exact duplicate of an already-accepted prompt is rejected"
  )
}

// ── 4) NearDuplicateFilter compares against ALL accepted prompts, not just the latest ──
{
  const filter = new NearDuplicateFilter(0.6)
  assert(filter.tryAccept("a, b, c, d"), "accept prompt #1")
  assert(filter.tryAccept("e, f, g, h"), "accept prompt #2 (disjoint from #1)")
  // Similar to #1 (a,b,c,d) but not #2: intersection=3, union=5 -> 0.6 -> rejected (>= threshold)
  assert(!filter.tryAccept("a, b, c, x"), "candidate near-duplicate of prompt #1 (not the most recent) is rejected")
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
