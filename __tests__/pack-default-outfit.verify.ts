/**
 * Tests for the outfit a new pack starts with (lib/pack/brief-pack.ts NEW_PACK_OUTFIT,
 * shownOutfit, outfitSetting): the characters' usual outfit, read as each scene's own when
 * there is none to take.
 *
 * Covers:
 *   1. A new pack starts with the usual outfit.
 *   2. The menu shows it as the usual outfit once it is known, as each scene's before.
 *   3. Other choices show as they are.
 *   4. The engine dresses the characters in their own outfit when they have one, and takes
 *      each scene's otherwise, or when Wearing asks for clothes or the outfit is what changes.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-default-outfit.verify.ts
 */
import { NEW_PACK_OUTFIT, outfitSetting, shownOutfit } from "../lib/pack/brief-pack"

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

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// 1. The usual outfit by default.
assert(eq(NEW_PACK_OUTFIT, { kind: "usual" }), "a new pack starts with the usual outfit")

// 2. How the menu shows it.
assert(eq(shownOutfit(NEW_PACK_OUTFIT, true), { kind: "usual" }), "known usual outfit: shown as the usual outfit")
assert(eq(shownOutfit(NEW_PACK_OUTFIT, false), { kind: "scene" }), "no usual outfit to take: shown as each scene's")

// 3. Other choices as they are.
assert(eq(shownOutfit({ kind: "scene" }, true), { kind: "scene" }), "each scene's stays")
assert(eq(shownOutfit({ kind: "official", name: "Cowgirl" }, false), { kind: "official", name: "Cowgirl" }), "an official outfit stays")
assert(eq(shownOutfit({ kind: "library" }, true), { kind: "scene" }), "the old library choice reads as each scene's")

// 4. What the engine does with it.
const has = (characterOutfits: boolean, outfitChanges = false) => ({ characterOutfits, library: false, outfitChanges })
assert(outfitSetting(NEW_PACK_OUTFIT, false, has(true)) === "character", "usual outfit known: the characters wear it")
assert(outfitSetting(NEW_PACK_OUTFIT, false, has(false)) === "scene", "no usual outfit: each scene's")
assert(outfitSetting(NEW_PACK_OUTFIT, true, has(true)) === "scene", "Wearing asks for clothes: the scenes' outfits make way")
assert(outfitSetting(NEW_PACK_OUTFIT, false, has(true, true)) === "scene", "the outfit is what changes: each scene's")

console.log(`pack-default-outfit: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
