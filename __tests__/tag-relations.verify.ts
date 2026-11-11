/**
 * Tests for lib/tag-relations.ts: parsing, exclusions by context (one person or
 * several, by rating), requirements, and the loaded-state switch.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/tag-relations.verify.ts
 */
import { excludes, loadedTagRelations, parseTagRelations, relationKey, requiredBy, requiredSlots, setTagRelations, type TagRelationsFile } from "../lib/tag-relations"

let failed = 0
let passed = 0
const assert = (ok: unknown, label: string) => {
  if (ok) passed++
  else { failed++; console.log("FAIL: " + label) }
}

const CONTEXTS = ["solo:all", "solo:sfw", "solo:q", "solo:e", "solo:both", "multi:all", "multi:sfw", "multi:q", "multi:e", "multi:both"]
const bit = (...names: string[]) => names.reduce((m, n) => m | (1 << CONTEXTS.indexOf(n)), 0)
const file: TagRelationsFile = {
  v: 1,
  contexts: CONTEXTS,
  tags: ["standing", "sitting", "day", "night", "skirt lift", "skirt", "drinking", "1girl", "1boy"],
  ex: [
    0, 1, bit("solo:all", "solo:sfw", "solo:q", "solo:e", "solo:both"),
    2, 3, bit(...CONTEXTS),
    7, 8, bit("solo:sfw"),
  ],
  req: [4, 5],
  reqSlot: { "equipment:handheld": [6] },
}
const rel = parseTagRelations(file)

assert(relationKey("Skirt_Lift ") === "skirt lift", "the app's spelling")
assert(excludes(rel, "standing", "sitting", { people: 1 }), "one person can't stand and sit")
assert(excludes(rel, "sitting", "standing", { people: 1, rating: "explicit" }), "in either order, at any rating it lists")
assert(!excludes(rel, "standing", "sitting", { people: 2 }), "with two people one can stand while the other sits")
assert(excludes(rel, "day", "night", { people: 3, rating: "both" }), "day and night never meet, whoever is in the picture")
assert(excludes(rel, "1girl", "1boy", { people: 1, rating: "sfw" }) && !excludes(rel, "1girl", "1boy", { people: 1, rating: "explicit" }), "a pair excluded at one rating only")
assert(!excludes(rel, "standing", "unknown tag", { people: 1 }) && !excludes(rel, "standing", "standing", { people: 1 }), "unknown tags and a tag with itself never exclude")
assert(requiredBy(rel, "skirt_lift").join() === "skirt" && requiredBy(rel, "skirt").length === 0, "skirt lift requires skirt, not the other way")
assert(requiredSlots(rel, "drinking").join() === "equipment:handheld" && requiredSlots(rel, "standing").length === 0, "drinking requires something in hand")

assert(loadedTagRelations() === null, "nothing is loaded until the file is")
setTagRelations(rel)
assert(loadedTagRelations() === rel, "then it is")
setTagRelations(null)

let threw = false
try { parseTagRelations({ v: 2 } as unknown as TagRelationsFile) } catch { threw = true }
assert(threw, "an unknown version is refused")

console.log(`${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
