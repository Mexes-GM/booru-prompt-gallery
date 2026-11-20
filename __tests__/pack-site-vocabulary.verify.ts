/**
 * Tests for a site's own words for the people staying out of the scenes and prompts
 * (lib/pack/scene/people.ts sitePeopleRole, lib/pack/scene/scene.ts extractScene with
 * SceneContext.provider).
 *
 * Covers:
 *   W. The words: on Rule34 and e621, the tags that say who is there and how they pair up
 *      ("female", "multiple males", "straight", "male/female", "female focus", "male penetrating
 *      female", "trio") are `people`; the kind of being ("human", "anthro") is `kind`; acts, the
 *      prompt's own pairing and counts, traits written with a gender ("fat male"), and the third
 *      kind ("futanari", "futa on female") are none. On Danbooru-like sites, and with no site,
 *      nothing is.
 *   S. The scene of a Rule34 post: none of those words in its units or its pairing; the acts,
 *      the people (read from them) and everything else stay. A kind of being never travels.
 *   D. The same post with no site, and a Danbooru post with its site: the scene as before.
 *   P. A pack of Rule34 posts: the header says who is there, and nothing else does.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-site-vocabulary.verify.ts
 */
import { sitePeopleRole, peopleVocabulary } from "../lib/pack/scene/people"
import { extractScene, sceneTags, type SceneContext } from "../lib/pack/scene/scene"
import { buildScenePool } from "../lib/pack/scene/scene-pool"
import { createPermanence } from "../lib/pack/scene/permanence"
import { DEFAULT_SCENE_SETTINGS, generateScenePack, type ScenePackArgs } from "../lib/pack/scene-pack"
import { OVERRIDES, PERMANENCE_DATA, makeAssert, makePost } from "./fixtures/pack-scene-data"

const { assert, done } = makeAssert()

// ── W. The words ─────────────────────────────────────────────────────────────
const PEOPLE = [
  "female", "male", "multiple males", "multiple females", "partial male", "human female", "anthro male",
  "female focus", "male focus", "male only", "female only", "human only", "trio focus",
  "male/female", "male/male", "male/male/female", "female/female",
  "anthro on anthro", "human on feral", "female on male",
  "male penetrating female", "male penetrating", "female penetrated", "anthro penetrating human",
  "straight", "straight sex", "gay", "lesbian sex", "bisexual",
  "duo", "trio", "group",
]
const KIND = ["human", "anthro", "feral", "humanoid"]
const NEITHER = [
  // Acts and the prompt's own pairing and counts.
  "group sex", "mmf threesome", "threesome", "gangbang", "hetero", "yuri", "solo", "solo focus", "1girls", "2boys",
  // Traits and states of one person, written with a gender.
  "fat male", "light-skinned female", "nude female", "clothed female nude male", "male pubic hair", "dark-skinned male",
  // The third kind: the header can't say it.
  "futanari", "intersex", "futa on female", "futa with female", "futa/female",
  // Positions, focus on a body part, other words that happen to look alike.
  "female on top", "girl on top", "ass focus", "upper teeth only", "straight hair", "human skull", "monster on female",
]
for (const vocabulary of ["rule34", "e621"] as const) {
  for (const tag of PEOPLE) assert(sitePeopleRole(tag, vocabulary) === "people", `W1 ${vocabulary}: "${tag}" says who is there`)
  for (const tag of KIND) assert(sitePeopleRole(tag, vocabulary) === "kind", `W2 ${vocabulary}: "${tag}" is a kind of being`)
  for (const tag of NEITHER) assert(sitePeopleRole(tag, vocabulary) === null, `W3 ${vocabulary}: "${tag}" is not the site's people words`)
}
for (const tag of [...PEOPLE, ...KIND]) assert(sitePeopleRole(tag, "danbooru") === null, `W4: on a Danbooru-like site "${tag}" is left as it is`)
assert(peopleVocabulary("rule34") === "rule34" && peopleVocabulary("e621") === "e621" && peopleVocabulary("e6ai") === "e621", "W5: Rule34 and e621 write the people their own way")
for (const provider of ["danbooru", "gelbooru", "aibooru", undefined] as const) assert(peopleVocabulary(provider) === "danbooru", `W5: ${provider ?? "no site"} counts Danbooru's way`)

