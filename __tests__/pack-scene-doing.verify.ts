/**
 * Tests for what goes in "Doing" (lib/pack/brief.ts routeTag, ScenePackArgs.requests.select): a
 * posture and an activity behave the same, and an imposed one sends out what of the scene's pose
 * contradicts it. Real taxonomy snapshot, permanence data and measured tag relations.
 *
 * Covers:
 *   1. routeTag: an action the taxonomy files with the hand objects ("reading", "carrying") goes to
 *      "doing"; the objects themselves ("book", "holding sword") stay "also".
 *   2. contradictsImposedPose: actions of the whole body (combat, movement) go; hand gestures go for
 *      an action done with something in the hand, and what can't go with holding something; a
 *      posture the relations set against the imposed one goes; compatible postures and forms of
 *      the pose stay; tags outside the pose are never touched.
 *   3. An activity takes the ladder like a posture: the scenes with it first, then once more, then
 *      imposed on the others with `pose-imposed` and its exact count; no imposed prompt keeps a
 *      combat or movement tag or a busy-hand gesture; a scene that has the activity keeps its own pose.
 *   4. Hosts whose pose has nothing against the request come before the others (sceneCandidates).
 *   5. A posture imposed on a scene of movement sends the movement out and keeps the arms.
 *   6. Async = sync; reroll keeps the rule.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-scene-doing.verify.ts
 */
import fs from "fs"
import path from "path"
import { buildScenePool } from "../lib/pack/scene/scene-pool"
import { createPermanence, type PermanenceData } from "../lib/pack/scene/permanence"
import { cleanSyntheticPrompt } from "../lib/pack/bulk-send"
import { parseTagRelations, setTagRelations, type TagRelationsFile } from "../lib/tag-relations"
import { routeTag, type SceneRequests } from "../lib/pack/brief"
import {
  DEFAULT_SCENE_SETTINGS,
  contradictsImposedPose,
  generateScenePack,
  generateScenePackAsync,
  rerollScenePrompt,
  sceneCandidates,
  tagKindsFromPosts,
  type ScenePackArgs,
} from "../lib/pack/scene-pack"
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

const READERS = [401, 408]
const CLEAN = [404, 405]
const POSTS = [
  // Reading: one sitting, one walking (a real scene keeps its own pose).
  post(401, "1girl solo reading book sitting library indoors smile cardigan"),
  post(408, "1girl solo reading book walking street outdoors day hoodie"),
  // Hosts with nothing against reading.
  post(404, "1girl solo standing smile bedroom indoors white_shirt looking_at_viewer"),
  post(405, "1girl solo sitting chair classroom indoors school_uniform blush"),
  // Hosts with a body action or busy hands.
  post(402, "1girl solo fighting_stance clenched_hands standing street outdoors night jacket"),
  post(403, "1girl solo walking open_mouth street outdoors day blue_dress"),
  post(406, "1girl solo stretching arms_up standing bedroom indoors pajamas"),
  post(407, "1girl solo hands_in_pockets standing night street outdoors coat"),
]
const kinds = tagKindsFromPosts(POSTS)
const alone = buildScenePool(POSTS, { overrides, permanence, subject: "girl", tagKind: (tag: string) => kinds.get(tag), people: { girls: 1, boys: 0 } })

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
  count: 8,
  seed: 3,
  overrides,
  clean,
  permanence,
  ...over,
})
const READING = requests({ select: ["reading"] })
const scenesOf = (prompts: Array<{ scene?: { postId: number } }>) => prompts.map((p) => p.scene?.postId ?? -1)
/** Tags of combat, movement or hand gestures in a prompt. */
const bodyActions = (prompt: string) => tagsOf(prompt).filter((tag) => /^pose:(combat|kinetic|gesture)$/.test(overrides[tag] ?? ""))

// ── 1. Routing ──
{
  const role = (tag: string) => { const r = routeTag(tag, overrides); return r.kind === "request" ? r.role : r.kind }
  assert(role("reading") === "doing" && role("carrying") === "doing", "an action filed with the hand objects is doing: " + role("reading") + " " + role("carrying"))
  assert(role("book") === "also" && role("holding sword") === "also" && role("umbrella") === "also", "an object stays also")
  assert(role("sitting") === "doing" && role("stretching") === "doing" && role("fighting stance") === "doing", "postures and actions as before")
  assert(role("smile") === "also" && role("beach") === "where", "expressions and places as before")
}

// ── 2. The rule ──
{
  const against = (tag: string, pose: string) => contradictsImposedPose(tag, [pose], overrides)
  assert(against("fighting stance", "reading") && against("walking", "reading") && against("stretching", "sitting"), "combat and movement give way to the imposed pose")
  assert(against("clenched hands", "reading") && against("hands in pockets", "reading"), "busy hands: the hand gestures go for reading")
  assert(against("arms behind back", "reading"), "what can't go with holding something goes for reading")
  assert(!against("clenched hands", "sitting"), "a hand gesture stays with a posture")
  assert(against("standing", "sitting") && !against("standing", "reading") && !against("sitting", "reading"), "a posture goes only when set against the imposed one")
  assert(!against("arms up", "sitting"), "the arms stay with sitting")
  assert(!against("stretching", "stretching") && !against("walking", "walking"), "the pose itself is not against itself")
  assert(!against("smile", "reading") && !against("street", "reading") && !against("book", "reading"), "tags outside the pose are never touched")
  assert(!contradictsImposedPose("walking", [], overrides), "nothing imposed, nothing displaced")
}

