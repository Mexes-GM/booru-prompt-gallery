/**
 * Tests for the Image Pack Builder pure core (lib/pack/pack-generator.ts).
 *
 * Covers:
 *   1. extractAxisValues ranks candidate values by cross-post frequency.
 *   2. extractAxisValues respects the `limit` and dedupes.
 *   3. generatePackPrompts emits exactly N distinct prompts when the
 *      combination space allows (N combos = N, no duplicates).
 *   4. Every generated prompt contains all locked base tags.
 *   5. Smart Tag Exclusion drops values that contradict the base
 *      (base "from behind" blocks "cleavage").
 *   6. The hard cap (maxPrompts) is respected.
 *   7. Global weights are applied when enabled.
 *   8. Seeded rng is deterministic.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-generator.verify.ts
 */
import type { BooruPost } from "../lib/booru/types"
import type { TagCategory } from "../lib/tag-classifier"
import {
  extractAxisValues,
  extractAxisValuesWithCounts,
  extractAllAxisValuesWithCounts,
  canonicalizeBundleTags,
  extractAxisBundlesWithCounts,
  extractAllAxisBundlesWithCounts,
  classifyPostForPack,
  filterAppearanceForPrimaryCharacter,
  generatePackPrompts,
  checkSlotConstraints,
  filterValuesBySlotState,
  groupValuesBySlot,
  maxValuesPerPrompt,
  createSeededRng,
  withAxisFallback,
  MAX_MIN_TAGS_SLIDER,
  MAX_MIN_PACKS_SLIDER,
} from "../lib/pack/pack-generator"

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

const POSTS: BooruPost[] = [
  makePost(1, "1girl solo standing looking_at_viewer long_hair blue_eyes shirt outdoors"),
  makePost(2, "1girl solo standing sitting long_hair red_dress indoors"),
  makePost(3, "1girl solo standing from_behind short_hair skirt night"),
]

// ── 1) Frequency ranking: "standing" appears in all 3 posts → ranked first ──
{
  const pose = extractAxisValues(POSTS, "pose")
  assert(pose[0] === "standing", `pose ranked by frequency (got '${pose[0]}')`)
  assert(pose.includes("from behind"), "pose includes 'from behind' (underscore normalized)")
  assert(pose.includes("looking at viewer"), "pose includes 'looking at viewer'")
}

// ── 2) limit + dedupe ──
{
  const pose = extractAxisValues(POSTS, "pose", {}, 2)
  assert(pose.length === 2, `limit respected (got ${pose.length})`)
  const clothing = extractAxisValues(POSTS, "clothing")
  const unique = new Set(clothing)
  assert(unique.size === clothing.length, "clothing values are deduped")
}

// ── 3) N combos = N distinct prompts when the space allows ──
{
  const rng = createSeededRng(42)
  const result = generatePackPrompts({
    lockedTags: ["1girl", "mona (genshin impact)"],
    axes: { pose: ["standing", "sitting", "kneeling"], scenery: ["outdoors", "indoors"] },
    count: 6,
    rng,
  })
  assert(result.length === 6, `emits 6 prompts for a 3x2 space (got ${result.length})`)
  const prompts = result.map((r) => r.prompt)
  assert(new Set(prompts).size === 6, "all 6 prompts are distinct")
}
{
  const rng = createSeededRng(7)
  const result = generatePackPrompts({
    lockedTags: ["1girl"],
    axes: { pose: ["standing", "sitting", "kneeling"], scenery: ["outdoors", "indoors"] },
    count: 4,
    rng,
  })
  assert(result.length === 4, `emits 4 prompts when asked for 4 (got ${result.length})`)
}

// ── 4) Every prompt contains all locked base tags ──
{
  const result = generatePackPrompts({
    lockedTags: ["1girl", "mona (genshin impact)"],
    axes: { pose: ["standing", "sitting"], scenery: ["outdoors", "indoors"] },
    count: 4,
    rng: createSeededRng(1),
  })
  const allHaveBase = result.every(
    (r) => r.prompt.includes("1girl") && r.prompt.includes("mona (genshin impact)")
  )
  assert(allHaveBase, "every prompt keeps the locked base tags")
}

