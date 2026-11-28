/**
 * Tests for "Changes: only one thing" in the scenes engine (ScenePackArgs.changes): every prompt is
 * one base scene with only its outfit, pose, place or expression taken from another scene. Real
 * taxonomy snapshot, permanence data and measured tag relations.
 *
 * Covers:
 *   1. Without `changes` (or with 'scene') nothing changes.
 *   2. On each axis: the first prompt is the base as it is; every other prompt is the base with one
 *      donor; off the axis every prompt is the same; no value of the axis twice. The mix doesn't apply.
 *   3. A donor that contradicts what stays is skipped: a visible face on a picture from behind, an
 *      indoor place on an outdoor scene, an act that needs company in a picture of one.
 *   4. Requests still hold: one on the axis stays in every prompt, the donors vary the rest of the
 *      unit, and `axis-requested` says so.
 *   5. A short pack, never padded: `few-variations` says how many there are.
 *   6. baseScene picks the base; a removed or unknown one falls back to the default.
 *   7. sceneCandidates: the base, then the donors in the order the pack uses them.
 *   8. Reroll keeps the base and takes a donor the pack doesn't use yet; null when none is left.
 *   9. Async makes the same pack.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-scene-changes.verify.ts
 */
import fs from "fs"
import path from "path"
import { buildScenePool } from "../lib/pack/scene/scene-pool"
import { createPermanence, type PermanenceData } from "../lib/pack/scene/permanence"
import { cleanSyntheticPrompt } from "../lib/pack/bulk-send"
import { parseTagRelations, setTagRelations, type TagRelationsFile } from "../lib/tag-relations"
import { axisOfTag, type OneAxis } from "../lib/pack/scene/scene-axis"
import {
  DEFAULT_SCENE_SETTINGS,
  generateScenePack,
  generateScenePackAsync,
  rerollScenePrompt,
  sceneCandidates,
  tagKindsFromPosts,
  type ScenePackArgs,
} from "../lib/pack/scene-pack"
import type { PackPrompt } from "../lib/pack/pack-generator"
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

const FROM_BEHIND = 403
const OUTDOOR_BEACH = 402
const POSTS = [
  post(401, "1girl solo standing smile looking_at_viewer white_shirt pleated_skirt classroom indoors desk"),
  post(OUTDOOR_BEACH, "1girl solo sitting blush open_mouth beach outdoors ocean white_bikini sand"),
  post(FROM_BEHIND, "1girl solo standing from_behind kimono night street city outdoors"),
  post(404, "1girl solo kneeling crying tears school_uniform bedroom indoors bed"),
  post(405, "1girl solo squatting grin v hoodie jeans forest outdoors tree day"),
  post(406, "1girl solo arms_up surprised sundress forest outdoors grass day"),
  post(407, "1girl solo lying on_back closed_eyes pajamas bedroom indoors pillow bed"),
  post(408, "1girl solo walking pout maid kitchen indoors window"),
  post(409, "1girl solo crossed_arms smile open_mouth swimsuit beach outdoors ocean sky"),
  post(410, "1girl solo sitting wariza smile bikini sarong beach outdoors palm_tree"),
  post(411, "1girl solo sitting crossed_legs blush red_bikini beach outdoors sunset"),
  post(412, "1girl solo hug stuffed_toy smile pajamas bedroom indoors bed night"),
  post(413, "1girl solo sitting chair pout school_uniform classroom indoors window"),
]
const kinds = tagKindsFromPosts(POSTS)
const pool = buildScenePool(POSTS, { overrides, permanence, subject: "girl", tagKind: (tag: string) => kinds.get(tag), people: { girls: 1, boys: 0 } })

const clean = (tags: string[], locked: string[]) =>
  cleanSyntheticPrompt(tags, ["test heroine"], {
    excludeInput: "", addInput: "", includeCharacters: true, optimizeTags: false, smartTagExclusion: true, tagOverrides: overrides, lockedTags: locked,
  }, locked)
