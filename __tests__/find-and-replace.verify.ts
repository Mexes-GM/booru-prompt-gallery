/**
 * Regression tests for the "Find & Replace" feature (lib/cleanPrompt.ts).
 *
 * Context: Danbooru renamed League of Legends character tags from
 * "jinx (league of legends)" to "jinx (league)", but image generation models
 * (Illustrious/Pony/SDXL) were trained on the old tag. This lets users define
 * find/replace rules to correct this without editing every prompt by hand.
 *
 * Matching rule under test: replacement only targets the EXACT content
 * between parentheses of a tag ("character (series)" pattern) — never a free
 * substring — so an unrelated tag like "league of champions" (no parentheses)
 * is never corrupted into "league of legends of champions".
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/find-and-replace.verify.ts
 */
import { cleanPrompt } from "../lib/cleanPrompt"

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

const BASE_OPTS = { optimizeTags: true, includeCharacters: true, includeCopyrights: true, escapeOutput: false }

function cleanTags(
  tagString: string,
  characterTags: string,
  copyrightTags: string,
  wordReplacements: { find: string; replace: string }[],
  opts: any = {},
): string[] {
  const out = cleanPrompt(tagString, "", characterTags, copyrightTags, {
    ...BASE_OPTS,
    ...opts,
    wordReplacements,
  })
  return out.split(",").map((t) => t.trim()).filter(Boolean)
}
function has(tags: string[], tag: string) {
  return tags.includes(tag)
}

const LOL_RULE = [{ find: "league", replace: "league of legends" }]

// ── 1) Core case: "jinx (league)" -> "jinx (league of legends)" via characterTags ──
{
  const t = cleanTags("1girl, solo", "jinx (league)", "", LOL_RULE)
  assert(has(t, "jinx (league of legends)"), "core: character tag corrected to 'jinx (league of legends)'")
  assert(!has(t, "jinx (league)"), "core: old tag no longer present")
}

// ── 2) Unrelated tag without parentheses must stay untouched (the false-positive case) ──
{
  const t = cleanTags("1girl, league of champions, solo", "jinx (league)", "", LOL_RULE)
  assert(has(t, "league of champions"), "no false positive: 'league of champions' preserved verbatim")
  assert(!has(t, "league of legends of champions"), "no false positive: substring corruption did not happen")
  assert(has(t, "jinx (league of legends)"), "no false positive: character tag still corrected")
}

// ── 3) A tag with different parenthesized content is left alone ──
{
  const t = cleanTags("1girl", "arcane (netflix show)", "", LOL_RULE)
  assert(has(t, "arcane (netflix show)"), "non-match: different parenthesized content untouched")
}

// ── 4) Copyright tags are also corrected ──
{
  const t = cleanTags("1girl", "", "league (league)", LOL_RULE)
  assert(has(t, "league (league of legends)"), "copyright: 'league (league)' corrected")
}

// ── 5) Multiple simultaneous rules ──
{
  const rules = [
    { find: "league", replace: "league of legends" },
    { find: "genshin", replace: "genshin impact" },
  ]
  const t = cleanTags("1girl", "jinx (league), lumine (genshin)", "", rules)
  assert(has(t, "jinx (league of legends)"), "multi-rule: first rule applied")
  assert(has(t, "lumine (genshin impact)"), "multi-rule: second rule applied")
}

// ── 6) No rules configured -> behavior unchanged ──
{
  const withRules = cleanTags("1girl", "jinx (league)", "", [])
  const withoutOption = cleanPrompt("1girl", "", "jinx (league)", "", { ...BASE_OPTS })
    .split(",").map((t) => t.trim()).filter(Boolean)
  assert(JSON.stringify(withRules) === JSON.stringify(withoutOption), "no-op: empty wordReplacements matches default behavior")
  assert(has(withRules, "jinx (league)"), "no-op: tag left untouched without rules")
}

// ── 7) Rule with empty find is ignored, not applied ──
{
  const t = cleanTags("1girl", "jinx (league)", "", [{ find: "", replace: "league of legends" }])
  assert(has(t, "jinx (league)"), "empty find: rule ignored, tag untouched")
}

// ── 8) Case-insensitive matching against normalized content ──
{
  const t = cleanTags("1girl", "jinx (League)", "", LOL_RULE)
  assert(has(t, "jinx (league of legends)"), "case-insensitive: 'League' (capitalized) still matches")
}

// ── 9) Reports which replacements were applied via onWordReplacementsApplied ──
{
  let captured: { from: string; to: string }[] = []
  cleanPrompt("1girl", "", "jinx (league)", "", {
    ...BASE_OPTS,
    wordReplacements: LOL_RULE,
    onWordReplacementsApplied: (applied) => { captured = applied },
  })
  assert(captured.length === 1, "callback: exactly one replacement reported")
  assert(captured[0]?.from === "jinx (league)" && captured[0]?.to === "jinx (league of legends)",
    "callback: reports correct from/to pair")
}

// ── 10) User types the parentheses literally in both fields (real-world UI input) ──
{
  const rulesWithParens = [{ find: "(league)", replace: "(league of legends)" }]
  const t = cleanTags("1girl, solo", "jinx (league)", "", rulesWithParens)
  assert(has(t, "jinx (league of legends)"), "literal parens: 'find=(league)' still matches and corrects the tag")
  assert(!has(t, "jinx (league)"), "literal parens: old tag replaced")
}
{
  // Mixed: find has parens, replace doesn't (or vice versa) — both should normalize the same way.
  const mixedRules = [{ find: "(league)", replace: "league of legends" }]
  const t = cleanTags("1girl", "jinx (league)", "", mixedRules)
  assert(has(t, "jinx (league of legends)"), "mixed parens: find with parens + replace without still works")
}

// ── 11) Plain tags (no parentheses) match by EXACT whole-tag equality ──
{
  const t = cleanTags("1girl, long hair, blue eyes", "", "", [{ find: "long hair", replace: "short hair" }], { optimizeTags: false })
  assert(has(t, "short hair"), "plain tag: 'long hair' -> 'short hair' applied")
  assert(!has(t, "long hair"), "plain tag: old value removed")
}
{
  // No false positive: a longer tag that merely CONTAINS the find string must be untouched.
  const t = cleanTags("1girl, very long hair, long hair ribbon", "", "", [{ find: "long hair", replace: "short hair" }], { optimizeTags: false })
  assert(has(t, "very long hair"), "plain tag no-false-positive: 'very long hair' untouched")
  assert(has(t, "long hair ribbon"), "plain tag no-false-positive: 'long hair ribbon' untouched")
  assert(!has(t, "very short hair") && !has(t, "short hair ribbon"), "plain tag no-false-positive: no corrupted substrings")
}

// ── 12) Plain-tag replacement still behaves correctly with optimizeTags ON (default/real usage) ──
{
  const t = cleanTags("1girl, long hair, blue eyes", "", "", [{ find: "long hair", replace: "short hair" }])
  assert(has(t, "short hair"), "plain tag + optimizeTags: replacement happens before hierarchy/merge logic runs")
  assert(!has(t, "long hair"), "plain tag + optimizeTags: old value not left behind")
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