// ── 5) Smart Tag Exclusion drops contradictory values ──
{
  const result = generatePackPrompts({
    lockedTags: ["1girl", "from behind"],
    axes: { appearance: ["cleavage", "long hair"] },
    count: 2,
    rng: createSeededRng(99),
  })
  const anyCleavage = result.some((r) => r.prompt.includes("cleavage"))
  assert(!anyCleavage, "'cleavage' is dropped when base has 'from behind'")
  const anyLongHair = result.some((r) => r.prompt.includes("long hair"))
  assert(anyLongHair, "'long hair' (non-conflicting) is kept")
}

// ── 6) Hard cap respected ──
{
  const bigPose = Array.from({ length: 30 }, (_, i) => `pose${i}`)
  const bigScene = Array.from({ length: 30 }, (_, i) => `scene${i}`)
  const result = generatePackPrompts({
    lockedTags: ["1girl"],
    axes: { pose: bigPose, scenery: bigScene },
    count: 1000,
    maxPrompts: 5,
    rng: createSeededRng(3),
  })
  assert(result.length === 5, `hard cap of 5 respected (got ${result.length})`)
}

// ── 7) Global weights applied when enabled ──
{
  const result = generatePackPrompts({
    lockedTags: ["1girl", "long hair"],
    axes: { pose: ["standing"] },
    count: 1,
    globalWeights: { "long hair": 1.3 },
    isGlobalWeightsEnabled: true,
    rng: createSeededRng(5),
  })
  assert(result.length === 1 && result[0].prompt.includes("(long hair:1.3)"),
    `global weight applied (got '${result[0]?.prompt}')`)
}

// ── 8) Determinism: same seed → same output ──
{
  const args = {
    lockedTags: ["1girl"],
    axes: { pose: ["standing", "sitting", "kneeling", "walking"], scenery: ["outdoors", "indoors", "beach"] },
    count: 5,
  }
  const a = generatePackPrompts({ ...args, rng: createSeededRng(123) }).map((r) => r.prompt)
  const b = generatePackPrompts({ ...args, rng: createSeededRng(123) }).map((r) => r.prompt)
  assert(JSON.stringify(a) === JSON.stringify(b), "seeded rng is deterministic")
}

// ── 9) No active axes → single base prompt (or empty) ──
{
  const withBase = generatePackPrompts({ lockedTags: ["1girl", "solo"], axes: {}, count: 5 })
  assert(withBase.length === 1 && withBase[0].prompt === "1girl, solo",
    `no axes + base → single base prompt (got ${withBase.length})`)
  const noBase = generatePackPrompts({ lockedTags: [], axes: {}, count: 5 })
  assert(noBase.length === 0, "no axes + no base → empty")
}

// ── 10) "Copy all" format: one prompt per line, in generation order ──
{
  const result = generatePackPrompts({
    lockedTags: ["1girl"],
    axes: { pose: ["standing", "sitting", "kneeling"] },
    count: 3,
    rng: createSeededRng(11),
  })
  const copyAllText = result.map((r) => r.prompt).join('\n')
  const lines = copyAllText.split('\n')
  assert(lines.length === result.length, `copy-all has one line per prompt (got ${lines.length})`)
  assert(lines.every((line, i) => line === result[i].prompt), "copy-all lines match prompts in order")
  assert(!copyAllText.includes('\n\n'), "copy-all has no blank lines")
}

// ── 11) withAxisFallback: curated fallback tops up sparse pools ──
{
  const sparse = ["standing", "sitting"]
  const fallback = ["standing", "kneeling", "walking", "jumping", "leaning forward"]
  const topped = withAxisFallback(sparse, fallback)
  assert(topped[0] === "standing" && topped[1] === "sitting",
    "withAxisFallback: sampled values come first, unchanged")
  assert(topped.includes("kneeling") && topped.includes("walking"),
    "withAxisFallback: fallback values fill the gap")
  assert(new Set(topped).size === topped.length,
    "withAxisFallback: no duplicate values (e.g. 'standing' from both lists)")
}
{
  const rich = Array.from({ length: 6 }, (_, i) => `pose${i}`)
  const topped = withAxisFallback(rich, ["fallback-a", "fallback-b"])
  assert(topped.length === rich.length && topped.every((v, i) => v === rich[i]),
    "withAxisFallback: a pool at/above the sparse threshold is left untouched")
}
{
  const topped = withAxisFallback(["standing"], undefined)
  assert(topped.length === 1 && topped[0] === "standing",
    "withAxisFallback: no fallback list provided -> sampled values returned as-is")
}