// ── S / D. The scene ─────────────────────────────────────────────────────────
const overrides: Record<string, string> = {
  ...OVERRIDES,
  female: "appearance:demographics",
  male: "appearance:demographics",
  "female focus": "appearance:demographics",
  "male focus": "appearance:demographics",
  threesome: "appearance:demographics",
  "light-skinned female": "appearance:demographics",
  "group sex": "pose:physiological",
  "mmf threesome": "pose:physiological",
  sex: "pose:physiological",
  kneeling: "pose:posture",
  bed: "scenery:props",
}
const permanence = createPermanence(PERMANENCE_DATA, overrides)
const ctx = (provider?: SceneContext["provider"]): SceneContext => ({ overrides, permanence, subject: "girl", ...(provider ? { provider } : {}) })
const R34_TAGS =
  "1girls 2boys female male multiple_males straight male/female female_focus female_penetrated male_penetrating_female trio human anthro " +
  "mmf_threesome threesome group_sex sex kneeling bed indoors blush open_mouth light-skinned_female intersex"
const r34 = makePost(1, R34_TAGS, { rating: "explicit" })
{
  const scene = extractScene(r34, ctx("rule34"))!
  const all = [...sceneTags(scene), ...scene.pairing]
  const site = all.filter((tag) => sitePeopleRole(tag, "rule34") !== null)
  assert(site.length === 0, `S1: none of the site's people words in the scene (${site.join(", ")})`)
  assert(scene.people?.girls === 1 && scene.people?.boys === 2, "S2: the people are still read from them: one girl, two boys")
  for (const tag of ["mmf threesome", "group sex", "sex", "kneeling", "bed", "indoors", "blush", "open mouth"]) {
    assert(all.includes(tag), `S3: "${tag}" stays`)
  }
  assert(all.includes("threesome") && all.includes("light-skinned female") && all.includes("intersex"), "S3: tags of other kinds are this change's business only if they are the site's people words")
  assert(!all.includes("human") && !all.includes("anthro"), "S4: a kind of being never comes from another post")
}
{
  const anonymous = extractScene(makePost(2, "1boys male anthro anthro_male sex kneeling bed indoors blush open_mouth", { rating: "explicit" }), {
    ...ctx("rule34"),
    subject: "boy",
    cast: { girls: 1, boys: 0 },
    poolShare: () => 1,
  })
  const tags = anonymous ? sceneTags(anonymous) : []
  assert(!tags.includes("anthro") && !tags.includes("anthro male"), "S4: not even for a partner nobody plays, whatever the pool's theme")
}
{
  const none = extractScene(r34, ctx())!
  assert(sceneTags(none).includes("female") && sceneTags(none).includes("male"), "D1: with no site the reading is Danbooru's, as before (and a Rule34 post loses nothing to it)")
  const danbooru = makePost(3, "1girl 2boys hetero male_focus group_sex mmf_threesome sex kneeling bed indoors blush open_mouth", { rating: "explicit" })
  const a = extractScene(danbooru, ctx())!
  const b = extractScene(danbooru, ctx("danbooru"))!
  const c = extractScene(danbooru, ctx("gelbooru"))!
  const same = (x: typeof a, y: typeof a) => JSON.stringify({ ...x, preview: 0 }) === JSON.stringify({ ...y, preview: 0 })
  assert(same(a, b) && same(a, c), "D2: a Danbooru-like site gives the scene it gave with no site")
  assert(b.pairing.includes("male focus"), "D2: Danbooru's own 'male focus' stays")
}

// ── P. A pack ────────────────────────────────────────────────────────────────
{
  const posts = [
    makePost(10, `${R34_TAGS} looking_at_viewer`, { rating: "explicit" }),
    makePost(11, "1girls 2boys female male multiple_males straight male/female mmf_threesome group_sex sex kneeling bedroom indoors smile sweat tongue_out", { rating: "explicit" }),
    makePost(12, "female male multiple_males mmf_threesome group_sex straight female_penetrated sex bed indoors closed_eyes blush human", { rating: "explicit" }),
  ]
  const people = { girls: 1, boys: 2 }
  const pool = buildScenePool(posts, { overrides, permanence, subject: "girl", people, provider: "rule34" })
  assert(pool.scenes.length === 3, `P1: every post is a scene of one girl and two boys (${pool.scenes.length})`)
  const args: ScenePackArgs = {
    identity: ["alice (test)", "long hair", "black hair"],
    alwaysAdd: [],
    subject: "girl",
    settings: DEFAULT_SCENE_SETTINGS,
    count: 3,
    seed: 1,
    overrides,
    people,
    clean: (tags: string[]) => tags.join(", "),
  }
  const { prompts } = generateScenePack(pool, args)
  assert(prompts.length === 3, "P2: three prompts")
  for (const p of prompts) {
    const tags = p.prompt.split(", ")
    assert(tags.slice(0, 2).join() === "1girl,2boys", "P3: the header says who is there: " + p.prompt)
    const site = tags.filter((tag) => sitePeopleRole(tag, "rule34") !== null)
    assert(site.length === 0, `P4: and nothing else does (${site.join(", ")})`)
  }
}

done()
