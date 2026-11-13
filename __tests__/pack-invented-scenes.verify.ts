/**
 * Tests for lib/pack/scene/invented.ts (scenes the scene model writes, added to Pack Mode's pool).
 *
 * Covers:
 *   1. How many: a quarter of the real posts, between 8 and 30.
 *   2. Ratings shared out like the real posts (largest remainder); none: the lowest allowed.
 *   3. Conditions: people-count tags, body traits from the identity, series from the card or the pool.
 *   4. An invented scene as a post: negative id, marked, no image, count tags first, booru spelling.
 *   5. In the pool: it goes through extraction like a real post and is marked; the pool's
 *      counts and its evidence (support, names) come from real posts only; a near-copy of a
 *      real post is dropped in favour of the real one.
 *   6. In a pack: the prompt says its scene is invented, has no preview and goes through the cleaner.
 *   7. With a picked scene, real posts that have it come before invented scenes (which all have it).
 *   8. Saved configs: the option is off unless saved on.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-invented-scenes.verify.ts
 */
import {
  bodyTraits, inventedPost, inventedSceneCount, inventedSceneSpec, isInventedPost, peopleTags, ratingPlan, seriesOf,
  MAX_INVENTED_SCENES, MIN_INVENTED_SCENES,
} from "../lib/pack/scene/invented"
import { buildScenePool } from "../lib/pack/scene/scene-pool"
import { createPermanence } from "../lib/pack/scene/permanence"
import { DEFAULT_SCENE_SETTINGS, generateScenePack, sceneIdeaPhases, type ScenePackArgs } from "../lib/pack/scene-pack"
import { packEngineConfig } from "../lib/pack/pack-config-migration"
import { OVERRIDES, PERMANENCE_DATA, makeAssert, makePost } from "./fixtures/pack-scene-data"

const { assert, done } = makeAssert()
const ctx = { overrides: OVERRIDES, permanence: createPermanence(PERMANENCE_DATA, OVERRIDES), subject: "girl" as const }

// ── 1. How many ──
assert(inventedSceneCount(0) === MIN_INVENTED_SCENES && inventedSceneCount(10) === MIN_INVENTED_SCENES, "small pools get the minimum")
assert(inventedSceneCount(80) === 20, "a quarter of the posts")
assert(inventedSceneCount(1000) === MAX_INVENTED_SCENES, "large pools get the maximum")

// ── 2. Ratings ──
{
  const plan = ratingPlan(["g", "g", "g", "s", "general", "sensitive", "q"], ["g", "s"], 10)
  assert(plan.length === 10 && plan.filter((r) => r === "g").length === 7 && plan.filter((r) => r === "s").length === 3, "shared out like the posts of the pack's ratings (4:2 -> 7:3)")
  assert(ratingPlan([], ["g", "s"], 4).every((r) => r === "g"), "no posts: the lowest allowed rating")
  assert(ratingPlan(["q", "e", "e"], ["q", "e"], 3).join() === "q,e,e", "a mixed adult pack follows its posts")
  assert(ratingPlan(["g"], ["g"], 0).length === 0, "none asked, none planned")
}