// ── 12) axisMinCounts: sampling multiple distinct values per axis ──
// Uses synthetic values with no entry in TAG_CONFLICTS (unlike real scenery/
// pose tags) so this isolates the sampling-count behavior from Smart Tag
// Exclusion, which test #13 covers separately with real conflicting tags.
{
  const result = generatePackPrompts({
    lockedTags: ["1girl"],
    axes: { scenery: ["scenery-a", "scenery-b", "scenery-c", "scenery-d"] },
    axisMinCounts: { scenery: 2 },
    count: 1,
    rng: createSeededRng(1),
  })
  assert(result.length === 1, `axisMinCounts: emits a prompt (got ${result.length})`)
  const sceneryValues = ["scenery-a", "scenery-b", "scenery-c", "scenery-d"].filter((v) =>
    result[0]?.prompt.includes(v)
  )
  assert(sceneryValues.length === 2, `axisMinCounts=2 samples exactly 2 distinct scenery values (got ${sceneryValues.length})`)
}
{
  // Clamped to the pool size when minCount exceeds it.
  const result = generatePackPrompts({
    lockedTags: ["1girl"],
    axes: { scenery: ["scenery-a", "scenery-b"] },
    axisMinCounts: { scenery: 10 },
    count: 1,
    rng: createSeededRng(2),
  })
  assert(
    result[0]?.prompt.includes("scenery-a") && result[0]?.prompt.includes("scenery-b"),
    "axisMinCounts clamps to pool size when requested min exceeds it"
  )
}
{
  // Default (no axisMinCounts) still behaves as 1-per-axis.
  const withDefault = generatePackPrompts({
    lockedTags: ["1girl"],
    axes: { pose: ["standing", "sitting", "kneeling"] },
    count: 1,
    rng: createSeededRng(3),
  })
  const poseHits = ["standing", "sitting", "kneeling"].filter((v) => withDefault[0]?.prompt.includes(v))
  assert(poseHits.length === 1, `no axisMinCounts defaults to 1 value per axis (got ${poseHits.length})`)
}
{
  // axisMinCounts=0 deactivates the axis completely (zero tags sampled from this axis).
  const result = generatePackPrompts({
    lockedTags: ["1girl"],
    axes: {
      scenery: ["scenery-a", "scenery-b"],
      pose: ["standing", "sitting"],
    },
    axisMinCounts: { scenery: 0 },
    count: 1,
    rng: createSeededRng(4),
  })
  assert(result.length === 1, "axisMinCounts=0: emits a prompt")
  const sceneryHits = ["scenery-a", "scenery-b"].filter((v) => result[0]?.prompt.includes(v))
  assert(sceneryHits.length === 0, `axisMinCounts=0 emits no scenery tags (got ${sceneryHits.length})`)
  const poseHits = ["standing", "sitting"].filter((v) => result[0]?.prompt.includes(v))
  assert(poseHits.length === 1, `active axis still emits tags normally (got ${poseHits.length})`)
}
{
  // When all axes are deactivated (minCount=0), only base tags are emitted.
  const result = generatePackPrompts({
    lockedTags: ["1girl", "solo"],
    axes: {
      scenery: ["beach"],
      pose: ["standing"],
    },
    axisMinCounts: { scenery: 0, pose: 0 },
    count: 1,
  })
  assert(result.length === 1, "emits base prompt when all axes deactivated")
  assert(result[0]?.prompt === "1girl, solo", `only base tags are emitted (got ${result[0]?.prompt})`)
}

// ── 13) axisMinCounts + Smart Tag Exclusion: same-axis contradictions ──
// "standing" blocks "sitting" (tag-conflicts.ts POSES rule) — with
// axisMinCounts=2 both could get picked into the same prompt, which the
// base-only conflict check can't catch (neither contradicts "1girl").
// buildPrompt's second, incremental pass must drop one of them.
{
  const result = generatePackPrompts({
    lockedTags: ["1girl"],
    axes: { pose: ["standing", "sitting"] },
    axisMinCounts: { pose: 2 },
    count: 1,
    rng: createSeededRng(4),
  })
  assert(result.length === 1, `axisMinCounts same-axis conflict: still emits a prompt (got ${result.length})`)
  const hasStanding = result[0]?.prompt.includes("standing")
  const hasSitting = result[0]?.prompt.includes("sitting")
  assert(
    !(hasStanding && hasSitting),
    `axisMinCounts same-axis conflict: 'standing' and 'sitting' never both land in one prompt (got standing=${hasStanding}, sitting=${hasSitting})`
  )
  assert(hasStanding || hasSitting, "axisMinCounts same-axis conflict: at least one of the two survives")
}

