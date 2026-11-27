/**
 * One character per prompt, in turn (PackBrief.castMode 'turns'; lib/pack/cast-turns.ts):
 *   1. who each prompt is for: an even share, interleaved, locked rows counted in;
 *   2. each character's identity as a pack of only them, and the pack made from it, where every
 *      prompt has one character and none of another's traits, and no two share a scene;
 *   3. the source plan in turns mode, with something asked for and with nothing;
 *   4. the saved pack keeps the choice, and old saved packs still load;
 *   5. "Together" (the default) is what it was.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-cast-turns.verify.ts
 */
import assert from "node:assert/strict"
import { addTag, castTurns, setCastMode, turnBriefs, type PackBrief } from "../lib/pack/brief"
import { briefFromCharacters } from "../lib/pack/brief-history"
import { briefIdentity, briefPackArgs, coreKeyOf, type ResolvedLook } from "../lib/pack/brief-pack"
import { assignTurns, generateTurnsAsync, mergeTurnIssues, turnSeed, turnShares } from "../lib/pack/cast-turns"
import { normalizeTagForPack } from "../lib/pack/pack-generator"
import { readSavedPack, savedPackToStore, savedResultOf, type LiveResult } from "../lib/pack/saved-pack"
import { buildScenePool } from "../lib/pack/scene/scene-pool"
import { createPermanence } from "../lib/pack/scene/permanence"
import type { ScenePackIssue } from "../lib/pack/scene-pack"
import { planSources } from "../lib/pack/source-plan"
import { searchDescription } from "../components/prompt-gallery/pack/search-text"
import { OVERRIDES as SCENE_OVERRIDES, PERMANENCE_DATA, makePost } from "./fixtures/pack-scene-data"

let passed = 0
const pending: Array<Promise<void>> = []
const check = (name: string, fn: () => void | Promise<void>) => {
  const run = async () => {
    try {
      await fn()
      passed++
    } catch (err) {
      console.error(`FAIL: ${name}`)
      console.error(err)
      throw err
    }
  }
  pending.push(run())
}

const TIFA = "tifa lockhart"
const AERITH = "aerith gainsborough"
const YUFFIE = "yuffie kisaragi"
const OVERRIDES: Record<string, string> = {
  ...SCENE_OVERRIDES,
  [TIFA]: "other:character", [AERITH]: "other:character", [YUFFIE]: "other:character",
  "long hair": "appearance:hair", "short hair": "appearance:hair", "black hair": "appearance:hair",
  "brown hair": "appearance:hair", "blonde hair": "appearance:hair", "braided ponytail": "appearance:hair",
  "red eyes": "appearance:eyes", "green eyes": "appearance:eyes", "grey eyes": "appearance:eyes", "blue eyes": "appearance:eyes",
  "large breasts": "appearance:anatomy", "small breasts": "appearance:anatomy",
  bikini: "clothing:outfit", headband: "clothing:headwear", "pink dress": "clothing:top",
  sitting: "pose:posture", chair: "scenery:props", classroom: "scenery:setting", garden: "scenery:setting",
}
const permanence = createPermanence(PERMANENCE_DATA, OVERRIDES)

const look = (tags: string[]): ResolvedLook => ({ look: tags, subject: ["1girl", "solo"], source: "solo" })
const LOOKS: Record<string, ResolvedLook> = {
  [TIFA]: look(["long hair", "black hair", "red eyes", "large breasts"]),
  [AERITH]: look(["long hair", "brown hair", "braided ponytail", "green eyes"]),
  [YUFFIE]: look(["short hair", "black hair", "grey eyes", "small breasts", "headband"]),
}
/** What tells each one apart: their traits no other character of the pack has. */
const OWN: Record<string, string[]> = {
  [TIFA]: ["red eyes", "large breasts"],
  [AERITH]: ["brown hair", "braided ponytail", "green eyes"],
  [YUFFIE]: ["short hair", "grey eyes", "small breasts", "headband"],
}
const CAST = [TIFA, AERITH, YUFFIE]

const castBrief = (): PackBrief => briefFromCharacters(CAST)
const turnsBrief = (): PackBrief => setCastMode(castBrief(), "turns")

// ── 1. Who each prompt is for ─────────────────────────────────────────────────

