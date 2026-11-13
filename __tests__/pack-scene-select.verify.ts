/**
 * Tests for selected poses in the scenes engine (ScenePackArgs.requests.select): the pose picks the
 * scenes, and the composition comes from the scenes that have it. Real taxonomy snapshot,
 * permanence data and measured tag relations.
 *
 * Covers:
 *   1. poseCompositions counts the compositions of the scenes with the pose; an act that needs
 *      company leaves out a one-person scene that has the tag. defaultComposition and
 *      castComposition take them: the pose's most common composition wins over "the character
 *      alone"; the user's pick still wins.
 *   2. Prompts come only from scenes with the pose; preferred posts first; removed scenes never.
 *   3. The ladder: too few scenes -> those scenes again with other parts, then (a plain posture only)
 *      the pose imposed on other scenes, else a short pack; each step in `issues`; no prompt twice.
 *   4. A composition with no scene with the pose says so; the pose is never imposed.
 *   5. sceneCandidates lists the scenes in the order the pack uses them, as many as the pack can show.
 *   6. A selected tag stays even when the scene has a longer form of it ("reverse princess carry").
 *   7. Without the new fields nothing changes; reroll keeps to scenes with the pose; async = sync.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-scene-select.verify.ts
 */
import fs from "fs"
import path from "path"
import { buildScenePool, type PackPeople } from "../lib/pack/scene/scene-pool"
import { createPermanence, type PermanenceData } from "../lib/pack/scene/permanence"
import { cleanSyntheticPrompt } from "../lib/pack/bulk-send"
import { parseTagRelations, setTagRelations, type TagRelationsFile } from "../lib/tag-relations"
import {
  DEFAULT_SCENE_SETTINGS,
  castComposition,
  defaultComposition,
  generateScenePack,
  generateScenePackAsync,
  poseCompositions,
  poseNeedsScene,
  rerollScenePrompt,
  sceneCandidates,
  tagKindsFromPosts,
  type ScenePackArgs,
} from "../lib/pack/scene-pack"
import type { SceneRequests } from "../lib/pack/brief"
import { makeAssert, makePost } from "./fixtures/pack-scene-data"

const { assert, done } = makeAssert()
const root = path.join(__dirname, "..")
const CORE: Record<string, string> = JSON.parse(fs.readFileSync(path.join(root, "public/tags-core.json"), "utf8"))
const PERMANENCE: PermanenceData = JSON.parse(fs.readFileSync(path.join(root, "public/tag-permanence.json"), "utf8"))
const overrides: Record<string, string> = {}
for (const [tag, slot] of Object.entries(CORE)) overrides[tag.replace(/_/g, " ")] = slot
const permanence = createPermanence(PERMANENCE, overrides)
setTagRelations(parseTagRelations(JSON.parse(fs.readFileSync(path.join(root, "public/tag-relations.json"), "utf8")) as TagRelationsFile))

const tagsOf = (prompt: string) => prompt.split(",").map((t) => t.trim())
const requests = (over: Partial<SceneRequests>): SceneRequests => ({ select: [], wearing: [], where: [], also: [], literal: [], ...over })
const post = (id: number, tags: string) => makePost(id, tags, { rating: "general" })

const CARRY_PAIR = [301, 302, 303, 304, 305]
const POSTS = [
  // One girl and one boy, princess carry (305 also has the reverse form).
  post(301, "1girl 1boy hetero princess_carry smile outdoors day park tree white_dress"),
  post(302, "1girl 1boy princess_carry blush open_mouth indoors bedroom bed pajamas"),
  post(303, "1girl 1boy princess_carry looking_at_another night street city jacket skirt"),
  post(304, "1girl 1boy princess_carry closed_eyes beach ocean sand swimsuit sunlight"),
  post(305, "1girl 1boy princess_carry reverse_princess_carry laughing castle stairs wedding_dress veil"),
  // Two girls, princess carry.
  post(311, "2girls yuri princess_carry smile classroom indoors school_uniform desk window"),
  post(312, "2girls princess_carry blush forest outdoors grass hat sweater skirt"),
  // One person with the tag: not the pose that needs company.
  post(321, "1girl solo princess_carry cat smile kitchen indoors apron hair_ribbon"),
  // One girl and one boy without it.
  post(331, "1girl 1boy hug standing smile snow outdoors coat scarf"),
  post(332, "1girl 1boy holding_hands walking cherry_blossoms outdoors day kimono"),
  // One girl alone.
  post(341, "1girl solo standing smile looking_at_viewer bedroom indoors white_shirt pleated_skirt"),
  post(342, "1girl solo sitting blush beach outdoors ocean white_bikini earrings"),
  post(343, "1girl solo sitting chair classroom indoors school_uniform desk smile"),
  post(344, "1girl solo standing open_mouth park outdoors tree day blue_dress boots"),
  post(345, "1girl solo lying on_bed from_above bedroom indoors pajamas pillow"),
  post(346, "1girl solo standing arms_up night street city jacket jeans"),
]
const kinds = tagKindsFromPosts(POSTS)
const ctx = { overrides, permanence, subject: "girl" as const, tagKind: (tag: string) => kinds.get(tag) }
const basePool = buildScenePool(POSTS, ctx)
const poolOf = (people: PackPeople) => buildScenePool(POSTS, { ...ctx, people })
const pair = poolOf({ girls: 1, boys: 1 })
const alone = poolOf({ girls: 1, boys: 0 })

