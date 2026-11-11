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

// ── PostgREST list ──
const BS = String.fromCharCode(92)
assert(
  postgrestInList(["a,b", "x_(y)", 'say_"hi"', `back${BS}slash`]) === `("a,b","x_(y)","say_${BS}"hi${BS}"","back${BS}${BS}slash")`,
  "every value quoted, quotes and backslashes escaped"
)

done()