check("10 prompts and 3 characters: 4, 3 and 3, interleaved", () => {
  const order = assignTurns(Array.from({ length: 10 }, (_, i) => i), ["a", "b", "c"])
  assert.deepEqual(order, ["a", "b", "c", "a", "b", "c", "a", "b", "c", "a"])
  assert.deepEqual(turnShares(order), [{ character: "a", share: 4 }, { character: "b", share: 3 }, { character: "c", share: 3 }])
})

check("even shares at any count; no two neighbours alike while there are two or more", () => {
  for (const n of [2, 3]) {
    const names = ["a", "b", "c"].slice(0, n)
    for (let count = 1; count <= 25; count++) {
      const order = assignTurns(Array.from({ length: count }, (_, i) => i), names)
      const shares = turnShares(order).map((s) => s.share)
      assert.ok(Math.max(...shares) - Math.min(...shares) <= 1, `even at ${count} with ${n}`)
      for (let i = 1; i < order.length; i++) assert.notEqual(order[i], order[i - 1], `interleaved at ${count} with ${n}`)
    }
  }
})

check("locked rows count in: the free rows even the whole pack out", () => {
  // Rows 0 and 1 are locked, both Tifa's: the eight free rows go mostly to the others.
  const free = [2, 3, 4, 5, 6, 7, 8, 9]
  const order = assignTurns(free, ["a", "b", "c"], ["a", "a"])
  const total = turnShares(["a", "a", ...order]).map((s) => s.share).sort()
  assert.deepEqual(total, [3, 3, 4])
  // A locked row of someone no longer in Who isn't counted.
  assert.deepEqual(assignTurns([0, 1], ["a", "b"], ["gone"]), ["a", "b"])
})

check("each run has a seed of its own; the first keeps the pack's", () => {
  assert.equal(turnSeed(42, 0), 42)
  assert.notEqual(turnSeed(42, 1), turnSeed(42, 2))
  assert.notEqual(turnSeed(42, 1), 42)
})

// ── 2. Identity and the pack ──────────────────────────────────────────────────

check("castTurns: only 'turns' with two or more named characters", () => {
  assert.equal(castTurns(castBrief()), false)
  assert.equal(castTurns(turnsBrief()), true)
  assert.equal(castTurns(setCastMode(briefFromCharacters([TIFA]), "turns")), false)
  // 'together' is the default and isn't stored.
  assert.equal(setCastMode(turnsBrief(), "together").castMode, undefined)
  const same = castBrief()
  assert.equal(setCastMode(same, "together"), same)
})

check("turnBriefs: one brief per character, alone in Who with their own edits", () => {
  let brief = addTag(turnsBrief(), "sitting", OVERRIDES)
  brief = { ...brief, who: brief.who.map((c) => (c.tag === AERITH ? { ...c, addedLook: ["smile"], removedLook: ["green eyes"] } : c)) }
  const briefs = turnBriefs(brief)
  assert.deepEqual(briefs.map((b) => b.who.map((c) => c.tag)), [[TIFA], [AERITH], [YUFFIE]])
  assert.ok(briefs.every((b) => b.castMode === undefined && b.requests.some((r) => r.tag === "sitting")))
  assert.deepEqual(briefs[1].who[0].removedLook, ["green eyes"])
})

check("turns: each character's identity is the one a pack of only them has", () => {
  const brief = turnsBrief()
  const who = briefIdentity({ brief, looks: LOOKS, permanence, overrides: OVERRIDES })
  assert.ok(who.turns && who.turns.length === 3)
  CAST.forEach((name, i) => {
    const alone = briefIdentity({ brief: briefFromCharacters([name]), looks: LOOKS, permanence, overrides: OVERRIDES })
    assert.deepEqual(who.turns![i].identity, alone.identity, `${name}: same identity as alone`)
    assert.equal(who.turns![i].castSize, 1)
    assert.deepEqual(who.turns![i].cast, { girls: 1, boys: 0 })
  })
  // The pack as a whole is one person per prompt, while Who still shows everyone.
  assert.equal(who.castSize, 1)
  assert.deepEqual(who.cast, { girls: 1, boys: 0 })
  assert.equal(who.blocks.length, 3)
  assert.equal(who.members.length, 3)
  assert.deepEqual(who.missingRoles, [])
})

