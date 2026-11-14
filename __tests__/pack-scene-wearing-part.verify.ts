/**
 * Tests for a garment asked for in Wearing that takes only part of the outfit (a hat, glasses, a
 * choker, boots): it replaces what it occupies and nothing else, in exact mode and as a condition,
 * with the character's usual outfit and with each scene's outfit. A whole outfit still replaces it all.
 *
 * Covers:
 *   U. "Usual outfit" (settings.clothing 'character', the outfit in the identity): a hat keeps the rest
 *      of it; a garment of a slot it has (gloves) replaces that piece; a whole outfit replaces it all.
 *   S. "Each scene's outfit", exact: a hat keeps the scene's clothes, without the scene's own hat;
 *      boots keep the top and the bottom; a whole outfit (bikini) replaces them, as before.
 *   C. The same as a condition, with a donor: the hat comes from the donor, the rest stays.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-scene-wearing-part.verify.ts
 */
import fs from "fs"
import path from "path"
import { buildScenePool } from "../lib/pack/scene/scene-pool"
import { createPermanence, type PermanenceData } from "../lib/pack/scene/permanence"
import { cleanSyntheticPrompt } from "../lib/pack/bulk-send"
import { parseTagRelations, setTagRelations, type TagRelationsFile } from "../lib/tag-relations"
import type { SceneRequests } from "../lib/pack/brief"
import { DEFAULT_SCENE_SETTINGS, generateScenePack, tagKindsFromPosts, type ScenePackArgs } from "../lib/pack/scene-pack"
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

const USUAL = ["crop top", "black skirt", "fingerless gloves", "earrings"]
const POSTS = [
  makePost(1, "1girl solo standing smile white_shirt pleated_skirt beret sneakers street outdoors day"),
  makePost(2, "1girl solo sitting blush sweater jeans baseball_cap boots park outdoors looking_at_viewer"),
  makePost(3, "1girl solo standing open_mouth hoodie miniskirt sandals classroom indoors cowboy_shot"),
]
const DONOR = makePost(9, "1girl solo standing smile witch_hat dress cape forest outdoors night")
const SOLO = { girls: 1, boys: 0 }
function poolOf(posts: ReturnType<typeof makePost>[]) {
  const kinds = tagKindsFromPosts(posts)
  return buildScenePool(posts, { overrides, permanence, subject: "girl", tagKind: (tag: string) => kinds.get(tag), people: SOLO })
}
const pool = poolOf(POSTS)
function args(over: Partial<ScenePackArgs> = {}): ScenePackArgs {
  return { identity: ["test heroine", "long hair"], alwaysAdd: [], people: SOLO, subject: "girl", settings: DEFAULT_SCENE_SETTINGS, count: 3, seed: 2, overrides, clean, permanence, ...over }
}
const usual = (over: Partial<ScenePackArgs>) => args({ identity: ["test heroine", "long hair", ...USUAL], settings: { ...DEFAULT_SCENE_SETTINGS, clothing: "character" }, characterOutfit: USUAL, ...over })

// ── U ────────────────────────────────────────────────────────────────────────
{
  const hat = generateScenePack(pool, usual({ requests: requests({ wearing: ["witch hat"] }) }))
  assert(hat.prompts.length === 3 && hat.prompts.every((p) => ["witch hat", ...USUAL].every((t) => tagsOf(p.prompt).includes(t))), "U1: a hat keeps the usual outfit")
  assert(hat.prompts.every((p) => !["white shirt", "sweater", "hoodie", "beret", "baseball cap"].some((t) => tagsOf(p.prompt).includes(t))), "U1: and none of the scene's clothes")
  const gloves = generateScenePack(pool, usual({ requests: requests({ wearing: ["gloves"] }) }))
  assert(gloves.prompts.every((p) => tagsOf(p.prompt).includes("gloves") && !tagsOf(p.prompt).includes("fingerless gloves") && tagsOf(p.prompt).includes("crop top")), "U2: gloves replace the usual gloves only")
  const bikini = generateScenePack(pool, usual({ requests: requests({ wearing: ["bikini"] }) }))
  assert(bikini.prompts.every((p) => tagsOf(p.prompt).includes("bikini") && !USUAL.slice(0, 3).some((t) => tagsOf(p.prompt).includes(t))), "U3: a whole outfit replaces the usual outfit")
}
// ── S ────────────────────────────────────────────────────────────────────────
{
  const hat = generateScenePack(pool, args({ requests: requests({ wearing: ["witch hat"] }) }))
  const tops = ["white shirt", "sweater", "hoodie"]
  assert(hat.prompts.every((p) => tagsOf(p.prompt).includes("witch hat") && tops.some((t) => tagsOf(p.prompt).includes(t))), "S1: a hat keeps the scene's clothes")
  assert(hat.prompts.every((p) => !["beret", "baseball cap"].some((t) => tagsOf(p.prompt).includes(t))), "S1: the scene's own hat gives way")
  const boots = generateScenePack(pool, args({ requests: requests({ wearing: ["boots"] }) }))
  assert(boots.prompts.every((p) => tops.some((t) => tagsOf(p.prompt).includes(t)) && !["sneakers", "sandals"].some((t) => tagsOf(p.prompt).includes(t))), "S2: boots keep the top, replace the shoes")
  const bikini = generateScenePack(pool, args({ requests: requests({ wearing: ["bikini"] }) }))
  assert(bikini.prompts.every((p) => !tops.some((t) => tagsOf(p.prompt).includes(t)) && !tagsOf(p.prompt).includes("beret")), "S3: a whole outfit replaces the scene's clothes, as before")
}
// ── C ────────────────────────────────────────────────────────────────────────
{
  const withDonor = poolOf([...POSTS, DONOR])
  const hat = generateScenePack(withDonor, usual({ donorPosts: [9], requests: requests({ wearing: ["witch hat"], conditions: ["witch hat"] }) }))
  assert(hat.prompts.every((p) => USUAL.every((t) => tagsOf(p.prompt).includes(t)) && tagsOf(p.prompt).includes("witch hat")), "C1: as a condition, the usual outfit stays")
  assert(hat.prompts.every((p) => !tagsOf(p.prompt).includes("dress") && !tagsOf(p.prompt).includes("cape")), "C1: the donor lends its hat, not its dress")
}

done()
