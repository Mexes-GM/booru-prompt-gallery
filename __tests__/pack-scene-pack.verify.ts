/**
 * Tests for lib/pack/scene-pack.ts (the scenes engine as the Pack Builder runs it).
 *
 * Covers:
 *   1. Inputs: rating filter, tag kinds from the posts' typed fields, subject,
 *      identity split (counts and picture-state appearance tags go to the scene),
 *      default composition.
 *   2. End to end with the app's real taxonomy snapshot (public/tags-core.json) and
 *      permanence data (public/tag-permanence.json): header first, identity next,
 *      the cleaner's output kept in order, "Always add" first, sizes and donor posts.
 *   3. Dangling references are dropped after the cleaner removes a garment.
 *   4. Faithful makes at most one prompt per scene; Remix fills the pack.
 *   5. Library clothing carries the outfit id.
 *   6. Reroll: another scene of the same situation, never one already in the pack.
 *   7. Default composition: the pick, the base's counts, a character alone, then the pool.
 *   8. What the character owns: variants of its tags and garments for the same body
 *      slot leave the scene; removed and "Never include" tags never appear.
 *   9. "Always add": first, as typed, once; a count tag the composition contradicts is left out.
 *  10. The base's clothing replaces the scene's; redundant booru pairs collapse; async
 *      generation matches the sync one and stops when cancelled.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-scene-pack.verify.ts
 */
import fs from "fs"
import path from "path"
import { buildScenePool } from "../lib/pack/scene/scene-pool"
import { createPermanence, type PermanenceData } from "../lib/pack/scene/permanence"
import { cleanSyntheticPrompt } from "../lib/pack/bulk-send"
import {
  DEFAULT_SCENE_SETTINGS,
  alwaysAddFor,
  applySceneOwnership,
  defaultComposition,
  dropRedundantSceneTags,
  generateScenePackAsync,
  enabledSceneCount,
  generateScenePack,
  postsForRating,
  rerollScenePrompt,
  splitSceneIdentity,
  subjectOfTags,
  tagKindsFromPosts,
  type ScenePackArgs,
} from "../lib/pack/scene-pack"
import { makeAssert, makePost } from "./fixtures/pack-scene-data"

const { assert, done } = makeAssert()
const root = path.join(__dirname, "..")
const CORE: Record<string, string> = JSON.parse(fs.readFileSync(path.join(root, "public/tags-core.json"), "utf8"))
const PERMANENCE: PermanenceData = JSON.parse(fs.readFileSync(path.join(root, "public/tag-permanence.json"), "utf8"))
// The snapshot lists tags in both spellings; the pack works on the spaced one.
const overrides: Record<string, string> = {}
for (const [tag, slot] of Object.entries(CORE)) overrides[tag.replace(/_/g, " ")] = slot
const permanence = createPermanence(PERMANENCE, overrides)

