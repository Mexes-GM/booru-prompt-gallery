/**
 * Tests for Wearing / Where as conditions (ScenePackArgs.requests.conditions): the pack meets them
 * with a different outfit or place in each prompt. Real taxonomy snapshot, permanence data and
 * measured relations.
 *
 * Covers:
 *   C. Wearing as a condition: a different variant per prompt from the scene, donors (`donorPosts`,
 *      never the scene of a prompt) or the library; a donor with a layer over the garment is never
 *      used; the exposure comes with an outfit of the torso; condition-variety says where they came from.
 *   P. A partial garment (legwear) takes only its part: the rest of the scene's clothes stays.
 *   L. The library: outfits that meet the condition, `outfitId`; `outfitStyles` alone.
 *   W. Where as a condition: different places at the place.
 *   X. Exact (not in `conditions`): as before; an exact garment next to a condition stays.
 *   A. One-axis outfit pack with a condition: the donor posts and the library widen it.
 *   K. A costume is its pieces, measured on the pool (a dress with a maid outfit), not a layer; a coat over it is.
 *   N. Other names of a condition (conditionAliases): a post tagged "qipao" meets "china dress".
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-scene-conditions.verify.ts
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
  tagKindsFromPosts,
  type ScenePackArgs,
  type ScenePackIssue,
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
const clean = (tags: string[], locked: string[]) =>
  cleanSyntheticPrompt(tags, ["test heroine"], {
    excludeInput: "", addInput: "", includeCharacters: true, optimizeTags: false, smartTagExclusion: true, tagOverrides: overrides, lockedTags: locked,
  }, locked)
const IDENTITY = ["test heroine", "long hair", "black hair", "red eyes"]
function baseArgs(over: Partial<ScenePackArgs> = {}): ScenePackArgs {
  return {
  identity: IDENTITY,
  alwaysAdd: [],
  subject: "girl",
  settings: DEFAULT_SCENE_SETTINGS,
  count: 4,
  seed: 3,
  overrides,
  clean,
  permanence,
  ...over,
  }
}

// ── Conditions ───────────────────────────────────────────────────────────────
const OWN = [
  makePost(901, "1girl solo standing smile crop_top black_skirt street outdoors looking_at_viewer day"),
  makePost(902, "1girl solo sitting blush white_shirt pleated_skirt bedroom indoors bed looking_at_viewer"),
  makePost(903, "1girl solo standing open_mouth tank_top denim_shorts sneakers city outdoors day"),
  makePost(904, "1girl solo sitting smile jacket black_skirt street outdoors looking_at_viewer cloud"),
]
const DONORS = [
  makePost(951, "1girl solo standing smile white_bikini swimsuit navel cleavage beach ocean day sky"),
  makePost(952, "1girl solo sitting blush striped_bikini swimsuit navel stomach poolside pool water"),
  makePost(953, "1girl solo standing open_mouth red_bikini swimsuit collarbone navel beach sand palm_tree"),
  // A layer over the garment: a shirt on the bikini.
  makePost(954, "1girl solo standing smile black_bikini tied_shirt shorts navel beach shore day"),
  makePost(955, "1girl solo sitting smile white_thighhighs pleated_skirt white_shirt classroom indoors looking_at_viewer"),
  makePost(956, "1girl solo standing blush striped_thighhighs crop_top shorts street outdoors day"),
]
const ALL = [...OWN, ...DONORS]
const allKinds = tagKindsFromPosts(ALL)
const condPool = buildScenePool(ALL, { overrides, permanence, subject: "girl", tagKind: (tag: string) => allKinds.get(tag) })
const DONOR_IDS = DONORS.map((p) => p.id)
const SOLO = { girls: 1, boys: 0 }
const condArgs = (over: Partial<ScenePackArgs>) => baseArgs({ people: SOLO, count: 4, donorPosts: DONOR_IDS, ...over })
type VarietyIssue = Extract<ScenePackIssue, { kind: "condition-variety" }>
const issueOf = (result: ReturnType<typeof generateScenePack>, role: string): VarietyIssue | undefined =>
  result.issues.find((i): i is VarietyIssue => i.kind === "condition-variety" && i.role === role)
const isBikiniForm = (t: string) => /\S bikini$/.test(t)
{
  const result = generateScenePack(condPool, condArgs({ requests: requests({ wearing: ["bikini"], conditions: ["bikini"] }) }))
  const lists = result.prompts.map((p) => tagsOf(p.prompt))
  assert(result.prompts.length === 4, "C1: four prompts")
  assert(result.prompts.every((p) => !DONOR_IDS.includes(p.scene!.postId)), "C1: a donor post is never the scene of a prompt")
  const forms = lists.map((tags) => tags.find(isBikiniForm) ?? "").filter(Boolean)
  assert(forms.length === 3 && new Set(forms).size === 3, `C1: three donors, three different bikinis (${forms.join(" / ")})`)
  assert(lists.every((tags) => tags.includes("bikini")), "C1: the condition's own tag stays in every prompt")
  assert(lists.every((tags) => !tags.includes("tied shirt") && !tags.includes("black bikini")), "C1: the donor with a shirt over the bikini is never used")
  assert(lists.every((tags) => !tags.includes("crop top") && !tags.includes("jacket") && !tags.includes("tank top")), "C1: the scene's own top gives way to the whole outfit")
  assert(lists.filter((tags) => tags.some(isBikiniForm)).every((tags) => tags.includes("navel")), "C1: the donor's exposure comes with the outfit")
  const issue = issueOf(result, "wearing")
  assert(!!issue && issue.variants === 3 && issue.fromDonors === 3 && issue.imposed === 1 && issue.fromScene === 0, `C1: condition-variety says 3 variants from donors, 1 as typed (${JSON.stringify(issue)})`)
  assert(result.prompts.every((p) => (p.scene?.donors ?? []).every((id) => id > 0)), "C1: donors are posts")
  const lent = result.prompts.filter((p) => (p.scene?.donors ?? []).some((id) => DONOR_IDS.includes(id)))
  assert(lent.length === 3, "C1: the prompts record their donor")
}
{
  // P: a legwear condition keeps the rest of each scene's clothes.
  const result = generateScenePack(condPool, condArgs({ requests: requests({ wearing: ["thighhighs"], conditions: ["thighhighs"] }) }))
  const lists = result.prompts.map((p) => tagsOf(p.prompt))
  const bySource = new Map(OWN.map((p) => [p.id, p.tag_string]))
  assert(lists.every((tags) => tags.includes("thighhighs")), "P1: the condition in every prompt")
  const variants = lists.map((tags) => tags.find((t) => /\S thighhighs$/.test(t))).filter(Boolean)
  assert(new Set(variants).size === 2, `P1: two donors, two different thighhighs (${variants.join(" / ")})`)
  result.prompts.forEach((p, i) => {
    const own = (bySource.get(p.scene!.postId) ?? "").split(" ").map((t) => t.replace(/_/g, " "))
    const top = own.find((t) => ["crop top", "white shirt", "tank top", "jacket"].includes(t))
    assert(!top || lists[i].includes(top), `P1: prompt ${i + 1} keeps its scene's top (${top})`)
    const bottom = own.find((t) => ["black skirt", "pleated skirt", "denim shorts"].includes(t))
    assert(!bottom || lists[i].includes(bottom), `P1: prompt ${i + 1} keeps its scene's bottom (${bottom})`)
  })
}
{
  // L: the library; and a style alone.
  const library = [
    { outfitId: 10, tags: ["red bikini", "sandals"], style: "swimwear" },
    { outfitId: 11, tags: ["frilled bikini", "sun hat"], style: "swimwear" },
    { outfitId: 12, tags: ["sundress", "sun hat", "sandals"], style: "summer" },
    { outfitId: 13, tags: ["white shirt", "denim shorts", "sneakers"], style: "summer" },
  ]
  const onlyLibrary = generateScenePack(condPool, condArgs({ count: 4, outfitLibrary: library, requests: requests({ wearing: ["bikini"], conditions: ["bikini"] }) }))
  assert(onlyLibrary.prompts.every((p) => tagsOf(p.prompt).includes("bikini")), "L1: the condition in every prompt")
  const fromLibrary = onlyLibrary.prompts.filter((p) => p.outfitId !== undefined)
  assert(fromLibrary.length >= 1 && fromLibrary.every((p) => p.outfitId === 10 || p.outfitId === 11), `L1: once the posts run out, a library outfit that meets it (${onlyLibrary.prompts.map((p) => p.outfitId).join(",")})`)
  const styles = generateScenePack(condPool, condArgs({ outfitLibrary: library, requests: requests({ outfitStyles: ["summer"] }) }))
  const ids = styles.prompts.map((p) => p.outfitId)
  assert(ids.filter((id) => id === 12).length === 1 && ids.filter((id) => id === 13).length === 1, `L2: a different summer outfit per prompt while there are (${ids.join(",")})`)
  styles.prompts.filter((p) => p.outfitId === 12).forEach((p) =>
    assert(["sundress", "sun hat", "sandals"].every((t) => tagsOf(p.prompt).includes(t)) && !tagsOf(p.prompt).includes("crop top"), "L2: the whole library outfit replaces the scene's"))
  const st = issueOf(styles, "wearing")
  assert(!!st && st.fromLibrary === 2 && st.styles.join() === "summer" && st.variants === 2, `L2: the issue counts the library (${JSON.stringify(st)})`)
}
{
  // W: a place condition.
  const result = generateScenePack(condPool, condArgs({ requests: requests({ where: ["beach"], conditions: ["beach"] }) }))
  const lists = result.prompts.map((p) => tagsOf(p.prompt))
  assert(lists.every((tags) => tags.includes("beach")), "W1: the place in every prompt")
  const places = lists.map((tags) => ["ocean", "sand", "palm tree", "shore", "sky"].filter((t) => tags.includes(t)).join("+"))
  assert(new Set(places.filter(Boolean)).size >= 2, `W1: different places at the beach (${places.join(" / ")})`)
  assert(lists.every((tags) => !tags.includes("street") && !tags.includes("bedroom")), "W1: the scene's own place gives way")
  const issue = issueOf(result, "where")
  assert(!!issue && issue.variants >= 2, `W1: condition-variety for the place (${JSON.stringify(issue)})`)
}
{
  // X: exact (not in conditions) is the engine as before.
  const exact = generateScenePack(condPool, baseArgs({ people: SOLO, count: 4, requests: requests({ wearing: ["bikini"], conditions: [] }) }))
  const before = generateScenePack(condPool, baseArgs({ people: SOLO, count: 4, requests: requests({ wearing: ["bikini"] }) }))
  assert(exact.prompts.map((p) => p.prompt).join("\n") === before.prompts.map((p) => p.prompt).join("\n"), "X1: no conditions: the same pack")
  assert(!exact.issues.some((i) => i.kind === "condition-variety"), "X1: no condition-variety without conditions")
  const mixed = generateScenePack(condPool, condArgs({ requests: requests({ wearing: ["bikini", "sandals"], conditions: ["bikini"] }) }))
  assert(mixed.prompts.every((p) => tagsOf(p.prompt).includes("sandals") && tagsOf(p.prompt).includes("bikini")), "X2: an exact garment next to a condition stays in every prompt")
}
{
  // A: one-axis outfit pack with a condition: before, only the pool's scenes that wear it lent.
  // Before: the pool had the character's posts only (no search for the garment).
  const ownKinds = tagKindsFromPosts(OWN)
  const ownPool = buildScenePool(OWN, { overrides, permanence, subject: "girl", tagKind: (tag: string) => ownKinds.get(tag) })
  const exact = generateScenePack(ownPool, baseArgs({ people: SOLO, count: 6, changes: "outfit", requests: requests({ wearing: ["bikini"] }) }))
  const cond = generateScenePack(condPool, condArgs({ count: 6, changes: "outfit", requests: requests({ wearing: ["bikini"], conditions: ["bikini"] }), outfitLibrary: [{ outfitId: 20, tags: ["red bikini", "sandals"], style: "swimwear" }] }))
  assert(cond.prompts.length > exact.prompts.length, `A1: more outfits with the condition's donors (${exact.prompts.length} -> ${cond.prompts.length})`)
  assert(cond.prompts.every((p) => tagsOf(p.prompt).includes("bikini")), "A1: the condition in every prompt")
  assert(new Set(cond.prompts.map((p) => p.scene!.postId)).size === 1, "A1: one base")
  assert(cond.prompts.some((p) => p.outfitId === 20), "A1: the library outfit is a donor too")
  assert(cond.prompts.every((p) => !tagsOf(p.prompt).includes("tied shirt")), "A1: no layered donor")
}

// ── K. A costume is its pieces (measured), a layer over it is not ────────────
{
  const DRESSES = ["black_dress", "blue_dress", "white_dress", "frilled_dress", "long_dress", "red_dress"]
  const POSES = ["standing", "sitting", "standing", "sitting", "standing", "sitting"]
  // Twelve maid outfits from other posts: a dress with it in every one (a piece of the outfit by the data).
  const FACES = ["smile", "blush", "open_mouth", "closed_eyes", "grin", "frown", "smile", "blush", "open_mouth", "closed_eyes", "grin", "frown"]
  const PLACES = ["kitchen indoors", "bedroom indoors", "classroom indoors", "library indoors", "bathroom indoors", "street outdoors", "park outdoors", "beach outdoors", "forest outdoors", "city outdoors", "rooftop outdoors", "shrine outdoors"]
  const CAMERAS = ["looking_at_viewer", "from_side", "upper_body", "full_body", "cowboy_shot", "from_above", "from_below", "looking_away", "profile", "portrait", "close-up", "wide_shot"]
  const MAIDS = Array.from({ length: 12 }, (_, i) =>
    makePost(1000 + i, `1girl solo ${POSES[i % 6]} ${FACES[i]} maid ${DRESSES[i % 6]} maid_headdress ${PLACES[i]} ${CAMERAS[i]}`))
  // One with a coat over it: a layer, whatever the data says about dresses.
  const COATED = makePost(1100, "1girl solo standing smile maid black_dress winter_coat street outdoors looking_at_viewer")
  const posts = [...OWN, ...MAIDS, COATED]
  const kinds = tagKindsFromPosts(posts)
  const pool = buildScenePool(posts, { overrides, permanence, subject: "girl", tagKind: (tag: string) => kinds.get(tag) })
  const donors = [...MAIDS, COATED].map((p) => p.id)
  const result = generateScenePack(pool, condArgs({ donorPosts: donors, requests: requests({ wearing: ["maid"], conditions: ["maid"] }) }))
  const lists = result.prompts.map((p) => tagsOf(p.prompt))
  assert(lists.every((tags) => tags.includes("maid")), "K1: the condition in every prompt")
  const dresses = lists.map((tags) => tags.find((t) => / dress$/.test(t)) ?? "")
  assert(dresses.filter(Boolean).length === 4 && new Set(dresses).size === 4, `K1: four prompts, four maid outfits with their dress (${dresses.join(" / ")})`)
  assert(lists.every((tags) => !tags.includes("winter coat")), "K1: the outfit with a coat over it is never lent")
  const issue = issueOf(result, "wearing")
  assert(!!issue && issue.fromDonors === 4 && issue.imposed === 0, `K1: four donors, none as typed (${JSON.stringify(issue)})`)
  // With too few outfits to measure, a dress next to the maid outfit is still a layer.
  const few = [...OWN, ...MAIDS.slice(0, 5)]
  const fewKinds = tagKindsFromPosts(few)
  const fewPool = buildScenePool(few, { overrides, permanence, subject: "girl", tagKind: (tag: string) => fewKinds.get(tag) })
  const strict = generateScenePack(fewPool, condArgs({ donorPosts: MAIDS.slice(0, 5).map((p) => p.id), requests: requests({ wearing: ["maid"], conditions: ["maid"] }) }))
  assert(strict.prompts.every((p) => !tagsOf(p.prompt).some((t) => / dress$/.test(t))), "K2: under MIN_PIECE_SUPPORT outfits, no piece is measured")
}

// ── N. Other names of a condition (conditionAliases) ─────────────────────────
{
  const QIPAO = [
    makePost(1200, "1girl solo standing smile qipao red_qipao chinese_clothes street outdoors looking_at_viewer day"),
    makePost(1201, "1girl solo sitting blush qipao red_qipao chinese_clothes bedroom indoors bed looking_at_viewer"),
    makePost(1202, "1girl solo standing open_mouth qipao blue_qipao chinese_clothes city outdoors day cloud"),
    makePost(1203, "1girl solo sitting grin qipao blue_qipao chinese_clothes park outdoors from_side"),
  ]
  const posts = [...OWN, ...QIPAO]
  const kinds = tagKindsFromPosts(posts)
  const pool = buildScenePool(posts, { overrides, permanence, subject: "girl", tagKind: (tag: string) => kinds.get(tag) })
  const ask = requests({ wearing: ["china dress"], conditions: ["china dress"] })
  const without = generateScenePack(pool, condArgs({ donorPosts: QIPAO.map((p) => p.id), requests: ask }))
  assert(issueOf(without, "wearing")?.variants === 0, "N1: without the aliases, posts tagged with another name don't meet it")
  const withAliases = generateScenePack(pool, condArgs({ donorPosts: QIPAO.map((p) => p.id), requests: ask, conditionAliases: { "china dress": ["qipao", "cheongsam"] } }))
  const lists = withAliases.prompts.map((p) => tagsOf(p.prompt))
  assert((issueOf(withAliases, "wearing")?.variants ?? 0) >= 2, `N2: with them, the qipao posts lend their variants (${JSON.stringify(issueOf(withAliases, "wearing"))})`)
  assert(lists.some((tags) => tags.includes("red china dress") || tags.includes("blue china dress")), "N2: the prompt says the condition's own name, qualified forms too")
  assert(lists.every((tags) => !tags.some((t) => /qipao/.test(t))), "N2: the other name doesn't reach the prompt")
}

done()
