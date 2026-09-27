/**
 * Tests for lib/pack/base-prompt.ts (classifying a pasted "From my prompt" base).
 *
 * Covers:
 *   1. A pasted prompt classifies hair/eyes tags into `appearance` and
 *      clothing tags into `clothing`.
 *   2. The same tags on a BooruPost fixture, run through classifyPostForPack,
 *      produce the same buckets (both bases converge to one representation).
 *   3. Empty text produces empty buckets.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/base-prompt.verify.ts
 */
import type { BooruPost } from "../lib/booru/types"
import { classifyBasePrompt } from "../lib/pack/base-prompt"
import { classifyPostForPack } from "../lib/pack/pack-generator"

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

function makePost(tag_string: string, character = ""): BooruPost {
  return {
    id: 1,
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

const PROMPT_TEXT = "1girl, long hair, red eyes, maid, apron"
// The heuristic classifier doesn't reliably bucket "maid"/"apron" as clothing
// without a DB override — same fixture-overrides allowance the design spec
// calls out for this test.
const OVERRIDES: Record<string, string> = { maid: "clothing", apron: "clothing" }

// ── Pasted prompt: hair/eyes -> appearance, maid/apron -> clothing ──
{
  const { classified } = classifyBasePrompt(PROMPT_TEXT, OVERRIDES, [])
  assert(classified.appearance.includes("long hair"), "appearance includes 'long hair'")
  assert(classified.appearance.includes("red eyes"), "appearance includes 'red eyes'")
  assert(classified.clothing.includes("maid"), "clothing includes 'maid'")
  assert(classified.clothing.includes("apron"), "clothing includes 'apron'")
}

// ── Same tags via a BooruPost fixture (tag_string) -> same buckets ──
{
  const fromPrompt = classifyBasePrompt(PROMPT_TEXT, OVERRIDES, []).classified
  const post = makePost("1girl long_hair red_eyes maid apron")
  const fromCard = classifyPostForPack(post, OVERRIDES)
  for (const cat of ["appearance", "clothing", "equipment", "pose", "scenery", "creature", "other"] as const) {
    assert(
      JSON.stringify([...fromPrompt[cat]].sort()) === JSON.stringify([...fromCard[cat]].sort()),
      `category '${cat}' matches between pasted prompt and card classification`
    )
  }
}

// ── Empty text -> empty buckets ──
{
  const { classified, characterTags } = classifyBasePrompt("", {}, ["mona (genshin impact)"])
  for (const cat of ["appearance", "clothing", "equipment", "pose", "scenery", "creature", "other"] as const) {
    assert(classified[cat].length === 0, `empty text: '${cat}' bucket is empty`)
  }
  assert(characterTags.length === 0, "empty text: no character tags detected")
}

// ── Known character tags found in the prompt, in order of appearance ──
{
  const { characterTags } = classifyBasePrompt(
    "mona (genshin impact), long hair, klee (genshin impact)",
    {},
    ["klee (genshin impact)", "mona (genshin impact)"]
  )
  assert(JSON.stringify(characterTags) === JSON.stringify(["mona (genshin impact)", "klee (genshin impact)"]), "character tags found in prompt order")
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