// ── Inputs ──
{
  const posts = [
    makePost(1, "1girl", { rating: "e" }),
    makePost(2, "1girl", { rating: "q" }),
    makePost(3, "1girl", { rating: "s" }),
    makePost(4, "1girl", { rating: "general" }),
  ]
  const ids = (mode: Parameters<typeof postsForRating>[1]) => postsForRating(posts, mode).map((p) => p.id).join()
  assert(ids("explicit") === "1", "explicit packs use explicit scenes")
  assert(ids("questionable") === "2", "questionable packs use questionable scenes")
  assert(ids("sfw") === "3,4", "safe packs use general and sensitive scenes")
  assert(ids("both") === "1,2", "'both' uses questionable and explicit scenes")
  assert(ids(null) === "1,2,3,4", "no rating: every scene")

  const kinds = tagKindsFromPosts([
    makePost(5, "1girl test_hero test_series some_artist", {
      tag_string_character: "test_hero",
      tag_string_copyright: "test_series",
      tag_string_artist: "some_artist",
      tag_string_meta: "highres",
    }),
  ])
  assert(kinds.get("test hero") === "character" && kinds.get("test series") === "copyright", "typed fields give names")
  assert(kinds.get("some artist") === "artist" && kinds.get("highres") === "meta", "artist and meta fields")
  assert(kinds.get("1girl") === undefined, "a tag no typed field lists stays unknown")

  assert(subjectOfTags(["1girl", "long hair"]) === "girl" && subjectOfTags(["1boy", "short hair"]) === "boy", "subject from the count tags")
  assert(subjectOfTags(["long hair"]) === "girl" && subjectOfTags(["1girl", "1boy"]) === "girl", "girl by default and when both are there")

  const split = splitSceneIdentity(["test hero", "1girl", "solo", "long hair", "blue eyes", "navel", "closed eyes", "glasses"], permanence, overrides)
  assert(split.identity.join() === "test hero,long hair,blue eyes,glasses", "names, permanent traits and accessories stay in the identity")
  assert(split.fromScene.join() === "1girl,solo,navel,closed eyes", "counts and picture state come from each scene")

  const compositions = [{ people: { girls: 1, boys: 0 } }, { people: { girls: 1, boys: 1 } }, { people: { girls: 0, boys: 1 } }]
  assert(defaultComposition(compositions, "girl")?.boys === 0, "most common composition with a girl")
  assert(defaultComposition(compositions, "boy")?.boys === 1 && defaultComposition(compositions, "boy")?.girls === 1, "most common composition with a boy")
  assert(defaultComposition(compositions, "girl", { girls: 0, boys: 1 })?.girls === 0, "the user's pick while the pool has it")
  assert(defaultComposition(compositions, "girl", { girls: 3, boys: 0 })?.boys === 0, "a pick the pool lost falls back to the default")
  assert(defaultComposition([], "girl") === null, "no compositions")
  // A card "1girl, solo" in a pool where pair scenes are a bit more common: the card decides.
  const card = [{ people: { girls: 1, boys: 1 } }, { people: { girls: 1, boys: 0 } }]
  assert(defaultComposition(card, "girl", null, { declared: { girls: 1, boys: 0 }, character: false })?.boys === 0, "the base's count tags decide first")
  assert(defaultComposition(card, "girl", null, { declared: { girls: 2, boys: 0 }, character: false })?.boys === 1, "a declared composition the pool lacks falls through")
  assert(defaultComposition(card, "girl", null, { declared: null, character: true })?.boys === 0, "a character base without counts: the character alone")
  assert(defaultComposition(card, "girl", null, { declared: null, character: false })?.boys === 1, "a card without counts: the most common with her")
  assert(defaultComposition(card, "girl", { girls: 1, boys: 1 }, { declared: { girls: 1, boys: 0 }, character: false })?.boys === 1, "the user's pick wins")
}

// ── End to end with the real taxonomy and permanence data ──
const scene = (id: number, tags: string, extra = {}) => makePost(id, tags, { rating: "general", ...extra })
const POSTS = [
  scene(101, "1girl solo test_hero standing smile looking_at_viewer bedroom bed indoors white_shirt pleated_skirt red_hair long_hair green_eyes highres", { tag_string_character: "test_hero", tag_string_meta: "highres" }),
  scene(102, "1girl solo standing blush looking_at_viewer park outdoors tree day blue_dress boots short_hair", { width: 1200, height: 800 }),
  scene(103, "1girl solo standing closed_eyes from_side street outdoors night jacket jeans ponytail"),
  scene(104, "1girl solo sitting smile looking_at_viewer classroom indoors chair desk shirt skirt twintails"),
  scene(105, "1girl solo sitting open_mouth from_above cafe indoors table cup sweater skirt braid"),
  scene(106, "1girl solo sitting crossed_legs looking_at_viewer couch indoors living_room shirt shorts"),
  scene(107, "1girl solo lying on_back smile from_above bed bedroom indoors pajamas pillow"),
  scene(108, "1girl solo lying on_stomach looking_at_viewer grass outdoors flower day dress"),
  scene(109, "1girl solo lying on_side closed_eyes bed indoors blanket shirt"),
  scene(110, "1girl 1boy hetero standing holding_hands smile park outdoors day dress shirt"),
]
const pool = buildScenePool(POSTS, {
  overrides,
  permanence,
  subject: "girl",
  tagKind: (tag) => tagKindsFromPosts(POSTS).get(tag),
})
assert(pool.scenes.length >= 6, `a usable pool (${pool.scenes.length} scenes)`)
assert(pool.stats.composition?.girls === 1 && pool.stats.composition?.boys === 0, "solo scenes by default")

const IDENTITY = ["my character", "long hair", "blue hair", "red eyes"]
const clean = (tags: string[], locked: string[]) =>
  cleanSyntheticPrompt(tags, ["my character"], {
    excludeInput: "",
    addInput: "",
    includeCharacters: true,
    optimizeTags: true,
    smartTagExclusion: true,
    tagOverrides: overrides,
    lockedTags: locked,
  }, locked)