// ── 14) extractAxisValuesWithCounts: same ranking as extractAxisValues, plus counts ──
{
  const withCounts = extractAxisValuesWithCounts(POSTS, "pose")
  const plain = extractAxisValues(POSTS, "pose")
  assert(
    JSON.stringify(withCounts.map((v) => v.value)) === JSON.stringify(plain),
    "extractAxisValuesWithCounts: value order matches extractAxisValues exactly"
  )
  const standing = withCounts.find((v) => v.value === "standing")
  assert(standing?.count === 3, `extractAxisValuesWithCounts: 'standing' count is 3 (got ${standing?.count})`)
  const fromBehind = withCounts.find((v) => v.value === "from behind")
  assert(fromBehind?.count === 1, `extractAxisValuesWithCounts: 'from behind' count is 1 (got ${fromBehind?.count})`)
}

// ── 14b) extractAllAxisValuesWithCounts: classifies posts once, but matches
//         calling extractAxisValuesWithCounts once per category exactly ──
{
  const categories: TagCategory[] = ["appearance", "pose", "clothing", "scenery"]
  const all = extractAllAxisValuesWithCounts(POSTS, categories)
  for (const cat of categories) {
    const expected = extractAxisValuesWithCounts(POSTS, cat)
    assert(
      JSON.stringify(all[cat]) === JSON.stringify(expected),
      `extractAllAxisValuesWithCounts: '${cat}' matches extractAxisValuesWithCounts exactly (got ${JSON.stringify(all[cat])}, expected ${JSON.stringify(expected)})`
    )
  }
  // A subset of categories only computes/returns that subset.
  const subset = extractAllAxisValuesWithCounts(POSTS, ["pose"])
  assert(
    Object.keys(subset).length === 1 && subset.pose !== undefined,
    "extractAllAxisValuesWithCounts: only computes the requested categories"
  )
  // Respects `limit` the same way the single-category function does.
  const limited = extractAllAxisValuesWithCounts(POSTS, ["pose"], {}, 1)
  assert(limited.pose?.length === 1, `extractAllAxisValuesWithCounts: respects limit (got ${limited.pose?.length})`)
}

// ── 14c) filterAppearanceForPrimaryCharacter: drops non-primary character
//         tags from an appearance bucket, keeps everything else untouched ──
{
  // Regression for the multi-character base-card contamination bug: a
  // crossover post's classifyPostForPack folds EVERY character tag into
  // `appearance`, so a naive 'character' pack locked all of them at once.
  const appearanceTags = ["mona megistus", "sucrose (genshin impact)", "black hair", "blue tail", "breasts"]
  const characterTags = ["mona megistus", "sucrose (genshin impact)"]
  const filtered = filterAppearanceForPrimaryCharacter(appearanceTags, characterTags)
  assert(filtered.includes("mona megistus"), "keeps the PRIMARY (first) character tag")
  assert(!filtered.includes("sucrose (genshin impact)"), "drops every OTHER character tag")
  assert(filtered.includes("black hair") && filtered.includes("blue tail") && filtered.includes("breasts"),
    "non-character appearance tags (hair, tail, body) are untouched")
  assert(filtered.length === appearanceTags.length - 1, `drops exactly the non-primary character tags (got ${filtered.length}, expected ${appearanceTags.length - 1})`)
}
{
  // No-op with 0 or 1 character tags — the common case must be untouched.
  const appearanceTags = ["mona megistus", "black hair"]
  assert(
    JSON.stringify(filterAppearanceForPrimaryCharacter(appearanceTags, ["mona megistus"])) === JSON.stringify(appearanceTags),
    "no-op with exactly 1 character tag"
  )
  assert(
    JSON.stringify(filterAppearanceForPrimaryCharacter(appearanceTags, [])) === JSON.stringify(appearanceTags),
    "no-op with 0 character tags"
  )
}
{
  // An 8-character crossover post (the real-world case this bug was found
  // against) — only the first survives, order preserved for the rest.
  const characters = Array.from({ length: 8 }, (_, i) => `character${i}`)
  const appearanceTags = [...characters, "long hair", "green eyes"]
  const filtered = filterAppearanceForPrimaryCharacter(appearanceTags, characters)
  assert(JSON.stringify(filtered) === JSON.stringify(["character0", "long hair", "green eyes"]),
    `8-character crossover: only character0 survives, in original order (got ${JSON.stringify(filtered)})`)
}
{
  // Integration: classifyPostForPack's own appearance bucket, run through
  // the filter with the post's OWN character tags, ends up single-character.
  const crossoverPost = makePost(999, "black_hair blue_tail breasts", "mona_megistus sucrose_(genshin_impact) klee_(genshin_impact)")
  const classified = classifyPostForPack(crossoverPost)
  const characterTags = ["mona megistus", "sucrose (genshin impact)", "klee (genshin impact)"]
  const filtered = filterAppearanceForPrimaryCharacter(classified.appearance, characterTags)
  const remainingCharacterTags = filtered.filter((t) => characterTags.includes(t))
  assert(remainingCharacterTags.length === 1 && remainingCharacterTags[0] === "mona megistus",
    `integration: classifyPostForPack's appearance bucket filtered down to exactly the primary character (got [${filtered.join(", ")}])`)
}

