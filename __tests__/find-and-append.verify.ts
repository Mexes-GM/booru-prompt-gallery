/**
 * Regression tests for the "Find & Append" feature (lib/cleanPrompt.ts).
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/find-and-append.verify.ts
 */
import { cleanPrompt, type TagAppendRule } from "../lib/cleanPrompt"
import { derivePostPrompt } from "../lib/prompt/derive-post-prompt"

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

const BASE_OPTIONS = {
  optimizeTags: false,
  includeCharacters: true,
  includeCopyrights: true,
  escapeOutput: false,
}

function cleanTags(
  tagString: string,
  rules: TagAppendRule[],
  options: Record<string, unknown> = {},
): string[] {
  const output = cleanPrompt(tagString, "", "", "", {
    ...BASE_OPTIONS,
    ...options,
    tagAppendRules: rules,
  })
  return output.split(",").map((tag) => tag.trim()).filter(Boolean)
}

function has(tags: string[], tag: string) {
  return tags.includes(tag)
}

const NEKO_RULE: TagAppendRule = {
  id: "neko-anatomy",
  find: "neko",
  append: ["animal ears", "cat ears", "cat tail"],
}

const POSITION_RULE: TagAppendRule = {
  id: "neko-position",
  find: "neko",
  append: ["blue eyes", "school uniform", "standing"],
}

// 1. A single exact source tag keeps itself and adds every configured tag.
{
  const tags = cleanTags("neko, smile", [NEKO_RULE])
  assert(has(tags, "neko"), "core: source tag is preserved")
  assert(has(tags, "animal ears"), "core: first appended tag is present")
  assert(has(tags, "cat ears"), "core: second appended tag is present")
  assert(has(tags, "cat tail"), "core: third appended tag is present")
}

// 1b. Appended tags stay immediately after their source despite category sorting.
{
  const tags = cleanTags("neko", [POSITION_RULE])
  const sourceIndex = tags.indexOf("neko")
  assert(sourceIndex >= 0, "order: source tag is present")
  assert(
    tags.slice(sourceIndex + 1, sourceIndex + 4).join(",") === "blue eyes,school uniform,standing",
    "order: appended tags retain their configured order directly after the source",
  )
}

// 2. Matching is exact and never matches substrings or parenthesized fragments.
{
  const tags = cleanTags("neko girl, character (neko)", [NEKO_RULE])
  assert(!has(tags, "animal ears"), "exact: substring and parenthesized fragment do not match")
  assert(has(tags, "neko girl"), "exact: longer source tag stays untouched")
}

// 3. Multiple rules for the same source contribute all of their tags.
{
  const tags = cleanTags("neko", [
    NEKO_RULE,
    { id: "neko-style", find: "neko", append: ["feline", "whiskers"] },
  ])
  assert(has(tags, "cat tail"), "multi-rule: tags from the first rule are present")
  assert(has(tags, "feline") && has(tags, "whiskers"), "multi-rule: tags from the second rule are present")
}

// 4. Existing and repeated appended tags are deduplicated in the final prompt.
{
  const tags = cleanTags("neko, cat tail", [NEKO_RULE])
  assert(tags.filter((tag) => tag === "cat tail").length === 1, "dedupe: existing tag appears only once")
}

// 5. Appended tags never become sources for another append rule.
{
  const tags = cleanTags("neko", [
    { id: "first", find: "neko", append: ["cat ears"] },
    { id: "second", find: "cat ears", append: ["cat tail"] },
  ])
  assert(has(tags, "cat ears"), "no-chain: direct appended tag is present")
  assert(!has(tags, "cat tail"), "no-chain: generated tag does not trigger another rule")
}

// 6. Exclusions apply after append generation.
{
  const tags = cleanTags("neko", [NEKO_RULE], { exclude: ["cat tail"] })
  assert(!has(tags, "cat tail"), "exclude: appended tag is removed by exclusions")
  assert(has(tags, "cat ears"), "exclude: unrelated appended tags remain")
}

// 7. Source tags are captured before exclusions, while generated tags still
// pass through the final exclusion filter.
{
  const tags = cleanTags("neko", [NEKO_RULE], { exclude: ["neko"] })
  assert(!has(tags, "neko"), "source-exclusion: source tag remains excluded")
  assert(has(tags, "cat tail"), "source-exclusion: rule still contributes generated tags")
}

// 8. Manual Tags to Add do not act as append-rule sources.
{
  const tags = cleanPrompt("1girl", "", "", "", {
    ...BASE_OPTIONS,
    addedTags: ["neko"],
    tagAppendRules: [NEKO_RULE],
  }).split(",").map((tag) => tag.trim()).filter(Boolean)
  assert(has(tags, "neko"), "manual-add: manually added source tag is present")
  assert(!has(tags, "cat ears"), "manual-add: manually added tags do not trigger append rules")
}

// 9. The shared card and real Bulk Send derivation can trigger from copyright
// source tags even though copyright labels remain hidden in the final prompt.
{
  const post = {
    id: 101,
    file_url: "https://example.test/full.jpg",
    large_file_url: "https://example.test/large.jpg",
    preview_file_url: "https://example.test/preview.jpg",
    tag_string: "1girl",
    tag_string_artist: "",
    tag_string_character: "",
    tag_string_copyright: "fandom",
    rating: "general",
    score: 1,
  }
  const derived = derivePostPrompt(post, {
    excludeInput: "",
    addInput: "",
    tagAppendRules: [{ id: "copyright", find: "fandom", append: ["franchise style"] }],
    includeCharacters: true,
    optimizeTags: false,
  })
  assert(derived.displayContent.includes("franchise style"), "derive: copyright source adds its target")
  assert(derived.hasAppends && derived.appendedTags[0]?.from === "fandom", "derive: applied rule metadata is exposed")
}

// 10. Applied rules are reported without changing cleanPrompt's return type.
{
  let applied: { from: string; append: string[] }[] = []
  cleanPrompt("neko", "", "", "", {
    ...BASE_OPTIONS,
    tagAppendRules: [NEKO_RULE],
    onTagAppendsApplied: (matches) => { applied = matches },
  })
  assert(applied.length === 1, "callback: one matching rule is reported")
  assert(applied[0]?.from === "neko", "callback: reports the normalized source tag")
  assert(applied[0]?.append.join(",") === "animal ears,cat ears,cat tail", "callback: reports all appended tags")
}

// 11. Empty rules are ignored and retain the existing prompt output.
{
  const withoutRules = cleanTags("neko, smile", [])
  const withEmptyRule = cleanTags("neko, smile", [{ id: "empty", find: "", append: [] }])
  assert(JSON.stringify(withEmptyRule) === JSON.stringify(withoutRules), "empty-rule: no valid source or target is a no-op")
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
