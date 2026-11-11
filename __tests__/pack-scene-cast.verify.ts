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
import { castAddition, castDefaultSearch, castMemberLook, castPeople, compositionQuery, holdsCast, roleFromProfile, roleFromSubject } from "../lib/pack/scene/cast"
import { DEFAULT_SCENE_SETTINGS, applySceneOwnership, castComposition, generateScenePack, type ScenePackArgs } from "../lib/pack/scene-pack"
import { packNaturalSource } from "../lib/pack/pack-natural"
import { profileIdentity, typicalLook } from "../lib/pack/character-identity"
import { extractScene } from "../lib/pack/scene/scene"
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
// A man often drawn next to his family: 78% of his solo posts say 1boy, 22% 1girl.
assert(roleFromProfile({ "solo 1boy": 0.783, "solo 1girl": 0.217, "black hair": 0.689, "long hair": 0.502 }) === "boy", "two to one in his solo posts is clear enough")
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

// ── Search: count tags while they fit, with room for the theme; else one tag ──
assert(compositionQuery({ girls: 1, boys: 1 }, "danbooru") === "1girl, 1boy", "a girl and a boy: the count tags")
assert(compositionQuery({ girls: 2, boys: 0 }, "gelbooru") === "2girls", "two girls")
assert(compositionQuery({ girls: 2, boys: 1 }, "gelbooru", "beach", "sfw") === "2girls, 1boy, beach", "no tag limit: counts and the whole theme")
assert(compositionQuery({ girls: 1, boys: 1 }, "rule34") === "1girls, 1boy", "Rule34 spells one girl 1girls")
assert(compositionQuery({ girls: 1, boys: 1 }, "e621") === "duo", "e621 counts with duo")
assert(compositionQuery({ girls: 1, boys: 1 }, "danbooru", "beach, rating:explicit, swimsuit") === "hetero, beach", "Danbooru's two tags: one for the pair, one for the theme; ratings are left to the source")
assert(compositionQuery({ girls: 2, boys: 1 }, "danbooru", "beach", "explicit") === "ffm_threesome, beach", "an explicit trio on Danbooru uses its pairing tag")
assert(compositionQuery({ girls: 2, boys: 1 }, "danbooru", "beach", "sfw") === "1boy, beach", "at a safe rating, never a threesome tag (almost no posts): the rarer count")

// ── A cast member's look comes from their own solo posts ──
{
  const ov: Record<string, string> = { ...overrides, "short hair": "appearance:hair", "long hair": "appearance:hair", "red eyes": "appearance:eyes", "green eyes": "appearance:eyes" }
  const him = "man (test)"
  const her = "woman (test)"
  const solo = (id: number) => makePost(id, `1boy solo ${him.replace(/ /g, "_")} blonde_hair short_hair green_eyes standing`, { tag_string_character: him.replace(/ /g, "_") })
  const pair = (id: number) => makePost(id, `1girl 1boy ${him.replace(/ /g, "_")} ${her.replace(/ /g, "_")} blonde_hair short_hair black_hair long_hair red_eyes green_eyes standing`, {
    tag_string_character: `${him.replace(/ /g, "_")} ${her.replace(/ /g, "_")}`,
  })
  const posts = [1, 2, 3, 4, 5, 6].map(solo).concat([7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map(pair))
  const look = typicalLook(posts, him, ov)!
  const member = castMemberLook(him, look)
  assert(member[0] === him && member.includes("blonde hair") && member.includes("short hair"), "his look: his own hair, name first")
  assert(!member.includes("black hair") && !member.includes("long hair") && !member.includes("red eyes"), "none of the woman's traits, though most of his posts show her too")
  // The static profile counts every post he is in: her hair and eyes would pass as his.
  const profile = { "solo 1boy": 0.78, "solo 1girl": 0.22, "blonde hair": 0.64, "short hair": 0.55, "black hair": 0.69, "long hair": 0.5, "red eyes": 0.41 }
  const fromProfile = profileIdentity(him, { [him]: profile }, ov)
  assert(fromProfile.includes("black hair"), "(why the profile isn't used: it would give him her black hair)")
  assert(castMemberLook(him, null).join() === him, "until his solo posts arrive, only his name")
}

// ── "multiple girls" next to "2girls" is a count, not an open one ──
{
  const ctx = { overrides, permanence, subject: "girl" as const }
  const two = extractScene(makePost(30, "2girls multiple_girls yuri standing hug smile bedroom"), ctx)!
  assert(two.people?.girls === 2 && two.people?.boys === 0, "2girls with multiple girls: two girls")
  assert(!two.pairing.includes("multiple girls"), "the open count isn't carried when a number says how many")
  const open = extractScene(makePost(31, "multiple_girls standing smile bedroom"), ctx)!
  assert(open.people === null, "multiple girls alone stays open")
}

// ── Adding characters and the source the app sets up ──
assert(castAddition(["alice"], "alice") === "duplicate", "the same character twice is refused")
assert(castAddition(["alice", "bob"], "cara") === "added" && castAddition(["alice", "bob", "cara"], "dan") === "full", "three at most")
assert(castDefaultSearch(["girl"], "alice, solo", "danbooru") === "alice, solo", "one character: their own posts alone")
assert(castDefaultSearch(["girl", "boy"], "alice, solo", "danbooru") === "1girl, 1boy", "a cast: pictures of the same mix of people, without their names")
assert(castDefaultSearch(["girl", null], "alice, solo", "danbooru") === null, "not until every role is known")

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

// ── Natural formats get every named character ──
{
  const prompt = { prompt: "1girl, 1boy, hetero, alice (test), long hair, bob (test), short hair, hug", values: [] }
  const both = packNaturalSource(prompt, { character: "alice (test)", characters: ["alice (test)", "bob (test)"], contentRating: "sfw" })
  assert(both.characters === "alice_(test) bob_(test)", "both names go to the converter, as booru fields: " + both.characters)
  const gone = packNaturalSource({ ...prompt, prompt: "1girl, 1boy, hetero, alice (test), hug" }, { character: "alice (test)", characters: ["alice (test)", "bob (test)"], contentRating: "sfw" })
  assert(gone.characters === "alice_(test)", "a name the prompt no longer has is left out")
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
