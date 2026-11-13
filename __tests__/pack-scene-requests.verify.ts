/**
 * Tests for the requests of the scenes engine (ScenePackArgs.requests), with the app's real
 * taxonomy snapshot, permanence data and measured tag relations.
 *
 * Covers:
 *   1. Interactions between people are not verbs that need an object: "princess carry" stays
 *      without "carrying" (filed with the hand objects); "shared umbrella" still needs one, and
 *      "holding" still goes with its sword when Extras is off.
 *   2. wearing: the garment is in every prompt; the scene's clothes and the character's usual
 *      clothes go, signature accessories stay; a scene already wearing it keeps its own clothes;
 *      the usual clothes don't come back through that scene.
 *   3. where: the scene's place goes, with the pose tags tied to it ("lying on bed").
 *   4. select / also: a requested posture or expression takes the scene's place.
 *   5. literal: first, as typed.
 *   6. The people rule: a scene tag that needs company leaves a one-person prompt; a requested
 *      one stays and the result reports it.
 *   7. Requests in "Never include" or against the composition are reported, not applied.
 *   8. Without requests nothing is reported; the async version returns the same issues.
 *   9. The natural formats take a Scenes prompt's rating from its scene, not from its words.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-scene-requests.verify.ts
 */
import fs from "fs"
import path from "path"
import { buildScenePool } from "../lib/pack/scene/scene-pool"
import { createPermanence, type PermanenceData } from "../lib/pack/scene/permanence"
import { composePack, danglingReferences, needsObject } from "../lib/pack/scene/scene-compose"
import { cleanSyntheticPrompt } from "../lib/pack/bulk-send"
import { parseTagRelations, setTagRelations, type TagRelationsFile } from "../lib/tag-relations"
import { packNaturalSource, packPromptRating } from "../lib/pack/pack-natural"
import {
  DEFAULT_SCENE_SETTINGS,
  generateScenePack,
  generateScenePackAsync,
  isWornByCharacter,
  tagKindsFromPosts,
  type ScenePackArgs,
} from "../lib/pack/scene-pack"
import type { SceneRequests } from "../lib/pack/brief"
import { makeAssert, makePost } from "./fixtures/pack-scene-data"

const { assert, done } = makeAssert()
const root = path.join(__dirname, "..")
const CORE: Record<string, string> = JSON.parse(fs.readFileSync(path.join(root, "public/tags-core.json"), "utf8"))
const PERMANENCE: PermanenceData = JSON.parse(fs.readFileSync(path.join(root, "public/tag-permanence.json"), "utf8"))
const overrides: Record<string, string> = {}
for (const [tag, slot] of Object.entries(CORE)) overrides[tag.replace(/_/g, " ")] = slot
const permanence = createPermanence(PERMANENCE, overrides)
const relations = parseTagRelations(JSON.parse(fs.readFileSync(path.join(root, "public/tag-relations.json"), "utf8")) as TagRelationsFile)
setTagRelations(relations)

const tagsOf = (prompt: string) => prompt.split(",").map((t) => t.trim())
const requests = (over: Partial<SceneRequests>): SceneRequests => ({ select: [], wearing: [], where: [], also: [], literal: [], ...over });


// ── 1. Interactions between people are not verbs that need an object ──
{
  for (const tag of ["princess carry", "carrying person", "piggyback", "reverse princess carry"]) {
    assert(!needsObject(tag, overrides, relations), `"${tag}" needs the other person, not an object`)
    assert(!danglingReferences(["1girl", "1boy", tag, "smile"], overrides).has(tag), `"${tag}" is not dangling without "carrying"`)
  }
  assert(needsObject("shared umbrella", overrides, relations), "an interaction a thing backs still needs it (shared umbrella)")
  assert(needsObject("drinking", overrides, relations), "a verb that is not an interaction still needs its object (drinking)")
  assert(danglingReferences(["1girl", "drinking", "smile"], overrides).has("drinking"), "drinking with nothing in hand still dangles")

  const ctx = { overrides, permanence, subject: "girl" as const, people: { girls: 1, boys: 1 } }
  const carry = buildScenePool([makePost(1, "1girl 1boy princess_carry carrying smile outdoors day dress")], ctx)
  const off = composePack(carry, { identity: ["1girl", "1boy"], subject: "girl", mix: "faithful", clothing: "scene", scenery: "scene", extras: false, count: 1, seed: 1, overrides }).prompts[0]
  assert(off.tags.includes("princess carry"), "Extras off: the scene keeps its princess carry: " + off.tags.join(", "))
  const armed = buildScenePool([makePost(2, "1girl solo standing holding sword smile bedroom indoors skirt shirt")], { ...ctx, people: undefined })
  const sword = composePack(armed, { identity: ["1girl"], subject: "girl", mix: "faithful", clothing: "scene", scenery: "scene", extras: false, count: 1, seed: 1, overrides }).prompts[0]
  assert(!sword.tags.includes("holding") && !sword.tags.includes("sword"), "Extras off: holding still goes with its sword")
}

