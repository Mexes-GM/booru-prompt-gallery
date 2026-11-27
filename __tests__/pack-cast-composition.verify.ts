/**
 * A pack's scenes have exactly the people it names, unless the user asked for company. Real
 * taxonomy snapshot, permanence data and measured tag relations; adult characters by name only.
 *
 * Covers:
 *   1. A cast of three girls: a "3girls 1boy" scene is never used, a "3girls" one is; with only the
 *      first kind in the pool the pack has no make-up (packComposition null) and no prompt with a boy.
 *   2. The same with Rule34's spellings ("1girls 2girls 3girls", "male").
 *   3. One girl with "With 1 boy" picked: "1girl 1boy" scenes, never "1girl 2boys"; without the
 *      pick, neither; a requested act that needs company still finds its partner.
 *   4. The header never writes people the composition doesn't have, even from a pool built for
 *      another composition; a mixed pack keeps only its marked make-ups.
 *   5. One character per prompt: each turn's make-up is that character alone unless asked.
 *   6. The People line offers the make-ups there are when the pack's own is missing.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-cast-composition.verify.ts
 */
import fs from "fs"
import path from "path"
import { buildScenePool, type PackPeople } from "../lib/pack/scene/scene-pool"
import { createPermanence, type PermanenceData } from "../lib/pack/scene/permanence"
import { parseTagRelations, setTagRelations, type TagRelationsFile } from "../lib/tag-relations"
import { cleanSyntheticPrompt } from "../lib/pack/bulk-send"
import { DEFAULT_SCENE_SETTINGS, generateScenePack, poseCompositions, poseNeedsScene, type ScenePackArgs } from "../lib/pack/scene-pack"
import { packComposition, peopleChoices, peopleLineState } from "../lib/pack/brief-pack"
import type { SceneRequests } from "../lib/pack/brief"
import type { BooruPost, BooruProvider } from "../lib/booru/types"
import { makeAssert, makePost } from "./fixtures/pack-scene-data"

const { assert, done } = makeAssert()
const root = path.join(__dirname, "..")
const CORE: Record<string, string> = JSON.parse(fs.readFileSync(path.join(root, "public/tags-core.json"), "utf8"))
const PERMANENCE: PermanenceData = JSON.parse(fs.readFileSync(path.join(root, "public/tag-permanence.json"), "utf8"))
const overrides: Record<string, string> = {}
for (const [tag, slot] of Object.entries(CORE)) overrides[tag.replace(/_/g, " ")] = slot
const permanence = createPermanence(PERMANENCE, overrides)
setTagRelations(parseTagRelations(JSON.parse(fs.readFileSync(path.join(root, "public/tag-relations.json"), "utf8")) as TagRelationsFile))

const NAMES = ["tifa lockhart", "aerith gainsborough", "yuffie kisaragi"]
const requests = (over: Partial<SceneRequests> = {}): SceneRequests => ({ select: [], wearing: [], where: [], also: [], literal: [], ...over })
const SITTING = requests({ select: ["sitting"] })
const post = (id: number, tags: string) => makePost(id, tags, { rating: "general" })
const clean = (tags: string[], locked: string[]) =>
  cleanSyntheticPrompt(tags, NAMES, { excludeInput: "", addInput: "", includeCharacters: true, optimizeTags: false, smartTagExclusion: true, tagOverrides: overrides, lockedTags: locked }, locked)
const tagsOf = (prompt: string) => prompt.split(",").map((t) => t.trim())
const key = (p: PackPeople | null | undefined) => (p ? `${p.girls}/${p.boys}` : "none")
const COUNT = /^(\d+)(girls?|boys?)$/
/** The people the prompt's count tags write. */
function headerPeople(prompt: string): PackPeople {
  const out = { girls: 0, boys: 0 }
  for (const tag of tagsOf(prompt)) {
    const m = COUNT.exec(tag)
    if (m) out[m[2].startsWith("girl") ? "girls" : "boys"] = Number(m[1])
  }
  return out
}