const args = (over: Partial<ScenePackArgs> = {}): ScenePackArgs => ({
  identity: ["test heroine", "long hair", "black hair", "red eyes"],
  alwaysAdd: [],
  people: { girls: 1, boys: 0 },
  subject: "girl",
  settings: DEFAULT_SCENE_SETTINGS,
  count: 5,
  seed: 3,
  overrides,
  clean,
  permanence,
  ...over,
})
const AXES: OneAxis[] = ["outfit", "pose", "place", "expression"]
const IDENTITY = new Set(["test heroine", "long hair", "black hair", "red eyes", "1girl", "solo"])
/** The donor of a one-axis prompt (null for the base as it is). */
const donorOf = (p: PackPrompt) => (p.scene?.donors ?? []).find((id) => id !== p.scene?.postId) ?? null
/** A prompt's tags off the axis, and on it. */
const off = (p: PackPrompt, axis: OneAxis) => tagsOf(p.prompt).filter((t) => axisOfTag(t, overrides) !== axis).sort().join("|")
const on = (p: PackPrompt, axis: OneAxis) => tagsOf(p.prompt).filter((t) => axisOfTag(t, overrides) === axis && !IDENTITY.has(t)).sort().join("|")

// ── 1. Nothing new asked, nothing changes ──
{
  const before = generateScenePack(pool, args())
  const scene = generateScenePack(pool, args({ changes: "scene" }))
  assert(before.prompts.length === 5 && before.prompts.map((p) => p.prompt).join("\n") === scene.prompts.map((p) => p.prompt).join("\n"), "changes 'scene' is the plain pack")
  assert(new Set(before.prompts.map((p) => p.scene?.postId)).size === 5, "the plain pack: every prompt another scene")
}

// ── 2. One axis ──
for (const axis of AXES) {
  const { prompts, shortBy, issues } = generateScenePack(pool, args({ changes: axis }))
  assert(prompts.length >= 3, `${axis}: a pack (${prompts.length}, ${JSON.stringify(issues)})`)
  assert(prompts.length + shortBy === 5, `${axis}: shortBy counts what is missing`)
  const base = prompts[0]?.scene?.postId
  assert(prompts.every((p) => p.scene?.postId === base), `${axis}: one base for the whole pack`)
  assert(donorOf(prompts[0]) === null && prompts.slice(1).every((p) => donorOf(p) !== null), `${axis}: the base as it is first, then one donor each`)
  assert(new Set(prompts.slice(1).map(donorOf)).size === prompts.length - 1, `${axis}: every donor once`)
  assert(prompts.every((p) => off(p, axis) === off(prompts[0], axis)), `${axis}: off the axis every prompt is the base: ${prompts.map((p) => p.prompt).join(" || ")}`)
  assert(new Set(prompts.map((p) => on(p, axis))).size === prompts.length, `${axis}: no value of the axis twice: ${prompts.map((p) => on(p, axis)).join(" / ")}`)
  const remix = generateScenePack(pool, args({ changes: axis, settings: { ...DEFAULT_SCENE_SETTINGS, mix: "remix" } }))
  assert(remix.prompts.map((p) => p.prompt).join("\n") === prompts.map((p) => p.prompt).join("\n"), `${axis}: the mix doesn't apply`)
}
{
  // The outfit takes what it shows of the body with it.
  const { prompts } = generateScenePack(pool, args({ changes: "outfit", baseScene: 409, count: 13 }))
  const bikini = prompts.find((p) => donorOf(p) === 410)
  assert(!!bikini && tagsOf(bikini.prompt).includes("sarong") && !tagsOf(bikini.prompt).includes("swimsuit"), "the donor's outfit replaces the base's: " + bikini?.prompt)
}

