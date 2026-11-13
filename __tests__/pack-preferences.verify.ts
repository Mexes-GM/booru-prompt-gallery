/**
 * What Pack Mode remembers between sessions (migratePackPreferences).
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-preferences.verify.ts
 */
import assert from "node:assert/strict"
import { migratePackConfig, migratePackPreferences } from "../lib/pack/pack-config-migration"
import type { PackModeConfigV2, PackPreferences } from "../lib/storage"

let passed = 0
const check = (fn: () => void) => { fn(); passed++ }

const v2 = (extra: Partial<PackModeConfigV2> = {}): PackModeConfigV2 => ({
  ...migratePackConfig(null, {}, "character"),
  ...extra,
})

const DEFAULTS: PackPreferences = { promptCount: 10, neverDefaults: [], includeSensitive: false }

check(() => {
  const out = migratePackPreferences(null, v2({ promptCount: 30, neverIncludeText: "smile, Looking_At_Viewer, smile" }))
  assert.deepEqual(out, { promptCount: 30, neverDefaults: ["smile", "looking at viewer"], includeSensitive: false })
})

check(() => {
  const out = migratePackPreferences(null, v2({ engine: "classic", promptCount: 12 }))
  assert.deepEqual(out, { promptCount: 12, neverDefaults: [], includeSensitive: false })
  assert.deepEqual(migratePackPreferences(null, v2({ neverIncludeText: "  ,  " })).neverDefaults, [])
})

check(() => {
  assert.deepEqual(migratePackPreferences(null, null), DEFAULTS)
  // The defaults are not shared between calls.
  assert.notEqual(migratePackPreferences(null, null).neverDefaults, migratePackPreferences(null, null).neverDefaults)
})

check(() => {
  assert.equal(migratePackPreferences({ ...DEFAULTS, promptCount: 500 }, null).promptCount, 100)
  assert.equal(migratePackPreferences({ ...DEFAULTS, promptCount: 0 }, null).promptCount, 1)
  assert.equal(migratePackPreferences({ ...DEFAULTS, promptCount: 12.6 }, null).promptCount, 13)
  assert.equal(migratePackPreferences(null, v2({ promptCount: 999 })).promptCount, 100)
})

check(() => {
  const saved: PackPreferences = { promptCount: 20, neverDefaults: ["Blush", "blush", "text"], includeSensitive: true }
  const out = migratePackPreferences(saved, v2({ promptCount: 30, neverIncludeText: "smile" }))
  assert.deepEqual(out, { promptCount: 20, neverDefaults: ["blush", "text"], includeSensitive: true })
  assert.deepEqual(saved.neverDefaults, ["Blush", "blush", "text"], "input unchanged")
})

console.log(`${passed} passed, 0 failed`)