const clean = (tags: string[], locked: string[]) =>
  cleanSyntheticPrompt(tags, ["test heroine"], {
    excludeInput: "", addInput: "", includeCharacters: true, optimizeTags: false, smartTagExclusion: true, tagOverrides: overrides, lockedTags: locked,
  }, locked)
const args = (over: Partial<ScenePackArgs> = {}): ScenePackArgs => ({
  identity: ["test heroine", "long hair", "black hair", "red eyes"],
  alwaysAdd: [],
  people: { girls: 1, boys: 1 },
  subject: "girl",
  settings: DEFAULT_SCENE_SETTINGS,
  count: 3,
  seed: 5,
  overrides,
  clean,
  permanence,
  ...over,
})
const CARRY = requests({ select: ["princess carry"] })
const scenesOf = (prompts: Array<{ scene?: { postId: number } }>) => prompts.map((p) => p.scene?.postId ?? -1)

// ── 1. Compositions from the pose ──
{
  assert(poseNeedsScene("princess carry", overrides) && !poseNeedsScene("sitting", overrides), "an interaction needs a scene with it; a plain posture doesn't")
  const poses = poseCompositions(basePool, { requests: CARRY, overrides })
  const key = poses.map((c) => `${c.people.girls}/${c.people.boys}:${c.scenes}`).join(" ")
  assert(key === "1/1:5 2/0:2", "compositions of the scenes with the pose, most first, no one-person scene: " + key)
  assert(poseCompositions(basePool, { requests: CARRY, overrides, removedScenes: [301] })[0].scenes === 4, "removed scenes aren't counted")
  assert(poseCompositions(basePool, { requests: requests({}), overrides }).length === 0, "no selected pose, no list")
  const all = basePool.stats.compositions
  const base = { declared: null, character: true }
  assert(defaultComposition(all, "girl", null, base)?.boys === 0, "without the pose, the character alone (as before)")
  const chosen = defaultComposition(all, "girl", null, base, poses)
  assert(chosen?.girls === 1 && chosen.boys === 1, "with the pose, its most common composition: " + JSON.stringify(chosen))
  const picked = defaultComposition(all, "girl", { girls: 2, boys: 0 }, base, poses)
  assert(picked?.girls === 2 && picked.boys === 0, "the user's pick still wins")
  const cast = castComposition(all, { girls: 2, boys: 0 }, null, poses)
  assert(cast?.girls === 2 && cast.boys === 0, "a cast takes the pose's composition that holds it")
}

// ── 2. Scenes with the pose, preferred first, removed never ──
{
  const { prompts, issues } = generateScenePack(pair, args({ requests: CARRY }))
  assert(prompts.length === 3 && issues.length === 0, `a full pack with nothing to report (${prompts.length}, ${JSON.stringify(issues)})`)
  assert(scenesOf(prompts).every((id) => CARRY_PAIR.includes(id)), "every prompt from a scene with the pose: " + scenesOf(prompts).join())
  assert(prompts.every((p) => tagsOf(p.prompt).includes("princess carry") && !tagsOf(p.prompt).includes("solo")), "with the pose and two people")

  const preferred = generateScenePack(pair, args({ requests: CARRY, preferredPosts: [303, 304] }))
  assert(scenesOf(preferred.prompts).slice(0, 2).sort().join() === "303,304", "preferred posts first: " + scenesOf(preferred.prompts).join())
  const removed = generateScenePack(pair, args({ requests: CARRY, count: 10, removedScenes: [301, 302] }))
  assert(!scenesOf(removed.prompts).some((id) => id === 301 || id === 302), "removed scenes never: " + scenesOf(removed.prompts).join())
}

