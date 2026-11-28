/**
 * Classic generation can't run away: unslotted values don't inflate the per-prompt
 * ceiling (what the Chaotic preset asks for), and a pathological setup finishes
 * within the work budget, synchronously or in slices.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-generator-limits.verify.ts
 */
import {
  categoryCapacity,
  createSeededRng,
  generatePackPrompts,
  generatePackPromptsAsync,
  groupValuesBySlot,
  maxValuesPerPrompt,
} from "../lib/pack/pack-generator"
import { varietyPreset } from "../lib/pack/variety-presets"

let failed = 0
let passed = 0
const assert = (ok: unknown, label: string) => {
  if (ok) passed++
  else { failed++; console.log("FAIL: " + label) }
}

void (async () => {
  // ── The ceiling while the slots haven't loaded ──
  const pose = Array.from({ length: 300 }, (_, i) => `pose value ${i}`)
  const unslotted = groupValuesBySlot("pose", pose, {})
  const ceiling = maxValuesPerPrompt(unslotted, "pose")
  assert(ceiling === categoryCapacity("pose") && ceiling < 15, `300 values with no slot yet: at most what a pose can hold (got ${ceiling})`)
  assert(maxValuesPerPrompt(unslotted) === 300, "(without the category, the old count: every value)")
  const chaotic = varietyPreset(5, ["pose"], { pose: ceiling })
  assert((chaotic.axisMinCounts.pose ?? 0) <= 15, "so Chaotic asks for a handful of poses, not hundreds")
  const slotted = groupValuesBySlot("pose", ["smile", "standing", "mystery"], { smile: "pose:expression", standing: "pose:posture" })
  assert(maxValuesPerPrompt(slotted, "pose") === 3, "known slots count as before, an unknown value fills the room left")

  // ── A pathological setup ends within its budget ──
  const axes = {
    pose: Array.from({ length: 400 }, (_, i) => `p${i}`),
    clothing: Array.from({ length: 400 }, (_, i) => `c${i}`),
    scenery: Array.from({ length: 400 }, (_, i) => `s${i}`),
  }
  const heavy = { lockedTags: ["1girl"], axes, axisMinCounts: { pose: 300, clothing: 300, scenery: 300 }, count: 90, maxPrompts: 90, rng: createSeededRng(1) }
  let start = Date.now()
  const sync = generatePackPrompts({ ...heavy, budgetMs: 300 })
  const syncMs = Date.now() - start
  assert(syncMs < 2500, `a 300 ms budget stops in time even with 900 tags asked per prompt (took ${syncMs} ms)`)
  assert(sync.length > 0, "and returns what it made")

  start = Date.now()
  let pauses = 0
  const sliced = await generatePackPromptsAsync({ ...heavy, budgetMs: 300 }, {
    pause: () => { pauses++; return new Promise((resolve) => setTimeout(resolve, 0)) },
    cancelled: () => false,
  })
  assert(sliced !== null && Date.now() - start < 4000, `in slices too (took ${Date.now() - start} ms)`)
  assert(pauses > 0, "giving the page room between slices")

  let calls = 0
  const cancelled = await generatePackPromptsAsync({ ...heavy, budgetMs: 5000 }, {
    pause: () => new Promise((resolve) => setTimeout(resolve, 0)),
    cancelled: () => ++calls > 2,
  })
  assert(cancelled === null, "a newer Generate cancels it")

  const normal = generatePackPrompts({ lockedTags: ["1girl"], axes: { pose: ["standing", "sitting"] }, count: 2, rng: createSeededRng(2) })
  assert(normal.length === 2, "an ordinary pack is unaffected")

  console.log(`${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
})()
