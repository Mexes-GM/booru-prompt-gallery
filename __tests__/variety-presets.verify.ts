/**
 * Tests for lib/pack/variety-presets.ts (Pack Mode's Variety slider).
 *
 * Covers:
 *   1. Each of the 5 levels produces the modes/min-counts/temperature from
 *      the design spec's table (§5.1).
 *   2. Only active axes get an entry.
 *   3. The clamp against axisMaxPerPrompt applies in individual mode.
 *   4. Level 5 falls back to 1 when axisMaxPerPrompt is absent for an axis.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/variety-presets.verify.ts
 */
import type { TagCategory } from "../lib/tag-classifier"
import { varietyPreset } from "../lib/pack/variety-presets"

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

const ALL_AXES: TagCategory[] = ["appearance", "clothing", "equipment", "pose", "scenery", "creature"]

// ── Level 1: Faithful — all bundle, min 1, temp 0.7 ──
{
  const r = varietyPreset(1, ALL_AXES, {})
  assert(ALL_AXES.every((c) => r.axisTagModes[c] === "bundle"), "level 1: all axes bundle")
  assert(ALL_AXES.every((c) => r.axisMinCounts[c] === 1), "level 1: min 1 everywhere")
  assert(r.temperature === 0.7, "level 1: temperature 0.7")
}

// ── Level 2: Coherent — all bundle, min 1, temp 1.0 ──
{
  const r = varietyPreset(2, ALL_AXES, {})
  assert(ALL_AXES.every((c) => r.axisTagModes[c] === "bundle"), "level 2: all axes bundle")
  assert(ALL_AXES.every((c) => r.axisMinCounts[c] === 1), "level 2: min 1 everywhere")
  assert(r.temperature === 1.0, "level 2: temperature 1.0")
}

// ── Level 3: Balanced (default) — clothing/equipment bundle min 1; rest individual min 2 ──
{
  const r = varietyPreset(3, ALL_AXES, {})
  assert(r.axisTagModes.clothing === "bundle" && r.axisMinCounts.clothing === 1, "level 3: clothing bundle min 1")
  assert(r.axisTagModes.equipment === "bundle" && r.axisMinCounts.equipment === 1, "level 3: equipment bundle min 1")
  for (const cat of ["appearance", "pose", "scenery", "creature"] as TagCategory[]) {
    assert(r.axisTagModes[cat] === "individual", `level 3: ${cat} individual`)
    assert(r.axisMinCounts[cat] === 2, `level 3: ${cat} min 2`)
  }
  assert(r.temperature === 1.0, "level 3: temperature 1.0")
}

// ── Level 4: Varied — all individual, min 3, temp 1.3 ──
{
  const r = varietyPreset(4, ALL_AXES, {})
  assert(ALL_AXES.every((c) => r.axisTagModes[c] === "individual"), "level 4: all axes individual")
  assert(ALL_AXES.every((c) => r.axisMinCounts[c] === 3), "level 4: min 3 everywhere")
  assert(r.temperature === 1.3, "level 4: temperature 1.3")
}

// ── Level 5: Chaotic — all individual, min = axisMaxPerPrompt (or 1), temp 2.0 ──
{
  const r = varietyPreset(5, ALL_AXES, { appearance: 6, pose: 2 })
  assert(r.axisMinCounts.appearance === 6, "level 5: min = axisMaxPerPrompt when present")
  assert(r.axisMinCounts.pose === 2, "level 5: min = axisMaxPerPrompt when present (2)")
  assert(r.axisMinCounts.clothing === 1, "level 5: min falls back to 1 when axisMaxPerPrompt is absent")
  assert(r.temperature === 2.0, "level 5: temperature 2.0")
}

// ── Only active axes appear ──
{
  const r = varietyPreset(3, ["appearance", "pose"], {})
  assert(Object.keys(r.axisTagModes).length === 2, "only active axes get a mode entry")
  assert(r.axisTagModes.clothing === undefined, "an inactive axis is absent")
}

// ── Clamp with axisMaxPerPrompt in individual mode (levels 3 and 4) ──
{
  const r3 = varietyPreset(3, ["appearance"], { appearance: 1 })
  assert(r3.axisMinCounts.appearance === 1, "level 3: individual min clamped down to axisMaxPerPrompt (floor 1)")

  const r4 = varietyPreset(4, ["appearance"], { appearance: 2 })
  assert(r4.axisMinCounts.appearance === 2, "level 4: individual min 3 clamped down to axisMaxPerPrompt=2")
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
