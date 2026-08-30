/**
 * Regression tests for searched tags injection (lib/prompt/derive-post-prompt.ts).
 *
 * Tests that searched tags missing from a booru post's prompt (e.g. on Gelbooru)
 * are automatically appended after the user's "Tags to add" (addInput).
 *
 * Run with: npx tsx __tests__/searched-tags-injection.verify.ts
 */
import { derivePostPrompt, extractSearchPromptTags } from "../lib/prompt/derive-post-prompt"
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

const mockPost = (tags: { general?: string; artist?: string; character?: string; copyright?: string }): BooruPost => ({
  id: 12345,
  tag_string: (tags.general || "").replace(/,\s*/g, " "),
  tag_string_artist: (tags.artist || "").replace(/,\s*/g, " "),
  tag_string_character: (tags.character || "").replace(/,\s*/g, " "),
  tag_string_copyright: (tags.copyright || "").replace(/,\s*/g, " "),
  score: 100,
  rating: "g",
  width: 1000,
  height: 1000,
})

// ── 1. extractSearchPromptTags unit tests ──
{
  const result = extractSearchPromptTags("spirit blossom syndra, 1girl, solo")
  assertEqual(result.length, 3, "extractSearchPromptTags: extracts 3 normal tags")
  assertEqual(result[0], "spirit blossom syndra", "extractSearchPromptTags: first tag matches")
  assertEqual(result[1], "1girl", "extractSearchPromptTags: second tag matches")
  assertEqual(result[2], "solo", "extractSearchPromptTags: third tag matches")
}

{
  // Underscores and typos normalization
  const result = extractSearchPromptTags("spirit_blossom_syndra, 1 girl, solo")
  assertEqual(result[0], "spirit blossom syndra", "extractSearchPromptTags: underscores converted to spaces")
  assertEqual(result[1], "1girl", "extractSearchPromptTags: typo '1 girl' normalized to '1girl'")
}

{
  // Search operators, exclusions, and meta tags filtered out
  const query = "frieren, solo, rating:general, order:popular, score:>=10, tagcount:>=20, -video, -monochrome, has:prompt, highres, absurdres"
  const result = extractSearchPromptTags(query)
  assertEqual(result.length, 2, "extractSearchPromptTags: filters out operators, exclusions, and meta tags")
  assertEqual(result[0], "frieren", "extractSearchPromptTags: retains valid tag frieren")
  assertEqual(result[1], "solo", "extractSearchPromptTags: retains valid tag solo")
}

{
  // Empty or whitespace query
  assertEqual(extractSearchPromptTags("").length, 0, "extractSearchPromptTags: empty query returns []")
  assertEqual(extractSearchPromptTags("   ").length, 0, "extractSearchPromptTags: whitespace query returns []")
  assertEqual(extractSearchPromptTags(undefined).length, 0, "extractSearchPromptTags: undefined returns []")
}

// ── 2. Missing searched tag added after addInput ──
{
  // Gelbooru post missing "spirit blossom syndra"
  const post = mockPost({ general: "1girl, solo, kimono, pink hair, sakura" })
  const result = derivePostPrompt(post, {
    excludeInput: "",
    addInput: "masterpiece, best quality",
    searchTags: "spirit blossom syndra, 1girl, solo",
    includeCharacters: true,
    optimizeTags: false,
    smartTagExclusion: false,
  })

  assert(result.displayContent.includes("spirit blossom syndra"), "derivePostPrompt: missing searched tag is in prompt")
  // Check position: addInput tags first, then missing search tag, then post tags
  const tags = result.displayContent.split(",").map((t) => t.trim())
  assertEqual(tags[0], "masterpiece", "order: first addInput tag is at index 0")
  assertEqual(tags[1], "best quality", "order: second addInput tag is at index 1")
  assertEqual(tags[2], "spirit blossom syndra", "order: missing search tag is at index 2 (after addInput)")
  assert(tags.indexOf("1girl") > 2, "order: post tags follow after added tags")
}

// ── 3. Missing searched tag placed at front when addInput is empty ──
{
  const post = mockPost({ general: "1girl, solo, kimono, pink hair" })
  const result = derivePostPrompt(post, {
    excludeInput: "",
    addInput: "",
    searchTags: "spirit blossom syndra, 1girl, solo",
    includeCharacters: true,
    optimizeTags: false,
    smartTagExclusion: false,
  })

  const tags = result.displayContent.split(",").map((t) => t.trim())
  assertEqual(tags[0], "spirit blossom syndra", "order: missing search tag is first when addInput is empty")
  assert(tags.includes("1girl"), "post tags are present")
  assert(tags.includes("solo"), "post tags are present")
}

