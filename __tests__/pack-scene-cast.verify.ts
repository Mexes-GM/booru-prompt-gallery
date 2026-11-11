/**
 * Tests for a cast of two or three characters on the scenes engine
 * (lib/pack/scene/cast.ts, lib/pack/scene-pack.ts).
 *
 * Covers:
 *   1. Roles: from subject tags and trait profiles; null when unclear.
 *   2. The cast's composition and the compositions that can hold it; the default.
 *   3. The composition search per booru, with the user's theme within the tag limit.
 *   4. Prompt order with two and three characters: header, then one block per
 *      character (name first, in cast order), then the scene; never "solo".
 *   5. Blocks stay whole even when they share tags.
 *   6. With a cast, a pinned garment doesn't push the scene's garments out; "Own
 *      outfits" drops the scene's clothing and exposure.
 *   7. Traits of donors never travel when the cast names everyone.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-scene-cast.verify.ts
 */
import { buildScenePool } from "../lib/pack/scene/scene-pool"
import { createPermanence } from "../lib/pack/scene/permanence"
import { castPeople, compositionQuery, holdsCast, roleFromProfile, roleFromSubject } from "../lib/pack/scene/cast"
import { DEFAULT_SCENE_SETTINGS, applySceneOwnership, castComposition, generateScenePack, type ScenePackArgs } from "../lib/pack/scene-pack"
import { OVERRIDES, PERMANENCE_DATA, makeAssert, makePost } from "./fixtures/pack-scene-data"

const { assert, done } = makeAssert()
const overrides: Record<string, string> = { ...OVERRIDES, "black hair": "appearance:hair", "blonde hair": "appearance:hair", "red dress": "clothing:top" }
const permanence = createPermanence(PERMANENCE_DATA, overrides)

// ── Roles ──
assert(roleFromSubject(["1girl", "solo"]) === "girl" && roleFromSubject(["1boy"]) === "boy", "role from subject tags")
assert(roleFromSubject(["1girl", "1boy"]) === null && roleFromSubject(["solo"]) === null, "no role when the tags say neither or both")
assert(roleFromProfile({ "solo 1girl": 0.9, "solo 1boy": 0.01 }) === "girl", "a profile with clear solo girl posts")
assert(roleFromProfile({ "solo 1boy": 0.8, "solo 1girl": 0.05 }) === "boy", "a profile with clear solo boy posts")
assert(roleFromProfile({ "1boy": 0.6, "1girl": 0.5 }) === null, "a profile that leaves doubt gives no role")
assert(roleFromProfile(undefined) === null, "no profile, no role")

// ── Composition ──
{
  const pair = castPeople(["girl", "boy"])
  assert(pair.girls === 1 && pair.boys === 1, "a girl and a boy")
  assert(castPeople(["girl", null]).girls === 1 && castPeople(["girl", null]).boys === 0, "an unknown role is not counted")
  assert(holdsCast({ girls: 2, boys: 1 }, pair) && !holdsCast({ girls: 2, boys: 0 }, pair), "compositions with room for the cast")
  const compositions = [{ people: { girls: 2, boys: 1 } }, { people: { girls: 1, boys: 1 } }, { people: { girls: 1, boys: 0 } }]
  assert(castComposition(compositions, pair)?.girls === 1, "the exact composition by default, even if another is more common")
  assert(castComposition(compositions, pair, { girls: 2, boys: 1 })?.girls === 2, "the user may pick a bigger one")
  assert(castComposition(compositions, pair, { girls: 1, boys: 0 })?.girls === 1 && castComposition(compositions, pair, { girls: 1, boys: 0 })?.boys === 1, "a pick that can't hold the cast is ignored")
  assert(castComposition([{ people: { girls: 3, boys: 1 } }], pair)?.girls === 3, "else the most common that holds them")
  assert(castComposition([{ people: { girls: 1, boys: 0 } }], pair) === null, "none holds them: null")
}

// ── Search ──
assert(compositionQuery({ girls: 1, boys: 1 }, "danbooru") === "hetero", "a girl and a boy: hetero")
assert(compositionQuery({ girls: 2, boys: 0 }, "gelbooru") === "yuri", "two girls: yuri")
assert(compositionQuery({ girls: 1, boys: 1 }, "e621") === "male/female", "e621's own pairing tag")
assert(compositionQuery({ girls: 2, boys: 1 }, "danbooru") === "ffm_threesome", "a trio has its pairing tag")
assert(compositionQuery({ girls: 1, boys: 1 }, "danbooru", "beach, rating:explicit, swimsuit") === "hetero, beach", "the theme fits within Danbooru's two tags; ratings are left to the source")