const args = (over: Partial<ScenePackArgs> = {}): ScenePackArgs => ({
  identity: IDENTITY,
  alwaysAdd: ["masterpiece", "score_9"],
  subject: "girl",
  settings: DEFAULT_SCENE_SETTINGS,
  count: 5,
  seed: 7,
  overrides,
  clean,
  resolution: (aspect) => ({ width: Math.round(1024 * Math.min(1, aspect)), height: Math.round(1024 * Math.min(1, 1 / aspect)) }),
  ...over,
})

{
  const { prompts, shortBy } = generateScenePack(pool, args())
  assert(prompts.length === 5 && shortBy === 0, "five prompts")
  for (const p of prompts) {
    const tags = p.prompt.split(",").map((t) => t.trim())
    assert(tags[0] === "masterpiece" && tags[1] === "score_9", `"Always add" goes first, as typed (${p.prompt})`)
    assert(tags[2] === "1girl" && tags[3] === "solo", `the header comes right after it (${p.prompt})`)
    assert(tags.slice(4, 8).join() === IDENTITY.join(), `the identity follows, unchanged and in order (${p.prompt})`)
    assert(!tags.some((t) => ["red hair", "green eyes", "short hair", "ponytail", "twintails", "braid"].includes(t)), `no hair or eyes of the donor (${p.prompt})`)
    assert(!tags.includes("test hero") && !tags.includes("highres"), "no names or meta of the donor")
    assert(!!p.scene && pool.scenes.some((s) => s.postId === p.scene!.postId), "every prompt knows its donor post")
    assert(p.scene?.preview === `https://example.test/${p.scene?.postId}.jpg`, "and its preview")
    assert(!!p.scene?.situation, "and its situation")
    assert(!!p.width && !!p.height, "a suggested size from the donor's proportions")
    assert(p.values.length === 0, "no axis values (nothing for the learning model)")
  }
  assert(new Set(prompts.map((p) => p.scene!.postId)).size === 5, "faithful uses five different scenes")
  const landscape = prompts.find((p) => p.scene!.postId === 102)
  if (landscape) assert(landscape.width! > landscape.height!, "a wide post suggests a wide size")
  assert(JSON.stringify(prompts) === JSON.stringify(generateScenePack(pool, args()).prompts), "same seed, same pack")
}

// ── Faithful vs remix with more prompts than scenes ──
{
  const enabled = enabledSceneCount(pool, [])
  const faithful = generateScenePack(pool, args({ count: 30 }))
  assert(faithful.prompts.length <= enabled && faithful.shortBy === 30 - faithful.prompts.length, "faithful: one prompt per scene at most, and the gap is reported")
  const remix = generateScenePack(pool, args({ count: 12, settings: { ...DEFAULT_SCENE_SETTINGS, mix: "remix" } }))
  assert(remix.prompts.length > enabled || remix.shortBy === 12 - remix.prompts.length, "remix reuses scenes to fill the pack")
  const off = pool.situations[0].id
  const fewer = generateScenePack(pool, args({ count: 30, disabledSituations: [off] }))
  assert(!fewer.prompts.some((p) => p.scene!.situation === off), "switched-off situations are skipped")
  assert(enabledSceneCount(pool, [off]) === enabled - pool.situations[0].sceneIds.length, "enabled scene count")
}

// ── The cleaner removes a garment: its reference goes too ──
{
  // Two posts, so the pool vouches for "skirt lift" (the snapshot has no slot for it).
  const lifted = [
    scene(201, "1girl solo standing skirt_lift smile looking_at_viewer bedroom indoors bed shirt pleated_skirt"),
    scene(202, "1girl solo standing skirt_lift blush from_side park outdoors tree jacket miniskirt"),
  ]
  const small = buildScenePool(lifted, { overrides, permanence, subject: "girl" })
  const dropSkirt = (tags: string[], locked: string[]) => clean(tags.filter((t) => !t.endsWith("skirt")), locked)
  const dropped = generateScenePack(small, args({ count: 2, clean: dropSkirt })).prompts
  assert(dropped.length === 2 && dropped.every((p) => !p.prompt.includes("skirt lift")), "a lifted skirt without a skirt is dropped after cleaning")
  const kept = generateScenePack(small, args({ count: 2 })).prompts
  assert(kept.length === 2 && kept.every((p) => p.prompt.includes("skirt lift")), "kept while the skirt is there")
}

