/**
 * Tests for requests as conditions the pack meets with variety (ScenePackArgs.requests): how the
 * people besides the characters look (`requests.others`), and Wearing / Where met by a different
 * outfit or place in each prompt. Real taxonomy snapshot, permanence data and measured relations.
 *
 * Covers:
 *   O. `others`: in every prompt of two or more people, after the character, winning over the
 *      scene's tags about the same trait of someone of that gender; never in a prompt of one person
 *      (`request-dropped`, reason 'composition'); without it nothing changes.
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

// ── O. How the others look ──────────────────────────────────────────────────
{
  const PAIR = [
    makePost(601, "1girl 1boy hetero hug navel midriff crop_top street outdoors smile"),
    makePost(602, "1girl 1boy hetero holding_hands collarbone sundress park outdoors day blush"),
    makePost(603, "1girl 1boy hetero princess_carry white_dress forest outdoors open_mouth"),
    makePost(604, "1girl 1boy hetero hug from_behind school_uniform classroom indoors closed_eyes"),
  ]
  const kinds = tagKindsFromPosts(PAIR)
  const people = { girls: 1, boys: 1 }
  const pool = buildScenePool(PAIR, { overrides, permanence, subject: "girl", tagKind: (tag: string) => kinds.get(tag), people })
  const others = ["dark-skinned male", "muscular male"]
  const result = generateScenePack(pool, baseArgs({ people, requests: requests({ others }) }))
  assert(result.prompts.length === pool.scenes.length && result.prompts.length >= 3, "O1: a prompt per scene of two people")
  assert(result.prompts.every((p) => others.every((tag) => tagsOf(p.prompt).includes(tag))), "O1: every prompt of two people has the others' look")
  assert(result.prompts.every((p) => {
    const tags = tagsOf(p.prompt)
    return tags.indexOf("dark-skinned male") > tags.indexOf("red eyes")
  }), "O1: the others' look comes after the character's identity")
  assert(!result.issues.some((i) => i.kind === "request-dropped"), "O1: no issue when it went in")

  // A scene tag about the same trait of a man gives way ("pale-skinned male" in a pool about it).
  const PALE = PAIR.map((post, i) => makePost(700 + i, `${post.tag_string} pale-skinned_male`))
  const paleKinds = tagKindsFromPosts(PALE)
  const palePool = buildScenePool(PALE, { overrides, permanence, subject: "girl", tagKind: (tag: string) => paleKinds.get(tag), people })
  const plain = generateScenePack(palePool, baseArgs({ people, requests: requests({}) }))
  const withOthers = generateScenePack(palePool, baseArgs({ people, requests: requests({ others: ["dark-skinned male"] }) }))
  if (plain.prompts.some((p) => tagsOf(p.prompt).includes("pale-skinned male"))) {
    assert(withOthers.prompts.every((p) => !tagsOf(p.prompt).includes("pale-skinned male")), "O2: the scene's other skin of a man gives way to the others' look")
  } else {
    assert(true, "O2: (the pool keeps no other-person skin tag; nothing to give way)")
  }

  // One person: never in the prompt, and the pack says so.
  const SOLO = [
    makePost(801, "1girl solo standing navel crop_top street outdoors smile"),
    makePost(802, "1girl solo sitting sundress park outdoors day blush"),
  ]
  const soloKinds = tagKindsFromPosts(SOLO)
  const soloPool = buildScenePool(SOLO, { overrides, permanence, subject: "girl", tagKind: (tag: string) => soloKinds.get(tag) })
  const solo = generateScenePack(soloPool, baseArgs({ people: { girls: 1, boys: 0 }, count: 2, requests: requests({ others: ["dark-skinned male"] }) }))
  assert(solo.prompts.length > 0 && solo.prompts.every((p) => !tagsOf(p.prompt).includes("dark-skinned male")), "O3: not in a prompt of one person")
  assert(solo.issues.some((i) => i.kind === "request-dropped" && i.tag === "dark-skinned male" && i.role === "others" && i.reason === "composition"), "O3: request-dropped (composition) says so")
  // The composition not set: the pictures decide, and the pack still says it when none had room.
  const unset = generateScenePack(soloPool, baseArgs({ count: 2, requests: requests({ others: ["dark-skinned male"] }) }))
  assert(unset.issues.some((i) => i.kind === "request-dropped" && i.role === "others"), "O3: with no composition set, a pack of one-person pictures says it too")

  // Without `others` the pack is the same as before.
  const before = generateScenePack(pool, baseArgs({ people, requests: requests({}) }))
  const empty = generateScenePack(pool, baseArgs({ people, requests: requests({ others: [] }) }))
  assert(before.prompts.map((p) => p.prompt).join("\n") === empty.prompts.map((p) => p.prompt).join("\n"), "O4: an empty `others` changes nothing")
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

done()
