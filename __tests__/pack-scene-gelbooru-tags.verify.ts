/**
 * Tests for Gelbooru's own tag list in the scenes engine (lib/pack/scene-pack.ts,
 * lib/supabase/client-queries.ts):
 *   1. Which tags are looked up: no typed field lists them and the taxonomy has no slot.
 *   2. Categories become tag kinds; a tag the list lacks is 'unlisted'.
 *   3. The scene keeps general tags and leaves names, meta, deprecated and unlisted
 *      tags out, even when the pool repeats them.
 *   4. The PostgREST list quotes names with commas, parentheses, quotes and backslashes.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-scene-gelbooru-tags.verify.ts
 */
import { buildScenePool } from "../lib/pack/scene/scene-pool"
import { createPermanence } from "../lib/pack/scene/permanence"
import { gelbooruTagKinds, tagKindsFromPosts, untypedTags } from "../lib/pack/scene-pack"
import { postgrestInList } from "../lib/supabase/client-queries"
import { OVERRIDES, PERMANENCE_DATA, makeAssert, makePost } from "./fixtures/pack-scene-data"

const { assert, done } = makeAssert()
const ctx = { overrides: OVERRIDES, permanence: createPermanence(PERMANENCE_DATA, OVERRIDES), subject: "girl" as const }

const SCENES = [
  "standing smile from_above park outdoors skirt shirt",
  "sitting blush from_side bedroom indoors bed dress boots",
  "lying smile looking_at_viewer beach outdoors sunset dress",
  "standing open_mouth from_side bedroom indoors bed shirt skirt boots",
]
// Every post repeats the same untyped tags, as a themed pool does with a popular series.
const posts = SCENES.map((tags, i) =>
  makePost(i + 1, `1girl solo ${tags} pokemon_scarlet_and_violet some_artist old_tag fresh_name leaf_print chara_${i}`, {
    tag_string_character: `chara_${i}`,
  })
)

// ── What gets looked up ──
const typed = tagKindsFromPosts(posts)
const names = untypedTags(posts, typed, OVERRIDES)
assert(names.includes("pokemon scarlet and violet") && names.includes("leaf print"), "untyped, unslotted tags are looked up")
assert(!names.includes("chara 0") && !names.includes("standing") && !names.includes("1girl"), "typed tags and tags with a slot are not")
assert(names.join() === [...names].sort().join(), "sorted, so the list is a stable key")

// ── Kinds ──
const categories = new Map<string, number | null>([
  ["pokemon scarlet and violet", 3], ["some artist", 1], ["old tag", 6], ["leaf print", 0], ["fresh name", null],
])
const kinds = gelbooruTagKinds(categories)
assert(kinds.get("pokemon scarlet and violet") === "copyright" && kinds.get("some artist") === "artist", "names")
assert(kinds.get("old tag") === "deprecated" && kinds.get("leaf print") === "general" && kinds.get("fresh name") === "unlisted", "deprecated, general, unlisted")

// ── The scene ──
{
  const without = buildScenePool(posts, ctx)
  const tagsOf = (pool: typeof without) => pool.scenes.flatMap((scene) => Object.values(scene.units).flat())
  assert(tagsOf(without).includes("pokemon scarlet and violet"), "without the list, a repeated series name gets through (the case this fixes)")
  const merged = new Map(kinds)
  typed.forEach((kind, tag) => merged.set(tag, kind))
  const withList = buildScenePool(posts, { ...ctx, tagKind: (tag) => merged.get(tag) })
  const all = tagsOf(withList)
  for (const gone of ["pokemon scarlet and violet", "some artist", "old tag", "fresh name"]) {
    assert(!all.includes(gone), `${gone} stays out of the scene`)
  }
  assert(all.includes("leaf print"), "a general tag the list knows stays")
  assert(all.includes("standing") && all.includes("smile"), "the scene keeps its own tags")
}

// ── A general tag with no slot travels only when the pool repeats it ──
{
  const once = SCENES.map((tags, i) => makePost(20 + i, `1girl solo ${tags} chara_${i}${i === 0 ? " ruddy_rose_witch" : ""}${i < 2 ? " leaf_print" : ""}`, { tag_string_character: `chara_${i}` }))
  const general = (tag: string) => (tag === "ruddy rose witch" || tag === "leaf print" ? "general" as const : undefined)
  const all = buildScenePool(once, { ...ctx, tagKind: general }).scenes.flatMap((scene) => Object.values(scene.units).flat())
  assert(!all.includes("ruddy rose witch"), "a general, unslotted tag in one post stays out")
  assert(all.includes("leaf print"), "in two posts, it travels")
}

// ── A garment named after a series ──
{
  const ov: Record<string, string> = { ...OVERRIDES, "school uniform": "clothing:outfit", "summer pockets school uniform": "clothing:outfit", "domino mask": "clothing:headwear", "mask": "clothing:headwear" }
  const uniform = SCENES.map((tags, i) => makePost(30 + i, `1girl solo ${tags} chara_${i} summer_pockets_school_uniform domino_mask`, { tag_string_character: `chara_${i}` }))
  const asked = untypedTags(uniform, tagKindsFromPosts(uniform), ov)
  assert(asked.includes("summer pockets") && asked.includes("domino"), "the words before a known garment are looked up in the same list: " + asked.join())
  assert(!asked.includes("summer pockets school uniform"), "the garment itself has a slot, so it isn't")
  const kinds = gelbooruTagKinds(new Map<string, number | null>([["summer pockets", 3], ["domino", 4]]))
  const pool = buildScenePool(uniform, { ...ctx, overrides: ov, permanence: createPermanence(PERMANENCE_DATA, ov), tagKind: (tag) => kinds.get(tag) })
  const all = pool.scenes.flatMap((scene) => Object.values(scene.units).flat())
  assert(!all.includes("summer pockets school uniform"), "a series' uniform leaves the scene")
  assert(all.includes("domino mask"), "a character prefix doesn't make a garment a name ('domino mask' is a mask)")
}

// ── A general tag qualified by a work ──
{
  const named = SCENES.map((tags, i) => makePost(40 + i, `1girl solo ${tags} chara_${i} la_manchaland_(identity)_(project_moon) leaf_print`, { tag_string_character: `chara_${i}` }))
  const asked = untypedTags(named, tagKindsFromPosts(named), OVERRIDES)
  assert(asked.includes("project moon") && asked.includes("la manchaland (identity) (project moon)"), "its last qualifier is looked up in the same list: " + asked.join())
  const kinds = gelbooruTagKinds(new Map<string, number | null>([["la manchaland (identity) (project moon)", 0], ["project moon", 3], ["leaf print", 0]]))
  const all = buildScenePool(named, { ...ctx, tagKind: (tag) => kinds.get(tag) }).scenes.flatMap((scene) => Object.values(scene.units).flat())
  assert(!all.includes("la manchaland (identity) (project moon)"), "general on Gelbooru, but qualified by a series: it stays out")
  assert(all.includes("leaf print"), "an ordinary general tag still travels")
}

// ── PostgREST list ──
const BS = String.fromCharCode(92)
assert(
  postgrestInList(["a,b", "x_(y)", 'say_"hi"', `back${BS}slash`]) === `("a,b","x_(y)","say_${BS}"hi${BS}"","back${BS}${BS}slash")`,
  "every value quoted, quotes and backslashes escaped"
)

done()
