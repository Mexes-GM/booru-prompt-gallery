/**
 * Tests for how the people besides the named characters look (ScenePackArgs.requests.others).
 * Real taxonomy snapshot, permanence data and measured tag relations.
 *
 * Covers:
 *   1. A picture of three people and one named character: every prompt has the tags, as a block
 *      right after the character's identity and before the scene's tags; the rest of each prompt is
 *      the prompt made without them (they take nothing of the character's or the scene's).
 *   2. A scene that already has one of the tags: it shows once, in the block.
 *   3. A picture of one person: none of them, and the pack says why (request-dropped, composition);
 *      the prompts are those made without them. A cast of two in a picture of two: same.
 *   4. A tag also in "Never include": in no prompt, and the pack says why.
 *   5. Without `others`, or with it empty: the prompts made before the field existed.
 *   6. Async = sync; a reroll and a one-axis pack (`changes`) keep them.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-scene-others.verify.ts
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
  generateScenePackAsync,
  rerollScenePrompt,
  tagKindsFromPosts,
  type ScenePackArgs,
} from "../lib/pack/scene-pack"
import type { BooruPost } from "../lib/booru/types"
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
const poolOf = (posts: BooruPost[], people: { girls: number; boys: number }) => {
  const kinds = tagKindsFromPosts(posts)
  return buildScenePool(posts, { overrides, permanence, subject: "girl", tagKind: (tag: string) => kinds.get(tag), people })
}

const IDENTITY = ["test heroine", "long hair", "black hair", "red eyes"]
const OTHERS = ["dark-skinned male", "muscular male"]
const clean = (tags: string[], locked: string[]) =>
  cleanSyntheticPrompt(tags, ["test heroine"], {
    excludeInput: "", addInput: "", includeCharacters: true, optimizeTags: false, smartTagExclusion: true, tagOverrides: overrides, lockedTags: locked,
  }, locked)
const args = (over: Partial<ScenePackArgs> = {}): ScenePackArgs => ({
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
})

const TRIO_PEOPLE = { girls: 1, boys: 2 }
const TRIO = [
  adult(801, "1girl 2boys group_sex threesome nude nipples navel lying on_back bedroom indoors blush open_mouth sweat"),
  adult(802, "1girl 2boys threesome school_uniform skirt panties skirt_lift standing classroom indoors smile blush"),
  adult(803, "1girl 2boys threesome bikini cleavage navel kneeling beach outdoors looking_at_viewer open_mouth"),
  adult(804, "1girl 2boys threesome lingerie thighhighs cleavage sitting bed indoors closed_eyes blush"),
  adult(805, "1girl 2boys threesome dark-skinned_male sundress bare_shoulders collarbone standing park outdoors day smile"),
]
const trioPool = poolOf(TRIO, TRIO_PEOPLE)
const trioArgs = (over: Partial<ScenePackArgs> = {}) => args({ people: TRIO_PEOPLE, ...over })
const withOthers = requests({ others: OTHERS })

/** The prompt less the requested look, for comparing with the prompt made without it. */
const without = (prompt: string, drop: readonly string[]) => tagsOf(prompt).filter((t) => !drop.includes(t)).join(", ")

// ── 1. Three people, one named: the block after the identity, nothing else changes ──
{
  const plain = generateScenePack(trioPool, trioArgs({ requests: requests({}) }))
  const result = generateScenePack(trioPool, trioArgs({ requests: withOthers }))
  assert(result.prompts.length === 4, `1: four prompts (got ${result.prompts.length})`)
  for (const p of result.prompts) {
    const tags = tagsOf(p.prompt)
    const at = tags.indexOf("dark-skinned male")
    assert(at >= 0 && tags[at + 1] === "muscular male", `1: ${p.scene?.postId} has the block (${p.prompt})`)
    const identityEnd = Math.max(...IDENTITY.map((t) => tags.indexOf(t)))
    assert(IDENTITY.every((t) => tags.includes(t)) && at === identityEnd + 1, `1: ${p.scene?.postId} block right after the identity (${p.prompt})`)
    assert(tags.filter((t) => t === "dark-skinned male").length === 1, `1: ${p.scene?.postId} has the tag once`)
  }
  assert(
    JSON.stringify(result.prompts.map((p) => without(p.prompt, OTHERS))) === JSON.stringify(plain.prompts.map((p) => p.prompt)),
    "1: less the block, the prompts are the ones made without it"
  )
  assert(result.issues.length === 0, `1: no issue (${JSON.stringify(result.issues)})`)
  // With a request (imposed after the identity), the block still comes first.
  const asked = generateScenePack(trioPool, trioArgs({ requests: requests({ also: ["blush"], others: OTHERS }) }))
  assert(asked.prompts.length > 0, "1: prompts with a request too")
  for (const p of asked.prompts) {
    const tags = tagsOf(p.prompt)
    assert(tags.indexOf("dark-skinned male") === tags.indexOf("red eyes") + 1 && tags.indexOf("blush") > tags.indexOf("muscular male"), `1: block before the request (${p.prompt})`)
  }
}

// ── 2. The scene already has one of them: it shows once, in the block ──────────
{
  const result = generateScenePack(trioPool, trioArgs({ count: 5, requests: withOthers }))
  const of805 = result.prompts.find((p) => p.scene?.postId === 805)
  assert(!!of805, "2: the scene with dark-skinned male makes a prompt")
  if (of805) {
    const tags = tagsOf(of805.prompt)
    assert(tags.filter((t) => t === "dark-skinned male").length === 1, `2: once (${of805.prompt})`)
    assert(tags.indexOf("dark-skinned male") === tags.indexOf("red eyes") + 1, `2: in the block (${of805.prompt})`)
  }
}