// ── 4. No duplicate when searched tag is already in post tags ──
{
  // Danbooru post that already contains character tag
  const post = mockPost({
    general: "1girl, solo, kimono",
    character: "syndra_(spirit_blossom)",
  })
  const result = derivePostPrompt(post, {
    excludeInput: "",
    addInput: "masterpiece",
    searchTags: "syndra (spirit blossom), 1girl, solo",
    includeCharacters: true,
    optimizeTags: false,
    smartTagExclusion: false,
  })

  const tags = result.displayContent.split(",").map((t) => t.trim())
  // Count occurrences of syndra (spirit blossom)
  const syndraOccurrences = tags.filter((t) => t.includes("syndra") && t.includes("spirit blossom"))
  assertEqual(syndraOccurrences.length, 1, "no duplicates: already present tag appears exactly once")
}

// ── 5. No duplicate when searched tag is already in addInput ──
{
  const post = mockPost({ general: "1girl, solo, kimono" })
  const result = derivePostPrompt(post, {
    excludeInput: "",
    addInput: "spirit blossom syndra, masterpiece",
    searchTags: "spirit blossom syndra, 1girl",
    includeCharacters: true,
    optimizeTags: false,
    smartTagExclusion: false,
  })

  const tags = result.displayContent.split(",").map((t) => t.trim())
  const occurrences = tags.filter((t) => t === "spirit blossom syndra")
  assertEqual(occurrences.length, 1, "no duplicates: tag in addInput is not duplicated")
}

// ── 6. Searched tag in excludeInput is NOT added ──
{
  const post = mockPost({ general: "1girl, kimono" })
  const result = derivePostPrompt(post, {
    excludeInput: "solo",
    addInput: "masterpiece",
    searchTags: "1girl, solo",
    includeCharacters: true,
    optimizeTags: false,
    smartTagExclusion: false,
  })

  const tags = result.displayContent.split(",").map((t) => t.trim())
  assert(!tags.includes("solo"), "excluded tag is not added even if in search query")
}

// ── 7. Multiple missing searched tags maintain query order ──
{
  const post = mockPost({ general: "kimono, sakura" })
  const result = derivePostPrompt(post, {
    excludeInput: "",
    addInput: "masterpiece",
    searchTags: "spirit blossom syndra, 1girl, solo",
    includeCharacters: true,
    optimizeTags: false,
    smartTagExclusion: false,
  })

  const tags = result.displayContent.split(",").map((t) => t.trim())
  const idxSyndra = tags.indexOf("spirit blossom syndra")
  const idx1girl = tags.indexOf("1girl")
  const idxSolo = tags.indexOf("solo")

  assert(idxSyndra >= 0 && idx1girl >= 0 && idxSolo >= 0, "all missing search tags are added")
  assert(idxSyndra < idx1girl && idx1girl < idxSolo, "missing search tags maintain search query order")
}

// ── 8. Search operators with colons and exclusions are never injected ──
{
  const post = mockPost({ general: "1girl, solo" })
  const result = derivePostPrompt(post, {
    excludeInput: "",
    addInput: "",
    searchTags: "rating:general, order:popular, score:>=50, tagcount:>=15, -video, has:prompt",
    includeCharacters: true,
    optimizeTags: false,
    smartTagExclusion: false,
  })

  const content = result.displayContent
  assert(!content.includes("rating:"), "no rating: in output")
  assert(!content.includes("order:"), "no order: in output")
  assert(!content.includes("score:"), "no score: in output")
  assert(!content.includes("tagcount:"), "no tagcount: in output")
  assert(!content.includes("-video"), "no -video in output")
  assert(!content.includes("has:prompt"), "no has:prompt in output")
}

// ── 9. Smart Tag Exclusion works with injected search tags ──
{
  // Post has closed eyes, search query had "blue eyes"
  const post = mockPost({ general: "1girl closed_eyes" })
  const result = derivePostPrompt(post, {
    excludeInput: "",
    addInput: "",
    searchTags: "blue eyes",
    includeCharacters: true,
    optimizeTags: false,
    smartTagExclusion: true,
  })

  const tags = result.displayContent.split(",").map((t) => t.trim())
  assert(!tags.includes("blue eyes"), "smartTagExclusion blocks conflicting search tag 'blue eyes' against 'closed eyes'")
  assert(result.conflictingTags.some((c) => c.tag === "blue eyes"), "conflictingTags reports blocked search tag")
}

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) {
  process.exit(1)
}