// ── 3. The ladder ──
{
  // Five scenes with the pose, eight prompts: those scenes again, then a short pack.
  const { prompts, issues } = generateScenePack(pair, args({ requests: CARRY, count: 8 }))
  assert(prompts.length > 5 && scenesOf(prompts).every((id) => CARRY_PAIR.includes(id)), "reuse only scenes with the pose: " + scenesOf(prompts).join())
  assert(new Set(prompts.map((p) => p.prompt)).size === prompts.length, "no prompt twice")
  const reused = issues.find((i) => i.kind === "scenes-reused")
  assert(!!reused && reused.kind === "scenes-reused" && reused.scenes === 5 && reused.prompts === prompts.length - new Set(scenesOf(prompts)).size, "reuse is reported: " + JSON.stringify(issues))
  const short = issues.find((i) => i.kind === "few-scenes")
  assert(prompts.length === 8 ? !short : !!short && short.kind === "few-scenes" && short.scenes === 5 && short.prompts === prompts.length, "a short pack says why: " + JSON.stringify(issues))
  assert(!issues.some((i) => i.kind === "pose-imposed"), "a pose that needs company is never imposed")

  // A plain posture: two scenes sitting; then again; then imposed on the others.
  const sit = generateScenePack(alone, args({ people: { girls: 1, boys: 0 }, requests: requests({ select: ["sitting"] }), count: 6 }))
  assert(sit.prompts.length === 6 && sit.prompts.every((p) => tagsOf(p.prompt).includes("sitting")), "six prompts, all sitting")
  assert(scenesOf(sit.prompts).slice(0, 2).every((id) => id === 342 || id === 343), "the scenes already sitting first: " + scenesOf(sit.prompts).join())
  const imposed = sit.issues.find((i) => i.kind === "pose-imposed")
  assert(!!imposed && imposed.kind === "pose-imposed" && imposed.tag === "sitting" && imposed.prompts === scenesOf(sit.prompts).filter((id) => id !== 342 && id !== 343).length, "imposing is reported: " + JSON.stringify(sit.issues))
  assert(sit.prompts.every((p) => !tagsOf(p.prompt).includes("standing") && !tagsOf(p.prompt).includes("lying")), "an imposed posture sends out the scene's")
}

// ── 4. A composition without the pose ──
{
  const { prompts, issues } = generateScenePack(alone, args({ people: { girls: 1, boys: 0 }, requests: CARRY }))
  assert(prompts.length === 0, "never imposed on one-person scenes")
  const other = issues.find((i) => i.kind === "composition-without-pose")
  assert(!!other && other.kind === "composition-without-pose" && other.people.boys === 0 && other.scenes === 7, "the composition has none; seven scenes elsewhere: " + JSON.stringify(issues))
  assert(issues.some((i) => i.kind === "few-scenes" && i.scenes === 0), "and the pack is empty for that reason")
}

// ── 5. Candidates ──
{
  const a = args({ requests: CARRY, preferredPosts: [304], removedScenes: [302] })
  const list = sceneCandidates(pair, a)
  const unlimited = generateScenePack(pair, { ...a, count: 100 })
  const order = Array.from(new Set(scenesOf(unlimited.prompts)))
  assert(list.map((c) => c.postId).join() === order.join(), `as many and in the order the pack uses them: ${list.map((c) => c.postId).join()} / ${order.join()}`)
  assert(list[0]?.postId === 304 && list[0].preferred && list.every((c) => c.hasPose && c.people?.boys === 1), "preferred first, with the pose, with who is in it")
  assert(!list.some((c) => c.postId === 302) && list.every((c) => !!c.preview), "removed left out; thumbnails there")
  const plain = sceneCandidates(alone, args({ people: { girls: 1, boys: 0 }, requests: requests({ select: ["sitting"] }) }))
  assert(plain.filter((c) => c.hasPose).map((c) => c.postId).sort().join() === "342,343" && plain.length > 2 && !plain[plain.length - 1].hasPose, "a plain posture: the scenes with it, then those it would be imposed on")
}

// ── 6. The selected tag stays next to a longer form ──
{
  const { prompts } = generateScenePack(pair, args({ requests: CARRY, count: 5 }))
  const reverse = prompts.find((p) => p.scene?.postId === 305)
  assert(!!reverse && tagsOf(reverse.prompt).includes("princess carry"), "princess carry stays though the scene says reverse princess carry: " + reverse?.prompt)
}

// ── 7. Nothing new asked, nothing changes; reroll; async ──
void (async () => {
  const before = generateScenePack(alone, args({ people: { girls: 1, boys: 0 }, count: 5 }))
  const empty = generateScenePack(alone, args({ people: { girls: 1, boys: 0 }, count: 5, preferredPosts: [], removedScenes: [] }))
  assert(before.prompts.map((p) => p.prompt).join("|") === empty.prompts.map((p) => p.prompt).join("|"), "empty preferred / removed lists change nothing")

  const a = args({ requests: CARRY, count: 3 })
  const pack = generateScenePack(pair, a)
  const replacement = rerollScenePrompt(pair, pack.prompts, 0, a)
  assert(!replacement || CARRY_PAIR.includes(replacement.scene?.postId ?? -1), "a reroll keeps to scenes with the pose: " + replacement?.scene?.postId)

  const b = args({ requests: CARRY, count: 8 })
  const sync = generateScenePack(pair, b)
  const async = await generateScenePackAsync(pair, b, { pause: () => Promise.resolve(), cancelled: () => false })
  assert(!!async && JSON.stringify(async.issues) === JSON.stringify(sync.issues) && async.prompts.map((p) => p.prompt).join("|") === sync.prompts.map((p) => p.prompt).join("|"), "async makes the same pack and issues")
  done()
})()
