/**
 * Tests for Pack Mode's rating handling (lib/pack/source-rating.ts,
 * lib/pack/explicit-tags.ts and generatePackPrompts' requiredTag/forbiddenTag).
 *
 * Covers:
 *   1. splitRatingFromTags reads rating:/-rating: tags and strips them.
 *   2. Unknown or contradictory rating tags are left in place.
 *   3. normalizePackSourceRating lets the search's rating win over the selector.
 *   4. countPostRatings / formatRatingBreakdown.
 *   5. isExplicitTag: depicted acts only, nudity is not explicit; whole words only.
 *   6. requiredTag puts an explicit tag in every prompt when the pools have one.
 *   7. requiredTag is a no-op when no axis can satisfy it, or the base already does.
 *   8. forbiddenTag keeps explicit tags out; bundles with one are dropped whole,
 *      and no leftover value out-samples the rest.
 *   9. ratingPasses / interleave.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-explicit-rating.verify.ts
 */
import {
  splitRatingFromTags,
  normalizePackSourceRating,
  countPostRatings,
  formatRatingBreakdown,
} from "../lib/pack/source-rating"
import { isExplicitTag, promptHasExplicitTag, ratingPasses, interleave } from "../lib/pack/explicit-tags"
import { generatePackPrompts, createSeededRng, withoutForbiddenTags } from "../lib/pack/pack-generator"
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

// 5. Explicit tags: depicted acts only, nudity stays questionable
for (const tag of ["hetero", "oral", "(hetero:1.2)", "after_sex", "girl on top", "lube", "crotch rub"]) {
  assert(isExplicitTag(tag), `explicit: ${tag}`)
}
for (const tag of ["nude", "completely nude", "nipples", "topless", "butterfly", "white butterfly", "sundress", "looking at viewer", "smile", "floral print"]) {
  assert(!isExplicitTag(tag), `not explicit: ${tag}`)
}
assert(promptHasExplicitTag("1girl, smile, hetero"), "prompt with explicit tag")
assert(!promptHasExplicitTag("1girl, nude, standing"), "nudity alone is not explicit")

// 6. requiredTag guarantees an explicit tag
const axes = {
  pose: ["looking at viewer", "standing", "smile", "sitting", "waving", "oral", "hetero"],
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
  pose: ["looking at viewer, smile", "sitting, waving", "standing, arms up", "blush, hetero, lying", "oral, kneeling"],
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

// 7. requiredTag no-op cases
const sfwAxes = { pose: ["standing", "smile", "sitting"], scenery: ["beach", "forest"] }
const noSource = generatePackPrompts({ lockedTags: ["1girl"], axes: sfwAxes, count: 6, requiredTag: isExplicitTag, rng: createSeededRng(3) })
const noSourceBaseline = generatePackPrompts({ lockedTags: ["1girl"], axes: sfwAxes, count: 6, rng: createSeededRng(3) })
assert(noSource.length === noSourceBaseline.length && noSource.length > 0, "no explicit values anywhere -> prompts unchanged")
const baseExplicit = generatePackPrompts({ lockedTags: ["1girl", "hetero"], axes, count: 20, requiredTag: isExplicitTag, rng: createSeededRng(7) })
const baseExplicitBaseline = generatePackPrompts({ lockedTags: ["1girl", "hetero"], axes, count: 20, rng: createSeededRng(7) })
assert(
  baseExplicit.map((p) => p.prompt).join("|") === baseExplicitBaseline.map((p) => p.prompt).join("|"),
  "explicit base -> sampling untouched"
)

// 8. forbiddenTag keeps explicit tags out, in loose tags and bundles
const forbidden = generatePackPrompts({ lockedTags: ["1girl"], axes, count: 20, forbiddenTag: isExplicitTag, rng: createSeededRng(5) })
assert(forbidden.length > 0 && forbidden.every((p) => !promptHasExplicitTag(p.prompt)), "no explicit tag sampled")
const forbiddenBundles = generatePackPrompts({ lockedTags: ["1girl"], axes: bundleAxes, count: 15, forbiddenTag: isExplicitTag, rng: createSeededRng(5) })
assert(forbiddenBundles.every((p) => !promptHasExplicitTag(p.prompt)), "no explicit tag sampled from bundles")
assert(!forbiddenBundles.some((p) => p.prompt.includes("kneeling") || p.prompt.includes("lying")), "a bundle with an explicit tag is dropped whole")
assert(
  withoutForbiddenTags(["smile", "hetero", "blush, hetero, lying", "sitting, waving"], isExplicitTag).join("|") === "smile|sitting, waving",
  "withoutForbiddenTags drops explicit values and bundles"
)
const lockedKept = generatePackPrompts({ lockedTags: ["1girl", "hetero"], axes, count: 5, forbiddenTag: isExplicitTag, rng: createSeededRng(5) })
assert(lockedKept.every((p) => p.prompt.includes("hetero")), "base tags are never removed")

// 8b. Regression: trimmed bundles used to be sampled as values missing from
// the weight map, at the fallback weight of 1 — dozens of times the
// normalized (~1/n) weights the app passes — and crowded out the pool.
// Every sampled value must be one the weight map knows.
const weightedPose = [
  "looking at viewer, smile", "sitting, waving", "standing, arms up", "kneeling, hands up",
  "lying, looking at viewer", "all fours, hetero", "looking at viewer, lube, oral", "bent over, hetero, blush",
]
const poseWeights = Object.fromEntries(weightedPose.map((v) => [v, 1 / weightedPose.length]))
const bigAxis = (name: string) => Array.from({ length: 40 }, (_, i) => `${name} ${i}`)
const sampled = generatePackPrompts({
  lockedTags: ["1girl"],
  axes: { pose: weightedPose, scenery: bigAxis("place"), clothing: bigAxis("outfit") },
  axisWeights: { pose: poseWeights },
  count: 50,
  forbiddenTag: isExplicitTag,
  rng: createSeededRng(9),
})
// `values` lists each picked bundle plus its single tags; the bundles are what
// used to come out trimmed.
const sampledBundles = new Set(sampled.flatMap((p) => p.values).filter((v) => v.includes(",")))
assert(sampled.length > 0 && [...sampledBundles].every((v) => v in poseWeights), "every sampled bundle has a weight entry")
assert(sampledBundles.size >= 4, `allowed pose bundles all get sampled (${sampledBundles.size})`)

// 9. Rating passes
assert(JSON.stringify(ratingPasses("explicit", 10)) === JSON.stringify([{ rule: "require", count: 10 }]), "explicit -> require")
assert(ratingPasses("questionable", 4)[0].rule === "forbid" && ratingPasses("sfw", 4)[0].rule === "forbid", "questionable/sfw -> forbid")
assert(JSON.stringify(ratingPasses("both", 5)) === JSON.stringify([{ rule: "require", count: 3 }, { rule: "forbid", count: 2 }]), "both -> half and half")
assert(ratingPasses(null, 3)[0].rule === null, "no rating -> no rule")
assert(interleave([[1, 3, 5], [2, 4]]).join(",") === "1,2,3,4,5", "interleave alternates")
assert(interleave([[], [1, 2]]).join(",") === "1,2", "interleave with an empty list")

console.log(`pack-explicit-rating: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
