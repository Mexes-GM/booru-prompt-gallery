/**
 * Defaults of the brief's rows (Never, Style): what every new pack starts with, kept in
 * pack-preferences (lib/pack/brief-history.ts, lib/pack/pack-config-migration.ts).
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-row-defaults.verify.ts
 */
import assert from "node:assert/strict"
import { addNever, emptyBrief, type PackBrief } from "../lib/pack/brief"
import {
  DEFAULT_ROWS, rowDefaults, rowMatchesDefaults, seedDefaults, seedStyle, withRowDefaults, withoutRowDefault,
} from "../lib/pack/brief-history"
import { migratePackPreferences, sanitizePackPreferences } from "../lib/pack/pack-config-migration"
import type { PackPreferences } from "../lib/storage"

let passed = 0
const check = (name: string, fn: () => void) => {
  try { fn(); passed++ } catch (err) { console.error(`FAIL: ${name}`); throw err }
}

const PREFS: PackPreferences = {
  promptCount: 10,
  neverDefaults: ["blurry", "smile"],
  includeSensitive: false,
  styleDefaults: ["@angeltights", "@radblackai", "no lineart", "realistic"],
}

check("a new pack starts with both rows' defaults, Style as typed", () => {
  const brief = seedDefaults(emptyBrief(), PREFS)
  assert.deepEqual(brief.never, ["blurry", "smile"])
  assert.deepEqual(brief.literal, ["@angeltights", "@radblackai", "no lineart", "realistic"])
})

check("what the start asks for wins over the defaults", () => {
  const start: PackBrief = { ...emptyBrief(), literal: ["Realistic", "masterpiece"], requests: [{ tag: "smile", role: "also" }] }
  const brief = seedDefaults(start, PREFS)
  // The start asks for a smile: not kept out by the default.
  assert.deepEqual(brief.never, ["blurry"])
  // The start's own Style first; a default it already has is not repeated.
  assert.deepEqual(brief.literal, ["Realistic", "masterpiece", "@angeltights", "@radblackai", "no lineart"])
  // A default the start keeps out (a search's -tag) is not added to Style.
  const kept = seedStyle(addNever(emptyBrief(), "no lineart"), PREFS.styleDefaults ?? [])
  assert.deepEqual(kept.literal, ["@angeltights", "@radblackai", "realistic"])
  // Nothing to add: the same brief.
  const same = emptyBrief()
  assert.equal(seedStyle(same, []), same)
})

check("use in new packs and remove from new packs; changing a pack changes nothing", () => {
  const brief = { ...seedDefaults(emptyBrief(), PREFS), literal: ["@angeltights", "soft lighting"] }
  assert.equal(rowMatchesDefaults(brief, PREFS, "style"), false)
  assert.equal(rowMatchesDefaults(brief, PREFS, "never"), true)
  const saved = sanitizePackPreferences(withRowDefaults(PREFS, "style", DEFAULT_ROWS.style.tagsOf(brief)))
  assert.deepEqual(rowDefaults(saved, "style"), ["@angeltights", "soft lighting"])
  assert.equal(rowMatchesDefaults(brief, saved, "style"), true)
  assert.deepEqual(saved.neverDefaults, PREFS.neverDefaults, "the other row stays")
  const less = sanitizePackPreferences(withoutRowDefault(PREFS, "never", "Smile"))
  assert.deepEqual(less.neverDefaults, ["blurry"])
  // Emptied: the field goes (older readers see no change of shape).
  const none = sanitizePackPreferences(withRowDefaults(PREFS, "style", []))
  assert.equal("styleDefaults" in none, false)
  assert.deepEqual(rowDefaults(none, "style"), [])
  // The input is never changed.
  assert.deepEqual(PREFS.neverDefaults, ["blurry", "smile"])
})

check("a stored value that is not valid: its bad parts go, the rest stays", () => {
  const corrupt = { promptCount: 20, neverDefaults: ["blush"], includeSensitive: true, styleDefaults: ["@angeltights", 3, null, "  ", "@ANGELTIGHTS", "realistic"] } as unknown as PackPreferences
  const out = migratePackPreferences(corrupt, null)
  assert.deepEqual(out, { promptCount: 20, neverDefaults: ["blush"], includeSensitive: true, styleDefaults: ["@angeltights", "realistic"] })
  const notArray = { promptCount: 20, neverDefaults: [], includeSensitive: false, styleDefaults: "realistic" } as unknown as PackPreferences
  assert.equal("styleDefaults" in migratePackPreferences(notArray, null), false)
})

check("preferences saved before Style had defaults read as before, with none for Style", () => {
  const old: PackPreferences = { promptCount: 12, neverDefaults: ["text"], includeSensitive: false }
  const out = migratePackPreferences(old, null)
  assert.deepEqual(out, old)
  assert.deepEqual(rowDefaults(out, "style"), [])
  assert.deepEqual(seedDefaults(emptyBrief(), out).literal, [])
})

console.log(`pack-row-defaults: ${passed} checks passed`)