const THREE: PackPeople = { girls: 3, boys: 0 }
const SCENE_TAIL = [
  "smile indoors living_room couch window day casual",
  "blush outdoors park bench tree skirt shirt",
  "open_mouth indoors classroom chair desk school_uniform",
  "looking_at_viewer outdoors beach sand ocean swimsuit",
]
/** Other scenes, so that no two posts of a test are near duplicates of each other. */
const OTHER_TAIL = [
  "laughing indoors kitchen table cup apron night",
  "closed_eyes outdoors garden flower hat dress sunlight",
  "wink indoors library bookshelf book sweater glasses",
  "surprised outdoors street city jacket jeans rain",
]

/** The hook's steps for a pack: pool of the characters' own make-up, poses, choices, make-up, pool of it. */
function pack(posts: BooruPost[], cast: PackPeople, over: { provider?: BooruProvider; picked?: PackPeople | null; req?: SceneRequests; subject?: "girl" | "boy" } = {}) {
  const subject = over.subject ?? (cast.girls > 0 ? "girl" : "boy")
  const req = over.req ?? SITTING
  const ctx = { overrides, permanence, subject, cast, provider: over.provider, tagKind: () => undefined }
  const base = buildScenePool(posts, { ...ctx, people: cast })
  const poses = poseCompositions(base, { requests: req, overrides })
  const choices = peopleChoices({ compositions: base.stats.compositions, poses, cast, hasPoses: req.select.length > 0 })
  const isCast = cast.girls + cast.boys >= 2
  const companyPose = req.select.some((tag) => poseNeedsScene(tag, overrides))
  const people = packComposition({ choices, cast, isCast, subject, picked: over.picked ?? null, character: true, companyPose })
  const pool = people ? buildScenePool(posts, { ...ctx, people }) : base
  const args: ScenePackArgs = {
    identity: isCast ? NAMES.slice(0, cast.girls + cast.boys) : [NAMES[0]],
    alwaysAdd: [], people, subject, castSize: cast.girls + cast.boys, settings: DEFAULT_SCENE_SETTINGS,
    count: 6, seed: 3, overrides, clean, permanence, requests: req,
  }
  return { people, choices, out: generateScenePack(pool, args) }
}

// ── 1. Three girls, Danbooru-like spelling ──
{
  const withBoy = SCENE_TAIL.map((tail, i) => post(100 + i, `3girls 1boy multiple_girls sitting ${tail}`))
  const own = OTHER_TAIL.map((tail, i) => post(200 + i, `3girls multiple_girls sitting ${tail}`))
  for (const provider of ["gelbooru", "danbooru"] as const) {
    const only = pack(withBoy.slice(0, 1), THREE, { provider })
    assert(only.choices.fitting.length === 1 && key(only.choices.fitting[0].people) === "3/1", `${provider}: the scene reads as three girls and a boy`)
    assert(only.people === null, `${provider}: one "3girls 1boy" scene gives the pack no make-up (${key(only.people)})`)
    assert(only.out.prompts.every((p) => !tagsOf(p.prompt).includes("1boy")), `${provider}: no prompt with a boy from it`)
    const both = pack([...withBoy, ...own], THREE, { provider })
    assert(key(both.people) === "3/0", `${provider}: the three girls' own make-up (${key(both.people)})`)
    const ids = both.out.prompts.map((p) => p.scene?.postId ?? -1)
    assert(both.out.prompts.length > 0 && ids.every((id) => id >= 200), `${provider}: prompts only from the "3girls" scenes: ${ids.join()}`)
    assert(both.out.prompts.every((p) => key(headerPeople(p.prompt)) === "3/0"), `${provider}: every header is three girls`)
    // Even when the scenes with a boy are more common.
    const crowded = pack([...withBoy, ...OTHER_TAIL.map((tail, i) => post(150 + i, `3girls 1boy multiple_girls sitting night ${tail}`)), post(199, "3girls multiple_girls sitting smile outdoors mountain snow coat scarf winter")], THREE, { provider })
    assert(key(crowded.choices.fitting[0]?.people) === "3/1", `${provider}: the make-up with a boy is the more common one here (${key(crowded.choices.fitting[0]?.people)})`)
    assert(key(crowded.people) === "3/0", `${provider}: a more common make-up with a boy is not the default`)
    // Asked for, the boy comes.
    const asked = pack(withBoy, THREE, { provider, picked: { girls: 3, boys: 1 } })
    assert(key(asked.people) === "3/1" && asked.out.prompts.every((p) => key(headerPeople(p.prompt)) === "3/1"), `${provider}: "With 1 boy" picked gives the boy`)
  }
}