// ── 15) axisWeights: biased sampling skews toward the higher-weighted value ──
// "scenery-rare" and "scenery-common" have no entry in tag-conflicts.ts, so
// this isolates weighting from Smart Tag Exclusion. Runs many independent
// single-prompt generations (fresh seed each time, so no seenPrompts dedup
// carries over) and checks the empirical pick rate skews the expected way.
{
  const RUNS = 400
  let commonWins = 0
  for (let i = 0; i < RUNS; i++) {
    const result = generatePackPrompts({
      lockedTags: ["1girl"],
      axes: { scenery: ["scenery-common", "scenery-rare"] },
      axisWeights: { scenery: { "scenery-common": 20, "scenery-rare": 1 } },
      count: 1,
      rng: createSeededRng(1000 + i),
    })
    if (result[0]?.prompt.includes("scenery-common")) commonWins++
  }
  const rate = commonWins / RUNS
  assert(
    rate > 0.75,
    `axisWeights: heavily-weighted value wins clearly more often (rate=${rate.toFixed(2)}, expected >0.75)`
  )
  assert(
    rate < 1,
    `axisWeights: the lower-weighted value still gets picked sometimes (rate=${rate.toFixed(2)}, expected <1, no hard exclusion)`
  )
}

// ── 16) axisWeights: omitted → sampling stays uniform (no regression) ──
{
  const RUNS = 400
  let firstWins = 0
  for (let i = 0; i < RUNS; i++) {
    const result = generatePackPrompts({
      lockedTags: ["1girl"],
      axes: { scenery: ["scenery-a", "scenery-b"] },
      count: 1,
      rng: createSeededRng(2000 + i),
    })
    if (result[0]?.prompt.includes("scenery-a")) firstWins++
  }
  const rate = firstWins / RUNS
  assert(
    rate > 0.35 && rate < 0.65,
    `no axisWeights: sampling stays roughly uniform (rate=${rate.toFixed(2)}, expected ~0.5)`
  )
}

// ── 17) weightTemperature: high temperature flattens a skewed weight back toward uniform ──
{
  const RUNS = 400
  const weightsArg = { scenery: { "scenery-common": 20, "scenery-rare": 1 } }
  let sharpWins = 0
  let flatWins = 0
  for (let i = 0; i < RUNS; i++) {
    const sharp = generatePackPrompts({
      lockedTags: ["1girl"],
      axes: { scenery: ["scenery-common", "scenery-rare"] },
      axisWeights: weightsArg,
      weightTemperature: 1,
      count: 1,
      rng: createSeededRng(3000 + i),
    })
    if (sharp[0]?.prompt.includes("scenery-common")) sharpWins++
    const flat = generatePackPrompts({
      lockedTags: ["1girl"],
      axes: { scenery: ["scenery-common", "scenery-rare"] },
      axisWeights: weightsArg,
      weightTemperature: 20,
      count: 1,
      rng: createSeededRng(3000 + i),
    })
    if (flat[0]?.prompt.includes("scenery-common")) flatWins++
  }
  const sharpRate = sharpWins / RUNS
  const flatRate = flatWins / RUNS
  assert(
    flatRate < sharpRate,
    `weightTemperature: a high temperature flattens the skew (sharp=${sharpRate.toFixed(2)}, flat=${flatRate.toFixed(2)})`
  )
  assert(
    flatRate > 0.3 && flatRate < 0.7,
    `weightTemperature: high temperature lands close to uniform (flat=${flatRate.toFixed(2)}, expected ~0.5)`
  )
}

