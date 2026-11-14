/**
 * Wearing and Where as conditions, through the brief (INT): a chip of Wearing or Where is met with a
 * different form per prompt unless made exact. The brief's conditions, the donor posts and the
 * library reach the engine through briefPackArgs as the hook passes them, and the real engine meets
 * them. Real taxonomy, permanence data and measured relations; synthetic posts.
 *
 * Ten requests: five garments of different kinds (a whole outfit, a top, legwear, footwear, an
 * accessory), two pairs of garments, two places and one library style.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-brief-conditions.verify.ts
 */
import fs from "fs"
import path from "path"
import assert from "node:assert/strict"
import { buildScenePool } from "../lib/pack/scene/scene-pool"
import { createPermanence, type PermanenceData } from "../lib/pack/scene/permanence"
import { cleanSyntheticPrompt } from "../lib/pack/bulk-send"
import { parseTagRelations, setTagRelations, type TagRelationsFile } from "../lib/tag-relations"
import { generateScenePack, tagKindsFromPosts, type ScenePackIssue } from "../lib/pack/scene-pack"
import { addOutfitStyle, addTag, addTagExactly, briefConditions, setRequestExact, type PackBrief } from "../lib/pack/brief"
import { briefFromCharacters } from "../lib/pack/brief-history"
import { briefIdentity, briefPackArgs, issuesFit } from "../lib/pack/brief-pack"
import { makePost } from "./fixtures/pack-scene-data"

const root = path.join(__dirname, "..")
const CORE: Record<string, string> = JSON.parse(fs.readFileSync(path.join(root, "public/tags-core.json"), "utf8"))
const PERMANENCE: PermanenceData = JSON.parse(fs.readFileSync(path.join(root, "public/tag-permanence.json"), "utf8"))
const overrides: Record<string, string> = {}
for (const [tag, slot] of Object.entries(CORE)) overrides[tag.replace(/_/g, " ")] = slot
const permanence = createPermanence(PERMANENCE, overrides)
setTagRelations(parseTagRelations(JSON.parse(fs.readFileSync(path.join(root, "public/tag-relations.json"), "utf8")) as TagRelationsFile))

let passed = 0
const check = (name: string, fn: () => void) => {
  try { fn(); passed++ } catch (err) { console.error(`FAIL: ${name}`); throw err }
}

const clean = (tags: string[], locked: string[]) =>
  cleanSyntheticPrompt(tags, ["tifa lockhart"], {
    excludeInput: "", addInput: "", includeCharacters: true, optimizeTags: false, smartTagExclusion: true, tagOverrides: overrides, lockedTags: locked,
  }, locked)

