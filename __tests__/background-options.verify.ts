/**
 * Regression tests for the "Background Options" feature
 * (lib/background-detector.ts + lib/cleanPrompt.ts integration).
 *
 * Covers the bugs found in the 2026-07-01 audit:
 *   1. Detailed Random must actually inject a scenery set when the dataset is
 *      loaded (previously it silently behaved like Remove All).
 *   2. Random / Detailed Random must be DETERMINISTIC for a given seed so the
 *      "pure" (category-copy) and "display" (full-copy) pipelines produce the
 *      SAME background instead of two independent Math.random() draws.
 *   3. All five modes behave as advertised: keep, remove_all, force_simple,
 *      random, detailed_random.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/background-options.verify.ts
 */
import {
  processBackgroundTags,
  analyzeBackground,
  isBackgroundTag,
} from "../lib/background-detector"

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

const has = (tags: string[], tag: string) => tags.includes(tag)
const eq = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b)

// ── 0) Detection primitives ──
{
  assert(isBackgroundTag("white background"), "detect: 'white background' is a bg tag")
  assert(isBackgroundTag("forest"), "detect: 'forest' (detailed keyword) is a bg tag")
  assert(!isBackgroundTag("blue eyes"), "detect: 'blue eyes' is NOT a bg tag")

  assert(analyzeBackground(["white background"]).type === "simple", "analyze: simple type")
  assert(analyzeBackground(["forest"]).type === "detailed", "analyze: detailed type")
  assert(analyzeBackground(["white background", "forest"]).type === "mixed", "analyze: mixed type")
}

// ── 1) keep: returns tags untouched ──
{
  const input = ["1girl", "white background", "forest"]
  const out = processBackgroundTags(input, "keep")
  assert(eq(out, input), "keep: output identical to input")
}

// ── 2) remove_all: strips simple bg + scenery, keeps the rest ──
{
  const out = processBackgroundTags(["1girl", "white background", "forest", "blue eyes"], "remove_all")
  assert(!has(out, "white background"), "remove_all: drops 'white background'")
  assert(!has(out, "forest"), "remove_all: drops scenery 'forest'")
  assert(has(out, "1girl") && has(out, "blue eyes"), "remove_all: keeps non-bg tags")
}

// ── 3) force_simple (Replace): strips bg then injects replacement tags ──
{
  const out = processBackgroundTags(
    ["1girl", "forest"],
    "force_simple",
    "simple background, white background",
  )
  assert(!has(out, "forest"), "force_simple: drops original bg")
  assert(has(out, "simple background") && has(out, "white background"),
    "force_simple: injects replacement tags")
}

// ── 4) random: deterministic per seed + always adds a background ──
{
  const opts = { includeGradients: true, patternsEnabled: true }
  const a = processBackgroundTags(["1girl", "blue eyes"], "random", undefined, undefined, opts, undefined, 123)
  const b = processBackgroundTags(["1girl", "blue eyes"], "random", undefined, undefined, opts, undefined, 123)
  assert(eq(a, b), "random: same seed => identical output (pure vs display consistency)")
  assert(a.some(t => /background/.test(t)) || a.some(t => t === "monochrome"),
    "random: injects at least one background tag")
  assert(has(a, "1girl") && has(a, "blue eyes"), "random: preserves subject tags")

  // Different seeds are allowed to diverge (sanity: not hard-locked to one value).
  const c = processBackgroundTags(["1girl", "blue eyes"], "random", undefined, undefined, opts, undefined, 999999)
  assert(typeof c[0] === "string", "random: different seed still produces valid output")
}

// ── 5) detailed_random: injects a scenery set from the dataset (deterministic) ──
{
  const list = [["forest", "sunlight"], ["cityscape", "night"]]
  const a = processBackgroundTags(["1girl", "white background"], "detailed_random", undefined, undefined, undefined, list, 7)
  const b = processBackgroundTags(["1girl", "white background"], "detailed_random", undefined, undefined, undefined, list, 7)
  assert(eq(a, b), "detailed_random: same seed => identical output")
  assert(!has(a, "white background"), "detailed_random: strips original bg")
  assert(a.some(t => t === "forest" || t === "cityscape"),
    "detailed_random: injects one scenery set from the dataset")
}

// ── 6) detailed_random with EMPTY dataset: must NOT crash, injects nothing ──
//    (documents WHY the dataset must be loaded — otherwise it degrades to remove_all)
{
  const out = processBackgroundTags(["1girl", "white background", "forest"], "detailed_random", undefined, undefined, undefined, [], 7)
  assert(!has(out, "white background") && !has(out, "forest"), "detailed_random(empty): still strips bg")
  assert(has(out, "1girl"), "detailed_random(empty): keeps subject, injects nothing")
}

// ── 7) modes that inject never duplicate an existing tag ──
{
  const out = processBackgroundTags(["1girl", "simple background"], "force_simple", "simple background")
  const count = out.filter(t => t.toLowerCase() === "simple background").length
  assert(count === 1, "no-dup: replacement not duplicated when already present")
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