// ── Library clothing ──
{
  const library = [
    { outfitId: 41, tags: ["maid", "maid headdress", "apron"] },
    { outfitId: 42, tags: ["school uniform", "serafuku"] },
  ]
  const { prompts } = generateScenePack(pool, args({ count: 4, library, settings: { ...DEFAULT_SCENE_SETTINGS, clothing: "library" } }))
  assert(prompts.length > 0 && prompts.every((p) => p.outfitId === 41 || p.outfitId === 42), "each prompt carries the library outfit it wears")
}

// ── What the character owns ──
{
  const sceneTags = ["1girl", "solo", "hairband", "smile", "white hairband", "gold jewelry", "jewelry", "standing", "white shirt", "skirt", "boots", "earrings"]
  const fixed = ["1girl", "solo", "hairband"]
  const owned = applySceneOwnership(sceneTags, fixed, [], overrides)
  assert(owned.includes("hairband") && !owned.includes("white hairband"), "another variant of the character's accessory leaves the scene")
  assert(owned.includes("gold jewelry") && owned.includes("earrings"), "other accessories stay")
  const never = applySceneOwnership(sceneTags, fixed, ["jewelry"], overrides)
  assert(!never.includes("jewelry") && !never.includes("gold jewelry"), "a removed tag and its variants never appear")
  assert(never.includes("earrings"), "a different accessory is not a variant")
  const dressed = applySceneOwnership(["1girl", "red dress", "white shirt", "pleated skirt", "boots", "smile"], ["1girl", "red dress"], [], overrides)
  assert(!dressed.includes("white shirt") && !dressed.includes("pleated skirt"), "a fixed dress takes the top and bottom slots: " + dressed.join())
  assert(dressed.includes("boots") && dressed.includes("smile"), "other slots and non-garments stay")
  const kept = applySceneOwnership(["hairband", "white hairband"], ["white hairband"], ["hairband"], overrides)
  assert(kept.includes("white hairband"), "a fixed tag stays whatever the other rules say")

  // End to end: the pack never shows a removed tag nor another hairband.
  const withBand = [
    scene(301, "1girl solo standing smile looking_at_viewer bedroom indoors bed white_shirt skirt white_hairband jewelry"),
    scene(302, "1girl solo standing blush looking_at_viewer park outdoors tree dress gold_hairband gold_jewelry"),
    scene(303, "1girl solo sitting smile looking_at_viewer classroom indoors chair desk shirt skirt yellow_hairband"),
  ]
  const bandPool = buildScenePool(withBand, { overrides, permanence, subject: "girl" })
  const pack = generateScenePack(bandPool, args({ identity: [...IDENTITY, "hairband"], never: ["jewelry"], count: 3 })).prompts
  assert(pack.length === 3, "three prompts")
  for (const p of pack) {
    assert(!/(white|gold|yellow) hairband|jewelry/.test(p.prompt), "no other hairband and no jewelry: " + p.prompt)
    assert(p.prompt.includes("hairband"), "the character's hairband stays")
  }
}

// ── Always add ──
{
  assert(alwaysAddFor(["masterpiece", "solo", "1girl"], ["1girl", "solo"]).join() === "masterpiece,solo,1girl", "count tags the header has are kept")
  assert(alwaysAddFor(["masterpiece", "solo", "1boy"], ["1girl", "1boy", "hetero"]).join() === "masterpiece,1boy", "a count the composition contradicts is left out")
  const typed = ["(masterpiece:1.2)", "score_9", "smile", "solo"]
  const { prompts } = generateScenePack(pool, args({ alwaysAdd: typed, count: 5 }))
  for (const p of prompts) {
    const tags = p.prompt.split(",").map((t) => t.trim())
    assert(tags.slice(0, 4).join() === typed.join(), "\"Always add\" goes first, as typed: " + p.prompt)
    assert(tags.filter((t) => t === "solo").length === 1 && tags.filter((t) => t === "smile").length <= 1, "no exact duplicates")
    assert(tags.slice(4, 9).join() === ["1girl", ...IDENTITY].join(), "the header's count and the identity follow untouched: " + p.prompt)
  }
  // literal text: it doesn't push the scene's own variants out
  const lit = generateScenePack(pool, args({ alwaysAdd: ["shirt"], count: 9 })).prompts
  assert(lit.some((p) => /white shirt/.test(p.prompt)), "an 'Always add' tag owns nothing: the scene keeps its variants")
  const pairPool = buildScenePool(POSTS, { overrides, permanence, subject: "girl", people: { girls: 1, boys: 1 } })
  const pair = generateScenePack(pairPool, args({ alwaysAdd: ["solo"], count: 1 })).prompts[0]
  assert(!!pair && !pair.prompt.split(", ").includes("solo"), "with a partner in the scene, a typed 'solo' is not added")
}

