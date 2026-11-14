/**
 * Tests for the pairing tag of a prompt (hetero, yuri, yaoi), worked out from the act of its scene
 * and its people instead of copied from the post.
 *
 * Covers:
 *   P1. The same hug between a girl and a boy: rated explicit, "hetero"; rated general, none,
 *       whether or not the post carried it.
 *   P2. An adult act between two girls: "yuri"; between two boys: "yaoi".
 *   P3. No act between people: no pairing, even if the post has one.
 *   P4. Coherence: every prompt of the same act and people gets the same pairing.
 *   P5. A pairing in "Never include" never comes; one asked for in the identity stays the only one.
 *   P6. An act the measured relations say requires a pairing gives it whatever the rating.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-scene-pairing.verify.ts
 */
import fs from "fs"
import path from "path"
import { buildScenePool } from "../lib/pack/scene/scene-pool"
import { createPermanence, type PermanenceData } from "../lib/pack/scene/permanence"
import { cleanSyntheticPrompt } from "../lib/pack/bulk-send"
import { parseTagRelations, requiredBy, setTagRelations, type TagRelationsFile } from "../lib/tag-relations"
import { DEFAULT_SCENE_SETTINGS, generateScenePack, tagKindsFromPosts, type ScenePackArgs } from "../lib/pack/scene-pack"
import { makeAssert, makePost } from "./fixtures/pack-scene-data"

const { assert, done } = makeAssert()
const root = path.join(__dirname, "..")
const CORE: Record<string, string> = JSON.parse(fs.readFileSync(path.join(root, "public/tags-core.json"), "utf8"))
const overrides: Record<string, string> = {}
for (const [tag, slot] of Object.entries(CORE)) overrides[tag.replace(/_/g, " ")] = slot
const permanence = createPermanence(JSON.parse(fs.readFileSync(path.join(root, "public/tag-permanence.json"), "utf8")) as PermanenceData, overrides)
const relations = parseTagRelations(JSON.parse(fs.readFileSync(path.join(root, "public/tag-relations.json"), "utf8")) as TagRelationsFile)
setTagRelations(relations)
const tagsOf = (prompt: string) => prompt.split(",").map((t) => t.trim())
const clean = (tags: string[], locked: string[]) =>
  cleanSyntheticPrompt(tags, ["test heroine"], { excludeInput: "", addInput: "", includeCharacters: true, optimizeTags: false, smartTagExclusion: true, tagOverrides: overrides, lockedTags: locked }, locked)
const PAIRINGS = ["hetero", "yuri", "yaoi"]
const pairingOf = (prompt: string) => tagsOf(prompt).filter((t) => PAIRINGS.includes(t)).join("+")

function pack(posts: ReturnType<typeof makePost>[], people: { girls: number; boys: number }, over: Partial<ScenePackArgs> = {}) {
  const kinds = tagKindsFromPosts(posts)
  const pool = buildScenePool(posts, { overrides, permanence, subject: "girl", tagKind: (tag: string) => kinds.get(tag), people })
  return generateScenePack(pool, {
    identity: ["test heroine", "long hair"], alwaysAdd: [], people, subject: "girl", settings: DEFAULT_SCENE_SETTINGS,
    count: posts.length, seed: 1, overrides, clean, permanence, ...over,
  })
}
const PAIR = { girls: 1, boys: 1 }
const hugs = (rating: string, withTag: boolean) => [
  makePost(1, `1girl 1boy ${withTag ? "hetero " : ""}hug standing white_dress park outdoors smile day`, { rating }),
  makePost(2, `1girl 1boy ${withTag ? "hetero " : ""}hug sitting sweater jeans bedroom indoors blush bed`, { rating }),
]

