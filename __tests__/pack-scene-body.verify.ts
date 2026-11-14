/**
 * Tests for the body of an asked-for act (ScenePackArgs.requests.select with a pose only a scene can
 * give) when the prompt wears other clothes (requests.wearing): what the act shows of the bodies is
 * part of the act, not of the clothes it was shown with. Real taxonomy snapshot, permanence data and
 * measured tag relations.
 *
 * Covers:
 *   1. An act between two people with a garment asked for: the prompts made from scenes with the act
 *      keep the scene's picture-state body tags, less what the garment rules out ("nude").
 *   2. No permanent trait of the scene comes in (size, skin, hair): the exposure unit holds picture
 *      state only; a size the user put in Who stays the only one.
 *   3. A pose that can be imposed on any scene ("sitting") keeps the old rule: the scene's exposure
 *      goes with its clothes when a garment is asked for.
 *   4. Without a garment asked for, nothing changes: the scene's own clothes and body stay.
 *   5. Async = sync; reroll keeps the rule.
 *   6. A decade on its own ("00s"), typed general by the booru and vouched for by the pool, never
 *      travels with a scene.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-scene-body.verify.ts
 */
import fs from "fs"
import path from "path"
import { buildScenePool } from "../lib/pack/scene/scene-pool"
import { createPermanence, type PermanenceData } from "../lib/pack/scene/permanence"
import { sceneTags } from "../lib/pack/scene/scene"
import { cleanSyntheticPrompt } from "../lib/pack/bulk-send"
import { parseTagRelations, setTagRelations, type TagRelationsFile } from "../lib/tag-relations"
import type { SceneRequests } from "../lib/pack/brief"
import {
  DEFAULT_SCENE_SETTINGS,
  generateScenePack,
  generateScenePackAsync,
  rerollScenePrompt,
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
const adult = (id: number, tags: string) => makePost(id, tags, { rating: "explicit" })

// Two people, an act; each scene names the body parts the act shows, and permanent traits of the
// people in it (sizes, skin) that must never travel.
const ACT = [501, 502, 503, 504]
const PAIR = [
  adult(501, "1girl 1boy hetero paizuri penis nipples breasts large_breasts nude bedroom indoors blush open_mouth"),
  adult(502, "1girl 1boy hetero paizuri penis breasts_out cleavage huge_breasts dark-skinned_male school_uniform classroom indoors smile"),
  adult(503, "1girl 1boy hetero paizuri penis testicles nipples breasts medium_breasts lingerie bed indoors looking_at_viewer"),
  adult(504, "1girl 1boy hetero paizuri penis navel breasts large_breasts nude bathroom indoors sweat"),
  // Scenes of the same two people without the act.
  adult(505, "1girl 1boy hetero hug navel midriff crop_top street outdoors smile"),
  adult(506, "1girl 1boy hetero holding_hands collarbone sundress park outdoors day"),
]
const pairKinds = tagKindsFromPosts(PAIR)
const PAIR_PEOPLE = { girls: 1, boys: 1 }
const pairPool = buildScenePool(PAIR, { overrides, permanence, subject: "girl", tagKind: (tag: string) => pairKinds.get(tag), people: PAIR_PEOPLE })

const clean = (tags: string[], locked: string[]) =>
  cleanSyntheticPrompt(tags, ["test heroine"], {
    excludeInput: "", addInput: "", includeCharacters: true, optimizeTags: false, smartTagExclusion: true, tagOverrides: overrides, lockedTags: locked,
  }, locked)
const args = (over: Partial<ScenePackArgs> = {}): ScenePackArgs => ({
  identity: ["test heroine", "long hair", "black hair", "red eyes"],
  alwaysAdd: [],
  people: PAIR_PEOPLE,
  subject: "girl",
  settings: DEFAULT_SCENE_SETTINGS,
  count: 4,
  seed: 2,
  overrides,
  clean,
  permanence,
  ...over,
})
const ACT_BIKINI = requests({ select: ["paizuri"], wearing: ["bikini"] })
const FOREIGN_LOOK = ["large breasts", "huge breasts", "medium breasts", "breasts", "dark-skinned male", "dark skin"]

// ── 1. The act's body stays with a garment asked for ─────────────────────────
{
  const result = generateScenePack(pairPool, args({ requests: ACT_BIKINI }))
  assert(result.prompts.length === 4, `1: four prompts (got ${result.prompts.length})`)
  assert(result.prompts.every((p) => ACT.includes(p.scene?.postId ?? -1)), "1: every prompt comes from a scene with the act")
  for (const p of result.prompts) {
    const tags = tagsOf(p.prompt)
    assert(tags.includes("bikini") && tags.includes("paizuri"), `1: ${p.scene?.postId} has the garment and the act`)
    assert(tags.includes("penis"), `1: ${p.scene?.postId} keeps the partner's body part the act shows (${p.prompt})`)
    assert(!tags.includes("nude"), `1: ${p.scene?.postId} drops what the garment rules out (nude)`)
    assert(!["school uniform", "lingerie"].some((t) => tags.includes(t)), `1: ${p.scene?.postId} has none of the scene's clothes`)
  }
  const byScene = new Map(result.prompts.map((p) => [p.scene?.postId, tagsOf(p.prompt)]))
  assert(byScene.get(501)?.includes("nipples") === true, "1: 501 keeps nipples")
  assert(byScene.get(502)?.includes("breasts out") === true && byScene.get(502)?.includes("cleavage") === true, "1: 502 keeps breasts out and cleavage")
  assert(byScene.get(503)?.includes("testicles") === true, "1: 503 keeps testicles")
  assert(byScene.get(504)?.includes("navel") === true, "1: 504 keeps navel")
}

// ── 2. No permanent trait of the scene; the size in Who is the only one ──────
{
  const plain = generateScenePack(pairPool, args({ requests: ACT_BIKINI }))
  for (const p of plain.prompts) {
    const tags = tagsOf(p.prompt)
    const foreign = FOREIGN_LOOK.filter((t) => tags.includes(t))
    assert(foreign.length === 0, `2: ${p.scene?.postId} has no look of the scene's people (${foreign.join(", ")})`)
  }
  const sized = generateScenePack(pairPool, args({ identity: ["test heroine", "long hair", "black hair", "red eyes", "huge breasts"], requests: ACT_BIKINI }))
  for (const p of sized.prompts) {
    const tags = tagsOf(p.prompt)
    assert(tags.includes("huge breasts"), `2: ${p.scene?.postId} keeps the size from Who`)
    const other = FOREIGN_LOOK.filter((t) => t !== "huge breasts" && t !== "breasts" && tags.includes(t))
    assert(other.length === 0, `2: ${p.scene?.postId} has no other size (${other.join(", ")})`)
  }
}

// ── 3. A pose that can be imposed keeps the old rule ─────────────────────────
{
  const SIT = [
    makePost(601, "1girl solo sitting navel midriff crop_top bedroom indoors smile"),
    makePost(602, "1girl solo sitting collarbone cleavage sweater cafe indoors blush"),
    makePost(603, "1girl solo standing thighs miniskirt street outdoors"),
  ]
  const kinds = tagKindsFromPosts(SIT)
  const pool = buildScenePool(SIT, { overrides, permanence, subject: "girl", tagKind: (tag: string) => kinds.get(tag), people: { girls: 1, boys: 0 } })
  const result = generateScenePack(pool, args({ people: { girls: 1, boys: 0 }, count: 2, requests: requests({ select: ["sitting"], wearing: ["bikini"] }) }))
  assert(result.prompts.length === 2, `3: two prompts (got ${result.prompts.length})`)
  for (const p of result.prompts) {
    const tags = tagsOf(p.prompt)
    const left = ["navel", "midriff", "collarbone", "cleavage"].filter((t) => tags.includes(t))
    assert(left.length === 0, `3: ${p.scene?.postId} has none of its old clothes' exposure (${left.join(", ")})`)
  }
}

// ── 4. Without a garment asked for, nothing changes ──────────────────────────
{
  const result = generateScenePack(pairPool, args({ requests: requests({ select: ["paizuri"] }) }))
  const of502 = result.prompts.find((p) => p.scene?.postId === 502)
  assert(!!of502 && tagsOf(of502.prompt).includes("school uniform") && tagsOf(of502.prompt).includes("cleavage"), "4: 502 keeps its own clothes and body")
  const of501 = result.prompts.find((p) => p.scene?.postId === 501)
  assert(!!of501 && tagsOf(of501.prompt).includes("nude"), "4: 501 keeps nude (no garment asked for)")
}

// ── 5. Async = sync; reroll keeps the rule ───────────────────────────────────
async function asyncAndReroll() {
  const a = args({ requests: ACT_BIKINI })
  const sync = generateScenePack(pairPool, a)
  const later = await generateScenePackAsync(pairPool, a, { pause: async () => {}, cancelled: () => false })
  assert(!!later && JSON.stringify(sync.prompts.map((p) => p.prompt)) === JSON.stringify(later.prompts.map((p) => p.prompt)), "5: async = sync")
  const again = rerollScenePrompt(pairPool, sync.prompts, 0, a)
  if (again) {
    const tags = tagsOf(again.prompt)
    assert(tags.includes("penis") && !tags.includes("nude"), `5: the reroll keeps the act's body (${again.prompt})`)
  }
}

// ── 6. A decade on its own never travels ─────────────────────────────────────
{
  const ERA = [1, 2, 3, 4].map((i) =>
    makePost(700 + i, "1girl solo 00s sitting smile looking_at_viewer shirt long_sleeves bedroom indoors window", { tag_string_character: `someone ${i}` })
  )
  const kinds = tagKindsFromPosts(ERA)
  const pool = buildScenePool(ERA, { overrides, permanence, subject: "girl", tagKind: (tag: string) => (tag === "00s" ? "general" : kinds.get(tag)), people: { girls: 1, boys: 0 } })
  assert(pool.scenes.length === 4, `6: four scenes (got ${pool.scenes.length})`)
  assert(pool.scenes.every((scene) => !sceneTags(scene).includes("00s")), "6: no scene carries 00s")
  assert(pool.scenes.every((scene) => sceneTags(scene).includes("sitting")), "6: the rest of the scene stays")
}

asyncAndReroll().then(done)
