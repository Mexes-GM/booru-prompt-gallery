/**
 * Tests for packs that mix several compositions (ScenePackArgs.compositions).
 *
 * Covers:
 *   M1. One composition in the list, or none: the pack is exactly the pack of `people`.
 *   M2. Two compositions: prompts from scenes of both; each prompt's people-count header is its
 *       base scene's; pairing from that scene.
 *   M3. What depends on how many people there are stays with the scene: a selected act keeps the
 *       scene's own composition; "Always add" count tags only where they fit the prompt's scene.
 *   M4. mixedCompositions: a composition that can't hold the character is left out; fewer than two
 *       left is a pack of one composition. poolForCompositions: the scenes of every chosen one.
 *   M5. Remix lends clothes only between scenes of the same people; sceneCandidates lists both.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-scene-mix.verify.ts
 */
import fs from "fs"
import path from "path"
import { buildScenePool } from "../lib/pack/scene/scene-pool"
import { createPermanence, type PermanenceData } from "../lib/pack/scene/permanence"
import { cleanSyntheticPrompt } from "../lib/pack/bulk-send"
import { parseTagRelations, setTagRelations, type TagRelationsFile } from "../lib/tag-relations"
import type { SceneRequests } from "../lib/pack/brief"
import {
  DEFAULT_SCENE_SETTINGS,
  generateScenePack,
  mixedCompositions,
  poolForCompositions,
  sceneCandidates,
  tagKindsFromPosts,
  type ScenePackArgs,
} from "../lib/pack/scene-pack"
import { makeAssert, makePost } from "./fixtures/pack-scene-data"

const { assert, done } = makeAssert()
const root = path.join(__dirname, "..")
const CORE: Record<string, string> = JSON.parse(fs.readFileSync(path.join(root, "public/tags-core.json"), "utf8"))
const overrides: Record<string, string> = {}
for (const [tag, slot] of Object.entries(CORE)) overrides[tag.replace(/_/g, " ")] = slot
const permanence = createPermanence(JSON.parse(fs.readFileSync(path.join(root, "public/tag-permanence.json"), "utf8")) as PermanenceData, overrides)
setTagRelations(parseTagRelations(JSON.parse(fs.readFileSync(path.join(root, "public/tag-relations.json"), "utf8")) as TagRelationsFile))
const tagsOf = (prompt: string) => prompt.split(",").map((t) => t.trim())
const requests = (over: Partial<SceneRequests>): SceneRequests => ({ select: [], wearing: [], where: [], also: [], literal: [], ...over })
const clean = (tags: string[], locked: string[]) =>
  cleanSyntheticPrompt(tags, ["test heroine"], { excludeInput: "", addInput: "", includeCharacters: true, optimizeTags: false, smartTagExclusion: true, tagOverrides: overrides, lockedTags: locked }, locked)

const PAIR = { girls: 1, boys: 1 }
const TRIO = { girls: 1, boys: 2 }
const POSTS = [
  makePost(1, "1girl 1boy hetero hug standing white_dress park outdoors smile day"),
  makePost(2, "1girl 1boy hetero princess_carry crop_top black_skirt street outdoors blush"),
  makePost(3, "1girl 1boy hetero holding_hands sitting sundress beach outdoors open_mouth"),
  makePost(4, "1girl 2boys hetero group_hug standing school_uniform classroom indoors smile"),
  makePost(5, "1girl 2boys hetero princess_carry kimono shrine outdoors closed_eyes blush day from_side"),
  makePost(6, "1girl 2boys hetero sitting maid kitchen indoors looking_at_viewer blush"),
  makePost(7, "1girl solo standing bikini beach outdoors smile day"),
]
const kinds = tagKindsFromPosts(POSTS)
const pool = buildScenePool(POSTS, { overrides, permanence, subject: "girl", tagKind: (tag: string) => kinds.get(tag), people: PAIR })
function args(over: Partial<ScenePackArgs> = {}): ScenePackArgs {
  return { identity: ["test heroine", "long hair"], alwaysAdd: [], people: PAIR, subject: "girl", settings: DEFAULT_SCENE_SETTINGS, count: 6, seed: 4, overrides, clean, permanence, ...over }
}
const countsOf = (prompt: string) => {
  const tags = tagsOf(prompt)
  const g = tags.find((t) => /^\dgirls?$/.test(t)) ?? ""
  const b = tags.find((t) => /^\dboys?$/.test(t)) ?? ""
  return `${parseInt(g) || 0}g${parseInt(b) || 0}b`
}
const sceneKey = new Map((pool.allScenes ?? []).map((s) => [s.postId, s.people ? `${s.people.girls}g${s.people.boys}b` : "open"]))

