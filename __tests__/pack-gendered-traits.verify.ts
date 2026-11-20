/**
 * Tests for traits written with a gender ("light-skinned female", "fat male", "nude female"):
 * lib/pack/scene/people.ts genderedTrait, extractScene, and the Others request (scene-pack withOthers).
 *
 * Covers:
 *   G. The reading: the trait on its own (its core) and whose it is, from the taxonomy, or from the
 *      two-word tags that share the core's noun ("light skin" from "dark skin", "pale skin"...);
 *      none for a tag with data of its own, two people in one tag, or a word the data doesn't know.
 *   S. The scene: a lasting trait of the named character's gender never comes from another post;
 *      a companion's travels only with the source's theme; a trait of the moment ("nude female")
 *      travels where its core does (exposure). Tags with data of their own are read as before.
 *   O. Asking for the others' look (Others) replaces the companion's look the scene brought.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-gendered-traits.verify.ts
 */
import fs from "fs"
import path from "path"
import { genderedTrait } from "../lib/pack/scene/people"
import { extractScene, sceneTags, type SceneContext } from "../lib/pack/scene/scene"
import { buildScenePool } from "../lib/pack/scene/scene-pool"
import { createPermanence, type PermanenceData } from "../lib/pack/scene/permanence"
import { DEFAULT_SCENE_SETTINGS, generateScenePack, type ScenePackArgs } from "../lib/pack/scene-pack"
import { makeAssert, makePost } from "./fixtures/pack-scene-data"

const { assert, done } = makeAssert()
const root = path.join(__dirname, "..")
const CORE: Record<string, string> = JSON.parse(fs.readFileSync(path.join(root, "public/tags-core.json"), "utf8"))
const overrides: Record<string, string> = {}
for (const [tag, slot] of Object.entries(CORE)) overrides[tag.replace(/_/g, " ")] = slot
const permanence = createPermanence(JSON.parse(fs.readFileSync(path.join(root, "public/tag-permanence.json"), "utf8")) as PermanenceData, overrides)
const read = (tag: string) => genderedTrait(tag, overrides, permanence)
const key = (tag: string) => {
  const t = read(tag)
  return t ? `${t.gender} ${t.core} ${t.slot} ${t.permanence}` : "null"
}

// ── G. The reading ───────────────────────────────────────────────────────────
assert(overrides["light skin"] === undefined, "G0: no tag spells 'light skin' (the case the family covers)")
assert(key("light-skinned female") === "girl light skin appearance:anatomy identity", `G1: a skin colour from its family (${key("light-skinned female")})`)
assert(key("pale-skinned male") === "boy pale skin appearance:anatomy identity", `G1: one the taxonomy spells (${key("pale-skinned male")})`)
assert(key("black-haired female") === "girl black hair appearance:hair identity", `G2: a hair colour (${key("black-haired female")})`)
assert(key("fat male") === "boy fat appearance:anatomy identity", `G3: a body trait (${key("fat male")})`)
assert(key("nude female") === "girl nude appearance:anatomy state", `G4: a state of this picture (${key("nude female")})`)
assert(key("topless female") === "girl topless clothing:top state", `G4: what someone wears (${key("topless female")})`)
for (const tag of ["dark-skinned male", "faceless male", "clothed female nude male", "voluptuous female", "solo female", "male focus", "female", "futa on female"]) {
  assert(read(tag) === null, `G5: "${tag}" is not read as a gendered trait (${key(tag)})`)
}

// ── S. The scene ─────────────────────────────────────────────────────────────
const TRAITS = "light-skinned_female black-haired_female nude_female fat_male light-skinned_male"
const SCENE = "1girl 1boy hetero sex kneeling bed indoors blush open_mouth sweat"
const ctx = (over: Partial<SceneContext> = {}): SceneContext => ({ overrides, permanence, subject: "girl", ...over })
for (const provider of [undefined, "rule34", "gelbooru"] as const) {
  const scene = extractScene(makePost(1, `${SCENE} ${TRAITS}`, { rating: "explicit" }), ctx(provider ? { provider } : {}))!
  const tags = sceneTags(scene)
  const site = provider ?? "no site"
  assert(!tags.includes("light-skinned female") && !tags.includes("black-haired female"), `S1 ${site}: the named character's look never comes from another post`)
  assert(!tags.includes("fat male") && !tags.includes("light-skinned male"), `S2 ${site}: a companion's look stays home when it is not the source's theme`)
  assert(scene.units.exposure.includes("nude female"), `S3 ${site}: "nude female" travels where "nude" does (${JSON.stringify(scene.units)})`)
}
{
  const themed = extractScene(makePost(2, `${SCENE} ${TRAITS}`, { rating: "explicit" }), ctx({ poolShare: () => 1 }))!
  assert(themed.units.body.includes("fat male") && themed.units.body.includes("light-skinned male"), "S4: a companion's look travels when it is the source's theme")
  assert(!sceneTags(themed).includes("light-skinned female"), "S4: the named character's never does")
  const two = extractScene(makePost(3, `2girls 1boy ${SCENE.replace("1girl 1boy ", "")} ${TRAITS}`, { rating: "explicit" }), ctx({ poolShare: () => 1 }))!
  assert(!sceneTags(two).includes("light-skinned female"), "S4: nor when another girl is there (nobody can tell whose it is)")
}
{
  const danbooru = makePost(4, `${SCENE} dark-skinned_male muscular_male faceless_male clothed_female_nude_male`, { rating: "explicit" })
  const a = extractScene(danbooru, ctx({ poolShare: () => 1, provider: "danbooru" }))!
  assert(a.units.body.includes("dark-skinned male") && a.units.body.includes("muscular male"), "S5: Danbooru's own gendered tags keep their data")
}

// ── O. Others ────────────────────────────────────────────────────────────────
{
  const people = { girls: 1, boys: 1 }
  const posts = [1, 2, 3, 4].map((id) => makePost(10 + id, `${SCENE} fat_male standing_sex smile`, { rating: "explicit" }))
  const pool = buildScenePool(posts, { overrides, permanence, subject: "girl", people })
  const args = (others?: string[]): ScenePackArgs => ({
    identity: ["alice (test)", "long hair", "black hair"],
    alwaysAdd: [],
    subject: "girl",
    settings: DEFAULT_SCENE_SETTINGS,
    count: 2,
    seed: 1,
    overrides,
    people,
    permanence,
    clean: (tags: string[]) => tags.join(", "),
    ...(others ? { requests: { select: [], wearing: [], where: [], also: [], literal: [], others } } : {}),
  })
  const plain = generateScenePack(pool, args()).prompts
  assert(plain.length > 0 && plain.every((p) => p.prompt.split(", ").includes("fat male")), "O1: the source's theme gives the companion's look")
  const asked = generateScenePack(pool, args(["muscular male"])).prompts
  assert(asked.length > 0 && asked.every((p) => p.prompt.split(", ").includes("muscular male") && !p.prompt.split(", ").includes("fat male")), `O2: what Others asks replaces it (${asked.map((p) => p.prompt).join(" | ")})`)
}

done()