// ── 3. A donor that contradicts what stays is skipped ──
{
  const behind = generateScenePack(pool, args({ changes: "expression", baseScene: FROM_BEHIND, count: 13 }))
  assert(behind.prompts.every((p) => tagsOf(p.prompt).includes("from behind")), "the base from behind stays")
  assert(behind.prompts.length === 1, "no expression is lent to a picture that hides the face: " + behind.prompts.map((p) => p.prompt).join(" || "))
  assert(behind.issues.some((i) => i.kind === "few-variations" && i.variations === 1), "and the pack says it is short: " + JSON.stringify(behind.issues))
  const def = generateScenePack(pool, args({ changes: "expression", count: 3 }))
  assert(def.prompts[0]?.scene?.postId !== FROM_BEHIND && def.prompts.length === 3, "the default base for the expression shows the face")
  const outdoor = generateScenePack(pool, args({ changes: "place", baseScene: OUTDOOR_BEACH, count: 13 }))
  assert(outdoor.prompts.length >= 2, "an outdoor base gets other places")
  assert(!outdoor.prompts.some((p) => tagsOf(p.prompt).includes("indoors")), "never an indoor place on an outdoor scene: " + outdoor.prompts.map((p) => p.prompt).join(" || "))
  const poses = generateScenePack(pool, args({ changes: "pose", count: 13 }))
  assert(!poses.prompts.some((p) => tagsOf(p.prompt).includes("hug")), "no act that needs company on a picture of one")
  assert(!poses.prompts.some((p) => donorOf(p) === 412), "the donor with it is skipped, not patched")
}

// ── 4. Requests still hold ──
{
  const outfit = generateScenePack(pool, args({ changes: "outfit", requests: requests({ wearing: ["bikini"] }), count: 13 }))
  assert(outfit.prompts.length >= 3 && outfit.prompts.every((p) => tagsOf(p.prompt).includes("bikini")), "Wearing with only the outfit: the garment in every prompt")
  assert(outfit.prompts.slice(1).every((p) => [OUTDOOR_BEACH, 410, 411].includes(donorOf(p) ?? -1)), "the donors already wear it: " + outfit.prompts.map(donorOf).join())
  const said = outfit.issues.find((i) => i.kind === "axis-requested")
  assert(!!said && said.kind === "axis-requested" && said.axis === "outfit" && said.tags.join() === "bikini", "and the result says so: " + JSON.stringify(outfit.issues))

  const pose = generateScenePack(pool, args({ changes: "pose", requests: requests({ select: ["sitting"] }), count: 13 }))
  assert(pose.prompts.length >= 3 && pose.prompts.every((p) => tagsOf(p.prompt).includes("sitting")), "Doing with only the pose: the pose in every prompt")
  assert(pose.prompts.every((p) => [OUTDOOR_BEACH, 410, 411, 413].includes(donorOf(p) ?? p.scene?.postId ?? -1)), "base and donors have the pose: " + pose.prompts.map((p) => donorOf(p) ?? p.scene?.postId).join())
  assert(pose.issues.some((i) => i.kind === "axis-requested" && i.axis === "pose" && i.tags.includes("sitting")), "axis-requested for the pose")

  const place = generateScenePack(pool, args({ changes: "place", requests: requests({ where: ["beach"] }), count: 13 }))
  assert(place.prompts.length >= 3 && place.prompts.every((p) => tagsOf(p.prompt).includes("beach")), "Where with only the place: the place in every prompt")
  assert(new Set(place.prompts.map((p) => on(p, "place"))).size === place.prompts.length, "the donors vary the rest of the place: " + place.prompts.map((p) => on(p, "place")).join(" / "))

  const face = generateScenePack(pool, args({ changes: "expression", requests: requests({ also: ["smile"] }), count: 13 }))
  assert(face.prompts.length >= 2 && face.prompts.every((p) => tagsOf(p.prompt).includes("smile")), "an expression asked with only the expression: in every prompt")
  assert(!face.prompts.some((p) => tagsOf(p.prompt).includes("crying")), "no donor face against it")
  assert(face.issues.some((i) => i.kind === "axis-requested" && i.axis === "expression"), "axis-requested for the expression")

  const elsewhere = generateScenePack(pool, args({ changes: "expression", requests: requests({ where: ["beach"] }) }))
  assert(elsewhere.prompts.every((p) => tagsOf(p.prompt).includes("beach")) && !elsewhere.issues.some((i) => i.kind === "axis-requested"), "a request off the axis is imposed as usual and not reported")
}