// ── The base's clothing ──
{
  const base = ["red dress", "black boots"]
  const { prompts } = generateScenePack(pool, args({ baseClothing: base, settings: { ...DEFAULT_SCENE_SETTINGS, clothing: "base" }, count: 5 }))
  assert(prompts.length === 5, "five prompts")
  for (const p of prompts) {
    assert(p.prompt.includes("red dress") && p.prompt.includes("black boots"), "every prompt wears the base's clothes")
    assert(!/(shirt|skirt|jacket|jeans|sweater|pajamas|shorts)/.test(p.prompt), "the scene's clothes are gone: " + p.prompt)
  }
  const none = generateScenePack(pool, args({ baseClothing: [], settings: { ...DEFAULT_SCENE_SETTINGS, clothing: "base" }, count: 3 })).prompts
  assert(none.some((p) => /(shirt|skirt|dress|jacket|sweater|pajamas)/.test(p.prompt)), "no base clothing: the scene's clothes stay")
}

// ── Redundant booru pairs ──
assert(dropRedundantSceneTags(["lace bra", "bra", "off-shoulder sweater", "off shoulder", "smile"], []).join() === "lace bra,off-shoulder sweater,smile", "the shorter tag of a pair goes")
assert(dropRedundantSceneTags(["simple background", "white background"], []).length === 2, "different backgrounds are not redundant")
assert(dropRedundantSceneTags(["hairband", "white hairband"], ["hairband"]).length === 2, "fixed tags are never dropped")
assert(dropRedundantSceneTags(["skirt", "miniskirt"], []).length === 2, "only whole words count")
assert(dropRedundantSceneTags(["blush", "blush stickers", "pussy juice", "pussy juice puddle"], []).length === 4, "a tag that starts with another is a different thing")

// ── Async generation ──
void (async () => {
  const sync = generateScenePack(pool, args({ count: 6 }))
  let pauses = 0
  const result = await generateScenePackAsync(pool, args({ count: 6 }), { pause: async () => { pauses++ }, cancelled: () => false, slice: 0 })
  assert(JSON.stringify(result) === JSON.stringify(sync), "async gives the same pack as sync")
  assert(pauses >= 6, "it pauses between prompts")
  let calls = 0
  const stopped = await generateScenePackAsync(pool, args({ count: 6 }), { pause: async () => { calls++ }, cancelled: () => calls > 2, slice: 0 })
  assert(stopped === null, "a cancelled request stops and gives nothing")
  rest()
})()

function rest() {
// ── Reroll ──
{
  const pack = generateScenePack(pool, args({ count: 3 })).prompts
  const used = new Set(pack.map((p) => p.scene!.postId))
  for (let i = 0; i < pack.length; i++) {
    const next = rerollScenePrompt(pool, pack, i, args({ seed: 100 + i }))
    if (!next) continue
    assert(!used.has(next.scene!.postId), `row ${i + 1}: a scene the pack does not use yet`)
    const situation = pool.situations.find((s) => s.id === pack[i].scene!.situation)!
    const unusedThere = situation.sceneIds.filter((id) => !used.has(id))
    if (unusedThere.length > 0) assert(situation.sceneIds.includes(next.scene!.postId), `row ${i + 1}: from the same situation while it has scenes left`)
  }
  const all = generateScenePack(pool, args({ count: 30 })).prompts
  const last = rerollScenePrompt(pool, all, 0, args())
  assert(last === null, "faithful: nothing left once every scene is in the pack")
  const remixAll = rerollScenePrompt(pool, all, 0, args({ settings: { ...DEFAULT_SCENE_SETTINGS, mix: "remix" } }))
  assert(remixAll === null || remixAll.prompt !== all[0].prompt, "remix may bring a scene back with other swaps")
}

done()
}