// ── P1 ───────────────────────────────────────────────────────────────────────
{
  const adult = pack(hugs("explicit", false), PAIR)
  assert(adult.prompts.length === 2 && adult.prompts.every((p) => pairingOf(p.prompt) === "hetero"), "P1: a hug rated explicit carries the pairing of a girl and a boy")
  assert(adult.prompts.every((p) => tagsOf(p.prompt).slice(0, 3).join() === "1girl,1boy,hetero"), "P1: in the header, after the counts")
  const general = pack(hugs("general", true), PAIR)
  assert(general.prompts.length === 2 && general.prompts.every((p) => pairingOf(p.prompt) === ""), "P1: the same hug rated general carries none, though the post had it")
}
// ── P2 ───────────────────────────────────────────────────────────────────────
{
  const girls = pack([
    makePost(11, "2girls hug standing bikini beach outdoors blush day", { rating: "explicit" }),
    makePost(12, "2girls hug lying nude bed bedroom indoors smile", { rating: "explicit" }),
  ], { girls: 2, boys: 0 })
  assert(girls.prompts.length > 0 && girls.prompts.every((p) => pairingOf(p.prompt) === "yuri"), "P2: two girls with an adult act: yuri")
  const boys = pack([
    makePost(21, "1girl 2boys hug standing dress park outdoors smile day", { rating: "explicit" }),
    makePost(22, "2boys hug standing shirt park outdoors smile day sky", { rating: "explicit" }),
    makePost(23, "2boys hug sitting jacket bedroom indoors blush bed", { rating: "explicit" }),
  ], { girls: 0, boys: 2 }, { subject: "boy", identity: ["test hero", "short hair"] })
  assert(boys.prompts.length > 0 && boys.prompts.every((p) => pairingOf(p.prompt) === "yaoi"), "P2: two boys with an adult act: yaoi")
}
// ── P3 ───────────────────────────────────────────────────────────────────────
{
  const noAct = pack([
    makePost(31, "1girl 1boy hetero standing white_dress park outdoors smile day", { rating: "explicit" }),
    makePost(32, "1girl 1boy hetero sitting sweater bedroom indoors blush bed", { rating: "explicit" }),
  ], PAIR)
  assert(noAct.prompts.length > 0 && noAct.prompts.every((p) => pairingOf(p.prompt) === ""), "P3: no act between people, no pairing")
}
// ── P4 ───────────────────────────────────────────────────────────────────────
{
  const mixed = pack([...hugs("explicit", false), makePost(3, "1girl 1boy hetero hug kneeling kimono shrine outdoors closed_eyes", { rating: "explicit" })], PAIR)
  assert(new Set(mixed.prompts.map((p) => pairingOf(p.prompt))).size === 1, "P4: the same act and people, the same pairing, whatever each post carried")
}
// ── P5 ───────────────────────────────────────────────────────────────────────
{
  const never = pack(hugs("explicit", true), PAIR, { never: ["hetero"] })
  assert(never.prompts.every((p) => pairingOf(p.prompt) === ""), "P5: a pairing in Never include never comes")
  const asked = pack(hugs("explicit", false), PAIR, { identity: ["test heroine", "long hair", "yuri"] })
  assert(asked.prompts.every((p) => !tagsOf(p.prompt).includes("hetero")), "P5: a pairing in the identity is the only one")
}
// ── P6 ───────────────────────────────────────────────────────────────────────
{
  const act = ["missionary", "cowgirl position", "paizuri"].find((t) => requiredBy(relations, t).includes("hetero"))
  if (act) {
    const required = pack([
      makePost(41, `1girl 1boy ${act.replace(/ /g, "_")} lying bed bedroom indoors blush`, { rating: "questionable" }),
      makePost(42, `1girl 1boy ${act.replace(/ /g, "_")} sitting couch living_room indoors smile`, { rating: "questionable" }),
    ], PAIR)
    assert(required.prompts.length > 0 && required.prompts.every((p) => pairingOf(p.prompt) === "hetero"), `P6: "${act}" requires hetero`)
  } else {
    assert(true, "P6: (no measured act requires hetero in this relations file)")
  }
}

done()