// ── 2. Three girls, Rule34 spelling ──
{
  const withBoy = SCENE_TAIL.map((tail, i) => post(300 + i, `1girls 2girls 3girls male sitting ${tail}`))
  const own = OTHER_TAIL.map((tail, i) => post(400 + i, `1girls 2girls 3girls sitting ${tail}`))
  const only = pack(withBoy, THREE, { provider: "rule34" })
  assert(only.people === null && only.out.prompts.length === 0, `rule34: "3girls, male" scenes are not three girls (${key(only.people)})`)
  const both = pack([...withBoy, ...own], THREE, { provider: "rule34" })
  const ids = both.out.prompts.map((p) => p.scene?.postId ?? -1)
  assert(key(both.people) === "3/0" && both.out.prompts.length > 0 && ids.every((id) => id >= 400), `rule34: only the three girls' scenes: ${ids.join()}`)
  assert(both.out.prompts.every((p) => key(headerPeople(p.prompt)) === "3/0" && !tagsOf(p.prompt).includes("male")), "rule34: three girls in every header, no boy")
}

// ── 3. One girl, with and without company ──
{
  const GIRL: PackPeople = { girls: 1, boys: 0 }
  const pair = SCENE_TAIL.map((tail, i) => post(500 + i, `1girl 1boy hetero sitting ${tail}`))
  const trio = OTHER_TAIL.map((tail, i) => post(600 + i, `1girl 2boys multiple_boys sitting ${tail}`))
  const unasked = pack([...pair, ...trio], GIRL)
  assert(unasked.people === null && unasked.out.prompts.length === 0, `one girl, nothing asked: no scene with a boy (${key(unasked.people)})`)
  const withBoy = pack([...pair, ...trio], GIRL, { picked: { girls: 1, boys: 1 } })
  const ids = withBoy.out.prompts.map((p) => p.scene?.postId ?? -1)
  assert(key(withBoy.people) === "1/1" && withBoy.out.prompts.length > 0 && ids.every((id) => id >= 500 && id < 600), `"With 1 boy": only "1girl 1boy" scenes: ${ids.join()}`)
  assert(withBoy.out.prompts.every((p) => key(headerPeople(p.prompt)) === "1/1"), '"With 1 boy": one girl and one boy in every header')
  // An act that needs someone else asks for company by itself: the partner of its scenes.
  const hug = SCENE_TAIL.map((tail, i) => post(700 + i, `1girl 1boy hetero hug ${tail}`))
  const solo = OTHER_TAIL.map((tail, i) => post(800 + i, `1girl solo standing ${tail}`))
  assert(poseNeedsScene("hug", overrides), "hug needs company")
  const hugged = pack([...hug, ...solo], GIRL, { req: requests({ select: ["hug"] }) })
  assert(key(hugged.people) === "1/1", `a requested hug takes its scenes' partner (${key(hugged.people)})`)
  // A cast that is already company gets nobody for it.
  const PAIR2: PackPeople = { girls: 2, boys: 0 }
  const cast = packComposition({
    choices: { fitting: [{ people: { girls: 2, boys: 1 }, scenes: 9 }], fittingPoses: [{ people: { girls: 2, boys: 1 }, scenes: 9 }] },
    cast: PAIR2, isCast: true, subject: "girl", companyPose: true,
  })
  assert(cast === null, `two girls and an act: no boy added (${key(cast)})`)
  // The base's own count tags are asked for.
  const declared = packComposition({ choices: { fitting: [{ people: { girls: 1, boys: 1 }, scenes: 3 }], fittingPoses: [] }, cast: GIRL, isCast: false, subject: "girl", declared: { girls: 1, boys: 1 } })
  assert(key(declared) === "1/1", "a card that says 1girl 1boy keeps its boy")
  // A pick the pool lacks falls back to the characters alone, never to another make-up with room.
  const lost = packComposition({
    choices: { fitting: [{ people: GIRL, scenes: 2 }, { people: { girls: 1, boys: 2 }, scenes: 8 }], fittingPoses: [] },
    cast: GIRL, isCast: false, subject: "girl", picked: { girls: 1, boys: 1 },
  })
  assert(key(lost) === "1/0", `a pick the pool lost: the girl alone (${key(lost)})`)
}