// ── 18) axisWeights on a huge (sampled, not enumerated) space still biases correctly ──
// Mirrors test #6's "hard cap respected" pool sizes (30x30, well above
// ENUMERATE_THRESHOLD's per-axis feasibility) to exercise the
// sampleWeightedCombination code path, not the enumerated/shuffled one.
{
  const bigPose = Array.from({ length: 30 }, (_, i) => `pose${i}`)
  const bigScene = Array.from({ length: 30 }, (_, i) => `scene${i}`)
  const poseWeights: Record<string, number> = {}
  bigPose.forEach((v, i) => { poseWeights[v] = i === 0 ? 50 : 1 })

  const result = generatePackPrompts({
    lockedTags: ["1girl"],
    axes: { pose: bigPose, scenery: bigScene },
    axisWeights: { pose: poseWeights },
    count: 40,
    maxPrompts: 40,
    rng: createSeededRng(4242),
  })
  assert(result.length > 0, `axisWeights on a huge space still produces prompts (got ${result.length})`)
  const pose0Count = result.filter((r) => r.prompt.includes("pose0")).length
  const rate = pose0Count / result.length
  // pose0 is ~50x more likely per-slot than any other single pose value; even
  // diluted by 29 competing values it should show up far more than the
  // uniform baseline (1/30 ≈ 0.033) across 40 generated prompts.
  assert(
    rate > 0.15,
    `axisWeights on a huge space: heavily-weighted 'pose0' appears well above uniform baseline (rate=${rate.toFixed(2)}, expected >0.15, uniform~0.033)`
  )
}

// ── 19) Full Setup (baseless pack): custom base prompt + sampled axes produces valid prompts ──
{
  const customBasePrompt = "1girl, solo, masterpiece"
  const lockedTags = customBasePrompt.split(",").map((t) => t.trim()).filter(Boolean)
  const result = generatePackPrompts({
    lockedTags,
    axes: {
      clothing: ["shirt", "dress"],
      pose: ["standing", "sitting"],
      scenery: ["indoors", "outdoors"],
    },
    count: 4,
    rng: createSeededRng(123),
  })
  assert(result.length === 4, `Full Setup generates requested count (got ${result.length})`)
  result.forEach((p) => {
    assert(p.prompt.includes("1girl"), "Prompt includes custom base tag 1girl")
    assert(p.prompt.includes("masterpiece"), "Prompt includes custom base tag masterpiece")
  })
}

// ── 20) canonicalizeBundleTags: normalizes, dedupes, sorts tags ──
{
  const tags = ["pleated_skirt", "serafuku", "pleated skirt", "white_socks"]
  const canonical = canonicalizeBundleTags(tags)
  assert(canonical === "pleated skirt, serafuku, white socks",
    `canonicalizeBundleTags produces sorted, normalized, deduped string (got '${canonical}')`)
}

// ── 21) extractAxisBundlesWithCounts: extracts cohesive sets per card ──
{
  const bundlePosts: BooruPost[] = [
    makePost(10, "1girl solo red_dress boots"),
    makePost(11, "1girl solo boots red_dress"), // same bundle in different order
    makePost(12, "1girl solo shirt pleated_skirt white_socks"),
  ]
  const bundles = extractAxisBundlesWithCounts(bundlePosts, "clothing")
  assert(bundles.length === 2, `extractAxisBundlesWithCounts dedupes identical card bundles (got ${bundles.length})`)
  assert(bundles[0].value === "boots, red dress", `first bundle is 'boots, red dress' (got '${bundles[0].value}')`)
  assert(bundles[0].count === 2, `first bundle count is 2 (got ${bundles[0].count})`)
  assert(bundles[1].value === "pleated skirt, shirt, white socks", `second bundle is 'pleated skirt, shirt, white socks' (got '${bundles[1].value}')`)
  assert(bundles[1].count === 1, `second bundle count is 1 (got ${bundles[1].count})`)

  // extractAllAxisBundlesWithCounts matches
  const allBundles = extractAllAxisBundlesWithCounts(bundlePosts, ["clothing"])
  assert(JSON.stringify(allBundles.clothing) === JSON.stringify(bundles),
    "extractAllAxisBundlesWithCounts matches extractAxisBundlesWithCounts")
}