// ── The pool and the engine ──
const scene = (id: number, tags: string, extra = {}) => makePost(id, tags, { rating: "general", ...extra })
const POSTS = [
  scene(201, "1girl solo standing smile looking_at_viewer bedroom bed indoors white_shirt pleated_skirt"),
  scene(202, "1girl solo standing open_mouth park outdoors tree day blue_dress boots"),
  scene(203, "1girl solo lying on_bed smile from_above bedroom indoors pajamas pillow"),
  scene(204, "1girl solo sitting smile looking_at_viewer classroom indoors chair desk shirt skirt"),
  scene(205, "1girl solo sitting blush beach outdoors ocean white_bikini earrings fingerless_gloves"),
  scene(206, "1girl solo standing looking_at_another smile street outdoors night jacket jeans"),
]
const pool = buildScenePool(POSTS, { overrides, permanence, subject: "girl", tagKind: (tag) => tagKindsFromPosts(POSTS).get(tag) })
const clean = (tags: string[], locked: string[]) =>
  cleanSyntheticPrompt(tags, ["test heroine"], {
    excludeInput: "", addInput: "", includeCharacters: true, optimizeTags: false, smartTagExclusion: true, tagOverrides: overrides, lockedTags: locked,
  }, locked)
const USUAL = ["crop top", "black skirt", "suspenders", "fingerless gloves", "elbow gloves", "earrings"]
const IDENTITY = ["test heroine", "long hair", "black hair", "red eyes", "hairband", ...USUAL]
const args = (over: Partial<ScenePackArgs> = {}): ScenePackArgs => ({
  identity: IDENTITY,
  alwaysAdd: [],
  people: { girls: 1, boys: 0 },
  subject: "girl",
  settings: DEFAULT_SCENE_SETTINGS,
  count: 6,
  seed: 3,
  overrides,
  clean,
  permanence,
  ...over,
});

// ── 2. wearing ──
{
  assert(isWornByCharacter("crop top", overrides, permanence) && isWornByCharacter("fingerless gloves", overrides, permanence), "usual clothes are worn")
  assert(!isWornByCharacter("hairband", overrides, permanence), "a signature accessory is the character")
  assert(!isWornByCharacter("black hair", overrides, permanence) && !isWornByCharacter("test heroine", overrides, permanence), "hair and name are the character")

  const { prompts, issues } = generateScenePack(pool, args({ requests: requests({ wearing: ["bikini"] }) }))
  assert(prompts.length >= 5, `a pack (${prompts.length})`)
  assert(issues.length === 0, "nothing to report")
  for (const p of prompts) {
    const tags = tagsOf(p.prompt)
    assert(tags.includes("bikini"), "the garment asked for is in every prompt: " + p.prompt)
    assert(!USUAL.some((t) => tags.includes(t)), "none of the usual clothes, not even through a scene: " + p.prompt)
    assert(tags.includes("hairband") && tags.includes("black hair"), "what the character is stays: " + p.prompt)
    assert(!["white shirt", "pleated skirt", "blue dress", "pajamas", "shirt", "skirt", "jacket", "jeans"].some((t) => tags.includes(t)), "no clothes of a scene that isn't wearing it: " + p.prompt)
  }
  const beach = prompts.find((p) => p.scene?.postId === 205)
  assert(!!beach && tagsOf(beach.prompt).includes("white bikini"), "a scene already in a bikini keeps its own: " + beach?.prompt)

  // Without requests the usual clothes stay as pinned traits.
  const plain = generateScenePack(pool, args())
  assert(plain.prompts.every((p) => tagsOf(p.prompt).includes("crop top")), "without requests the identity is untouched")
  assert(plain.issues.length === 0, "and nothing is reported")
}

