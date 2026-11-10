/**
 * Tests for lib/pack/scene/scene-pool.ts and lib/pack/scene/scene-select.ts.
 *
 * Covers:
 *   1. The pool drops blocked posts whole, near-duplicates and scenes without a
 *      skeleton or with too few state tags, and counts each step.
 *   2. Situations group scenes by skeleton, are stable, labelled, largest first,
 *      with at most three previews.
 *   3. Selection is deterministic for a seed, covers situations before repeating one,
 *      picks the farthest scene inside a situation, respects switched-off situations
 *      and returns what exists when there are fewer scenes than asked.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-scene-pool.verify.ts
 */
import { buildScenePool, groupSituations } from "../lib/pack/scene/scene-pool"
import { selectScenes } from "../lib/pack/scene/scene-select"
import { createSeededRng } from "../lib/pack/pack-generator"
import { createPermanence } from "../lib/pack/scene/permanence"
import { OVERRIDES, PERMANENCE_DATA, makeAssert, makePost } from "./fixtures/pack-scene-data"

const { assert, done } = makeAssert()
const ctx = { overrides: OVERRIDES, permanence: createPermanence(PERMANENCE_DATA, OVERRIDES), subject: "girl" as const }

const A1 = "1girl standing smile from_above bedroom bed skirt shirt"
const posts = [
  makePost(1, A1),
  makePost(2, "1girl standing blush looking_at_viewer park sunset skirt shirt boots"),
  makePost(3, "1girl lying on_back smile from_side bedroom bed shirt skirt"),
  makePost(4, "1girl lying on_back blush looking_at_viewer park sunset dress boots"),
  makePost(5, "1girl sitting hug smile bedroom bed skirt shirt"),
  makePost(6, "1girl smile bedroom"), // no skeleton
  makePost(7, "1girl standing smile"), // too few state tags
  makePost(8, "1girl standing smile from_above bedroom bed skirt shirt young_girl"), // blocked
  makePost(9, `${A1} blush`), // near-duplicate of post 1
]

// ── Pool steps ──
const pool = buildScenePool(posts, ctx)
const { stats } = pool
assert(stats.posts === 9, "counts the input posts")
assert(stats.blocked === 1, "blocked post removed whole")
assert(stats.nearDuplicates === 1, "near-duplicate removed")
assert(stats.belowQuality === 2, "scenes without skeleton or with too few tags removed")
assert(stats.unextractable === 0, "nothing unextractable here")
assert(stats.scenes === 5 && pool.scenes.length === 5, "five scenes remain")
assert(stats.blocked + stats.nearDuplicates + stats.unextractable + stats.belowQuality + stats.scenes === stats.posts, "every post is accounted for")
assert(!pool.scenes.some((scene) => scene.postId === 8), "the blocked post gives no scene")
assert(buildScenePool(posts, { ...ctx, minStateTags: 2 }).stats.belowQuality === 1, "the quality threshold is a parameter")
assert(buildScenePool([makePost(20, "no_humans standing bedroom bed")], ctx).stats.unextractable === 1, "posts without people are counted apart")

// ── Situations ──
assert(stats.situations === 3 && pool.situations.length === 3, "three situations")
assert(pool.situations[0].sceneIds.join() === "1,2", "largest situation first, scenes in pool order")
assert(pool.situations[0].label.join() === "standing", "label from the common skeleton tags")
assert(pool.situations[1].label.join() === "lying,on back", "label with two tags")
assert(pool.situations[2].sceneIds.join() === "5", "single-scene situation")
assert(pool.situations.every((s) => s.previews.length > 0 && s.previews.length <= 3), "previews are kept, at most three")
assert(JSON.stringify(buildScenePool(posts, ctx)) === JSON.stringify(pool), "building twice gives the same pool")
{
  const many = Array.from({ length: 6 }, (_, i) => makePost(100 + i, `1girl standing smile bedroom bed skirt shirt u${i}a u${i}b`))
  const big = buildScenePool(many, ctx)
  assert(big.situations.length === 1 && big.situations[0].sceneIds.length === 6, "scenes with the same skeleton share a situation")
  assert(big.situations[0].previews.length === 3, "at most three previews")
  const twice = groupSituations([...big.scenes, ...big.scenes.map((s) => ({ ...s, postId: s.postId + 1000 }))])
  assert(new Set(twice.map((s) => s.id)).size === twice.length, "situation ids are unique")
}

// ── Selection ──
const ids = (n: number, seed: number, disabled?: string[]) =>
  selectScenes(pool, n, { rng: createSeededRng(seed), disabledSituations: disabled }).map((s) => s.postId)
assert(ids(5, 7).join() === ids(5, 7).join(), "same seed, same selection")
assert(new Set(Array.from({ length: 20 }, (_, i) => ids(3, i + 1).join())).size > 1, "different seeds give different selections")
{
  const three = ids(3, 3)
  const situationOf = (id: number) => pool.situations.findIndex((s) => s.sceneIds.includes(id))
  assert(new Set(three.map(situationOf)).size === 3, "three prompts cover three situations")
  const four = ids(4, 3)
  assert(four.includes(1) && four.includes(2), "the fourth scene comes back to the largest situation")
}
assert(ids(50, 1).length === 5 && new Set(ids(50, 1)).size === 5, "fewer scenes than asked: returns the ones that exist")
assert(!ids(5, 1, ["standing"]).some((id) => id === 1 || id === 2), "a switched-off situation gives no scenes")
assert(ids(5, 1, ["standing"]).length === 3, "the others remain")
assert(ids(0, 1).length === 0, "count zero")
{
  const trio = buildScenePool(
    [
      makePost(31, "1girl standing smile from_above bedroom bed skirt shirt"),
      makePost(32, "1girl standing blush from_above park sunset dress boots"),
      makePost(33, "1girl standing smile from_side bedroom bed skirt boots"),
      makePost(34, "1girl sitting hug smile bedroom bed skirt shirt"),
    ],
    ctx
  )
  assert(trio.situations.length === 2, "two situations in the farthest-scene pool")
  for (let seed = 1; seed <= 12; seed++) {
    const picked = selectScenes(trio, 3, { rng: createSeededRng(seed) }).map((s) => s.postId)
    assert(picked.includes(33) && picked.includes(34), `seed ${seed}: the framing that differs is chosen before a near copy`)
  }
}

done()