// ── 22) generatePackPrompts with bundle values: includes entire bundle without scrambling ──
{
  const result = generatePackPrompts({
    lockedTags: ["1girl", "mona (genshin impact)"],
    axes: {
      clothing: ["serafuku, pleated skirt, white socks", "bikini, straw hat, sunglasses"],
    },
    count: 2,
    rng: createSeededRng(777),
  })
  assert(result.length === 2, `generates 2 prompts with clothing bundles (got ${result.length})`)
  const hasSerafukuOutfit = result.some((r) =>
    r.prompt.includes("serafuku") && r.prompt.includes("pleated skirt") && r.prompt.includes("white socks")
  )
  const hasBikiniOutfit = result.some((r) =>
    r.prompt.includes("bikini") && r.prompt.includes("straw hat") && r.prompt.includes("sunglasses")
  )
  assert(hasSerafukuOutfit && hasBikiniOutfit, "each prompt includes a complete outfit bundle intact")
  // Check that prompt values include the bundle string so learning can track it
  assert(
    result.some((r) => r.values.includes("serafuku, pleated skirt, white socks")),
    "prompt.values preserves the selected bundle string for learning tracking"
  )
}

// ── 23) Smart Tag Exclusion with bundle values: only conflicting tag is dropped from bundle ──
{
  // Base card has "from behind". Clothing bundle has "bikini, straw hat, cleavage".
  // "cleavage" conflicts with "from behind" (Smart Tag Exclusion).
  // "cleavage" must be dropped, while "bikini" and "straw hat" are preserved!
  const result = generatePackPrompts({
    lockedTags: ["1girl", "from behind"],
    axes: {
      clothing: ["bikini, straw hat, cleavage"],
    },
    count: 1,
    rng: createSeededRng(888),
  })
  assert(result.length === 1, "prompt generated with conflicting bundle")
  assert(!result[0].prompt.includes("cleavage"), "'cleavage' dropped by Smart Tag Exclusion from bundle")
  assert(result[0].prompt.includes("bikini"), "'bikini' kept in prompt")
  assert(result[0].prompt.includes("straw hat"), "'straw hat' kept in prompt")
}

// ── 24) Slider threshold limits: individual tags cap at 30, bundles cap at 10 ──
{
  assert(MAX_MIN_TAGS_SLIDER === 30, `MAX_MIN_TAGS_SLIDER is 30 (got ${MAX_MIN_TAGS_SLIDER})`)
  assert(MAX_MIN_PACKS_SLIDER === 10, `MAX_MIN_PACKS_SLIDER is 10 (got ${MAX_MIN_PACKS_SLIDER})`)
}

// ── 25) Orthogonal slot constraints: checkSlotConstraints blocks outfit + bottom ──
{
  const overrides: Record<string, string> = {
    dress: "clothing:outfit",
    skirt: "clothing:bottom",
    shirt: "clothing:top",
    beach: "scenery:setting",
    forest: "scenery:setting",
  }
  // Outfit + bottom incompatibility
  assert(!checkSlotConstraints("dress", ["skirt"], overrides), "dress rejected when skirt is present")
  assert(!checkSlotConstraints("skirt", ["dress"], overrides), "skirt rejected when dress is present")
  assert(checkSlotConstraints("shirt", ["skirt"], overrides), "shirt allowed when skirt is present")

  // Max count constraint (setting allows max 1)
  assert(!checkSlotConstraints("forest", ["beach"], overrides), "second setting rejected by maxCount=1")
  assert(checkSlotConstraints("forest", ["shirt"], overrides), "setting allowed when no setting is present")
}

