/**
 * Tests for Pack Mode pool variety (lib/booru/page-range.ts and
 * lib/pack/near-duplicates.ts).
 *
 * Covers:
 *   1. findLastPage: one probe when the range reaches maxPage, binary search otherwise.
 *   2. lastPageFromCount rounds up and caps.
 *   3. randomPageOrder keeps page 1 first, covers every page once, is seeded.
 *   4. collapseNearDuplicates drops near-identical posts of the same character only.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-pool-variety.verify.ts
 */
import { findLastPage, lastPageFromCount, randomPageOrder, MAX_RANDOM_PAGE } from "../lib/booru/page-range"
import { collapseNearDuplicates } from "../lib/pack/near-duplicates"
import { createSeededRng } from "../lib/pack/pack-generator"
import type { BooruPost } from "../lib/booru/types"

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

async function main() {
  // 1. findLastPage
  let probes = 0
  const upTo = (last: number) => async (page: number) => { probes++; return page <= last }
  assert((await findLastPage(upTo(5000))) === MAX_RANDOM_PAGE && probes === 1, "large result set: one probe")
  for (const last of [1, 2, 37, 199]) {
    probes = 0
    const found = await findLastPage(upTo(last))
    assert(found === last, `finds last page ${last} (got ${found})`)
    assert(probes <= 10, `binary search stays short for ${last} (${probes} probes)`)
  }
  assert((await findLastPage(upTo(3), 1)) === 1, "maxPage 1 -> 1 without searching")

  // 2. lastPageFromCount
  assert(lastPageFromCount(61, 30) === 3, "rounds up")
  assert(lastPageFromCount(0, 30) === 1, "at least one page")
  assert(lastPageFromCount(1_000_000, 60) === MAX_RANDOM_PAGE, "capped")

  // 3. randomPageOrder
  const order = randomPageOrder(50, createSeededRng(1))
  assert(order[0] === 1, "page 1 first")
  assert(order.length === 50 && new Set(order).size === 50, "every page once")
  assert(order.slice(1, 6).join() !== "2,3,4,5,6", "rest is shuffled")
  assert(order.join() === randomPageOrder(50, createSeededRng(1)).join(), "same seed -> same order")
  assert(order.join() !== randomPageOrder(50, createSeededRng(2)).join(), "different seed -> different order")
  assert(randomPageOrder(1, createSeededRng(1)).join() === "1", "single page")

  // 4. collapseNearDuplicates
  const base = "1girl solo long_hair blue_eyes school_uniform pleated_skirt smile looking_at_viewer classroom artist_a"
  const post = (id: number, tags: string, character = "mona_(genshin_impact)") =>
    ({ id, tag_string: tags, tag_string_character: character } as BooruPost)
  const posts = [
    post(1, base),
    post(2, `${base} blush`), // near-identical variation
    post(3, "1girl solo short_hair red_eyes bikini beach ocean sky standing artist_b"), // different
    post(4, `${base} blush`, "other_character"), // same tags, different character
    post(5, "1girl solo hat"), // too few tags to compare
    post(6, "1girl solo hat"),
  ]
  const kept = collapseNearDuplicates(posts).map((p) => p.id)
  assert(kept.join() === "1,3,4,5,6", `keeps first of each group (got ${kept.join()})`)
  assert(collapseNearDuplicates([]).length === 0, "empty pool")
}

main().then(() => {
  console.log(`pack-pool-variety: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
})
