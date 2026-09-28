/**
 * Tests for Bulk Send's "Synthetic" mode pure core (lib/pack/bulk-send.ts).
 *
 * Covers:
 *   1. extractLockedTagsFromSearch normalizes the search bar into locked tags
 *      and drops booru meta-operators (order:, score:, -exclusions).
 *   2. buildAxesFromSeedPosts excludes locked tags from the sampled pools.
 *   3. detectCharacterTags picks up tags from tag_string_character and from
 *      the appearance bucket.
 *   4. buildSyntheticPrompts emits cleaned, distinct prompts containing the
 *      locked tags.
 *   5. includeCharacters:false strips the character tags from the output
 *      (proves the synthetic path goes through the real cleaner, not just
 *      joinTags).
 *   6. exclude (excludeInput) removes a tag from every generated prompt.
 *   7. Fewer seed posts / a narrow query still produce at least the base prompt.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/bulk-send.verify.ts
 */
import type { BooruPost } from "../lib/booru/types"
import { createSeededRng } from "../lib/pack/pack-generator"
import {
  extractLockedTagsFromSearch,
  buildAxesFromSeedPosts,
  detectCharacterTags,
  buildSyntheticPrompts,
  generateAndFilterPrompts,
  type BulkSendCleanOptions,
} from "../lib/pack/bulk-send"

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

function makePost(id: number, tag_string: string, character = ""): BooruPost {
  return {
    id,
    file_url: "",
    large_file_url: "",
    preview_file_url: "",
    tag_string,
    tag_string_artist: "",
    tag_string_character: character,
    tag_string_copyright: "",
    rating: "g",
    score: 0,
  }
}

const BASE_CLEAN_OPTS: BulkSendCleanOptions = {
  excludeInput: "",
  addInput: "",
  includeCharacters: true,
  optimizeTags: true,
}

const SEED_POSTS: BooruPost[] = [
  makePost(1, "1girl solo standing looking_at_viewer long_hair blue_eyes shirt outdoors", "mona_(genshin_impact)"),
  makePost(2, "1girl solo sitting long_hair red_dress indoors", "mona_(genshin_impact)"),
  makePost(3, "1girl solo from_side short_hair skirt night", "mona_(genshin_impact)"),
  makePost(4, "1girl solo kneeling twintails blue_eyes swimsuit beach", "mona_(genshin_impact)"),
]

// ── 1) extractLockedTagsFromSearch: normalizes + drops meta-operators ──
{
  const locked = extractLockedTagsFromSearch("mona, from_side, order:random, -nsfw, score:>=50")
  assert(locked.includes("mona"), "locked tags include 'mona'")
  assert(locked.includes("from side"), "locked tags include normalized 'from side'")
  assert(!locked.some((t) => t.includes(":")), "meta-operators (order:, score:) are dropped")
  assert(!locked.includes("nsfw") && !locked.some((t) => t.startsWith("-")), "exclusion tag '-nsfw' is dropped")
}

// ── 2) buildAxesFromSeedPosts excludes locked tags from the pools ──
{
  const locked = extractLockedTagsFromSearch("from_side")
  const axes = buildAxesFromSeedPosts(SEED_POSTS, locked)
  assert(!!axes.pose && !axes.pose!.includes("from side"), "pose axis excludes the locked 'from side'")
  assert(!!axes.pose && axes.pose!.includes("standing"), "pose axis still includes non-locked values")
}

// ── 3) detectCharacterTags picks up character-field + appearance-bucket matches ──
{
  const locked = extractLockedTagsFromSearch("mona (genshin impact), from_side")
  const charTags = detectCharacterTags(locked, SEED_POSTS)
  assert(charTags.includes("mona (genshin impact)"), "character tag detected from tag_string_character")
  assert(!charTags.includes("from side"), "non-character locked tag ('from side') is not misdetected as character")
}

