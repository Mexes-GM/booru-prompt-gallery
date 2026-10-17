/**
 * Tests for Pack Mode's rating handling (lib/pack/source-rating.ts,
 * lib/pack/explicit-tags.ts and generatePackPrompts' requiredTag).
 *
 * Covers:
 *   1. splitRatingFromTags reads rating:/-rating: tags and strips them.
 *   2. Unknown or contradictory rating tags are left in place.
 *   3. normalizePackSourceRating lets the search's rating win over the selector.
 *   4. countPostRatings / formatRatingBreakdown.
 *   5. isExplicitTag matches whole words only (no "butterfly").
 *   6. requiredTag puts an explicit tag in every prompt when the pools have one.
 *   7. requiredTag is a no-op when no axis can satisfy it, or the base already does.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-explicit-rating.verify.ts
 */
import {
  splitRatingFromTags,
  normalizePackSourceRating,
  countPostRatings,
  formatRatingBreakdown,
} from "../lib/pack/source-rating"
import { isExplicitTag, promptHasExplicitTag } from "../lib/pack/explicit-tags"
import { generatePackPrompts, createSeededRng } from "../lib/pack/pack-generator"
import type { BooruPost } from "../lib/booru/types"
import type { PackRatingMode } from "../hooks/use-pack-seed-search"

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

// 1. Rating tags are read and stripped
let split = splitRatingFromTags("rating:explicit, 1girl")
assert(split.rating === "explicit" && split.tags === "1girl", "rating:explicit read and stripped")
split = splitRatingFromTags("1girl, rating:e")
assert(split.rating === "explicit" && split.tags === "1girl", "short form rating:e")
split = splitRatingFromTags("rating:q, rating:e, solo")
assert(split.rating === "both" && split.tags === "solo", "q + e -> both")
split = splitRatingFromTags("-rating:general, 1girl")
assert(split.rating === "both" && split.tags === "1girl", "-rating:general -> both")
split = splitRatingFromTags("Rating:General")
assert(split.rating === "sfw" && split.tags === "", "case-insensitive general -> sfw")
split = splitRatingFromTags("1girl, solo")
assert(split.rating === null && split.tags === "1girl, solo", "no rating tag -> untouched")

// 2. Unknown / contradictory ratings stay in the tags
split = splitRatingFromTags("rating:s, 1girl")
assert(split.rating === null && split.tags === "rating:s, 1girl", "ambiguous rating:s left alone")
split = splitRatingFromTags("rating:general, rating:explicit")
assert(split.rating === null, "general + explicit is contradictory -> null")

// 3. Normalizing answers
const answers: { ratingMode: PackRatingMode; searchTags: string; tagsSource: string } = {
  ratingMode: "sfw",
  searchTags: "rating:explicit, 1girl",
  tagsSource: "current",
}
const normalized = normalizePackSourceRating(answers)
assert(normalized.ratingMode === "explicit" && normalized.searchTags === "1girl", "search rating wins over selector")
assert(normalized.tagsSource === "current", "other fields kept")
const plain = { ratingMode: "both" as const, searchTags: "1girl" }
assert(normalizePackSourceRating(plain) === plain, "no rating tag -> same object")

// 4. Breakdown
const post = (rating: string) => ({ rating } as BooruPost)
const breakdown = countPostRatings([post("e"), post("e"), post("e"), post("q"), post("g"), post("explicit")])
assert(breakdown.total === 6 && breakdown.explicit === 4 && breakdown.questionable === 1 && breakdown.sfw === 1, "ratings counted")
assert(formatRatingBreakdown(breakdown) === "67% explicit · 17% questionable · 17% SFW", "breakdown formatted largest first")
assert(formatRatingBreakdown(countPostRatings([])) === "", "empty breakdown -> empty string")

// 5. Explicit tags
for (const tag of ["nude", "completely_nude", "(nude:1.2)", "hetero", "nipples"]) {
  assert(isExplicitTag(tag), `explicit: ${tag}`)
}
for (const tag of ["butterfly", "white butterfly", "butterflyfish", "sundress", "looking at viewer", "smile", "floral print"]) {
  assert(!isExplicitTag(tag), `not explicit: ${tag}`)
}
assert(promptHasExplicitTag("1girl, smile, nude"), "prompt with explicit tag")
assert(!promptHasExplicitTag("1girl, smile, standing"), "prompt without explicit tag")

// 6. requiredTag guarantees an explicit tag
const axes = {
  pose: ["looking at viewer", "standing", "smile", "sitting", "waving", "nude", "hetero"],
  scenery: ["beach", "bedroom", "classroom", "forest"],
}
const prompts = generatePackPrompts({
  lockedTags: ["1girl", "blonde hair"],
  axes,
  count: 20,
  requiredTag: isExplicitTag,
  rng: createSeededRng(7),
})
assert(prompts.length > 0, "requiredTag still produces prompts")
assert(prompts.every((p) => promptHasExplicitTag(p.prompt)), "every prompt has an explicit tag")
const unrestricted = generatePackPrompts({ lockedTags: ["1girl", "blonde hair"], axes, count: 20, rng: createSeededRng(7) })
assert(unrestricted.some((p) => !promptHasExplicitTag(p.prompt)), "without requiredTag some prompts lack one")

// 6b. Same guarantee when an axis samples whole bundles instead of single tags
const bundleAxes = {
  pose: ["looking at viewer, smile", "sitting, waving", "standing, arms up", "blush, nude, lying", "hetero, kneeling"],
  clothing: ["school uniform, pleated skirt", "bikini", "maid, apron, maid headdress"],
}
const bundlePrompts = generatePackPrompts({
  lockedTags: ["1girl"],
  axes: bundleAxes,
  count: 15,
  requiredTag: isExplicitTag,
  rng: createSeededRng(11),
})
assert(bundlePrompts.length > 0, "bundle axes still produce prompts")
assert(bundlePrompts.every((p) => promptHasExplicitTag(p.prompt)), "every bundle prompt has an explicit tag")
assert(
  bundlePrompts.every((p) => p.prompt.includes("kneeling") || p.prompt.includes("lying")),
  "explicit bundle swapped in whole, not split"
)

// 7. No-op cases
const sfwAxes = { pose: ["standing", "smile", "sitting"], scenery: ["beach", "forest"] }
const noSource = generatePackPrompts({ lockedTags: ["1girl"], axes: sfwAxes, count: 6, requiredTag: isExplicitTag, rng: createSeededRng(3) })
const noSourceBaseline = generatePackPrompts({ lockedTags: ["1girl"], axes: sfwAxes, count: 6, rng: createSeededRng(3) })
assert(noSource.length === noSourceBaseline.length && noSource.length > 0, "no explicit values anywhere -> prompts unchanged")
const baseExplicit = generatePackPrompts({ lockedTags: ["1girl", "nude"], axes, count: 20, requiredTag: isExplicitTag, rng: createSeededRng(7) })
const baseExplicitBaseline = generatePackPrompts({ lockedTags: ["1girl", "nude"], axes, count: 20, rng: createSeededRng(7) })
assert(
  baseExplicit.map((p) => p.prompt).join("|") === baseExplicitBaseline.map((p) => p.prompt).join("|"),
  "explicit base -> sampling untouched"
)

console.log(`pack-explicit-rating: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