/** Thirty pictures of someone sitting, each a different scene, with hair and eyes of their own. */
function sittingPosts() {
  const places = ["classroom", "garden", "beach", "park", "bedroom", "indoors"]
  const faces = ["smile", "blush", "open_mouth"]
  const views = ["looking_at_viewer", "from_above", "from_side"]
  const props = ["chair", "bed", "wall"]
  const wear = ["shirt skirt", "dress boots", "shirt scarf", "dress", "skirt boots"]
  return Array.from({ length: 30 }, (_, i) => makePost(1000 + i, [
    "1girl solo sitting blonde_hair blue_eyes", places[i % 6], faces[i % 3], views[Math.floor(i / 3) % 3],
    props[Math.floor(i / 2) % 3], wear[i % 5], i % 4 === 0 ? "arms_up" : "sunset",
  ].join(" ")))
}

check("the pack: one character per prompt, their own traits only, no scene twice", async () => {
  const brief = addTag(turnsBrief(), "sitting", OVERRIDES)
  const who = briefIdentity({ brief, looks: LOOKS, permanence, overrides: OVERRIDES })
  const pool = buildScenePool(sittingPosts(), { overrides: OVERRIDES, permanence, subject: "girl", cast: { girls: 1, boys: 0 }, people: { girls: 1, boys: 0 } })
  const solos = turnBriefs(brief)
  const order = assignTurns(Array.from({ length: 10 }, (_, i) => i), CAST)
  const out = await generateTurnsAsync(order, (character, index) => {
    const t = who.turns![CAST.indexOf(character)]
    assert.equal(index, CAST.indexOf(character))
    return {
      character,
      pool,
      args: briefPackArgs(solos[CAST.indexOf(character)], t, {
        overrides: OVERRIDES, permanence, count: 99, seed: 7, people: { girls: 1, boys: 0 }, outfit: { kind: "scene" }, clean: (tags) => tags.join(", "),
      }),
    }
  }, { pause: async () => {}, cancelled: () => false })
  assert.ok(out)
  assert.equal(out.prompts.length, 10)
  assert.equal(out.shortBy, 0)
  assert.deepEqual(out.prompts.map((p) => p.character), order)
  const scenes = out.prompts.map((p) => p.scene?.postId)
  assert.equal(new Set(scenes).size, 10, "no two prompts share a scene")
  for (const p of out.prompts) {
    const tags = new Set(p.prompt.split(",").map((t) => normalizeTagForPack(t)))
    const names = CAST.filter((name) => tags.has(name))
    assert.deepEqual(names, [p.character], `one name: ${p.prompt}`)
    for (const trait of OWN[p.character!]) assert.ok(tags.has(trait), `${p.character} keeps ${trait}: ${p.prompt}`)
    for (const other of CAST.filter((name) => name !== p.character)) {
      for (const trait of OWN[other]) assert.ok(!tags.has(trait), `${p.character}'s prompt has none of ${other}'s ${trait}: ${p.prompt}`)
    }
    assert.ok(tags.has("sitting"), `the pose: ${p.prompt}`)
    assert.ok(tags.has("solo"), `one person: ${p.prompt}`)
  }
})

check("a small pool: characters share scenes rather than coming out short", async () => {
  const brief = addTag(turnsBrief(), "sitting", OVERRIDES)
  const who = briefIdentity({ brief, looks: LOOKS, permanence, overrides: OVERRIDES })
  const pool = buildScenePool(sittingPosts().slice(0, 4), { overrides: OVERRIDES, permanence, subject: "girl", cast: { girls: 1, boys: 0 }, people: { girls: 1, boys: 0 } })
  const solos = turnBriefs(brief)
  const order = assignTurns([0, 1, 2, 3, 4, 5], CAST)
  const out = await generateTurnsAsync(order, (character) => ({
    character,
    pool,
    args: briefPackArgs(solos[CAST.indexOf(character)], who.turns![CAST.indexOf(character)], {
      overrides: OVERRIDES, permanence, count: 1, seed: 3, people: { girls: 1, boys: 0 }, outfit: { kind: "scene" }, clean: (tags) => tags.join(", "),
    }),
  }), { pause: async () => {}, cancelled: () => false })
  assert.ok(out)
  assert.equal(out.prompts.length, 6)
  assert.deepEqual(turnShares(out.prompts.map((p) => p.character!)).map((s) => s.share), [2, 2, 2])
})

check("a cancelled run makes nothing", async () => {
  const out = await generateTurnsAsync(["a"], () => null, { pause: async () => {}, cancelled: () => true })
  assert.deepEqual(out?.prompts ?? [], [])
})

