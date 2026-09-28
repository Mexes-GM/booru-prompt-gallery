/**
 * Regression tests for score tags preservation (e.g. score_7, score_8_up, score_9).
 *
 * Tests that score tags with underscores are NOT converted to spaces by cleanPrompt
 * or derivePostPrompt, especially when added via "Add tags" (addInput / addedTags).
 *
 * Run with: npx tsx __tests__/score-tags-preservation.verify.ts
 */
import { toSpace, normalize, cleanPrompt } from "../lib/cleanPrompt"
import { derivePostPrompt } from "../lib/prompt/derive-post-prompt"
import type { BooruPost } from "../lib/booru/types"

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

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual === expected) {
    passed++
  } else {
    failed++
    console.error(`FAIL: ${label}\n  Expected: ${JSON.stringify(expected)}\n  Actual:   ${JSON.stringify(actual)}`)
  }
}

const mockPost: BooruPost = {
  id: 12345,
  tag_string: "1girl solo long_hair blue_eyes",
  tag_string_artist: "artist_name",
  tag_string_character: "character_name",
  tag_string_copyright: "series_name",
  score: 100,
  rating: "g",
  width: 1000,
  height: 1000,
  file_url: "https://example.com/file.jpg",
  large_file_url: "https://example.com/large.jpg",
  preview_file_url: "https://example.com/preview.jpg",
}

// ── 1. toSpace unit tests ──
{
  assertEqual(toSpace("score_7"), "score_7", "toSpace: preserves score_7")
  assertEqual(toSpace("score_8_up"), "score_8_up", "toSpace: preserves score_8_up")
  assertEqual(toSpace("score_9"), "score_9", "toSpace: preserves score_9")
  assertEqual(toSpace("score_7_up"), "score_7_up", "toSpace: preserves score_7_up")
  assertEqual(toSpace("score_good"), "score_good", "toSpace: preserves score_good")
  assertEqual(toSpace("(score_7:1.2)"), "(score_7:1.2)", "toSpace: preserves (score_7:1.2)")
  assertEqual(toSpace("source_anime"), "source_anime", "toSpace: preserves source_anime")
  assertEqual(toSpace("rating_safe"), "rating_safe", "toSpace: preserves rating_safe")
  assertEqual(toSpace("<lora:my_lora_v1:0.8>"), "<lora:my_lora_v1:0.8>", "toSpace: preserves <lora:...>")
  assertEqual(toSpace("long_hair"), "long hair", "toSpace: converts normal booru tag to spaces")
  assertEqual(toSpace("blue_eyes"), "blue eyes", "toSpace: converts blue_eyes to blue eyes")
  assertEqual(toSpace("high_score"), "high score", "toSpace: converts high_score to high score")
}

// ── 2. normalize unit tests ──
{
  assertEqual(normalize("score_7"), "score_7", "normalize: score_7")
  assertEqual(normalize("score_8_up"), "score_8_up", "normalize: score_8_up")
  assertEqual(normalize("SCORE_7"), "score_7", "normalize: lowercases score_7")
  assertEqual(normalize("  score_7  "), "score_7", "normalize: trims score_7")
  assertEqual(normalize("(score_7:1.2)"), "(score_7:1.2)", "normalize: weighted (score_7:1.2)")
  assertEqual(normalize("long_hair"), "long hair", "normalize: normal tag long_hair")
  assertEqual(normalize("1 girl"), "1girl", "normalize: typo 1 girl -> 1girl")
}

// ── 3. cleanPrompt with addedTags ──
{
  const out = cleanPrompt("1girl, solo", "", "", "", {
    addedTags: ["score_7"],
  })
  assert(out.startsWith("score_7"), `cleanPrompt addedTags: starts with score_7 (got: "${out}")`)
  assert(!out.includes("score 7"), `cleanPrompt addedTags: does not contain 'score 7' with space (got: "${out}")`)
}

{
  const out = cleanPrompt("1girl, solo", "", "", "", {
    addedTags: ["score_9", "score_8_up", "score_7_up"],
  })
  assert(out.includes("score_9"), `cleanPrompt addedTags: includes score_9 (got: "${out}")`)
  assert(out.includes("score_8_up"), `cleanPrompt addedTags: includes score_8_up (got: "${out}")`)
  assert(out.includes("score_7_up"), `cleanPrompt addedTags: includes score_7_up (got: "${out}")`)
  assert(!out.includes("score 9"), `cleanPrompt addedTags: does not contain 'score 9' (got: "${out}")`)
  assert(!out.includes("score 8 up"), `cleanPrompt addedTags: does not contain 'score 8 up' (got: "${out}")`)
}

{
  // Normal tags in addedTags still get underscore normalized to spaces
  const out = cleanPrompt("1girl, solo", "", "", "", {
    addedTags: ["score_7", "masterpiece", "blue_eyes"],
  })
  assert(out.includes("score_7"), `cleanPrompt addedTags mixed: includes score_7`)
  assert(out.includes("blue eyes"), `cleanPrompt addedTags mixed: blue_eyes normalized to 'blue eyes'`)
}

// ── 4. derivePostPrompt with addInput ──
{
  const derived = derivePostPrompt(mockPost, {
    excludeInput: "",
    addInput: "score_7",
    includeCharacters: true,
    optimizeTags: true,
  })
  assert(derived.displayContent.startsWith("score_7"), `derivePostPrompt addInput: displayContent starts with score_7 (got: "${derived.displayContent}")`)
  assert(derived.baseContent.startsWith("score_7"), `derivePostPrompt addInput: baseContent starts with score_7 (got: "${derived.baseContent}")`)
  assert(!derived.displayContent.includes("score 7"), `derivePostPrompt addInput: no 'score 7' in displayContent`)
}

{
  const derived = derivePostPrompt(mockPost, {
    excludeInput: "",
    addInput: "score_7, score_8_up, masterpiece",
    includeCharacters: true,
    optimizeTags: true,
  })
  assert(derived.displayContent.includes("score_7"), `derivePostPrompt multiple addInput: includes score_7`)
  assert(derived.displayContent.includes("score_8_up"), `derivePostPrompt multiple addInput: includes score_8_up`)
  assert(!derived.displayContent.includes("score 7"), `derivePostPrompt multiple addInput: no 'score 7'`)
  assert(!derived.displayContent.includes("score 8 up"), `derivePostPrompt multiple addInput: no 'score 8 up'`)
}

// ── 5. Post tags containing score_ tags (e.g. from Aibooru) ──
{
  const postWithScores: BooruPost = {
    ...mockPost,
    tag_string: "score_9 score_8_up score_7 1girl blue_eyes",
  }
  const derived = derivePostPrompt(postWithScores, {
    excludeInput: "",
    addInput: "",
    includeCharacters: true,
    optimizeTags: true,
  })
  assert(derived.displayContent.includes("score_9"), `post tags with scores: includes score_9 (got: "${derived.displayContent}")`)
  assert(derived.displayContent.includes("score_8_up"), `post tags with scores: includes score_8_up (got: "${derived.displayContent}")`)
  assert(derived.displayContent.includes("score_7"), `post tags with scores: includes score_7 (got: "${derived.displayContent}")`)
  assert(derived.displayContent.includes("blue eyes"), `post tags with scores: normal tag normalized to 'blue eyes'`)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
