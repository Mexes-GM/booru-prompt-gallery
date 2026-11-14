/**
 * Where a tag goes in the brief, decided by its role (lib/pack/tag-role.ts) with one rule for every
 * way in: real taxonomy, permanence data and measured relations, a cast of one girl. Covers the
 * classes of the tag-role audit (looks of the moment, objects and actions, the picture, the others,
 * composition, garment states, signature garments, ambience) and the plain cases, plus the owner's
 * own tags. Then the ambience of Where: Any (a condition: places that have it, the donors' too),
 * Exactly (added to each scene, which keeps its place).
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-brief-roles.verify.ts
 */
import fs from "fs"
import path from "path"
import assert from "node:assert/strict"
import { createPermanence, type PermanenceData } from "../lib/pack/scene/permanence"
import { parseTagRelations, setTagRelations, type TagRelationsFile } from "../lib/tag-relations"
import {
  addTag, briefConditions, briefFromPrompt, emptyBrief, setRequestExact, isAmbienceTag, isOthersTag, routeTag, setRoutePermanence, toSceneRequests, typedRole,
} from "../lib/pack/brief"
import { buildScenePool } from "../lib/pack/scene/scene-pool"
import { cleanSyntheticPrompt } from "../lib/pack/bulk-send"
import { DEFAULT_SCENE_SETTINGS, generateScenePack, tagKindsFromPosts, type ScenePackArgs } from "../lib/pack/scene-pack"
import type { SceneRequests } from "../lib/pack/brief"
import { makePost } from "./fixtures/pack-scene-data"

const root = path.join(__dirname, "..")
const CORE: Record<string, string> = JSON.parse(fs.readFileSync(path.join(root, "public/tags-core.json"), "utf8"))
const PERMANENCE: PermanenceData = JSON.parse(fs.readFileSync(path.join(root, "public/tag-permanence.json"), "utf8"))
const overrides: Record<string, string> = {}
for (const [tag, slot] of Object.entries(CORE)) overrides[tag.replace(/_/g, " ")] = slot
const permanence = createPermanence(PERMANENCE, overrides)
setTagRelations(parseTagRelations(JSON.parse(fs.readFileSync(path.join(root, "public/tag-relations.json"), "utf8")) as TagRelationsFile))
setRoutePermanence(permanence)

let passed = 0
const check = (name: string, fn: () => void) => {
  try { fn(); passed++ } catch (err) { console.error(`FAIL: ${name}`); throw err }
}

type Row = "who" | "character" | "others" | "wearing" | "doing" | "where" | "ambience" | "also" | "style" | "people" | "composition"
/** The row a tag lands in, as the builder reads it: the others first (a cast of one girl), then the route. */
function rowOf(tag: string): Row {
  const route = routeTag(tag, overrides)
  if (route.kind === "people") return "people"
  if (route.kind === "composition") return "composition"
  if (route.kind === "character") return "character"
  if (isOthersTag(tag, ["girl"], overrides, permanence)) return "others"
  if (route.kind === "look") return "who"
  if (route.kind === "literal") return "style"
  if (route.role === "where" && isAmbienceTag(tag, overrides)) return "ambience"
  return route.role
}

const EXPECTED: Record<Row, string[]> = {
  // Lasting traits of the character.
  who: [
    "long hair", "blue eyes", "large breasts", "ponytail", "animal ears", "black hair", "red eyes", "short hair",
    "twintails", "freckles", "fox girl", "breasts", "mature female", "dark-skinned female", "bald", "dark skin", "tail",
  ],
  character: ["tifa lockhart", "hatsune miku"],
  // The others: another gender's words, the other sex's body, comparisons of the people.
  others: [
    "penis", "huge penis", "dark-skinned male", "pectorals", "testicles", "muscular male", "faceless male", "old man",
    "interracial",
  ],
  // Garments, signature accessories included.
  wearing: [
    "fingerless gloves", "hat", "glasses", "hair ornament", "hair ribbon", "hairband", "bow", "bikini", "crop top",
    "thighhighs", "boots", "choker", "dress", "school uniform", "maid", "jacket", "skirt", "pantyhose", "sneakers",
    "earrings", "elbow gloves", "kimono", "swimsuit", "shirt",
  ],
  // Actions, a garment moved for the moment, actions filed with the objects.
  doing: [
    "reading", "shirt lift", "panties aside", "skirt lift", "bra pull", "clothes lift", "sitting", "standing", "lying",
    "princess carry", "hug", "running", "carrying", "eating", "drinking", "sex", "fellatio", "sweat", "grabbing own breast",
    "girl on top", "kneeling", "squatting", "walking", "arms up",
  ],
  // Places.
  where: ["beach", "classroom", "bedroom", "forest", "bench", "bed", "chair", "flower", "outdoors", "indoors", "simple background", "white background", "street"],
  // The time, the weather, the light: shown in Where, asked as Also.
  ambience: ["night", "sunset", "rain", "day", "sky", "cloud", "sparkle"],
  // How the character looks in this picture, expressions, the shot, objects, garments worn open or left off.
  also: [
    "navel", "between breasts", "nipples", "closed eyes", "cleavage", "collarbone", "thighs", "midriff", "ass", "pussy",
    "armpits", "upper body", "full body", "smile", "blush", "open mouth", "tears", "from behind", "from above",
    "cowboy shot", "looking at viewer", "book", "sword", "umbrella", "cat", "cup", "vibrator", "open jacket",
    "no panties", "open clothes", "torn clothes",
    // "holding X" stays Also while the engine's routing test fixes it there (pack-scene-doing.verify.ts).
    "holding sword", "holding cup",
  ],
  // How the picture is made, names of works and artists, and what nothing knows.
  style: [
    "no lineart", "realistic", "@angeltights", "final fantasy", "absurdres", "monochrome", "censored", "speech bubble",
    "highres", "english text", "heart", "masterpiece", "floral print",
  ],
  people: ["1girl", "2boys", "solo", "3girls", "6+girls"],
  composition: ["hetero", "yuri", "multiple girls", "male focus", "solo focus", "multiple boys", "yaoi"],
}

