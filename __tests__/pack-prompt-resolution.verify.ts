/**
 * Tests for Pack Mode per-prompt resolution (lib/pack/prompt-resolution.ts and
 * the aspect ratios the axis extractors record in lib/pack/pack-generator.ts).
 *
 * Covers:
 *   1. Extractors record each value's median width / height; posts without a size are skipped.
 *   2. A pose set uses its own source posts' shape.
 *   3. Loose pose tags: the most distinctive well-supported one wins; thin ones are ignored.
 *   4. Fallback order: scenery, base card, pool; null when nothing is known.
 *   5. resolutionForAspect snaps to a bucket and honors the size settings.
 *   6. withResolutionPrefix produces the form the extension's Import List reads.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-prompt-resolution.verify.ts
 */
import { extractAllAxisValuesWithCounts, extractAllAxisBundlesWithCounts } from "../lib/pack/pack-generator"
import { pickPromptAspect, resolutionForAspect, withResolutionPrefix, MIN_ASPECT_SUPPORT } from "../lib/pack/prompt-resolution"
import { parsePromptList } from "../lib/extension/prompt-list-parser"
import type { TagCategory } from "../lib/tag-taxonomy"
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

const near = (a: number | null | undefined, b: number) => a != null && Math.abs(a - b) < 0.01

// 1. Extractors record aspects
const post = (id: number, tags: string, width?: number, height?: number) =>
  ({ id, tag_string: tags, tag_string_character: "", width, height } as BooruPost)
const overrides = { "all fours": "pose:posture", "sitting": "pose:posture", "beach": "scenery:setting" }
const posts = [
  post(1, "1girl all_fours beach", 1200, 1000),
  post(2, "1girl all_fours", 1500, 1000),
  post(3, "1girl sitting", 800, 1200),
  post(4, "1girl sitting"), // no size
]
const loose = extractAllAxisValuesWithCounts(posts, ["pose"], overrides).pose ?? []
const allFours = loose.find((v) => v.value === "all fours")
const sitting = loose.find((v) => v.value === "sitting")
assert(near(allFours?.aspect, Math.sqrt(1.2 * 1.5)), `loose aspect is the median (got ${allFours?.aspect})`)
assert(sitting?.count === 2 && near(sitting?.aspect, 800 / 1200), "posts without a size are skipped")
const sets = extractAllAxisBundlesWithCounts(posts, ["pose"], overrides).pose ?? []
assert(sets.length > 0 && sets.every((v) => typeof v.aspect === "number"), "sets carry an aspect")
assert(extractAllAxisValuesWithCounts([post(9, "1girl sitting")], ["pose"], overrides).pose?.[0]?.aspect === undefined, "no size anywhere -> no aspect")

// 2-4. pickPromptAspect
const categories: Record<string, TagCategory> = {
  "all fours, from behind": "pose",
  "looking at viewer": "pose",
  "wide shot": "pose",
  "lying": "pose",
  "beach": "scenery",
  "school uniform": "clothing",
}
const aspects: Record<string, { aspect: number; count: number }> = {
  "all fours, from behind": { aspect: 4 / 3, count: 1 },
  "looking at viewer": { aspect: 0.74, count: 80 },
  "wide shot": { aspect: 1.5, count: 12 },
  "lying": { aspect: 1.4, count: MIN_ASPECT_SUPPORT - 1 },
  "beach": { aspect: 1.2, count: 20 },
  "school uniform": { aspect: 0.5, count: 40 },
}
const pick = (values: string[], extra: { baseAspect?: number | null; poolAspect?: number | null } = {}) =>
  pickPromptAspect({
    values,
    categoryOf: (v) => categories[v],
    aspectOf: (cat, v) => (categories[v] === cat ? aspects[v] : undefined),
    poolAspect: 0.75,
    ...extra,
  })
assert(near(pick(["all fours, from behind", "looking at viewer", "beach"]), 4 / 3), "a pose set uses its own shape")
assert(near(pick(["looking at viewer", "wide shot", "beach"]), 1.5), "the most distinctive loose pose tag wins")
assert(near(pick(["looking at viewer", "lying"]), 0.74), "a thinly supported tag is ignored")
assert(near(pick(["school uniform", "beach"]), 1.2), "no pose -> scenery; clothing never decides")
assert(near(pick(["school uniform"], { baseAspect: 0.7 }), 0.7), "then the base card")
assert(near(pick(["school uniform"]), 0.75), "then the pool")
assert(pick(["school uniform"], { poolAspect: null }) === null, "nothing known -> null")

// 5. resolutionForAspect
const standard = { maxLongSide: 1536, strictCap: false }
const square = resolutionForAspect(1.02, standard)
assert(square !== null && square.width === square.height, `near-square -> square bucket (got ${JSON.stringify(square)})`)
const wide = resolutionForAspect(1.5, standard)
assert(wide !== null && wide.width > wide.height && wide.width % 64 === 0 && wide.height % 64 === 0, "landscape, multiples of 64")
const tall = resolutionForAspect(0.7, { maxLongSide: 1024, strictCap: true })
assert(tall !== null && tall.height === 1024 && tall.width < tall.height, `strict cap honored (got ${JSON.stringify(tall)})`)
assert(resolutionForAspect(0, standard) === null && resolutionForAspect(NaN, standard) === null, "bad aspect -> null")

// 6. Prefix round-trips through the extension's parser
const line = withResolutionPrefix("1girl, solo, all fours", { width: 1536, height: 1152 })
assert(line === "[1536x1152] 1girl, solo, all fours", "prefix format")
const parsed = parsePromptList(line)
assert(parsed.length === 1 && parsed[0].width === 1536 && parsed[0].height === 1152 && parsed[0].prompt === "1girl, solo, all fours", "Import List reads it back")
assert(withResolutionPrefix("1girl", {}) === "1girl", "no size -> unchanged")

console.log(`pack-prompt-resolution: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