// ── 3. Conditions ──
{
  assert(peopleTags({ girls: 1, boys: 0 }).join() === "1girl,solo", "one girl")
  assert(peopleTags({ girls: 2, boys: 1 }).join() === "2girls,1boy,multiple_girls", "two girls and a boy")
  assert(peopleTags({ girls: 7, boys: 0 }).join() === "6+girls,multiple_girls", "six or more")
  assert(bodyTraits(["long hair", "fox ears", "fox tail", "fake horns", "pointy ears", "hair wings", "dragon wings"]).join() === "tail,animal_ears,wings", "body traits from the identity, without fake, pointy or hair-shaped ones")
  assert(bodyTraits(["animal_ears", "demon horns"]).join() === "animal_ears,horns", "underscored tags too")
  const posts = [
    makePost(1, "1girl", { tag_string_character: "hero_a", tag_string_copyright: "series_a" }),
    makePost(2, "1girl", { tag_string_character: "hero_a", tag_string_copyright: "series_a crossover_b" }),
    makePost(3, "1girl", { tag_string_character: "hero_a", tag_string_copyright: "other_c" }),
    makePost(4, "1girl", { tag_string_character: "someone_else", tag_string_copyright: "other_c" }),
  ]
  assert(seriesOf("card_series", posts, ["hero a"]).join() === "card_series", "the card's series first")
  assert(seriesOf(undefined, posts, ["hero a"]).join() === "series_a", "else the series most of the character's posts have")
  assert(seriesOf(undefined, posts, ["nobody"]).length === 0 && seriesOf(undefined, posts, []).length === 0, "no posts of the character, no series")
  const spec = inventedSceneSpec({ rating: "s", people: { girls: 1, boys: 0 }, identity: ["cat ears"], characters: ["yor briar"], series: ["spy x family"] })
  assert(spec.conditions.rating === "s" && spec.conditions.characters?.join() === "yor_briar" && spec.conditions.series?.join() === "spy_x_family", "names in booru spelling")
  assert(spec.conditions.body?.join() === "animal_ears" && spec.people.join() === "1girl,solo" && !spec.conditions.noCharacter, "body and people")
  assert(inventedSceneSpec({ rating: "g", people: { girls: 1, boys: 0 }, identity: [], characters: [], series: [] }).conditions.noCharacter === true, "no character: an original")
}

// ── 4. As a post ──
const SPEC = inventedSceneSpec({ rating: "g", people: { girls: 1, boys: 0 }, identity: [], characters: ["hero_a"], series: ["series_a"] })
{
  const a = inventedPost(SPEC, ["standing", "smile", "from_above", "bedroom", "bed", "indoors", "skirt", "shirt"])
  const b = inventedPost(SPEC, ["sitting"])
  assert(a.id < 0 && b.id < 0 && a.id !== b.id, "negative ids, never repeated")
  assert(isInventedPost(a) && !isInventedPost(makePost(5, "1girl")), "marked")
  assert(a.preview_file_url === "" && a.file_url === "" && a.width === undefined, "no image, no size")
  assert(a.tag_string.startsWith("1girl solo standing") && a.rating === "g" && a.tag_string_character === "hero_a", "count tags first, booru spelling, rating and character")
}

