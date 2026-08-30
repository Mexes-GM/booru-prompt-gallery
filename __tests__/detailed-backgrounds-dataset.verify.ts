/**
 * Regression tests for the "Detailed Random" scenery dataset
 * (public/detailed-backgrounds.json) and its selection behaviour.
 *
 * Covers what the 2026-08-28 preset audit established, so a future edit to the
 * dataset can't silently undo it:
 *   1. Scenery-only: the mode REPLACES the post's background, so a preset must
 *      never carry pose/clothing/appearance tags. The loader only reads
 *      `scenery`, so anything else is both dead weight and a sign the preset
 *      was authored as a full scene instead of a background.
 *   2. Every preset is usable: non-empty, no duplicate tags inside a preset,
 *      no two presets identical.
 *   3. Selection stays varied. `processBackgroundTags` picks with
 *      seededRandom(post.id), and booru pages hand it a tight run of nearly
 *      consecutive ids — the case most likely to collapse onto a few presets.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/detailed-backgrounds-dataset.verify.ts
 */
import { processBackgroundTags } from "../lib/background-detector"
import rawPresets from "../public/detailed-backgrounds.json"
import pseudoTags from "./fixtures/scenery-pseudo-tags.json"

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

interface Preset {
  scenery?: string[]
  appearance?: string[]
  pose?: string[]
  clothing?: string[]
  other?: string[]
}

const presets = rawPresets as Preset[]
/** Mirrors what useDetailedBackgrounds hands to processBackgroundTags. */
const sceneryList: string[][] = presets.map((p) => (Array.isArray(p.scenery) ? p.scenery : []))

// ── 1) Scenery-only invariant ──
{
  assert(Array.isArray(presets) && presets.length > 0, "dataset: parses as a non-empty array")

  const nonSceneryAxes = ["appearance", "pose", "clothing", "other"] as const
  const polluted = presets.reduce<string[]>((acc, preset, i) => {
    for (const axis of nonSceneryAxes) {
      if ((preset[axis] || []).length > 0) acc.push(`#${i}.${axis}`)
    }
    return acc
  }, [])
  assert(
    polluted.length === 0,
    `scenery-only: presets must not carry non-scenery axes (offenders: ${polluted.slice(0, 8).join(", ")})`,
  )
}

// ── 2) Every preset is usable ──
{
  const empty = sceneryList.reduce<number[]>((acc, s, i) => (s.length === 0 ? [...acc, i] : acc), [])
  assert(empty.length === 0, `usable: no preset has an empty scenery list (offenders: ${empty.slice(0, 8).join(", ")})`)

  const withInternalDupes = sceneryList.reduce<number[]>(
    (acc, s, i) => (new Set(s).size !== s.length ? [...acc, i] : acc),
    [],
  )
  assert(
    withInternalDupes.length === 0,
    `usable: no preset repeats a tag (offenders: ${withInternalDupes.slice(0, 8).join(", ")})`,
  )

  const signatures = new Set(sceneryList.map((s) => s.join("|")))
  assert(signatures.size === sceneryList.length, "usable: no two presets are identical")

  const blank = sceneryList.some((s) => s.some((t) => typeof t !== "string" || t.trim() === ""))
  assert(!blank, "usable: no empty/non-string tags")
}