// ── 3. An activity takes the ladder ──
{
  const { prompts, issues } = generateScenePack(alone, args({ requests: READING }))
  assert(prompts.length === 8 && prompts.every((p) => tagsOf(p.prompt).includes("reading")), "eight prompts, all reading: " + prompts.length)
  const scenes = scenesOf(prompts)
  assert(scenes.slice(0, 2).every((id) => READERS.includes(id)), "the scenes with reading first: " + scenes.join())
  const imposedCount = scenes.filter((id) => !READERS.includes(id)).length
  const imposed = issues.find((i) => i.kind === "pose-imposed")
  assert(imposedCount > 0 && !!imposed && imposed.kind === "pose-imposed" && imposed.tag === "reading" && imposed.prompts === imposedCount, `imposing is reported with its count (${imposedCount}): ${JSON.stringify(issues)}`)
  const reused = issues.find((i) => i.kind === "scenes-reused")
  assert(!!reused && reused.kind === "scenes-reused" && reused.scenes === 2, "the scenes with reading come back once before imposing: " + JSON.stringify(issues))
  const bad = prompts.filter((p, i) => !READERS.includes(scenes[i]) && bodyActions(p.prompt).length > 0)
  assert(bad.length === 0, "no imposed prompt keeps combat, movement or a hand gesture: " + bad.map((p) => p.prompt).join(" | "))
  const walker = prompts.find((p) => p.scene?.postId === 408)
  assert(!!walker && tagsOf(walker.prompt).includes("walking"), "a scene that has reading keeps its own pose: " + walker?.prompt)
  assert(new Set(prompts.map((p) => p.prompt)).size === prompts.length, "no prompt twice")
}

// ── 4. Hosts with nothing against the request first ──
{
  const list = sceneCandidates(alone, args({ requests: READING }))
  const order = list.map((c) => c.postId)
  assert(order.slice(0, 2).every((id) => READERS.includes(id)) && list.slice(0, 2).every((c) => c.hasPose), "the scenes with reading first: " + order.join())
  assert(order.slice(2, 4).sort().join() === CLEAN.join(), "then the hosts with nothing against it: " + order.join())
  assert(order.length === POSTS.length, "then the others, every scene once: " + order.join())
}

// ── 5. A posture imposed on a scene of movement ──
{
  const sit = generateScenePack(alone, args({ requests: requests({ select: ["sitting"] }), count: 12 }))
  const stretch = sit.prompts.find((p) => p.scene?.postId === 406)
  assert(!!stretch && tagsOf(stretch.prompt).includes("sitting") && !tagsOf(stretch.prompt).includes("stretching") && !tagsOf(stretch.prompt).includes("standing"), "sitting sends out the stretch and the standing: " + stretch?.prompt)
  assert(!!stretch && tagsOf(stretch.prompt).includes("arms up"), "and keeps the arms: " + stretch?.prompt)
  const fight = sit.prompts.find((p) => p.scene?.postId === 402)
  assert(!!fight && !tagsOf(fight.prompt).includes("fighting stance") && tagsOf(fight.prompt).includes("clenched hands"), "a fight loses its stance, keeps the fists: " + fight?.prompt)
  const imposed = sit.issues.find((i) => i.kind === "pose-imposed")
  assert(!!imposed && imposed.kind === "pose-imposed" && imposed.prompts === scenesOf(sit.prompts).filter((id) => id !== 401 && id !== 405).length, "the count is exact: " + JSON.stringify(sit.issues))
}

// ── 6. Async and reroll ──
async function asyncChecks() {
  const a = args({ requests: READING })
  const sync = generateScenePack(alone, a)
  const later = await generateScenePackAsync(alone, a, { pause: async () => {}, cancelled: () => false })
  assert(!!later && later.prompts.map((p) => p.prompt).join("\n") === sync.prompts.map((p) => p.prompt).join("\n") && JSON.stringify(later.issues) === JSON.stringify(sync.issues), "async = sync")
  const row = scenesOf(sync.prompts).findIndex((id) => !READERS.includes(id))
  const next = rerollScenePrompt(alone, sync.prompts, row, a)
  assert(!!next && tagsOf(next.prompt).includes("reading"), "a reroll keeps the activity: " + next?.prompt)
  assert(!next || READERS.includes(next.scene?.postId ?? -1) || bodyActions(next.prompt).length === 0, "and an imposed reroll keeps no body action against it: " + next?.prompt)
}

asyncChecks().then(done)