// ── 4. The header never adds people ──
{
  const withBoy = SCENE_TAIL.map((tail, i) => post(900 + i, `3girls 1boy multiple_girls sitting ${tail}`))
  const own = OTHER_TAIL.map((tail, i) => post(950 + i, `3girls multiple_girls sitting ${tail}`))
  const ctx = { overrides, permanence, subject: "girl" as const, cast: THREE, tagKind: () => undefined }
  const wrong = buildScenePool([...withBoy, ...own], { ...ctx, people: { girls: 3, boys: 1 } })
  assert(wrong.scenes.length > 0 && wrong.scenes.every((scene) => key(scene.people) === "3/1"), "the pool holds only scenes with a boy")
  const args: ScenePackArgs = {
    identity: NAMES, alwaysAdd: [], people: THREE, subject: "girl", castSize: 3, settings: DEFAULT_SCENE_SETTINGS,
    count: 6, seed: 1, overrides, clean, permanence, requests: SITTING,
  }
  const out = generateScenePack(wrong, args)
  assert(out.prompts.every((p) => !tagsOf(p.prompt).includes("1boy")), "a pool of another make-up: no boy written for three girls")
  // Every prompt of a mixed pack is one of its make-ups.
  const GIRL: PackPeople = { girls: 1, boys: 0 }
  const alone = SCENE_TAIL.map((tail, i) => post(1000 + i, `1girl solo sitting ${tail}`))
  const pair = OTHER_TAIL.map((tail, i) => post(1050 + i, `1girl 1boy sitting ${tail}`))
  const trio = SCENE_TAIL.map((tail, i) => post(1100 + i, `1girl 2boys multiple_boys sitting evening rooftop ${tail}`))
  const base = buildScenePool([...alone, ...pair, ...trio], { overrides, permanence, subject: "girl", cast: GIRL, tagKind: () => undefined, people: GIRL })
  const mixed = generateScenePack(base, {
    identity: [NAMES[0]], alwaysAdd: [], people: GIRL, subject: "girl", settings: DEFAULT_SCENE_SETTINGS, count: 8, seed: 2, overrides, clean, permanence,
    compositions: [GIRL, { girls: 1, boys: 1 }],
  })
  assert((base.allScenes ?? []).some((scene) => key(scene.people) === "1/2"), "the pool has scenes with two boys")
  const seen = mixed.prompts.map((p) => key(headerPeople(p.prompt)))
  assert(mixed.prompts.length > 0 && seen.every((k) => k === "1/0" || k === "1/1"), `a mix of alone and with 1 boy: never two boys (${seen.join()})`)
}

// ── 5. One character per prompt ──
{
  // Each turn is one character: the same rule as one character alone.
  const GIRL: PackPeople = { girls: 1, boys: 0 }
  const choices = { fitting: [{ people: { girls: 1, boys: 1 }, scenes: 9 }, { people: GIRL, scenes: 1 }], fittingPoses: [{ people: { girls: 1, boys: 1 }, scenes: 4 }] }
  assert(key(packComposition({ choices, cast: GIRL, isCast: false, subject: "girl" })) === "1/0", "a turn: the character alone, even when her posed scenes have a boy")
  assert(key(packComposition({ choices, cast: GIRL, isCast: false, subject: "girl", picked: { girls: 1, boys: 1 } })) === "1/1", "a turn with the boy asked for")
}

// ── 6. The People line when the pack's own make-up is missing ──
{
  const only = [{ people: { girls: 3, boys: 1 }, scenes: 1 }]
  const line = peopleLineState({ poses: [], needsCompany: () => false, compositions: [], current: null, available: only, whenSeveral: true })
  assert(!!line && line.options.length === 1 && line.value === null, "the line offers the one make-up there is")
  const same = peopleLineState({ poses: [], needsCompany: () => false, compositions: [], current: THREE, available: [{ people: THREE, scenes: 4 }], whenSeveral: true })
  assert(same === null, "one make-up, the pack's own: no line (as before)")
}

done()
