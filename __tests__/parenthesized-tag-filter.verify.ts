/**
 * Regression tests for the general-tag parenthesis filter (lib/cleanPrompt.ts).
 *
 * Bug found via a real-data audit of Pack Mode output (2026-08-27): the old
 * `invalidBracket = /[(){}\[\]]/` rejected ANY general tag containing a
 * parenthesis, silently dropping legitimate content-bearing tags like
 * e621's "(anatomy)" qualifier suffix ("membrane (anatomy)", "horn
 * (anatomy)") — a locked base-card tag like "membrane (anatomy)" would
 * vanish from every generated Pack Mode prompt with no warning.
 *
 * Covers:
 *   1. A trailing "(qualifier)" suffix tag survives (the actual bug).
 *   2. Square/curly-bracket wildcard/weight leftovers are still rejected.
 *   3. A tag that IS entirely wrapped in parens (stray weight/grouping
 *      syntax, e.g. "(explicit content)" or "(tag:1.3)") is still rejected.
 *   4. The "character (series)" pattern is unaffected here — that pattern
 *      lives in characterTags/copyrightTags, not the general tagString this
 *      filter operates on, so it was never this filter's job to catch it.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/parenthesized-tag-filter.verify.ts
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

const BASE_OPTS = { optimizeTags: false, includeCharacters: false, includeCopyrights: false, escapeOutput: false }

function cleanTags(input: string, opts: any = {}): string[] {
  const out = cleanPrompt(input, "", "", "", { ...BASE_OPTS, ...opts })
  return out.split(",").map((t) => t.trim()).filter(Boolean)
}

// ── 1) Legitimate "(qualifier)" suffix tags survive ──
{
  const tags = cleanTags("1girl, membrane (anatomy), horn (anatomy), solo")
  assert(tags.includes("membrane (anatomy)"), `'membrane (anatomy)' survives (got [${tags.join(", ")}])`)
  assert(tags.includes("horn (anatomy)"), `'horn (anatomy)' survives (got [${tags.join(", ")}])`)
  assert(tags.includes("1girl") && tags.includes("solo"), "unrelated plain tags are unaffected")
}
{
  const tags = cleanTags("blue tail, star ornament (marking), 1girl")
  assert(tags.includes("star ornament (marking)"), `a '(marking)' qualifier suffix survives (got [${tags.join(", ")}])`)
}

// ── 2) Square/curly bracket leftovers are still rejected (wildcard/weight syntax) ──
{
  const tags = cleanTags("1girl, [some_wildcard], {another}, solo")
  assert(!tags.includes("[some_wildcard]"), "square-bracket leftover is rejected")
  assert(!tags.includes("{another}"), "curly-brace leftover is rejected")
  assert(tags.includes("1girl") && tags.includes("solo"), "unrelated plain tags survive alongside rejected ones")
}

// ── 3) A tag entirely wrapped in parens is still rejected (stray weight/grouping syntax) ──
{
  const tags = cleanTags("1girl, (explicit content), solo")
  assert(!tags.includes("(explicit content)"), "whole-tag-wrapped-in-parens is rejected (not a qualifier suffix)")
}
{
  // Real weight syntax "(tag:1.3)" is already caught by hasUrlLike (the ':'
  // check) upstream of this filter, but the whole-tag-wrapped-in-parens
  // check independently rejects it too — belt and suspenders, and this
  // asserts neither regression re-admits it.
  const tags = cleanTags("1girl, (long hair:1.3), solo")
  assert(!tags.includes("(long hair:1.3)"), "weight-syntax tag is rejected")
}

// ── 4) The "character (series)" pattern is a non-issue here: this filter only
//      ever sees the general tagString, never characterTags/copyrightTags. ──
{
  const out = cleanPrompt("1girl, solo", "", "jinx (league of legends)", "", { ...BASE_OPTS, includeCharacters: true })
  // "jinx (league of legends)" comes through the DEDICATED characterTags
  // parameter, not the general tagString this filter guards — so it is
  // present in the output via includeCharacters, unaffected by this filter
  // either way.
  assert(out.includes("jinx (league of legends)"), `character tag with parens is included via includeCharacters (got "${out}")`)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