// ── M1 ───────────────────────────────────────────────────────────────────────
{
  const plain = generateScenePack(pool, args())
  const one = generateScenePack(pool, args({ compositions: [PAIR] }))
  assert(plain.prompts.map((p) => p.prompt).join("\n") === one.prompts.map((p) => p.prompt).join("\n"), "M1: one composition in the list is the pack of `people`")
  assert(plain.prompts.every((p) => countsOf(p.prompt) === "1g1b"), "M1: a pack of one composition")
}
// ── M2 ───────────────────────────────────────────────────────────────────────
{
  const mixed = generateScenePack(pool, args({ compositions: [PAIR, TRIO] }))
  const comps = mixed.prompts.map((p) => sceneKey.get(p.scene!.postId))
  assert(mixed.prompts.length === 6 && comps.includes("1g1b") && comps.includes("1g2b"), `M2: prompts of both compositions (${comps.join(", ")})`)
  assert(mixed.prompts.every((p) => countsOf(p.prompt) === sceneKey.get(p.scene!.postId)), "M2: each header is its base scene's")
  assert(mixed.prompts.every((p) => !tagsOf(p.prompt).includes("solo")), "M2: no prompt of the solo scene")
}
// ── M3 ───────────────────────────────────────────────────────────────────────
{
  const act = generateScenePack(pool, args({ compositions: [PAIR, TRIO], requests: requests({ select: ["princess carry"] }) }))
  assert(act.prompts.length > 0 && act.prompts.every((p) => countsOf(p.prompt) === sceneKey.get(p.scene!.postId)), "M3: with an act, each prompt keeps its scene's people")
  const carriers = act.prompts.filter((p) => [2, 5].includes(p.scene!.postId)).map((p) => sceneKey.get(p.scene!.postId))
  assert(carriers.includes("1g1b") && carriers.includes("1g2b"), "M3: the act's scenes of both compositions are used")
  const always = generateScenePack(pool, args({ compositions: [PAIR, TRIO], alwaysAdd: ["2boys", "masterpiece"] }))
  assert(always.prompts.every((p) => tagsOf(p.prompt).includes("masterpiece")), "M3: other Always add tags in every prompt")
  assert(always.prompts.every((p) => tagsOf(p.prompt).includes("2boys") === (sceneKey.get(p.scene!.postId) === "1g2b")), "M3: an Always add count only where the prompt's scene has it")
}
// ── M4 ───────────────────────────────────────────────────────────────────────
{
  assert(mixedCompositions({ compositions: [PAIR, TRIO], subject: "girl" })?.length === 2, "M4: two compositions with a girl")
  assert(mixedCompositions({ compositions: [PAIR, { girls: 0, boys: 2 }], subject: "girl" }) === null, "M4: one without the character's gender leaves a pack of one")
  assert(mixedCompositions({ compositions: [PAIR, { girls: 1, boys: 0 }], subject: "girl", castSize: 2 }) === null, "M4: one too small for the cast is left out")
  assert(mixedCompositions({ compositions: [PAIR, PAIR], subject: "girl" }) === null, "M4: the same one twice is one")
  const wide = poolForCompositions(pool, { compositions: [PAIR, TRIO], subject: "girl", overrides })
  assert(wide.scenes.length === 6 && wide.situations.reduce((n, s) => n + s.sceneIds.length, 0) === 6, "M4: the scenes of both, in situations")
  assert(poolForCompositions(pool, { compositions: [PAIR], subject: "girl", overrides }) === pool, "M4: the same pool for one")
}
// ── M5 ───────────────────────────────────────────────────────────────────────
{
  const remix = generateScenePack(pool, args({ compositions: [PAIR, TRIO], settings: { ...DEFAULT_SCENE_SETTINGS, mix: "remix" }, count: 12 }))
  const byId = new Map((pool.allScenes ?? []).map((s) => [s.postId, s]))
  assert(remix.prompts.every((p) => countsOf(p.prompt) === sceneKey.get(p.scene!.postId)), "M5: Remix keeps each prompt's header")
  const crossed = remix.prompts.filter((p) => {
    const base = byId.get(p.scene!.postId)!
    return (p.scene!.donors ?? []).filter((id) => id !== base.postId).some((id) => {
      const donor = byId.get(id)!
      const outfit = donor.units.outfit.filter((t) => tagsOf(p.prompt).includes(t) && !base.units.outfit.includes(t))
      return outfit.length > 0 && sceneKey.get(id) !== sceneKey.get(base.postId)
    })
  })
  assert(crossed.length === 0, "M5: no outfit lent across compositions in Remix")
  const listed = sceneCandidates(pool, args({ compositions: [PAIR, TRIO] }))
  assert(listed.some((c) => c.people?.boys === 1) && listed.some((c) => c.people?.boys === 2), "M5: sceneCandidates lists the scenes of both, with their people")
}

done()
