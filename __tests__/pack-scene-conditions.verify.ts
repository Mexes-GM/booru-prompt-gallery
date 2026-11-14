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

done()