// ── 5. In the pool ──
const REAL = [
  makePost(1, "1girl solo standing smile from_above bedroom bed indoors skirt shirt"),
  makePost(2, "1girl solo standing blush looking_at_viewer park outdoors sunset dress boots"),
  makePost(3, "1girl solo lying on_bed smile from_side bedroom bed indoors shirt skirt navel"),
]
{
  const invented = [
    inventedPost(SPEC, ["sitting", "smile", "from_side", "beach", "outdoors", "dress", "boots", "made_up_loose_tag"]),
    inventedPost(SPEC, ["sitting", "blush", "looking_at_viewer", "park", "outdoors", "sunset", "skirt", "shirt", "made_up_loose_tag"]),
    // A near-copy of real post 1: the real one is kept.
    inventedPost(SPEC, ["standing", "smile", "from_above", "bedroom", "bed", "indoors", "skirt", "shirt"]),
    // A blocked theme: filtered like a real post.
    inventedPost(SPEC, ["sitting", "smile", "child", "park", "outdoors", "dress", "boots", "blush"]),
  ]
  const realOnly = buildScenePool(REAL, { ...ctx, people: { girls: 1, boys: 0 } })
  const pool = buildScenePool([...REAL, ...invented], { ...ctx, people: { girls: 1, boys: 0 } })
  const inventedScenes = pool.scenes.filter((s) => s.invented)
  assert(inventedScenes.length === 2 && pool.stats.invented === 2, "two invented scenes join the pool")
  assert(inventedScenes.every((s) => s.postId < 0 && s.preview === undefined && s.aspect === undefined), "no preview or size")
  assert(pool.stats.posts === 3 && pool.stats.blocked === 0 && pool.stats.nearDuplicates === 0, "the counts are of real posts only")
  assert(pool.stats.posts === realOnly.stats.posts && pool.stats.belowQuality === realOnly.stats.belowQuality, "same counts as without them")
  assert(pool.scenes.some((s) => s.postId === 1), "the real post survives its invented near-copy")
  const tags = inventedScenes.flatMap((s) => Object.values(s.units).flat())
  assert(!tags.includes("made up loose tag"), "two invented scenes don't vouch for an unknown tag: only real posts are evidence")
  assert(inventedScenes.some((s) => s.units.skeleton.includes("sitting") && s.units.place.includes("beach")), "extracted by slot like a real post")

  // ── 6. In a pack ──
  const args: ScenePackArgs = {
    identity: ["1girl", "solo", "long hair"],
    alwaysAdd: [],
    subject: "girl",
    settings: { ...DEFAULT_SCENE_SETTINGS },
    count: 10,
    seed: 3,
    overrides: OVERRIDES,
    clean: (t) => t.filter((tag) => tag !== "sunset").join(", "),
  }
  const { prompts } = generateScenePack(pool, args)
  const fromInvented = prompts.filter((p) => p.scene?.invented)
  assert(fromInvented.length === 2, "each invented scene makes a prompt, marked as invented")
  assert(fromInvented.every((p) => p.scene!.postId < 0 && p.scene!.preview === undefined && p.width === undefined), "no preview, no suggested size")
  assert(fromInvented.every((p) => !p.prompt.includes("sunset") && p.prompt.startsWith("1girl, solo, long hair")), "through the cleaner and the identity like any prompt")
  assert(prompts.filter((p) => !p.scene?.invented).every((p) => p.scene!.postId > 0 && !!p.scene!.preview), "real scenes keep their preview")
}

// ── 7. Picked scene: real posts first ──
{
  const invented = [
    inventedPost(SPEC, ["sitting", "smile", "from_side", "bedroom", "bed", "indoors", "dress", "boots"]),
    inventedPost(SPEC, ["lying", "blush", "looking_at_viewer", "bedroom", "indoors", "sunset", "skirt", "shirt"]),
  ]
  const pool = buildScenePool([...REAL, ...invented], { ...ctx, people: { girls: 1, boys: 0 } })
  const phases = sceneIdeaPhases(pool, ["bedroom"])!
  const ids = (i: number) => phases[i].situations.flatMap((s) => s.sceneIds)
  assert(phases.length === 3, "three phases: real matches, invented matches, the rest")
  assert(ids(0).length === 2 && ids(0).every((id) => id > 0), "real posts with the scene first")
  assert(ids(1).length === 2 && ids(1).every((id) => id < 0), "then the invented scenes")
  assert(ids(2).join() === "2", "then the rest")
}

// ── 8. Saved configs ──
{
  assert(DEFAULT_SCENE_SETTINGS.inventedScenes === false, "off by default")
  const old = packEngineConfig({ engine: "scenes", sceneSettings: { mix: "remix", clothing: "scene", scenery: "scene", extras: false } })
  assert(old.sceneSettings.inventedScenes === false, "a config saved before the option reads it off")
  const on = packEngineConfig({ engine: "scenes", sceneSettings: { ...DEFAULT_SCENE_SETTINGS, inventedScenes: true } })
  assert(on.sceneSettings.inventedScenes === true, "saved on, read on")
  const junk = packEngineConfig({ engine: "scenes", sceneSettings: { ...DEFAULT_SCENE_SETTINGS, inventedScenes: "yes" as unknown as boolean } })
  assert(junk.sceneSettings.inventedScenes === false, "anything but true reads off")
}

done()