// ── 3. One person (or a cast that fills the picture): none, and the pack says why ──
{
  const SOLO = [
    makePost(901, "1girl solo sitting smile blush looking_at_viewer bedroom indoors shirt collarbone"),
    makePost(902, "1girl solo standing blush open_mouth street outdoors dress bare_shoulders"),
    makePost(903, "1girl solo lying on_side bed indoors pajamas closed_eyes navel"),
  ]
  const soloPool = poolOf(SOLO, { girls: 1, boys: 0 })
  const plain = generateScenePack(soloPool, args({ people: { girls: 1, boys: 0 }, count: 3, requests: requests({}) }))
  const result = generateScenePack(soloPool, args({ people: { girls: 1, boys: 0 }, count: 3, requests: withOthers }))
  assert(result.prompts.length === 3, `3: three prompts (got ${result.prompts.length})`)
  assert(result.prompts.every((p) => !OTHERS.some((t) => tagsOf(p.prompt).includes(t))), "3: no prompt has them")
  assert(JSON.stringify(result.prompts.map((p) => p.prompt)) === JSON.stringify(plain.prompts.map((p) => p.prompt)), "3: the prompts are unchanged")
  for (const tag of OTHERS) {
    assert(
      result.issues.some((i) => i.kind === "request-dropped" && i.tag === tag && i.role === "others" && i.reason === "composition"),
      `3: the pack says ${tag} was left out (${JSON.stringify(result.issues)})`
    )
  }

  const PAIR = [
    adult(951, "1girl 1boy hetero hug standing street outdoors smile blush shirt skirt"),
    adult(952, "1girl 1boy hetero holding_hands walking park outdoors day smile dress bare_shoulders"),
  ]
  const pairPool = poolOf(PAIR, { girls: 1, boys: 1 })
  const cast = generateScenePack(pairPool, args({ people: { girls: 1, boys: 1 }, castSize: 2, identity: [...IDENTITY, "test hero"], count: 2, requests: withOthers }))
  assert(cast.prompts.length > 0 && cast.prompts.every((p) => !OTHERS.some((t) => tagsOf(p.prompt).includes(t))), "3: a cast of two in a picture of two gets none")
  const single = generateScenePack(pairPool, args({ people: { girls: 1, boys: 1 }, count: 2, requests: withOthers }))
  assert(single.prompts.length > 0 && single.prompts.every((p) => tagsOf(p.prompt).includes("dark-skinned male")), "3: one character in a picture of two gets them")
}

// ── 4. Never wins ───────────────────────────────────────────────────────────────
{
  const result = generateScenePack(trioPool, trioArgs({ count: 5, never: ["dark-skinned male"], requests: withOthers }))
  assert(result.prompts.every((p) => !tagsOf(p.prompt).includes("dark-skinned male")), "4: never in a prompt")
  assert(result.prompts.every((p) => tagsOf(p.prompt).includes("muscular male")), "4: the other tag stays")
  assert(
    result.issues.some((i) => i.kind === "request-dropped" && i.tag === "dark-skinned male" && i.role === "others" && i.reason === "never"),
    `4: the pack says why (${JSON.stringify(result.issues)})`
  )
}

// ── 5. Without others: as before ────────────────────────────────────────────────
{
  const base = generateScenePack(trioPool, trioArgs({ requests: requests({}) }))
  const empty = generateScenePack(trioPool, trioArgs({ requests: requests({ others: [] }) }))
  const none = generateScenePack(trioPool, trioArgs())
  const key = (r: typeof base) => JSON.stringify([r.prompts.map((p) => p.prompt), r.issues])
  assert(key(base) === key(empty), "5: an empty list changes nothing")
  assert(JSON.stringify(none.prompts.map((p) => p.prompt)) === JSON.stringify(base.prompts.map((p) => p.prompt)), "5: no requests at all, same prompts")
}

// ── 6. Async, reroll, one axis ──────────────────────────────────────────────────
async function asyncRerollAxis() {
  const a = trioArgs({ requests: withOthers })
  const sync = generateScenePack(trioPool, a)
  const later = await generateScenePackAsync(trioPool, a, { pause: async () => {}, cancelled: () => false })
  assert(!!later && JSON.stringify(sync.prompts.map((p) => p.prompt)) === JSON.stringify(later.prompts.map((p) => p.prompt)), "6: async = sync")
  const again = rerollScenePrompt(trioPool, sync.prompts, 0, a)
  assert(!!again && tagsOf(again.prompt).includes("dark-skinned male"), `6: the reroll keeps them (${again?.prompt})`)
  for (const changes of ["outfit", "place"] as const) {
    const axis = generateScenePack(trioPool, trioArgs({ changes, requests: withOthers }))
    assert(axis.prompts.length > 1, `6: ${changes}: several prompts (got ${axis.prompts.length})`)
    assert(axis.prompts.every((p) => tagsOf(p.prompt).indexOf("dark-skinned male") === tagsOf(p.prompt).indexOf("red eyes") + 1), `6: ${changes}: every prompt has the block`)
    const plain = generateScenePack(trioPool, trioArgs({ changes, requests: requests({}) }))
    assert(
      JSON.stringify(axis.prompts.map((p) => without(p.prompt, OTHERS))) === JSON.stringify(plain.prompts.map((p) => p.prompt)),
      `6: ${changes}: less the block, the same pack`
    )
    if (axis.prompts.length > 1) {
      const swap = rerollScenePrompt(trioPool, axis.prompts, 1, trioArgs({ changes, requests: withOthers }))
      assert(!swap || tagsOf(swap.prompt).includes("dark-skinned male"), `6: ${changes}: the reroll keeps them`)
    }
  }
}

asyncRerollAxis().then(done)
