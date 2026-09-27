/**
 * Tests for lib/pack/pack-config-migration.ts (V1 -> V2 Pack Mode config migration).
 *
 * Covers:
 *   1. V1 'character' (no saved config) -> V2 defaults from the archetype.
 *   2. V1 with custom axisTagModes/axisMinCounts -> varietyLevel 'custom', values preserved.
 *   3. V1 legacy 'clothing' key -> used as the 'wardrobe' config.
 *   4. An existing V2 config is returned unchanged.
 *   5. Nothing saved at all -> 'character' archetype defaults.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-config-migration.verify.ts
 */
import type { PackModeConfig, PackModeConfigByKind, PackModeConfigV2 } from "../lib/storage"
import { migratePackConfig } from "../lib/pack/pack-config-migration"

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

function makeV1(overrides: Partial<PackModeConfig> = {}): PackModeConfig {
  return {
    lockedCategories: ["appearance"],
    axisMinCounts: {},
    promptCount: 15,
    manualAxisValues: {},
    axisTagModes: {},
    lockedSlots: [],
    mutedSlots: [],
    ...overrides,
  }
}

// ── V1 'character' with a saved (default-shaped) config -> V2 defaults, varietyLevel 3 ──
{
  const v1ByKind: PackModeConfigByKind = { character: makeV1() }
  const result = migratePackConfig(null, v1ByKind, "character")
  assert(JSON.stringify(result.lockedCategories) === JSON.stringify(["appearance"]), "character: lockedCategories from V1")
  assert(result.varietyLevel === 3, "character: varietyLevel defaults to 3")
  assert(result.promptCount === 15, "character: promptCount carried over")
}

// ── V1 with custom axisTagModes -> 'custom', modes conserved ──
{
  const v1ByKind: PackModeConfigByKind = {
    character: makeV1({ axisTagModes: { pose: "bundle" } }),
  }
  const result = migratePackConfig(null, v1ByKind, "character")
  assert(result.varietyLevel === "custom", "custom axisTagModes -> varietyLevel 'custom'")
  assert(result.axisTagModes.pose === "bundle", "custom axisTagModes values preserved")
}

// ── V1 with custom axisMinCounts (no axisTagModes) also -> 'custom' ──
{
  const v1ByKind: PackModeConfigByKind = {
    character: makeV1({ axisMinCounts: { appearance: 4 } }),
  }
  const result = migratePackConfig(null, v1ByKind, "character")
  assert(result.varietyLevel === "custom", "custom axisMinCounts -> varietyLevel 'custom'")
  assert(result.axisMinCounts.appearance === 4, "custom axisMinCounts values preserved")
}

// ── Legacy 'clothing' key used when lastKind is 'wardrobe' and no 'wardrobe' entry exists ──
{
  const v1ByKind: PackModeConfigByKind = {
    clothing: makeV1({ lockedCategories: ["clothing"], promptCount: 20 }),
  }
  const result = migratePackConfig(null, v1ByKind, "wardrobe")
  assert(JSON.stringify(result.lockedCategories) === JSON.stringify(["clothing"]), "legacy clothing: lockedCategories carried over")
  assert(result.promptCount === 20, "legacy clothing: promptCount carried over")
}

// ── Existing V2 config passes through unchanged ──
{
  const existing: PackModeConfigV2 = {
    lockedCategories: ["appearance", "clothing"],
    lockedSlots: [],
    mutedSlots: [],
    varietyLevel: 4,
    axisTagModes: {},
    axisMinCounts: {},
    promptCount: 12,
    manualAxisValues: {},
  }
  const result = migratePackConfig(existing, {}, "character")
  assert(result === existing, "existing V2 config returned as-is")
}

// ── Nothing saved at all -> 'character' archetype defaults ──
{
  const result = migratePackConfig(null, {}, "character")
  assert(JSON.stringify(result.lockedCategories) === JSON.stringify(["appearance"]), "no config: character archetype defaults")
  assert(result.varietyLevel === 3, "no config: varietyLevel defaults to 3")
  assert(result.promptCount === 10, "no config: default promptCount 10")
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
