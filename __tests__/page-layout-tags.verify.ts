/**
 * Insets (a second picture pasted onto the post) never reach the prompt;
 * tags of posts made of several pictures go only with the experimental rules.
 * Tags the user adds or searches for are kept either way.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/page-layout-tags.verify.ts
 */
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

function post(tagString: string): BooruPost {
  return {
    id: 1, file_url: "", large_file_url: "", preview_file_url: "",
    tag_string: tagString, tag_string_artist: "", tag_string_character: "", tag_string_copyright: "",
    tag_string_meta: "highres", rating: "g", score: 0,
  }
}

function prompt(tagString: string, extra: { addInput?: string; searchTags?: string; experimental?: boolean } = {}): string[] {
  const { baseContent } = derivePostPrompt(post(tagString), {
    excludeInput: "",
    addInput: extra.addInput ?? "",
    searchTags: extra.searchTags ?? "",
    includeCharacters: true,
    optimizeTags: false,
    experimentalPromptRules: extra.experimental ?? false,
  })
  return baseContent.split(",").map((t) => t.trim().replace(/\\/g, ""))
}

// ── 1) Insets are always dropped ──
{
  const tags = prompt("1girl smile photo_inset reference_inset chibi_inset screenshot_inset inset_border picture_frame")
  for (const inset of ["photo inset", "reference inset", "chibi inset", "screenshot inset", "inset border"]) {
    assert(!tags.includes(inset), `${inset} is dropped`)
  }
  assert(tags.includes("smile") && tags.includes("1girl"), "scene tags stay")
  assert(tags.includes("picture frame"), "picture frame is an object, not an inset")
}

// ── 2) Multi-panel tags only go with the experimental rules ──
{
  const off = prompt("1girl smile comic 4koma multiple_views reference_sheet")
  assert(off.includes("comic") && off.includes("multiple views"), "kept without experimental rules")
  const on = prompt("1girl smile comic 4koma multiple_views reference_sheet", { experimental: true })
  for (const tag of ["comic", "4koma", "multiple views", "reference sheet"]) {
    assert(!on.includes(tag), `${tag} dropped with experimental rules`)
  }
  assert(on.includes("smile"), "scene tags stay with experimental rules")
}

// ── 3) Tags the user adds or searches for are kept ──
{
  assert(prompt("1girl smile comic", { experimental: true, addInput: "comic" }).includes("comic"), "added comic is kept")
  assert(prompt("1girl smile photo_inset", { addInput: "photo inset" }).includes("photo inset"), "added photo inset is kept")
  assert(prompt("1girl smile", { experimental: true, searchTags: "4koma" }).includes("4koma"), "searched 4koma is appended")
}

console.log(`\nResults: ${passed} passed, ${failed} failed\n`)

if (failed > 0) {
  process.exit(1)
}