check("the runs' issues read as one pack's", () => {
  const a: ScenePackIssue[] = [
    { kind: "pose-imposed", tag: "sitting", prompts: 2 },
    { kind: "condition-variety", role: "wearing", tags: ["bikini"], styles: [], variants: 3, fromScene: 2, fromDonors: 1, fromLibrary: 0, imposed: 1, partial: 0 },
    { kind: "few-scenes", tags: ["sitting"], scenes: 2, prompts: 3 },
  ]
  const b: ScenePackIssue[] = [
    { kind: "pose-imposed", tag: "sitting", prompts: 1 },
    { kind: "condition-variety", role: "wearing", tags: ["bikini"], styles: [], variants: 3, fromScene: 3, fromDonors: 0, fromLibrary: 0, imposed: 0, partial: 0 },
  ]
  const merged = mergeTurnIssues([a, b], 8)
  assert.deepEqual(merged.find((i) => i.kind === "pose-imposed"), { kind: "pose-imposed", tag: "sitting", prompts: 3 })
  const variety = merged.find((i) => i.kind === "condition-variety")
  assert.ok(variety && variety.kind === "condition-variety")
  assert.equal(variety.fromScene, 5)
  assert.equal(variety.imposed, 1)
  assert.equal(variety.variants, 6)
  assert.deepEqual(merged.find((i) => i.kind === "few-scenes"), { kind: "few-scenes", tags: ["sitting"], scenes: 2, prompts: 8 })
})

// ── 3. The plan ───────────────────────────────────────────────────────────────

const ENV = { provider: "danbooru" as const, rating: "sfw" as const, includeSensitive: false }

check("plan in turns with a pose: the pose's searches, no character's, everyone's look", () => {
  const plan = planSources(addTag(turnsBrief(), "sitting", OVERRIDES), { ...ENV, roles: ["girl", "girl", "girl"] })
  assert.deepEqual(plan.scenes.map((s) => [s.kind, s.query]), [["theme", "sitting"]])
  assert.equal(plan.people, null)
  assert.equal(plan.rolesPending, false)
  assert.deepEqual(plan.appearance.map((s) => s.character), CAST)
  assert.equal(plan.baseLookFromPool, false)
  // Together, the same brief searches the three of them together.
  const together = planSources(addTag(castBrief(), "sitting", OVERRIDES), { ...ENV, roles: ["girl", "girl", "girl"] })
  assert.ok(together.scenes.some((s) => s.tags.some((t) => /3girls|threesome/.test(t))), together.scenes.map((s) => s.query).join(" | "))
})

check("plan in turns with People set: the pose with that company", () => {
  const brief = { ...addTag(turnsBrief(), "sitting", OVERRIDES), people: { girls: 1, boys: 1 } }
  const plan = planSources(brief, ENV)
  assert.deepEqual(plan.people, { girls: 1, boys: 1 })
  assert.equal(plan.scenes.length, 1)
  assert.ok(plan.scenes[0].tags.includes("sitting") && plan.scenes[0].kind === "theme", plan.scenes[0].query)
})

check("plan in turns with clothes and no pose: a search for the clothes, said as such; no second search for the same", () => {
  const brief = addTag(turnsBrief(), "bikini", OVERRIDES)
  const plan = planSources(brief, { ...ENV, conditions: ["bikini"] })
  assert.deepEqual(plan.scenes.map((s) => [s.kind, s.query]), [["theme", "bikini"]])
  assert.deepEqual(plan.scenes[0].concept, { role: "wearing", tags: ["bikini"] })
  assert.equal(plan.donors.length, 0)
  assert.equal(searchDescription(plan.scenes[0], null, plan.people), "Anyone wearing bikini")
  // With a place too, the place keeps its own donor search.
  const both = planSources(addTag(brief, "beach", OVERRIDES), { ...ENV, conditions: ["bikini", "beach"] })
  assert.deepEqual(both.scenes.map((s) => s.query), ["bikini"])
  assert.deepEqual(both.donors.map((d) => [d.kind, d.query]), [["where", "beach"]])
})