// ── 26) generatePackPrompts with orthogonal slot constraints & tagSlots output ──
{
  const overrides: Record<string, string> = {
    dress: "clothing:outfit",
    skirt: "clothing:bottom",
    shirt: "clothing:top",
    smile: "pose:expression",
    standing: "pose:posture",
  }
  const result = generatePackPrompts({
    lockedTags: ["1girl", "dress"],
    axes: {
      clothing: ["skirt", "shirt"],
      pose: ["smile", "standing"],
    },
    count: 2,
    rng: createSeededRng(999),
    tagOverrides: overrides,
  })
  assert(result.length > 0, "generates prompts with slot constraints")
  for (const r of result) {
    // Because base has "dress" (clothing:outfit), "skirt" (clothing:bottom) must never be in the prompt!
    assert(!r.prompt.includes("skirt"), "prompt does not include conflicting bottom when outfit is locked")
    assert(r.tagSlots !== undefined, "tagSlots is populated")
    if (r.tagSlots) {
      assert(r.tagSlots["dress"] === "clothing:outfit", "dress mapped to clothing:outfit")
    }
  }
}

// ── 27) filterValuesBySlotState: locked and muted slots drop out ──
{
  const overrides: Record<string, string> = {
    smile: "pose:expression",
    standing: "pose:posture",
    running: "pose:kinetic",
  }
  const state = { lockedSlots: new Set(["pose:posture"]), mutedSlots: new Set(["pose:kinetic"]) }
  const filtered = filterValuesBySlotState("pose", ["smile", "standing", "running", "mystery pose"], state, overrides)
  assert(filtered.length === 1 && filtered[0] === "smile", "only the varying slot survives")
  assert(!filtered.includes("mystery pose"), "unknown slot dropped when the category is partially locked")

  const mutedOnly = { lockedSlots: new Set<string>(), mutedSlots: new Set(["pose:kinetic"]) }
  const kept = filterValuesBySlotState("pose", ["smile", "running", "mystery pose"], mutedOnly, overrides)
  assert(kept.includes("mystery pose"), "unknown slot kept when nothing in the category is locked")
  assert(!kept.includes("running"), "muted slot dropped")

  const none = { lockedSlots: new Set<string>(), mutedSlots: new Set<string>() }
  const values = ["smile", "running"]
  assert(filterValuesBySlotState("pose", values, none, overrides) === values, "no slot state is a no-op")
}

// ── 28) filterValuesBySlotState strips locked tags out of bundles ──
{
  const overrides: Record<string, string> = { smile: "pose:expression", standing: "pose:posture", wink: "pose:expression" }
  const state = { lockedSlots: new Set(["pose:posture"]), mutedSlots: new Set<string>() }
  const filtered = filterValuesBySlotState("pose", ["smile, standing", "standing", "wink"], state, overrides)
  assert(filtered.includes("smile"), "bundle reduced to its varying tag")
  assert(!filtered.some((v: string) => v.includes("standing")), "locked slot stripped from bundles and singles")
  assert(filtered.includes("wink"), "varying single kept")
}

// ── 29) groupValuesBySlot + maxValuesPerPrompt ──
{
  const overrides: Record<string, string> = {
    smile: "pose:expression",
    grin: "pose:expression",
    standing: "pose:posture",
    running: "pose:kinetic",
    punching: "pose:combat",
    hugging: "pose:interaction",
  }
  const groups = groupValuesBySlot("pose", ["mystery pose", "running", "smile", "standing", "grin", "punching", "hugging"], overrides)
  assert(groups[0].slot === "pose:posture", "groups follow taxonomy order")
  assert(groups[groups.length - 1].slot === null, "unslotted group comes last")
  const expression = groups.find((g) => g.slot === "pose:expression")
  assert(expression?.values.length === 2, "values of one slot share a group")
  // posture 1 + expression min(2,1)=1 + active actions min(1+1+1, 2)=2 + unslotted 1
  assert(maxValuesPerPrompt(groups) === 5, `cap respects maxCount and the action budget (got ${maxValuesPerPrompt(groups)})`)
}

// ── 30) Slot constraints apply to suffix-derived variants ("blue skirt" -> skirt) ──
{
  const overrides: Record<string, string> = {
    dress: "clothing:outfit",
    skirt: "clothing:bottom",
  }
  assert(!checkSlotConstraints("blue skirt", ["dress"], overrides), "derived bottom rejected against a locked outfit")
  assert(!checkSlotConstraints("red dress", ["skirt"], overrides), "derived outfit rejected against a bottom")
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)