// ── 3. where ──
{
  const { prompts } = generateScenePack(pool, args({ identity: IDENTITY.slice(0, 5), requests: requests({ where: ["beach"] }) }))
  for (const p of prompts) {
    const tags = tagsOf(p.prompt)
    assert(tags.includes("beach"), "the place asked for is in every prompt: " + p.prompt)
    assert(!["bedroom", "bed", "park", "classroom", "street", "indoors", "on bed"].some((t) => tags.includes(t)), "no place of the scene, nor pose tied to it: " + p.prompt)
  }
}

// ── 4. select / also ──
{
  const { prompts } = generateScenePack(pool, args({ identity: IDENTITY.slice(0, 5), requests: requests({ select: ["sitting"], also: ["smile"] }) }))
  for (const p of prompts) {
    const tags = tagsOf(p.prompt)
    assert(tags.includes("sitting") && !tags.includes("standing") && !tags.includes("lying"), "a requested posture takes the scene's: " + p.prompt)
    assert(tags.includes("smile") && !tags.includes("open mouth") && !tags.includes("blush"), "a requested expression takes the scene's: " + p.prompt)
  }
}

// ── 5. literal ──
{
  const { prompts } = generateScenePack(pool, args({ identity: IDENTITY.slice(0, 5), alwaysAdd: ["masterpiece"], requests: requests({ literal: ["score_9", "my lora"] }) }))
  for (const p of prompts) assert(tagsOf(p.prompt).slice(0, 3).join() === "score_9,my lora,masterpiece", "literal first, as typed, then Always add: " + p.prompt)
}

// ── 6. The people rule ──
{
  const plain = generateScenePack(pool, args({ identity: IDENTITY.slice(0, 5) }))
  const street = plain.prompts.find((p) => p.scene?.postId === 206)
  assert(!!street && !tagsOf(street.prompt).includes("looking at another"), "a scene tag that needs company leaves a one-person prompt: " + street?.prompt)

  const { prompts, issues } = generateScenePack(pool, args({ identity: IDENTITY.slice(0, 5), requests: requests({ select: ["princess carry"] }) }))
  assert(prompts.length > 0 && prompts.every((p) => tagsOf(p.prompt).includes("princess carry")), "a requested pose that needs company stays")
  const issue = issues.find((i) => i.kind === "needs-company")
  assert(!!issue && issue.tag === "princess carry" && issue.role === "select" && issue.kind === "needs-company" && issue.prompts === prompts.length, "and the result says it needs more than one person: " + JSON.stringify(issues))
}

// ── 7. Requests that can't be applied ──
{
  const { prompts, issues } = generateScenePack(pool, args({ identity: IDENTITY.slice(0, 5), never: ["beach"], requests: requests({ where: ["beach"], literal: ["2girls"] }) }))
  assert(prompts.every((p) => !tagsOf(p.prompt).includes("beach") && !tagsOf(p.prompt).includes("2girls")), "neither is applied")
  assert(issues.some((i) => i.kind === "request-dropped" && i.tag === "beach" && i.reason === "never"), "a request in Never include is reported")
  assert(issues.some((i) => i.kind === "request-dropped" && i.tag === "2girls" && i.reason === "composition"), "a count the composition contradicts is reported")
}

// ── 8. Async ──
void (async () => {
  const a = args({ identity: IDENTITY.slice(0, 5), requests: requests({ select: ["princess carry"] }) })
  const sync = generateScenePack(pool, a)
  const async = await generateScenePackAsync(pool, a, { pause: () => Promise.resolve(), cancelled: () => false })
  assert(!!async && JSON.stringify(async.issues) === JSON.stringify(sync.issues), "the async version reports the same issues")
  assert(!!async && async.prompts.map((p) => p.prompt).join("|") === sync.prompts.map((p) => p.prompt).join("|"), "and makes the same prompts")

  // ── 9. Natural formats: the scene's rating ──
  const general = { prompt: "1girl, 1boy, hetero, hug, smile", values: [], sceneRating: "g" as const }
  assert(packNaturalSource(general, { character: null, contentRating: "sfw" }).rating === "general", "a general scene with hetero stays general")
  assert(packPromptRating(general.prompt, "sfw", undefined, "s") === "sensitive", "a sensitive scene is sensitive")
  assert(packPromptRating(general.prompt, "sfw") === "explicit", "without a scene rating (Classic, saved packs) the words still decide")
  done()
})()