check("plan in turns with nothing asked: each character's own pictures alone, nothing left out", () => {
  const plan = planSources(turnsBrief(), ENV)
  assert.deepEqual(plan.scenes.map((s) => [s.kind, s.query, s.character]), [
    ["own", "tifa_lockhart, solo", TIFA], ["own", "aerith_gainsborough, solo", AERITH], ["own", "yuffie_kisaragi, solo", YUFFIE],
  ])
  assert.deepEqual(plan.leftOutSearches, [])
  assert.equal(searchDescription(plan.scenes[1], "Aerith Gainsborough", plan.people), "Aerith Gainsborough alone")
  // With company set, their pictures by name.
  const withBoy = planSources({ ...turnsBrief(), people: { girls: 1, boys: 1 } }, ENV)
  assert.deepEqual(withBoy.scenes.map((s) => s.query), ["tifa_lockhart", "aerith_gainsborough", "yuffie_kisaragi"])
})

// ── 4. Saved pack ─────────────────────────────────────────────────────────────

check("saved pack: the choice, each prompt's character and the turns come back", () => {
  const brief = turnsBrief()
  const result: LiveResult = {
    prompts: [{ prompt: `${TIFA}, 1girl, solo, sitting`, values: [], character: TIFA }, { prompt: `${AERITH}, 1girl, solo, sitting`, values: [], character: AERITH }],
    locked: [1], shortBy: 0, issues: [], count: 2, brief, outfit: { kind: "usual" },
    made: { seed: 1, genCount: 2, preferredPosts: [], lockedScenes: [], slots: [0, 1], rerolls: [], sourceKey: "k", turns: [TIFA, AERITH] },
  }
  const stored = savedPackToStore({ brief, outfit: { kind: "usual" }, provider: "danbooru", gallerySearch: "", result: savedResultOf(result, brief, { kind: "usual" }) }, 1)
  const back = readSavedPack(JSON.parse(JSON.stringify(stored)))
  assert.ok(back)
  assert.equal(back.brief.castMode, "turns")
  assert.deepEqual(back.result?.prompts.map((p) => p.character), [TIFA, AERITH])
  assert.deepEqual(back.result?.made.turns, [TIFA, AERITH])
})

check("saved pack: one saved before the choice existed still loads, as Together; a broken value doesn't", () => {
  const old = { version: 1, savedAt: 1, brief: castBrief(), outfit: { kind: "usual" }, provider: "danbooru", gallerySearch: "", result: null }
  const back = readSavedPack(JSON.parse(JSON.stringify(old)))
  assert.ok(back)
  assert.equal(castTurns(back.brief), false)
  assert.equal(readSavedPack({ ...old, brief: { ...castBrief(), castMode: "sideways" } }), null)
})

// ── 5. Together is unchanged ──────────────────────────────────────────────────

check("Together: the same identity, plan and arguments as before the choice existed", () => {
  const brief = addTag(castBrief(), "sitting", OVERRIDES)
  const together = setCastMode(setCastMode(brief, "turns"), "together")
  assert.deepEqual(together, brief)
  const a = briefIdentity({ brief, looks: LOOKS, permanence, overrides: OVERRIDES })
  assert.equal(a.turns, undefined)
  assert.equal(a.castSize, 3)
  const env = { ...ENV, roles: ["girl", "girl", "girl"] as const }
  assert.deepEqual(planSources(brief, { ...env, roles: [...env.roles] }), planSources({ ...brief, castMode: "together" }, { ...env, roles: [...env.roles] }))
  // One character: 'turns' changes nothing.
  const one = addTag(briefFromCharacters([TIFA]), "sitting", OVERRIDES)
  assert.deepEqual(planSources(setCastMode(one, "turns"), ENV), planSources(one, ENV))
  const oneWho = briefIdentity({ brief: setCastMode(one, "turns"), looks: LOOKS, permanence, overrides: OVERRIDES })
  assert.equal(oneWho.turns, undefined)
  const args = briefPackArgs(brief, a, { overrides: OVERRIDES, permanence, count: 5, seed: 1, people: { girls: 3, boys: 0 }, outfit: { kind: "scene" }, clean: (t) => t.join(", ") })
  assert.equal(args.castSize, 3)
  assert.ok(CAST.every((name) => args.identity.includes(name)))
})

check("coreKeyOf: switching between Together and One per prompt remakes the pack's source", () => {
  assert.notEqual(coreKeyOf(castBrief()), coreKeyOf(turnsBrief()))
  assert.equal(coreKeyOf(castBrief()), coreKeyOf(setCastMode(turnsBrief(), "together")))
})

Promise.all(pending).then(
  () => console.log(`pack-cast-turns: ${passed} passed`),
  () => process.exit(1),
)
