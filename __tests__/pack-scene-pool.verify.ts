/**
 * Tests for lib/pack/scene/scene-pool.ts and lib/pack/scene/scene-select.ts.
 *
 * Covers:
 *   1. The pool drops blocked posts whole, photographs, near-duplicates, scenes without a
 *      skeleton or with too few state tags, and scenes whose people do not match the pack;
 *      each step is counted.
 *   2. The composition of the pack comes from the identity, then from an option, then from
 *      the most frequent one of the pool.
 *   3. Situations are a partition by coverage: stable, labelled, at most twelve plus "other".
 *   4. Selection is deterministic for a seed, covers situations before repeating one,
 *      picks the farthest scene inside a situation, respects switched-off situations
 *      and returns what exists when there are fewer scenes than asked.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-scene-pool.verify.ts
 */
import { buildScenePool, compositionOfIdentity, groupSituations, MAX_SITUATIONS } from "../lib/pack/scene/scene-pool"
import { selectScenes } from "../lib/pack/scene/scene-select"
import { createSeededRng } from "../lib/pack/pack-generator"
import { createPermanence } from "../lib/pack/scene/permanence"
import { emptyUnits, type Scene } from "../lib/pack/scene/scene"
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
  makePost(10, "1girl lying smile from_above park sunset dress boots photo_(medium)"), // photograph
  makePost(11, "1girl 1boy sitting hug blush looking_at_viewer park sunset dress boots"), // a partner
  makePost(12, "multiple_girls running smile from_side park sunset dress boots"), // open count
]

// ── Pool steps ──
const pool = buildScenePool(posts, ctx)
const { stats } = pool
assert(stats.posts === 12, "counts the input posts")
assert(stats.blocked === 1, "blocked post removed whole")
assert(stats.notIllustration === 1, "photograph removed")
assert(stats.nearDuplicates === 1, "near-duplicate removed")
assert(stats.belowQuality === 2, "scenes without skeleton or with too few tags removed")
assert(stats.unextractable === 0, "nothing unextractable here")
assert(stats.incompatible === 2, "scenes with a partner or an open count removed")
assert(stats.scenes === 5 && pool.scenes.length === 5, "five scenes remain")
assert(
  stats.blocked + stats.notIllustration + stats.nearDuplicates + stats.unextractable + stats.belowQuality + stats.incompatible + stats.scenes === stats.posts,
  "every post is accounted for"
)
assert(stats.compositionSource === "pool" && stats.composition?.girls === 1 && stats.composition?.boys === 0, "most frequent composition of the pool")
assert(
  stats.compositions.map((c) => `${c.people.girls}/${c.people.boys}:${c.scenes}`).join() === "1/0:5,1/1:1",
  "every exact composition with its scene count, most scenes first; open counts are left out"
)
assert(
  buildScenePool(posts, { ...ctx, people: { girls: 1, boys: 1 } }).stats.compositions.length === 2,
  "the compositions are listed whatever composition the pool is filtered to"
)
assert(!pool.scenes.some((scene) => scene.postId === 8 || scene.postId === 10), "blocked and photo posts give no scene")
assert(buildScenePool(posts, { ...ctx, minStateTags: 2 }).stats.belowQuality === 1, "the quality threshold is a parameter")
assert(buildScenePool([makePost(20, "no_humans standing bedroom bed")], ctx).stats.unextractable === 1, "posts without people are counted apart")

// ── Composition of the pack ──
assert(compositionOfIdentity(["1girl", "solo", "long hair"])?.girls === 1 && compositionOfIdentity(["1girl", "solo"])?.boys === 0, "1girl, solo: one girl, no boys")
assert(compositionOfIdentity(["1girl", "1boy", "hetero"])?.boys === 1, "1girl, 1boy: one of each")
assert(compositionOfIdentity(["2girls"])?.girls === 2, "2girls")
assert(compositionOfIdentity(["long hair"]) === null && compositionOfIdentity(["multiple girls"]) === null && compositionOfIdentity(["6+girls"]) === null, "no count or an open one: undeclared")
{
  const pair = buildScenePool(posts, { ...ctx, identity: ["1girl", "1boy", "hetero"] })
  assert(pair.stats.compositionSource === "identity" && pair.scenes.length === 1 && pair.scenes[0].postId === 11, "the identity decides the composition")
  const explicit = buildScenePool(posts, { ...ctx, identity: ["long hair"], people: { girls: 1, boys: 1 } })
  assert(explicit.stats.compositionSource === "option" && explicit.scenes.map((s) => s.postId).join() === "11", "an explicit option is used when the identity declares nothing")
  const overridden = buildScenePool(posts, { ...ctx, identity: ["1girl", "solo"], people: { girls: 1, boys: 1 } })
  assert(overridden.stats.compositionSource === "identity" && overridden.scenes.length === 5, "the identity wins over the option")
  assert(buildScenePool([], ctx).stats.compositionSource === "none", "empty pool: no composition")
}