// ── 2b) Pseudo-tag guard: no entry may invoke a booru concept that has a canonical tag ──
//    This does NOT gate natural language, and that distinction is the whole point.
//
//    Illustrious was trained on multi-level captions covering both tags and natural-language
//    descriptions (arXiv 2409.19946), and ANIMA likewise reads both. So `linen curtains`,
//    `walk-in closet` and `cozy atmosphere` are legitimate scene description, not dead weight:
//    composing a background out of descriptive language is a supported mechanism, and demanding
//    that every entry be a real Danbooru tag would strip exactly the depth the dataset is for.
//
//    What IS wrong is a PSEUDO-TAG: a phrase reaching for a booru concept when a canonical tag
//    for that same concept already exists, e.g. `rim lighting` where `backlighting` (45k posts)
//    is what the model actually learned. Those are enumerated in the fixture with their
//    replacement, and this asserts none of them came back.
//
//    A previous version of this block gated every entry on post_count instead. That was wrong
//    for the reason above, and it is recorded here so the looser rule is not "tightened" back.
{
  const substitutions = pseudoTags.substitutions as Array<{ from: string; to: string }>
  const byPseudoTag = new Map(substitutions.map((s) => [s.from.toLowerCase(), s.to]))

  const offenders: string[] = []
  sceneryList.forEach((scenery, i) => {
    for (const tag of scenery) {
      const replacement = byPseudoTag.get(tag.trim().toLowerCase())
      if (replacement) offenders.push(`#${i}:"${tag}" (use "${replacement}")`)
    }
  })

  assert(
    offenders.length === 0,
    `pseudo-tags: no entry may use a phrase that has a canonical tag ` +
      `(offenders: ${offenders.slice(0, 8).join(", ")})`,
  )

  // Every substitution target must actually be present somewhere, otherwise the fixture has
  // drifted from the dataset and the guard above is silently vacuous.
  const allTags = new Set(sceneryList.flat().map((t) => t.trim().toLowerCase()))
  const missingTargets = [...new Set(substitutions.map((s) => s.to.toLowerCase()))].filter(
    (target) => !allTags.has(target),
  )
  assert(
    missingTargets.length === 0,
    `pseudo-tags: every replacement target appears in the dataset. The fixture may be stale ` +
      `(missing: ${missingTargets.slice(0, 8).join(", ")})`,
  )

  console.log(
    `pseudo-tags: ${substitutions.length} substitutions pinned; ` +
      `${allTags.size} distinct entries, natural-language prose intentionally allowed`,
  )
}

// ── 3) The full picked set is injected, not just its first tag ──
{
  const list = [["indoors", "bedroom", "night", "table lamp"]]
  const out = processBackgroundTags(
    ["1girl", "white background"],
    "detailed_random",
    undefined,
    undefined,
    undefined,
    list,
    7,
  )
  const injected = list[0].filter((t) => out.includes(t))
  assert(injected.length === list[0].length, "inject: every tag of the picked preset lands in the output")
  assert(out.includes("1girl") && !out.includes("white background"), "inject: subject kept, original bg stripped")
}

// ── 4) Selection stays varied across a realistic page of near-consecutive ids ──
//    Guards BOTH sides at once: a dataset collapsed onto a handful of themes,
//    and an RNG that correlates on nearby seeds. A booru page is the worst
//    realistic case — ~24 ids inside a span of ~50.
{
  const pageIds = Array.from({ length: 24 }, (_, i) => 14806740 - i * 2)
  const signatures = sceneryList.map((s) => s.join("|"))
  const pickedFor = (id: number) => {
    const out = processBackgroundTags(["1girl"], "detailed_random", undefined, undefined, undefined, sceneryList, id)
    // "1girl" is not scenery, so it survives untouched at index 0 and the
    // picked preset is appended verbatim after it — the injected slice is
    // therefore exactly out.slice(1), with no ambiguity about which preset ran.
    return signatures.indexOf(out.slice(1).join("|"))
  }

  const picks = pageIds.map(pickedFor)
  assert(picks.every((i) => i >= 0), "variety: every id resolves to a real preset")

  const distinctPresets = new Set(picks).size
  assert(
    distinctPresets >= 14,
    `variety: >=14 distinct presets across 24 near-consecutive ids (got ${distinctPresets})`,
  )

  // Themes, not just presets: the location anchor is the first two tags.
  const distinctThemes = new Set(picks.map((i) => sceneryList[i].slice(0, 2).join("/"))).size
  assert(
    distinctThemes >= 10,
    `variety: >=10 distinct locations across 24 near-consecutive ids (got ${distinctThemes})`,
  )

  // And the dataset itself must offer real breadth to draw from.
  const allThemes = new Set(sceneryList.map((s) => s.slice(0, 2).join("/"))).size
  assert(allThemes >= 20, `variety: dataset covers >=20 distinct locations (got ${allThemes})`)

  console.log(
    `variety: ${presets.length} presets / ${allThemes} locations; ` +
      `24 near-consecutive ids -> ${distinctPresets} presets, ${distinctThemes} locations`,
  )
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

