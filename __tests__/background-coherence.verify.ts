/**
 * Tests for lib/pack/background-coherence.ts (Pack Mode: a plain backdrop
 * never shares a prompt with a scene).
 *
 * Covers:
 *   1. Plain background detection (colours, gradient, simple) vs. non-plain ones.
 *   2. Scene detection by slot (setting, props, sky atmosphere) and by keyword when the slot is unknown.
 *   3. Conflicts both ways round, and no false positives (clothing/lighting/"star earrings").
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/background-coherence.verify.ts
 */
import { isPlainBackgroundTag, isSceneTag, conflictsWithBackground } from "../lib/pack/background-coherence"

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

const overrides: Record<string, string> = {
  classroom: "scenery:setting",
  table: "scenery:props",
  cloud: "scenery:atmosphere",
  "light particles": "scenery:atmosphere",
  "sun hat": "clothing:headwear",
  "school uniform": "clothing:outfit",
}

// 1. Plain backgrounds
for (const t of ["simple background", "white background", "grey background", "gradient background", "two-tone background", "white_background"]) {
  assert(isPlainBackgroundTag(t), `${t} is plain`)
}
for (const t of ["detailed background", "blurry background", "classroom", "sky"]) {
  assert(!isPlainBackgroundTag(t), `${t} is not plain`)
}

// 2. Scenes
assert(isSceneTag("classroom", overrides), "setting slot is a scene")
assert(isSceneTag("table", overrides), "props slot is a scene")
assert(isSceneTag("cloud", overrides), "sky atmosphere is a scene")
assert(!isSceneTag("light particles", overrides), "non-sky atmosphere is not a scene")
assert(isSceneTag("fireworks", overrides), "unknown-slot sky keyword is a scene")
assert(!isSceneTag("star earrings", overrides), "unknown-slot tag containing 'star' is not a scene")
assert(!isSceneTag("sun hat", overrides), "headwear containing 'sun' is not a scene")
assert(!isSceneTag("school uniform", overrides), "clothing is not a scene")

// 3. Conflicts
assert(conflictsWithBackground("white background", ["1girl", "classroom"], overrides), "plain bg after a location")
assert(conflictsWithBackground("table", ["1girl", "simple background"], overrides), "props after a plain bg")
assert(conflictsWithBackground("fireworks", ["white background"], overrides), "sky after a plain bg")
assert(!conflictsWithBackground("light particles", ["white background"], overrides), "lighting is fine on a plain bg")
assert(!conflictsWithBackground("school uniform", ["white background"], overrides), "clothing is fine on a plain bg")
assert(!conflictsWithBackground("classroom", ["1girl", "smile"], overrides), "a scene without a plain bg is fine")

console.log(`background-coherence: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