// ── Situations ──
assert(stats.situations === 3 && pool.situations.length === 3, "three situations")
assert(pool.situations[0].sceneIds.join() === "1,2", "largest situation first, scenes in pool order")
assert(pool.situations[0].label.join() === "standing", "label: the tag that covers the group")
assert(pool.situations[1].label.join() === "lying,on back", "label: the tag and its most frequent co-tag")
assert(pool.situations[2].sceneIds.join() === "5" && pool.situations[2].label.join() === "sitting,hug", "single-scene situation")
assert(pool.situations.every((s) => s.previews.length > 0 && s.previews.length <= 3), "previews are kept, at most three")
assert(JSON.stringify(buildScenePool(posts, ctx)) === JSON.stringify(pool), "building twice gives the same pool")
{
  const many = Array.from({ length: 6 }, (_, i) => makePost(100 + i, `1girl standing smile bedroom bed skirt shirt u${i}a u${i}b`))
  const big = buildScenePool(many, ctx)
  assert(big.situations.length === 1 && big.situations[0].sceneIds.length === 6, "scenes with the same tag share a situation")
  assert(big.situations[0].previews.length === 3, "at most three previews")
}
{
  const synthetic = (n: number, overrides: Record<string, string>): Scene[] =>
    Array.from({ length: n }, (_, i) => {
      const units = emptyUnits()
      units.skeleton = [`p${i}`]
      return { postId: i + 1, rating: "g", people: { girls: 1, boys: 0 }, pairing: [], units, anchors: [] } as Scene
    }).map((scene) => {
      overrides[`p${scene.postId - 1}`] = "pose:posture"
      return scene
    })
  const overrides15: Record<string, string> = {}
  const fifteen = groupSituations(synthetic(15, overrides15), overrides15)
  assert(fifteen.length === MAX_SITUATIONS + 1, "twelve situations and the rest in other")
  assert(fifteen[MAX_SITUATIONS].id === "other" && fifteen[MAX_SITUATIONS].sceneIds.length === 3, "other gathers what is left")
  assert(new Set(fifteen.map((s) => s.id)).size === fifteen.length, "situation ids are unique")
  const overrides30: Record<string, string> = {}
  const thirty = groupSituations(synthetic(30, overrides30), overrides30)
  assert(thirty.length === 1 && thirty[0].id === "other", "tags that cover under 4% of the pool make no situation")
  // a tag that almost every scene has defines nothing: the informative ones come first
  const ov: Record<string, string> = { common: "pose:posture", a: "pose:posture", b: "pose:gesture" }
  const mixed = synthetic(10, {}).map((scene, i) => ({ ...scene, units: { ...scene.units, skeleton: ["common", i < 5 ? "a" : "b"] } }))
  const split = groupSituations(mixed, ov)
  assert(split.length === 2 && split[0].label[0] === "a" && split[1].label[0] === "b", "informativeness decides, not coverage alone")
  assert(split[0].label[1] === "common", "the label adds the most frequent co-tag")
  const gestures = synthetic(3, {}).map((scene) => ({ ...scene, units: { ...scene.units, skeleton: ["smile"] } }))
  assert(groupSituations(gestures, OVERRIDES)[0].id === "other", "tags of other slots are not situation tags")
}

// ── Selection ──
const ids = (n: number, seed: number, disabled?: string[]) =>
  selectScenes(pool, n, { rng: createSeededRng(seed), disabledSituations: disabled }).map((s) => s.postId)
assert(ids(5, 7).join() === ids(5, 7).join(), "same seed, same selection")
{
  const many = buildScenePool(Array.from({ length: 12 }, (_, i) => makePost(200 + i, `1girl standing smile bedroom bed skirt shirt u${i}a u${i}b`)), ctx)
  const picks = Array.from({ length: 20 }, (_, i) => selectScenes(many, 3, { rng: createSeededRng(i + 1) }).map((s) => s.postId).join())
  assert(new Set(picks).size > 1, "different seeds give different selections")
}
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

// ── Typicality ──
assert(pool.scenes.every((scene) => scene.typicality !== undefined && scene.typicality >= 0 && scene.typicality <= 1), "every scene has a typicality")
{
  const makeScene = (id: number, tag: string, typicality: number): Scene => {
    const units = emptyUnits()
    units.skeleton = [tag]
    return { postId: id, rating: "g", people: { girls: 1, boys: 0 }, pairing: [], units, anchors: [], typicality }
  }
  const scenes = [makeScene(1, "a", 1), makeScene(2, "b", 1), makeScene(3, "c", 0.9), makeScene(4, "d", 0.1), makeScene(5, "e", 0.1), makeScene(6, "f", 0.2)]
  const one = { scenes, situations: [{ id: "all", label: ["all"], sceneIds: scenes.map((s) => s.postId), previews: [] }], stats: pool.stats }
  for (let seed = 1; seed <= 10; seed++) {
    const first = selectScenes(one, 3, { rng: createSeededRng(seed) }).map((s) => s.postId).sort()
    assert(first.join() === "1,2,3", `seed ${seed}: typical scenes go first even if the oddities are farther`)
    assert(selectScenes(one, 6, { rng: createSeededRng(seed) }).length === 6, "the others follow once the typical ones are out")
  }
}

done()