check("every tag lands where its role says (at least 120 tags, the owner's own included)", () => {
  const all = Object.values(EXPECTED).flat()
  assert.ok(all.length >= 120, `${all.length} tags`)
  const wrong: string[] = []
  for (const [row, tags] of Object.entries(EXPECTED) as Array<[Row, string[]]>) {
    for (const tag of tags) {
      const got = rowOf(tag)
      if (got !== row) wrong.push(`${tag}: ${got}, expected ${row}`)
    }
  }
  assert.deepEqual(wrong, [])
})

check("the owner's tags", () => {
  const owner: Array<[string, Row]> = [
    ["reading", "doing"], ["penis", "others"], ["between breasts", "also"], ["navel", "also"], ["dark-skinned male", "others"],
    ["huge penis", "others"], ["pectorals", "others"], ["fingerless gloves", "wearing"], ["hat", "wearing"],
    ["night", "ambience"], ["shirt lift", "doing"], ["hetero", "composition"], ["holding sword", "also"],
    ["@angeltights", "style"], ["no lineart", "style"], ["realistic", "style"],
  ]
  for (const [tag, row] of owner) assert.equal(rowOf(tag), row, tag)
})

check("a tag nothing knows: from a suggestion, by what it said; typed, stays in Wearing, Doing or Where; else Style", () => {
  assert.equal(typedRole("qwzx", "also", overrides, "general"), "also")
  assert.equal(typedRole("someartist", "also", overrides, "artist"), undefined)
  assert.equal(typedRole("some work", "wearing", overrides, "copyright"), undefined)
  assert.equal(typedRole("@angeltights", "wearing", overrides), undefined, "@name: Style wherever typed")
  assert.equal(typedRole("qwzx", "wearing", overrides), "wearing")
  assert.equal(typedRole("qwzx", "doing", overrides), "doing")
  assert.equal(typedRole("qwzx", "also", overrides), undefined)
  // A tag with a role goes where its role says, wherever typed.
  assert.equal(typedRole("hat", "doing", overrides), "wearing")
})

check("the same rule for a pasted prompt: composition apart, never lost; ambience a place condition, exact as Also", () => {
  const { brief, peopleTags } = briefFromPrompt("1girl, hetero, navel, hat, night, beach, shirt lift, realistic", overrides)
  assert.deepEqual(peopleTags, ["1girl", "hetero"])
  assert.deepEqual(brief.requests.map((r) => [r.tag, r.role, !!r.ambience]), [
    ["navel", "also", false], ["hat", "wearing", false], ["night", "where", true], ["beach", "where", false], ["shirt lift", "doing", false],
  ])
  assert.deepEqual(brief.literal, ["realistic"])
  const asked = toSceneRequests(brief)
  assert.deepEqual(asked.where, ["night", "beach"])
  assert.deepEqual(asked.also, ["navel"])
  const exact = toSceneRequests(setRequestExact(brief, "night", true))
  assert.deepEqual(exact.where, ["beach"])
  assert.deepEqual(exact.also, ["navel", "night"])
  // A pairing typed or added is no tag of the brief.
  assert.deepEqual(addTag(emptyBrief(), "hetero", overrides).requests, [])
})