// ── 4) buildSyntheticPrompts: distinct, cleaned prompts containing locked tags ──
{
  const rng = createSeededRng(42)
  const result = buildSyntheticPrompts(SEED_POSTS, "mona (genshin impact)", 5, BASE_CLEAN_OPTS, rng)
  assert(result.length > 0, `produces at least one prompt (got ${result.length})`)
  assert(result.every((r) => r.prompt.toLowerCase().includes("mona")), "every prompt keeps the locked search tag")
  const prompts = result.map((r) => r.prompt)
  assert(new Set(prompts).size === prompts.length, "all prompts are distinct")
}

// ── 5) includeCharacters:false strips the character identity from the output ──
{
  const rng = createSeededRng(1)
  const withChar = buildSyntheticPrompts(SEED_POSTS, "mona (genshin impact)", 3, { ...BASE_CLEAN_OPTS, includeCharacters: true }, rng)
  const rng2 = createSeededRng(1)
  const withoutChar = buildSyntheticPrompts(SEED_POSTS, "mona (genshin impact)", 3, { ...BASE_CLEAN_OPTS, includeCharacters: false }, rng2)
  assert(withChar.some((r) => r.prompt.toLowerCase().includes("mona")), "includeCharacters:true keeps 'mona' in at least one prompt")
  assert(withoutChar.every((r) => !r.prompt.toLowerCase().includes("mona")), "includeCharacters:false removes 'mona' from every prompt (goes through the real cleaner)")
}

// ── 6) exclude removes a tag from every generated prompt ──
{
  const rng = createSeededRng(7)
  const result = buildSyntheticPrompts(
    SEED_POSTS,
    "mona (genshin impact)",
    5,
    { ...BASE_CLEAN_OPTS, excludeInput: "blue_eyes" },
    rng
  )
  assert(result.every((r) => !r.prompt.toLowerCase().includes("blue eyes")), "'blue eyes' is excluded from every generated prompt")
}

// ── 7) Narrow query with few seed posts still yields at least the base prompt ──
{
  const single = [makePost(9, "1girl solo standing", "rare_character")]
  const result = buildSyntheticPrompts(single, "rare_character", 10, BASE_CLEAN_OPTS)
  assert(result.length >= 1, `narrow query still yields at least 1 prompt (got ${result.length})`)
  assert(result.every((r) => r.prompt.toLowerCase().includes("rare character")), "every prompt keeps the locked rare character tag")
}

/**
 * How many UNIQUE prompts generateAndFilterPrompts (the real, exported
 * function — not a reimplementation) yields for a given `count` +
 * `overGenerateCount`, using a large single-axis pool with
 * filterNearDuplicates:false so the only source of rejection is EXACT-STRING
 * dedup (deterministic, unlike the near-duplicate Jaccard filter) — isolating
 * the ceiling bug from the near-duplicate filter's own behavior entirely.
 */
function syntheticYield(count: number, overGenerateCount: number): number {
  const poses = Array.from({ length: 300 }, (_, i) => `pose${i}`)
  const result = generateAndFilterPrompts({
    lockedTags: ["widecharacter3"],
    axes: { pose: poses },
    characterTags: [],
    count,
    cleanOptions: BASE_CLEAN_OPTS,
    overGenerateCount,
    filterNearDuplicates: false,
    rng: createSeededRng(999),
  })
  return result.length
}

// ── 8) generateAndFilterPrompts must not clamp its internal
//      generatePackPrompts call to MAX_PACK_PROMPTS (100): it must use the
//      full overGenerateCount headroom (up to MAX_PACK_OVERGENERATE).
//      useBulkSend's runSynthetic requests count*3 so a near-duplicate-heavy
//      batch still has candidates left after filtering. A single axis with
//      300 distinct values can supply more than 100 unique prompts.
{
  const requestedCount = 150
  const overGenerateCount = requestedCount * 3 // useBulkSend's own multiplier (450, itself clamped elsewhere)
  const yielded = syntheticYield(requestedCount, overGenerateCount)
  assert(
    yielded === requestedCount,
    `requesting ${requestedCount} synthetic prompts from a single-axis pool of 300 values yields all ${requestedCount} (got ${yielded})`
  )
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