// The character's own scenes: none wears what is asked for.
const OWN = [
  makePost(901, "1girl solo standing smile white_shirt black_skirt street outdoors looking_at_viewer day"),
  makePost(902, "1girl solo sitting blush white_shirt pleated_skirt bedroom indoors bed looking_at_viewer"),
  makePost(903, "1girl solo standing open_mouth tank_top denim_shorts sneakers city outdoors day"),
  makePost(904, "1girl solo sitting smile jacket black_skirt street outdoors looking_at_viewer cloud"),
  makePost(905, "1girl solo sitting smile sweater long_skirt living_room indoors couch window"),
  makePost(906, "1girl solo standing blush apron kitchen indoors counter looking_at_viewer"),
]
// What the donor searches bring: three forms of each request.
const DONORS = [
  makePost(951, "1girl solo standing smile white_bikini swimsuit navel beach ocean day sky"),
  makePost(952, "1girl solo sitting blush striped_bikini swimsuit navel poolside pool water"),
  makePost(953, "1girl solo standing open_mouth red_bikini swimsuit navel beach sand palm_tree"),
  makePost(954, "1girl solo standing smile black_crop_top denim_shorts navel midriff street outdoors day"),
  makePost(955, "1girl solo sitting blush white_crop_top pleated_skirt midriff bedroom indoors"),
  makePost(956, "1girl solo standing open_mouth red_crop_top black_shorts midriff city outdoors night"),
  makePost(957, "1girl solo sitting smile white_thighhighs pleated_skirt white_shirt classroom indoors looking_at_viewer"),
  makePost(958, "1girl solo standing blush striped_thighhighs white_shirt shorts street outdoors day"),
  makePost(959, "1girl solo sitting smile black_thighhighs sweater skirt library indoors bookshelf"),
  makePost(960, "1girl solo standing smile brown_boots dress forest outdoors tree day"),
  makePost(961, "1girl solo standing blush black_boots jacket jeans street outdoors night"),
  makePost(962, "1girl solo sitting open_mouth white_boots coat skirt snow outdoors winter"),
  makePost(963, "1girl solo standing smile black_choker shirt skirt street outdoors day"),
  makePost(964, "1girl solo sitting blush red_choker dress bedroom indoors bed"),
  makePost(965, "1girl solo standing open_mouth white_choker sweater shorts park outdoors tree"),
  // Pairs: a donor must have both.
  makePost(966, "1girl solo standing smile black_crop_top black_thighhighs skirt midriff street outdoors day"),
  makePost(967, "1girl solo sitting blush white_crop_top white_thighhighs shorts midriff bedroom indoors"),
  makePost(968, "1girl solo standing smile blue_bikini black_choker swimsuit navel beach ocean day"),
  makePost(969, "1girl solo sitting blush pink_bikini red_choker swimsuit navel beach sand"),
  // Places.
  makePost(970, "1girl solo standing smile school_uniform classroom indoors desk chalkboard window"),
  makePost(971, "1girl solo sitting blush sailor_collar classroom indoors chair desk sunlight"),
  makePost(972, "1girl solo standing open_mouth sundress beach ocean shore day horizon"),
]
const ALL = [...OWN, ...DONORS]
const kinds = tagKindsFromPosts(ALL)
const pool = buildScenePool(ALL, { overrides, permanence, subject: "girl", tagKind: (tag: string) => kinds.get(tag) })
const DONOR_IDS = DONORS.map((p) => p.id)
const LIBRARY = [
  { outfitId: 1, tags: ["one-piece swimsuit", "white one-piece swimsuit"], style: "swimwear" },
  { outfitId: 2, tags: ["bikini", "red bikini", "sarong"], style: "swimwear" },
  { outfitId: 3, tags: ["swimsuit", "school swimsuit"], style: "swimwear" },
  { outfitId: 4, tags: ["sweater", "scarf", "jeans"], style: "winter" },
]

type Variety = Extract<ScenePackIssue, { kind: "condition-variety" }>
const tagsOf = (prompt: string) => prompt.split(",").map((t) => t.trim())
const meets = (tags: readonly string[], want: string) => tags.some((t) => t === want || t.endsWith(` ${want}`))

function pack(brief: PackBrief) {
  const who = briefIdentity({ brief, looks: {}, permanence, overrides })
  const args = briefPackArgs(brief, who, {
    overrides, permanence, count: 4, seed: 3, people: { girls: 1, boys: 0 }, outfit: { kind: "scene" }, clean,
    conditions: briefConditions(brief, overrides),
    outfitStyles: brief.outfitStyles ?? [],
    donorPosts: DONOR_IDS,
    outfitLibrary: LIBRARY,
  })
  return { args, result: generateScenePack(pool, args) }
}
const variety = (issues: readonly ScenePackIssue[], role: "wearing" | "where") =>
  issues.find((i): i is Variety => i.kind === "condition-variety" && i.role === role)

const tifa = briefFromCharacters(["tifa lockhart"])
const CASES: Array<{ name: string; role: "wearing" | "where"; tags: string[] }> = [
  { name: "a whole outfit", role: "wearing", tags: ["bikini"] },
  { name: "a top", role: "wearing", tags: ["crop top"] },
  { name: "legwear", role: "wearing", tags: ["thighhighs"] },
  { name: "footwear", role: "wearing", tags: ["boots"] },
  { name: "an accessory", role: "wearing", tags: ["choker"] },
  { name: "a top and legwear", role: "wearing", tags: ["crop top", "thighhighs"] },
  { name: "an outfit and an accessory", role: "wearing", tags: ["bikini", "choker"] },
  { name: "a place", role: "where", tags: ["beach"] },
  { name: "another place", role: "where", tags: ["classroom"] },
]

