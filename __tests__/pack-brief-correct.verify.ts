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
import { DEFAULT_SCENE_SETTINGS, generateScenePack, generateScenePackAsync, sceneCandidates, tagKindsFromPosts, type ScenePackArgs } from "../lib/pack/scene-pack"
import { addTag, routeTag, toSceneRequests } from "../lib/pack/brief"
import { briefFromCharacters } from "../lib/pack/brief-history"
import { BRIEF_EXAMPLES, rotationAfter, rotationPlan, briefAsksNothing, briefIdentity, briefPackArgs, briefWithExample, issuesFit, predictFit } from "../lib/pack/brief-pack"
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

// ── Generate again (INT-6) ──────────────────────────────────────────────────────

check("the engine picks almost the same scenes whatever the seed: Generate again prefers the unused ones", () => {
  // Measured, not changed: with fewer prompts than scenes the engine's choice barely depends on the seed.
  const small = (seed: number) => sceneOrder(generateScenePack(pool, args({ count: 4, seed })).prompts)
  const runs = [1, 2, 3, 99999].map(small)
  const overlap = runs.slice(1).map((r) => r.filter((id) => runs[0].includes(id)).length)
  assert.ok(overlap.every((n) => n >= 3), `seeds share most scenes (${overlap.join(", ")} of 4)`)
  // What the builder does: the scenes the last pack didn't use go first.
  const used = new Set(runs[0])
  const unused = pool.scenes.map((sc) => sc.postId).filter((id) => !used.has(id))
  const again = sceneOrder(generateScenePack(pool, args({ count: 4, seed: 2, preferredPosts: unused })).prompts)
  assert.ok(again.every((id) => !used.has(id!)), `another set (${again.join(", ")} after ${runs[0].join(", ")})`)
})

// ── A pose the scenes don't have (INT-6) ────────────────────────────────────────

// ── Another set each Generate, on the engine (INT-3 browser pass, B) ────────────

check("with the scenes the last run used set aside, the engine draws a disjoint set", () => {
  const ids = pool.scenes.map((sc) => sc.postId)
  let used: number[] = []
  const runs: number[][] = []
  for (const seed of [1, 2, 3]) {
    const turn = rotationPlan({ available: ids, used, needed: 4, own: [] })
    const got = sceneOrder(generateScenePack(pool, args({ count: 4, seed, removedScenes: turn.exclude, preferredPosts: turn.preferred })).prompts) as number[]
    used = rotationAfter(turn, used, got)
    runs.push(got)
  }
  assert.equal(runs[0].filter((id) => runs[1].includes(id)).length, 0, `${runs[0]} / ${runs[1]}`)
  // 9 scenes: after 8 used, the one left comes first in the third run.
  const left = ids.filter((id) => !runs[0].includes(id) && !runs[1].includes(id))
  assert.ok(left.every((id) => runs[2].includes(id)), `${left} in ${runs[2]}`)
})

// ── Examples of the empty brief (HELP) ──────────────────────────────────────────

check("the empty brief's examples use real tags that land in the rows they promise", () => {
  for (const ex of BRIEF_EXAMPLES) {
    for (const { tag, role } of ex.tags) {
      const slot = overrides[tag]
      assert.ok(slot, `${tag} is in the taxonomy`)
      assert.ok(!/nsfw|sex|nude|naked|lingerie/i.test(tag + slot), `${tag} is neutral`)
      assert.deepEqual(routeTag(tag, overrides), { kind: "request", role: role === "doing" ? "doing" : role }, tag)
    }
    const filled = briefWithExample(briefFromCharacters(["tifa lockhart"]), ex, overrides)
    assert.equal(filled.who[0].tag, "tifa lockhart", "the character in Who stays")
    const asked = toSceneRequests(filled)
    for (const { tag, role } of ex.tags) assert.ok((role === "doing" ? asked.select : asked[role]).includes(tag), `${ex.id}: ${tag}`)
    if (ex.changes) assert.equal(filled.changes, ex.changes)
    assert.equal(briefAsksNothing(filled), false)
  }
  assert.equal(briefAsksNothing(briefFromCharacters(["tifa lockhart"])), true)
})

/** reading: the hook's path (briefPackArgs → generateScenePackAsync → issuesFit) says it was added. */
async function readingPath() {
  let brief = briefFromCharacters(["tifa lockhart"])
  brief = addTag(brief, "reading", overrides)
  assert.deepEqual(toSceneRequests(brief).select, ["reading"], "reading goes to Doing")
  const who = briefIdentity({ brief, looks: {}, permanence, overrides })
  const packArgs = briefPackArgs(brief, who, { overrides, permanence, count: 6, seed: 3, people: null, outfit: { kind: "scene" }, clean })
  const sync = generateScenePack(pool, packArgs)
  const out = await generateScenePackAsync(pool, packArgs, { pause: async () => {}, cancelled: () => false })
  assert.ok(out)
  assert.equal(JSON.stringify(out.prompts), JSON.stringify(sync.prompts), "async and sync make the same prompts")
  assert.deepEqual(out.issues, sync.issues, "and the same issues")
  assert.ok(out.issues.some((i) => i.kind === "pose-imposed"), JSON.stringify(out.issues))
  const notes = issuesFit({ issues: out.issues, count: 6, made: out.prompts.length, cast: who.cast, scenes: null, canOfferSensitive: false })
  assert.ok(notes.some((n) => n.kind === "imposed"), JSON.stringify(notes))
  // Before generating: no scene has it, so the line foresees the imposing.
  const candidates = sceneCandidates(pool, { ...packArgs, count: 1 })
  assert.ok(candidates.every((c) => !c.hasPose))
  const predicted = predictFit({ candidates, count: 6, poses: ["reading"], finding: false, canOfferSensitive: false })
  assert.ok(predicted.some((n) => n.kind === "imposed"), JSON.stringify(predicted))
  // A pool searched for the pose has it in its scenes: then nothing is imposed and nothing is said.
  const withBook = POSTS.map((p) => ({ ...p, tag_string: `${p.tag_string} reading book holding_book` }))
  const bookPool = buildScenePool(withBook, { overrides, permanence, subject: "girl", tagKind: (tag) => tagKindsFromPosts(withBook).get(tag) })
  const bookOut = generateScenePack(bookPool, packArgs)
  assert.ok(!bookOut.issues.some((i) => i.kind === "pose-imposed"), JSON.stringify(bookOut.issues))
  passed++
}

void readingPath().then(() => console.log(`pack-brief-correct: ${passed} checks passed`)).catch((err) => {
  console.error("FAIL: reading path")
  console.error(err)
  process.exit(1)
})

