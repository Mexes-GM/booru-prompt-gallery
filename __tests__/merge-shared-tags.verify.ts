/**
 * Tests for lib/merge-shared-tags.ts (Merge Mode: keep only the tags found in
 * at least N of the selected posts).
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/merge-shared-tags.verify.ts
 */
import { clampSharedPosts, filterBySharedCount, maxSharedPosts } from "../lib/merge-shared-tags"

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

const segments = [
  { text: "added tag" }, // typed by the user: no count
  { text: "1girl", count: 5 },
  { text: "eyeliner", count: 3 },
  { text: "smile", count: 2 },
  { text: "hat", count: 1 },
]

// 1. Minimum of 1 keeps everything (current behaviour)
const all = filterBySharedCount(segments, 1)
assert(all.kept.length === 5 && all.hiddenCount === 0, "min 1 keeps every tag")
assert(all.kept === segments, "min 1 returns the same array (no needless re-render)")

// 2. Minimum of 3 keeps shared tags and typed tags, in order
const three = filterBySharedCount(segments, 3)
assert(three.kept.map(s => s.text).join(",") === "added tag,1girl,eyeliner", "min 3 keeps tags in 3+ posts plus typed tags, in order")
assert(three.hiddenCount === 2, "min 3 hides two tags")

// 3. Tags without a count (typed or background-injected) are never hidden
const high = filterBySharedCount(segments, 10)
assert(high.kept.length === 1 && high.kept[0].text === "added tag", "typed tags survive any minimum")
assert(high.hiddenCount === 4, "every counted tag below the minimum is hidden")

// 4. Clamping to the selection
assert(maxSharedPosts(0) === 1, "empty selection allows a minimum of 1")
assert(maxSharedPosts(4) === 4, "max is the number of selected posts")
assert(clampSharedPosts(5, 3) === 3, "minimum drops when posts are removed")
assert(clampSharedPosts(2, 3) === 2, "minimum within range is kept")
assert(clampSharedPosts(0, 3) === 1, "minimum never goes below 1")
assert(clampSharedPosts(3, 0) === 1, "clearing the selection resets to 1")

console.log(`merge-shared-tags: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
