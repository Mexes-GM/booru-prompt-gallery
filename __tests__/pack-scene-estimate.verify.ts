/**
 * sceneEstimate (lib/pack/brief-pack.ts): the most scenes that can fit, read from the pool alone.
 * While it is below the count the builder keeps loading pages without working out the scenes that
 * fit (sceneCandidates) after each one, so it must never be below what sceneCandidates finds.
 * Real taxonomy snapshot, permanence data and measured tag relations.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-scene-estimate.verify.ts
 */
import fs from "fs"
import path from "path"
import { buildScenePool, type PackPeople } from "../lib/pack/scene/scene-pool"
import { createPermanence, type PermanenceData } from "../lib/pack/scene/permanence"
import { cleanSyntheticPrompt } from "../lib/pack/bulk-send"
import { parseTagRelations, setTagRelations, type TagRelationsFile } from "../lib/tag-relations"
import { DEFAULT_SCENE_SETTINGS, poseCompositions, sceneCandidates, tagKindsFromPosts, type ScenePackArgs } from "../lib/pack/scene-pack"
import { sceneEstimate } from "../lib/pack/brief-pack"
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

const requests = (over: Partial<SceneRequests>): SceneRequests => ({ select: [], wearing: [], where: [], also: [], literal: [], ...over })
const post = (id: number, tags: string) => makePost(id, tags, { rating: "general" })
const POSTS = [
  post(301, "1girl 1boy hetero princess_carry smile outdoors day park tree white_dress"),
  post(302, "1girl 1boy princess_carry blush open_mouth indoors bedroom bed pajamas"),
  post(303, "1girl 1boy princess_carry looking_at_another night street city jacket skirt"),
  post(304, "1girl 1boy princess_carry closed_eyes beach ocean sand swimsuit sunlight"),
  post(311, "2girls yuri princess_carry smile classroom indoors school_uniform desk window"),
  post(321, "1girl solo princess_carry cat smile kitchen indoors apron hair_ribbon"),
  post(331, "1girl 1boy hug standing smile snow outdoors coat scarf"),
  post(332, "1girl 1boy holding_hands walking cherry_blossoms outdoors day kimono"),
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
const clean = (tags: string[], locked: string[]) =>
  cleanSyntheticPrompt(tags, ["test heroine"], {
    excludeInput: "", addInput: "", includeCharacters: true, optimizeTags: false, smartTagExclusion: true, tagOverrides: overrides, lockedTags: locked,
  }, locked)
const args = (people: PackPeople, over: Partial<ScenePackArgs> = {}): ScenePackArgs => ({
  identity: ["test heroine", "long hair", "black hair", "red eyes"],
  alwaysAdd: [],
  people,
  subject: "girl",
  settings: DEFAULT_SCENE_SETTINGS,
  count: 1,
  seed: 1,
  overrides,
  clean,
  permanence,
  ...over,
})

/** sceneEstimate as the hook reads it, and what sceneCandidates finds (with the poses: those that have them). */
function both(people: PackPeople, select: string[], removed: number[] = [], mix: PackPeople[] = []) {
  const req = requests({ select })
  const pool = poolOf(people)
  const poses = poseCompositions(basePool, { requests: req, overrides, removedScenes: removed })
  const estimate = sceneEstimate({ scenes: pool.scenes, allScenes: pool.allScenes, people, mix, poses, hasPoses: select.length > 0, removed })
  const found = sceneCandidates(pool, args(people, { requests: req, removedScenes: removed, ...(mix.length >= 2 ? { compositions: mix } : {}) }))
  const fit = select.length > 0 ? found.filter((c) => c.hasPose).length : found.length
  return { estimate, fit, scenes: pool.scenes.length }
}

const ALONE = { girls: 1, boys: 0 }
const PAIR = { girls: 1, boys: 1 }

{
  const r = both(ALONE, [])
  assert(r.estimate === r.scenes, `no pose: every scene of the make-up (${r.estimate} of ${r.scenes})`)
  assert(r.estimate !== null && r.estimate >= r.fit, `never below the scenes that fit (${r.estimate} >= ${r.fit})`)
}
{
  const r = both(ALONE, [], [341, 342])
  assert(r.estimate === r.scenes - 2, `scenes left out don't count (${r.estimate})`)
  assert(r.estimate !== null && r.estimate >= r.fit, `never below the scenes that fit (${r.estimate} >= ${r.fit})`)
}
{
  const r = both(PAIR, ["princess carry"])
  assert(r.estimate === 4, `with a pose: the make-up's scenes that have it (${r.estimate})`)
  assert(r.estimate !== null && r.estimate >= r.fit && r.fit > 0, `never below the scenes that fit (${r.estimate} >= ${r.fit})`)
}
{
  const r = both(PAIR, ["princess carry"], [301])
  assert(r.estimate === 3 && r.estimate >= r.fit, `a scene with the pose left out (${r.estimate} >= ${r.fit})`)
}
{
  const r = both(ALONE, ["sitting"])
  assert(r.estimate !== null && r.estimate >= r.fit, `a plain posture alone (${r.estimate} >= ${r.fit})`)
}
{
  const r = both({ girls: 2, boys: 0 }, ["princess carry"])
  assert(r.estimate === 1 && r.estimate >= r.fit, `another make-up with the pose (${r.estimate} >= ${r.fit})`)
}
{
  // Several make-ups marked: the scenes of any of them.
  const r = both(ALONE, [], [], [ALONE, PAIR])
  const alone = both(ALONE, [])
  assert(r.estimate !== null && alone.estimate !== null && r.estimate > alone.estimate, `a mix counts both make-ups (${r.estimate} > ${alone.estimate})`)
  assert(r.estimate !== null && r.estimate >= r.fit, `never below the scenes that fit (${r.estimate} >= ${r.fit})`)
  const posed = both(PAIR, ["princess carry"], [], [PAIR, { girls: 2, boys: 0 }])
  assert(posed.estimate === 5 && posed.estimate >= posed.fit, `a mix with a pose: its scenes in each make-up (${posed.estimate} >= ${posed.fit})`)
}
{
  const base = { scenes: basePool.scenes, people: ALONE, poses: [], hasPoses: false, removed: [] }
  assert(sceneEstimate({ ...base, people: null }) === null, "no make-up yet: unknown")
  assert(sceneEstimate({ ...base, oneAxis: true }) === null, "a one-part pack: unknown")
  assert(sceneEstimate({ ...base, hasPoses: true }) === null, "poses the pool can't read: unknown")
  assert(sceneEstimate({ ...base, hasPoses: true, poses: [{ people: PAIR, scenes: 4 }] }) === 0, "poses only in another make-up: none in this one")
}

done()