// ── 5. Short, never padded ──
{
  const { prompts, shortBy, issues } = generateScenePack(pool, args({ changes: "outfit", requests: requests({ wearing: ["bikini"] }), count: 20 }))
  const few = issues.find((i) => i.kind === "few-variations")
  assert(shortBy === 20 - prompts.length && shortBy > 0, "the pack is short")
  assert(!!few && few.kind === "few-variations" && few.axis === "outfit" && few.variations === prompts.length && few.prompts === prompts.length, "few-variations says how many: " + JSON.stringify(issues))
  const full = generateScenePack(pool, args({ changes: "outfit", count: 3 }))
  assert(!full.issues.some((i) => i.kind === "few-variations"), "a full pack says nothing")
}

// ── 6. baseScene ──
{
  const picked = generateScenePack(pool, args({ changes: "pose", baseScene: 405 }))
  assert(picked.prompts[0]?.scene?.postId === 405, "the picked base")
  const def = generateScenePack(pool, args({ changes: "pose" })).prompts[0]?.scene?.postId
  assert(generateScenePack(pool, args({ changes: "pose", baseScene: 405, removedScenes: [405] })).prompts[0]?.scene?.postId === def, "a removed base falls back to the default")
  assert(generateScenePack(pool, args({ changes: "pose", baseScene: 99999 })).prompts[0]?.scene?.postId === def, "an unknown one too")
  const removed = generateScenePack(pool, args({ changes: "pose", baseScene: 405, removedScenes: [401, 406], count: 13 }))
  assert(!removed.prompts.some((p) => [401, 406].includes(donorOf(p) ?? -1)), "a removed scene never lends")
}

// ── 7. Candidates ──
{
  const a = args({ changes: "expression", baseScene: 401 })
  const list = sceneCandidates(pool, a)
  const unlimited = generateScenePack(pool, { ...a, count: 100 })
  const used = unlimited.prompts.map((p) => donorOf(p) ?? p.scene?.postId)
  assert(list.map((c) => c.postId).join() === used.join(), `the base, then the donors in the order the pack uses them: ${list.map((c) => c.postId).join()} / ${used.join()}`)
  assert(list[0]?.axisRole === "base" && list.slice(1).every((c) => c.axisRole === "donor"), "base and donors told apart")
  assert(unlimited.prompts.length === list.length && unlimited.shortBy === 100 - list.length, "its length is the most prompts the pack can make")
}

// ── 8. Reroll ──
void (async () => {
  const a = args({ changes: "expression", baseScene: 401, count: 3 })
  const pack = generateScenePack(pool, a).prompts
  const used = new Set(pack.map(donorOf))
  const replacement = rerollScenePrompt(pool, pack, 1, { ...a, seed: 77 })
  assert(!!replacement && replacement.scene?.postId === 401 && !used.has(donorOf(replacement)) && !pack.some((p) => on(p, "expression") === on(replacement, "expression")), "a reroll: same base, a new donor, a new face: " + replacement?.prompt)
  const first = rerollScenePrompt(pool, pack, 0, a)
  assert(!!first && first.scene?.postId === 401 && donorOf(first) !== null, "rerolling the base's own row keeps the base")
  const all = generateScenePack(pool, { ...a, count: 100 }).prompts
  assert(rerollScenePrompt(pool, all, 1, a) === null, "null when no donor is left")

  // ── 9. Async ──
  const b = args({ changes: "place", requests: requests({ where: ["beach"] }), count: 13 })
  const sync = generateScenePack(pool, b)
  const async = await generateScenePackAsync(pool, b, { pause: () => Promise.resolve(), cancelled: () => false })
  assert(!!async && JSON.stringify(async.issues) === JSON.stringify(sync.issues) && async.prompts.map((p) => p.prompt).join("|") === sync.prompts.map((p) => p.prompt).join("|"), "async makes the same pack and issues")
  done()
})()
