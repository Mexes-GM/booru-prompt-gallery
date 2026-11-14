/**
 * Correcting a pack from its results (INT-4): with the same seed and the same scenes, an
 * Always or Never on one tag recomposes the pack and leaves alone the rows it doesn't
 * touch. Measured on the engine as it is (no change to its interface), with the app's
 * real taxonomy and permanence data.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-brief-correct.verify.ts
 */
import fs from "fs"
import path from "path"
import assert from "node:assert/strict"
import { buildScenePool } from "../lib/pack/scene/scene-pool"
import { createPermanence, type PermanenceData } from "../lib/pack/scene/permanence"
import { cleanSyntheticPrompt } from "../lib/pack/bulk-send"
import { DEFAULT_SCENE_SETTINGS, generateScenePack, tagKindsFromPosts, type ScenePackArgs } from "../lib/pack/scene-pack"
import type { SceneRequests } from "../lib/pack/brief"
import { makePost } from "./fixtures/pack-scene-data"
import { placeRows } from "../lib/pack/brief-pack"

const root = path.join(__dirname, "..")
const CORE: Record<string, string> = JSON.parse(fs.readFileSync(path.join(root, "public/tags-core.json"), "utf8"))
const PERMANENCE: PermanenceData = JSON.parse(fs.readFileSync(path.join(root, "public/tag-permanence.json"), "utf8"))
const overrides: Record<string, string> = {}
for (const [tag, slot] of Object.entries(CORE)) overrides[tag.replace(/_/g, " ")] = slot
const permanence = createPermanence(PERMANENCE, overrides)

const scene = (id: number, tags: string) => makePost(id, tags, { rating: "general" })
const POSTS = [
  scene(101, "1girl solo standing smile looking_at_viewer bedroom bed indoors white_shirt pleated_skirt"),
  scene(102, "1girl solo standing blush looking_at_viewer park outdoors tree day blue_dress boots"),
  scene(103, "1girl solo standing closed_eyes from_side street outdoors night jacket jeans"),
  scene(104, "1girl solo sitting smile looking_at_viewer classroom indoors chair desk shirt skirt"),
  scene(105, "1girl solo sitting open_mouth from_above cafe indoors table cup sweater skirt"),
  scene(106, "1girl solo sitting crossed_legs looking_at_viewer couch indoors living_room shirt shorts"),
  scene(107, "1girl solo lying on_back smile from_above bed bedroom indoors pajamas pillow"),
  scene(108, "1girl solo lying on_stomach looking_at_viewer grass outdoors flower day dress"),
  scene(109, "1girl solo lying on_side closed_eyes bed indoors blanket shirt"),
]
const pool = buildScenePool(POSTS, { overrides, permanence, subject: "girl", tagKind: (tag) => tagKindsFromPosts(POSTS).get(tag) })

const clean = (tags: string[], locked: string[]) =>
  cleanSyntheticPrompt(tags, ["my character"], {
    excludeInput: "", addInput: "", includeCharacters: true, optimizeTags: false, smartTagExclusion: true, tagOverrides: overrides, lockedTags: locked,
  }, locked)
const requests = (over: Partial<SceneRequests> = {}): SceneRequests => ({ select: [], wearing: [], where: [], also: [], literal: [], ...over })
const args = (over: Partial<ScenePackArgs> = {}): ScenePackArgs => ({
  identity: ["my character", "long hair", "blue hair"],
  alwaysAdd: [],
  subject: "girl",
  settings: DEFAULT_SCENE_SETTINGS,
  count: 6,
  seed: 11,
  overrides,
  permanence,
  clean,
  requests: requests(),
  ...over,
})
const tags = (prompt: string) => prompt.split(",").map((t) => t.trim())
const sceneOrder = (ps: { scene?: { postId: number } }[]) => ps.map((p) => p.scene?.postId)

let passed = 0
const check = (name: string, fn: () => void) => {
  try { fn(); passed++ } catch (err) { console.error(`FAIL: ${name}`); throw err }
}

const before = generateScenePack(pool, args()).prompts

check("Never on a tag: same scenes in the same order; rows without it are identical", () => {
  const target = "smile"
  const touched = before.filter((p) => tags(p.prompt).includes(target))
  assert.ok(touched.length > 0 && touched.length < before.length, `some rows have ${target} (${touched.length} of ${before.length})`)
  const after = generateScenePack(pool, args({ never: [target] })).prompts
  assert.deepEqual(sceneOrder(after), sceneOrder(before))
  before.forEach((p, i) => {
    if (!tags(p.prompt).includes(target)) assert.equal(after[i].prompt, p.prompt, `row ${i + 1} untouched`)
    else assert.ok(!tags(after[i].prompt).includes(target), `row ${i + 1} loses ${target}`)
  })
})

check("Always on a tag: same scenes in the same order, every row has it", () => {
  const after = generateScenePack(pool, args({ requests: requests({ also: ["blush"] }) })).prompts
  assert.deepEqual(sceneOrder(after), sceneOrder(before))
  for (const p of after) assert.ok(tags(p.prompt).includes("blush"), p.prompt)
})

check("preferred posts change the order, so a correction must pass the same ones it was made with", () => {
  const preferred = [109, 104]
  const made = generateScenePack(pool, args({ preferredPosts: preferred })).prompts
  // Preferring posts is not a way to pin an order: it moves those scenes first.
  assert.notDeepEqual(sceneOrder(made), sceneOrder(before))
  const corrected = generateScenePack(pool, args({ preferredPosts: preferred, never: ["smile"] })).prompts
  assert.deepEqual(sceneOrder(corrected), sceneOrder(made))
})

check("with locked rows: the free rows remade with the locked scenes left out keep their own scenes", () => {
  // Rows 1 and 3 locked at Generate: the engine makes the other four, never from their scenes.
  const lockedScenes = [before[1].scene!.postId, before[3].scene!.postId]
  const slots = [0, 2, 4, 5]
  const made = generateScenePack(pool, args({ count: slots.length, removedScenes: lockedScenes })).prompts
  const rows = placeRows(before, new Set([1, 3]), slots, made)
  assert.equal(rows.rows[1], before[1])
  assert.equal(rows.rows[3], before[3])
  assert.ok(!made.some((p) => lockedScenes.includes(p.scene!.postId)), "no locked scene comes back")
  // Never on a tag: the same run again; locked rows stay, free rows without the tag are identical.
  const again = generateScenePack(pool, args({ count: slots.length, removedScenes: lockedScenes, never: ["smile"] })).prompts
  const corrected = placeRows(rows.rows, new Set(rows.locked), rows.slots, again)
  assert.deepEqual(corrected.locked, [1, 3])
  corrected.rows.forEach((p, i) => {
    if (rows.locked.includes(i)) assert.equal(p, rows.rows[i])
    else if (!tags(rows.rows[i].prompt).includes("smile")) assert.equal(p.prompt, rows.rows[i].prompt, `row ${i + 1} untouched`)
    else assert.ok(!tags(p.prompt).includes("smile"))
  })
})

console.log(`pack-brief-correct: ${passed} checks passed`)
