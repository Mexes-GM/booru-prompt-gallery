/**
 * Tests for lib/pack/min-tags.ts (Pack Mode "Min tags per prompt").
 *
 * Covers:
 *   1. estimateTagsPerPrompt adds base + count * tagsPerPick, skipping off axes.
 *   2. raiseCountsForMinTotal leaves counts alone when the minimum is already met or 0.
 *   3. It spreads extra picks round-robin instead of piling onto one axis.
 *   4. It never raises an axis past its cap, nor touches an axis that is off.
 *   5. It stops (without looping forever) when the minimum is unreachable.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-min-tags.verify.ts
 */
import { estimateTagsPerPrompt, raiseCountsForMinTotal } from "../lib/pack/min-tags"

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

// 1. Estimate
assert(
  estimateTagsPerPrompt(5, {
    pose: { count: 2, cap: 5, tagsPerPick: 1 },
    clothing: { count: 1, cap: 3, tagsPerPick: 3 },
    scenery: { count: 0, cap: 4, tagsPerPick: 1 },
  }) === 10,
  "estimate = 5 base + 2 pose + 1x3 clothing, scenery off ignored"
)

// 2. Already satisfied / disabled
const base = { pose: { count: 2, cap: 5, tagsPerPick: 1 }, scenery: { count: 1, cap: 3, tagsPerPick: 1 } }
let out = raiseCountsForMinTotal(0, 5, base)
assert(out.pose === 2 && out.scenery === 1, "minTotal 0 keeps counts")
out = raiseCountsForMinTotal(6, 5, base)
assert(out.pose === 2 && out.scenery === 1, "already above minimum keeps counts")

// 3. Round-robin spreading
out = raiseCountsForMinTotal(12, 5, {
  pose: { count: 1, cap: 5, tagsPerPick: 1 },
  scenery: { count: 1, cap: 5, tagsPerPick: 1 },
})
assert((out.pose ?? 0) + (out.scenery ?? 0) === 7, "reaches exactly 12 total (5 + 7)")
assert(Math.abs((out.pose ?? 0) - (out.scenery ?? 0)) <= 1, "extra picks spread evenly")

// 4. Caps and off axes
out = raiseCountsForMinTotal(20, 2, {
  pose: { count: 1, cap: 2, tagsPerPick: 1 },
  scenery: { count: 0, cap: 10, tagsPerPick: 1 },
  clothing: { count: 1, cap: 3, tagsPerPick: 1 },
})
assert(out.pose === 2, "pose capped at 2")
assert(out.clothing === 3, "clothing capped at 3")
assert(out.scenery === 0, "off axis untouched")

// 5. Unreachable terminates
out = raiseCountsForMinTotal(1000, 0, { pose: { count: 1, cap: 4, tagsPerPick: 1 } })
assert(out.pose === 4, "unreachable minimum stops at cap")

console.log(`pack-min-tags: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