for (const c of CASES) {
  check(`condition, ${c.name} (${c.tags.join(" + ")}): met in every prompt, more than one form`, () => {
    const brief = c.tags.reduce((b, tag) => addTag(b, tag, overrides), tifa)
    assert.deepEqual(briefConditions(brief, overrides), c.tags, "a chip of Wearing or Where is a condition by default")
    const { args, result } = pack(brief)
    assert.deepEqual(args.requests?.conditions, c.tags)
    assert.equal(result.prompts.length, 4, JSON.stringify(result.issues))
    for (const p of result.prompts) {
      const tags = tagsOf(p.prompt)
      for (const want of c.tags) assert.ok(meets(tags, want), `${want} in: ${p.prompt}`)
      assert.ok(!DONOR_IDS.includes(p.scene!.postId), "a donor is never the scene of a prompt")
    }
    const issue = variety(result.issues, c.role)
    assert.ok(issue, JSON.stringify(result.issues))
    assert.ok(issue!.variants >= 2, `more than one form: ${JSON.stringify(issue)}`)
    // The fit line says it, one fact a sentence.
    const notes = issuesFit({ issues: result.issues, count: 4, made: result.prompts.length, cast: { girls: 1, boys: 0 }, scenes: 4, canOfferSensitive: false })
    assert.ok(notes.some((n) => n.kind === "variety" && n.role === c.role && n.variants === issue!.variants), JSON.stringify(notes))
  })
}

check("condition, a library style (swimwear): every prompt wears a swimwear outfit of the library, more than one", () => {
  const brief = addOutfitStyle(tifa, "swimwear")
  const { args, result } = pack(brief)
  assert.deepEqual(args.requests?.outfitStyles, ["swimwear"])
  assert.equal(result.prompts.length, 4)
  // Three swimwear outfits for four prompts: each one once, never the winter one; the fourth says so.
  const ids = result.prompts.map((p) => p.outfitId).filter((id) => id !== undefined)
  assert.deepEqual([...ids].sort(), [1, 2, 3], JSON.stringify(ids))
  const issue = variety(result.issues, "wearing")
  assert.ok(issue && issue.fromLibrary === 3 && issue.variants === 3, JSON.stringify(issue))
  const notes = issuesFit({ issues: result.issues, count: 4, made: 4, cast: { girls: 1, boys: 0 }, scenes: 4, canOfferSensitive: false })
  assert.ok(notes.some((n) => n.kind === "variety" && n.styles && n.what === "swimwear" && n.variants === 3 && n.prompts === 4), JSON.stringify(notes))
})

check("exact: the same tag in every prompt, as before; Always on a garment of a prompt is exact", () => {
  let brief = addTag(tifa, "bikini", overrides)
  brief = setRequestExact(brief, "bikini", true)
  assert.deepEqual(brief.requests, [{ tag: "bikini", role: "wearing", exact: true }])
  assert.deepEqual(briefConditions(brief, overrides), [])
  const { args, result } = pack(brief)
  assert.equal(args.requests?.conditions, undefined, "no conditions: the engine's exact path")
  assert.ok(result.prompts.every((p) => tagsOf(p.prompt).includes("bikini")))
  assert.ok(!variety(result.issues, "wearing"))
  // Back to any form.
  assert.deepEqual(briefConditions(setRequestExact(brief, "bikini", false), overrides), ["bikini"])
  // Always on "red bikini" from a prompt asks for that tag.
  assert.deepEqual(addTagExactly(tifa, "red bikini", overrides, "also").requests, [{ tag: "red bikini", role: "wearing", exact: true }])
  // A time of day typed in Where stays exact, with no switch.
  assert.deepEqual(briefConditions(addTag(tifa, "night", overrides), overrides), [])
})

console.log(`pack-brief-conditions: ${passed} checks passed`)