// ── night keeps the scene's place ────────────────────────────────────────────
const POSTS = [
  makePost(801, "1girl solo standing smile bikini beach ocean sand day looking_at_viewer"),
  makePost(802, "1girl solo sitting blush sundress beach shore sand palm_tree day"),
  makePost(803, "1girl solo standing open_mouth school_uniform classroom indoors desk chair"),
  makePost(804, "1girl solo sitting smile sweater bedroom indoors bed pillow"),
]
const kinds = tagKindsFromPosts(POSTS)
const pool = buildScenePool(POSTS, { overrides, permanence, subject: "girl", tagKind: (tag: string) => kinds.get(tag) })
const clean = (tags: string[], locked: string[]) =>
  cleanSyntheticPrompt(tags, ["tifa lockhart"], {
    excludeInput: "", addInput: "", includeCharacters: true, optimizeTags: false, smartTagExclusion: true, tagOverrides: overrides, lockedTags: locked,
  }, locked)
const args = (requests: SceneRequests): ScenePackArgs => ({
  identity: ["tifa lockhart"], alwaysAdd: [], subject: "girl", settings: DEFAULT_SCENE_SETTINGS, count: 4, seed: 3,
  overrides, clean, permanence, people: { girls: 1, boys: 0 }, requests,
})
const PLACES = ["beach", "classroom", "bedroom"]
const placesOf = (prompt: string) => prompt.split(",").map((t) => t.trim()).filter((t) => PLACES.includes(t))

check("night, Exactly: added to each scene (Also), which keeps its place; imposed as a place, it loses it", () => {
  const brief = setRequestExact(addTag(emptyBrief(), "night", overrides), "night", true)
  const requests = toSceneRequests(brief)
  assert.deepEqual(requests.also, ["night"])
  assert.deepEqual(requests.where, [])
  const kept = generateScenePack(pool, args(requests)).prompts
  assert.equal(kept.length, 4)
  for (const p of kept) {
    assert.ok(p.prompt.split(",").map((t) => t.trim()).includes("night"), p.prompt)
    assert.equal(placesOf(p.prompt).length, 1, `the scene's place stays: ${p.prompt}`)
  }
  const lost = generateScenePack(pool, args({ select: [], wearing: [], where: ["night"], also: [], literal: [] })).prompts
  assert.ok(lost.every((p) => placesOf(p.prompt).length === 0), lost.map((p) => p.prompt).join("\n"))
})

// ── Any: a place that has it ─────────────────────────────────────────────────
const OWN = [
  makePost(811, "1girl solo standing smile white_shirt skirt simple_background white_background looking_at_viewer"),
  makePost(812, "1girl solo sitting blush sweater bedroom indoors bed pillow"),
  makePost(813, "1girl solo standing open_mouth jacket street outdoors day building"),
  makePost(814, "1girl solo sitting smile coat park outdoors bench tree day"),
]
const DONORS = [
  makePost(851, "1girl solo standing smile coat snow outdoors winter tree forest snowing"),
  makePost(852, "1girl solo sitting blush scarf snow outdoors mountain winter sky"),
  makePost(853, "1girl solo standing open_mouth jacket snow street outdoors night city lights"),
  makePost(854, "1girl solo standing smile sweater night outdoors city cityscape building"),
  makePost(855, "1girl solo sitting blush yukata night outdoors festival lantern"),
  makePost(856, "1girl solo standing smile dress night beach ocean moon sky"),
]
const ANY_POSTS = [...OWN, ...DONORS]
const anyKinds = tagKindsFromPosts(ANY_POSTS)
const anyPool = buildScenePool(ANY_POSTS, { overrides, permanence, subject: "girl", tagKind: (tag: string) => anyKinds.get(tag) })
const PLAIN = ["white background", "simple background"]

for (const ambience of ["snow", "night"]) {
  check(`${ambience}, Any: a place condition met in every prompt, places of the donors, never on a plain background`, () => {
    const brief = addTag(emptyBrief(), ambience, overrides)
    assert.deepEqual(briefConditions(brief, overrides), [ambience])
    const requests = { ...toSceneRequests(brief), conditions: briefConditions(brief, overrides) }
    assert.deepEqual(requests.where, [ambience])
    assert.deepEqual(requests.also, [])
    const result = generateScenePack(anyPool, { ...args(requests), donorPosts: DONORS.map((p) => p.id) })
    assert.equal(result.prompts.length, 4, JSON.stringify(result.issues))
    const places = new Set<string>()
    for (const p of result.prompts) {
      const tags = p.prompt.split(",").map((t) => t.trim())
      assert.ok(tags.includes(ambience), p.prompt)
      assert.ok(!tags.some((t) => PLAIN.includes(t)), `no plain background with ${ambience}: ${p.prompt}`)
      places.add(tags.filter((t) => overrides[t]?.startsWith("scenery:setting")).sort().join("|"))
    }
    assert.ok(places.size >= 2, `more than one place: ${[...places].join(" / ")}`)
    const variety = result.issues.find((i) => i.kind === "condition-variety" && i.role === "where")
    assert.ok(variety && variety.kind === "condition-variety" && variety.variants >= 2, JSON.stringify(result.issues))
  })
}

console.log(`pack-brief-roles: ${passed} checks passed`)