// ── Prompts ──
const scene = (id: number, tags: string) => makePost(id, `1girl 1boy hetero ${tags}`)
const POSTS = [
  scene(1, "standing hug smile from_above bedroom bed indoors skirt shirt beard"),
  scene(2, "sitting hug blush from_side park outdoors dress boots muscular_male"),
  scene(3, "lying hug smile looking_at_viewer beach outdoors sunset dress navel"),
  scene(4, "standing hug open_mouth from_side bedroom indoors bed shirt skirt boots"),
  makePost(5, "1girl solo standing smile from_above bedroom bed skirt shirt"),
]
const CAST = { girls: 1, boys: 1 }
const pool = buildScenePool(POSTS, { overrides, permanence, subject: "girl", cast: CAST, people: CAST })
assert(pool.scenes.length === 4, "only the pair scenes")
const ALICE = ["alice (test)", "long hair", "black hair"]
const BOB = ["bob (test)", "short hair", "blonde hair"]
const clean = (tags: string[]) => tags.join(", ")
function args(over: Partial<ScenePackArgs> = {}): ScenePackArgs {
  return {
  identity: [...ALICE, ...BOB],
  alwaysAdd: [],
  subject: "girl",
  settings: DEFAULT_SCENE_SETTINGS,
  count: 4,
  seed: 3,
  overrides,
  castSize: 2,
  people: CAST,
  clean,
  ...over,
  }
}
{
  const { prompts } = generateScenePack(pool, args())
  assert(prompts.length === 4, "four prompts")
  for (const p of prompts) {
    const tags = p.prompt.split(", ")
    assert(tags.slice(0, 3).join() === "1girl,1boy,hetero", "the header first: " + p.prompt)
    assert(tags.slice(3, 9).join() === [...ALICE, ...BOB].join(), "then each character's block, in cast order, name first: " + p.prompt)
    assert(!tags.includes("solo"), "never solo with two people")
    assert(!tags.includes("beard") && !tags.includes("muscular male"), "with everyone named, no donor trait travels")
  }
  const trio = buildScenePool(
    [makePost(10, "2girls 1boy standing hug smile from_above bedroom bed indoors skirt shirt"), makePost(11, "2girls 1boy sitting hug blush from_side park outdoors dress boots")],
    { overrides, permanence, subject: "girl", cast: { girls: 2, boys: 1 }, people: { girls: 2, boys: 1 } }
  )
  const CARA = ["cara (test)", "long hair", "blonde hair"]
  const three = generateScenePack(trio, args({ identity: [...ALICE, ...CARA, ...BOB], castSize: 3, people: { girls: 2, boys: 1 }, count: 2 })).prompts
  assert(three.length === 2, "a cast of three works the same")
  for (const p of three) {
    const tags = p.prompt.split(", ")
    assert(tags.slice(0, 2).join() === "2girls,1boy", "the trio's header")
    assert(tags.slice(2, 11).join() === [...ALICE, ...CARA, ...BOB].join(), "three blocks, each whole, even where they share 'long hair': " + p.prompt)
    assert(!tags.includes("solo"), "never solo with three people")
  }
}

// ── Clothing with a cast ──
{
  const sceneTags = ["1girl", "1boy", "white shirt", "pleated skirt", "hairband", "white hairband"]
  const one = applySceneOwnership(sceneTags, ["1girl", "1boy", "red dress", "hairband"], [], overrides, false)
  assert(one.includes("white shirt") && one.includes("pleated skirt"), "with a cast, a pinned dress doesn't push out the scene's clothes (they may be the other's)")
  assert(!one.includes("white hairband"), "variants of a pinned accessory still go")
  const pinned = generateScenePack(pool, args({ identity: [...ALICE, "red dress", ...BOB], count: 4 })).prompts
  assert(pinned.some((p) => /\b(skirt|shirt|boots)\b/.test(p.prompt.replace("red dress", ""))), "the scene's clothes stay next to a pinned dress")
  const own = generateScenePack(pool, args({ identity: [...ALICE, "red dress", ...BOB], settings: { ...DEFAULT_SCENE_SETTINGS, clothing: "own" }, count: 4 })).prompts
  assert(own.length > 0, "own outfits make prompts")
  for (const p of own) {
    assert(p.prompt.includes("red dress"), "each character wears what is pinned in their block")
    assert(!/(skirt|shirt|boots|navel)/.test(p.prompt), "the scene's clothes and exposure are gone: " + p.prompt)
  }
  const single = generateScenePack(pool, args({ castSize: 1, settings: { ...DEFAULT_SCENE_SETTINGS, clothing: "own" }, count: 2 })).prompts
  assert(single.some((p) => /(skirt|shirt|dress|boots)/.test(p.prompt)), "'own outfits' means nothing with one character: the scene's clothes stay")
}

done()
