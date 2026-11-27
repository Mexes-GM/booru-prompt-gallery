/**
 * Random known characters, one per prompt (PackBrief.randomCast; lib/pack/random-cast.ts):
 *   1. the gender People leaves room for;
 *   2. the draw: as many as the prompts, all different, known, of that gender, the same for a seed,
 *      the locked rows' characters kept;
 *   3. the brief the engine works from, and naming a character ends the draw;
 *   4. the plan: no look search at all, no search per character;
 *   5. a Rule34 pack of 20 prompts with a sexual act and People "With 1 boy" + "With 2 boys": each
 *      prompt a different known girl, none an original character;
 *   6. the saved pack keeps the draw and the turns.
 *
 * The packs here draw from a small index of adult characters; the shipped index is checked for its
 * properties only.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-random-cast.verify.ts
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { addCharacter, addTag, setPeople, toggleComposition, turnBriefs, type PackBrief, type RandomCast } from "../lib/pack/brief"
import { briefFromCharacters } from "../lib/pack/brief-history"
import { briefIdentity, briefPackArgs, type ResolvedLook } from "../lib/pack/brief-pack"
import { castCandidates, isKnownCharacter, readCharacterIndex, type StoredCharacterIndex } from "../lib/pack/cast-picker"
import { assignTurns, generateTurnsAsync } from "../lib/pack/cast-turns"
import { normalizeTagForPack } from "../lib/pack/pack-generator"
import { castBrief, drawKey, drawRandomCast, drawsCast, needsRedraw, randomCastGender, redrawUsable, setRandomCast } from "../lib/pack/random-cast"
import { readSavedPack, savedPackToStore, savedResultOf, type LiveResult } from "../lib/pack/saved-pack"
import { createPermanence } from "../lib/pack/scene/permanence"
import { buildScenePool } from "../lib/pack/scene/scene-pool"
import { planSources } from "../lib/pack/source-plan"
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

// Adult women of known series, one man, one original character and a player's stand-in.
const WOMEN = [
  ["tifa lockhart", "final fantasy vii"], ["aerith gainsborough", "final fantasy vii"], ["yor briar", "spy x family"],
  ["makima (chainsaw man)", "chainsaw man"], ["raiden shogun", "genshin impact"], ["yae miko", "genshin impact"],
  ["beidou (genshin impact)", "genshin impact"], ["ningguang (genshin impact)", "genshin impact"], ["shenhe (genshin impact)", "genshin impact"],
  ["yelan (genshin impact)", "genshin impact"], ["eula (genshin impact)", "genshin impact"], ["jean (genshin impact)", "genshin impact"],
  ["lisa (genshin impact)", "genshin impact"], ["kujou sara", "genshin impact"], ["yorha no. 2 type b", "nier:automata"],
  ["samus aran", "metroid"], ["bayonetta (character)", "bayonetta"], ["lara croft", "tomb raider"],
  ["jill valentine", "resident evil"], ["ada wong", "resident evil"], ["mercy (overwatch)", "overwatch"],
  ["widowmaker (overwatch)", "overwatch"], ["fubuki (one-punch man)", "one-punch man"], ["boa hancock", "one piece"],
  ["nico robin", "one piece"],
] as const
const SERIES = [...new Set(WOMEN.map(([, s]) => s)), "original"]
const STORED: StoredCharacterIndex = {
  version: 1,
  series: SERIES,
  characters: [
    ...WOMEN.map(([tag, series], i): [string, number, number, string] => [tag, SERIES.indexOf(series), 20000 - i * 100, "g"]),
    ["cloud strife", SERIES.indexOf("final fantasy vii"), 15000, "b"],
    ["someone's oc", SERIES.indexOf("original"), 30000, "g"],
    ["admiral (kancolle)", SERIES.indexOf("genshin impact"), 40000, "g"],
  ],
}
const INDEX = readCharacterIndex(STORED)!
const KNOWN = new Set<string>(WOMEN.map(([tag]) => tag))

const popular = (gender: RandomCast["gender"], drawn: RandomCast["drawn"]): RandomCast => ({ source: { kind: "popular" }, gender, drawn })
const withMakeUps = (brief: PackBrief) => toggleComposition(setPeople(brief, { girls: 1, boys: 1 }), { girls: 1, boys: 2 }, null)

// ── 1. Gender ─────────────────────────────────────────────────────────────────

check("Auto: the gender People leaves room for, girls first", () => {
  const empty = briefFromCharacters([])
  assert.equal(randomCastGender("auto", empty), "girls", "no People: a girl")
  assert.equal(randomCastGender("auto", withMakeUps(empty)), "girls", "With 1 boy and With 2 boys: the girl")
  assert.equal(randomCastGender("auto", setPeople(empty, { girls: 0, boys: 2 })), "boys")
  assert.equal(randomCastGender("auto", toggleComposition(setPeople(empty, { girls: 2, boys: 0 }), { girls: 0, boys: 2 }, null)), "any")
  assert.equal(randomCastGender("boys", withMakeUps(empty)), "boys", "a gender chosen is kept")
})

// ── 2. The draw ───────────────────────────────────────────────────────────────

check("the index keeps only known characters", () => {
  assert.ok(!INDEX.characters.some((c) => c.tag === "someone's oc"), "an original character")
  assert.ok(!INDEX.characters.some((c) => c.tag === "admiral (kancolle)"), "a player's stand-in")
  assert.equal(isKnownCharacter("raiden shogun", "genshin impact"), true)
  assert.equal(isKnownCharacter("someone", null), false)
})

check("a draw of 20: all different, all known girls, the same for a seed, another for another seed", () => {
  const args = { source: { kind: "popular" } as const, gender: "girls" as const, count: 20, seed: 9, provider: "rule34" as const }
  const drawn = drawRandomCast(INDEX, args)
  assert.equal(drawn.length, 20)
  assert.equal(new Set(drawn.map((m) => m.tag)).size, 20)
  assert.ok(drawn.every((m) => KNOWN.has(m.tag) && m.role === "girl"), drawKey(drawn))
  assert.deepEqual(drawRandomCast(INDEX, args), drawn)
  assert.notDeepEqual(drawRandomCast(INDEX, { ...args, seed: 10 }), drawn)
  // The locked rows' characters stay first and aren't drawn again.
  const keep = drawn.slice(0, 2)
  const again = drawRandomCast(INDEX, { ...args, seed: 11, keep })
  assert.deepEqual(again.slice(0, 2), keep)
  assert.equal(new Set(again.map((m) => m.tag)).size, again.length)
  // Fewer than asked when the source has fewer.
  assert.equal(drawRandomCast(INDEX, { ...args, count: 60 }).length, WOMEN.length)
  // A series.
  const genshin = drawRandomCast(INDEX, { ...args, source: { kind: "series", series: "Genshin Impact" }, count: 5 })
  assert.ok(genshin.every((m) => INDEX.characters.find((c) => c.tag === m.tag)?.series === "genshin impact"))
})

check("the shipped index: known characters only, and Rule34 names where Rule34 differs", () => {
  const index = readCharacterIndex(JSON.parse(readFileSync(join(__dirname, "../public/character-index.json"), "utf8")))
  assert.ok(index)
  assert.ok(index.characters.every((c) => isKnownCharacter(c.tag, c.series)))
  const girls = castCandidates(index, { source: { kind: "popular" }, gender: "girls" })
  assert.ok(girls.length >= 100 && girls.every((c) => c.role === "girl"))
  const drawn = drawRandomCast(index, { source: { kind: "popular" }, gender: "girls", count: 50, seed: 3, provider: "rule34" })
  assert.equal(new Set(drawn.map((m) => m.tag)).size, 50)
})

check("a redraw is usable only when it adds a character beyond the kept ones", () => {
  const args = { source: { kind: "popular" } as const, gender: "girls" as const, count: 5, seed: 4, provider: "danbooru" as const }
  const drawn = drawRandomCast(INDEX, args)
  assert.equal(redrawUsable(drawn, []), true, "a fresh draw")
  assert.equal(redrawUsable(drawn, drawn.slice(0, 2)), true, "kept rows plus new characters")
  assert.equal(redrawUsable([], []), false, "nobody drawn")
  assert.equal(redrawUsable([], drawn.slice(0, 2)), false, "nothing drawn")
  assert.equal(redrawUsable(drawn.slice(0, 2), drawn.slice(0, 2)), false, "only the kept rows")
  // A series with every character locked has nobody left to draw: the draw is only the kept ones.
  const series = { kind: "series", series: "final fantasy vii" } as const
  const all = drawRandomCast(INDEX, { ...args, source: series, count: 5 })
  const exhausted = drawRandomCast(INDEX, { ...args, source: series, count: 5, keep: all })
  assert.equal(redrawUsable(exhausted, all), false)
})

// ── 3. The brief ──────────────────────────────────────────────────────────────

check("the engine's brief: the drawn characters in Who, one per prompt; naming one ends the draw", () => {
  const drawn = drawRandomCast(INDEX, { source: { kind: "popular" }, gender: "girls", count: 20, seed: 1, provider: "rule34" })
  const brief = setRandomCast(addTag(briefFromCharacters([]), "long hair", SCENE_OVERRIDES), popular("auto", drawn))
  assert.equal(drawsCast(brief), true)
  const engine = castBrief(brief)
  assert.deepEqual(engine.who.map((c) => c.tag), drawn.map((m) => m.tag))
  assert.ok(engine.who.every((c) => c.role === "girl"))
  assert.equal(engine.castMode, "turns")
  assert.equal(turnBriefs(engine).length, 20)
  // The brief the user sees still names nobody.
  assert.equal(brief.who.filter((c) => c.tag).length, 0)
  const named = addCharacter(brief, "tifa lockhart")
  assert.equal(named.randomCast, undefined)
  assert.equal(castBrief(named), named)
  assert.equal(setRandomCast(brief, null).randomCast, undefined)
  // Generate draws again after a first pack, or when the draw is shorter than the prompts.
  assert.equal(needsRedraw(brief, 20, false), false)
  assert.equal(needsRedraw(brief, 30, false), true)
  assert.equal(needsRedraw(brief, 20, true), true)
})

// ── 4. The plan ───────────────────────────────────────────────────────────────

const OWNER_TAGS = ["sex", "excessive cum", "cum overflow", "cum pool"]
const OVERRIDES: Record<string, string> = {
  ...SCENE_OVERRIDES,
  ...Object.fromEntries(WOMEN.map(([tag]) => [tag, "other:character"])),
  sex: "pose:sexual", "excessive cum": "pose:sexual", "cum overflow": "pose:sexual", "cum pool": "pose:sexual",
  bed: "scenery:props", bedroom: "scenery:setting", indoors: "scenery:setting", couch: "scenery:props",
  "purple hair": "appearance:hair", "brown hair": "appearance:hair",
}
const ownerBrief = (drawn: RandomCast["drawn"]) =>
  setRandomCast(withMakeUps(OWNER_TAGS.reduce((b, tag) => addTag(b, tag, OVERRIDES, "doing"), briefFromCharacters([]))), popular("auto", drawn))

check("the plan of random characters: the act's searches, no search per character, no look search", () => {
  const drawn = drawRandomCast(INDEX, { source: { kind: "popular" }, gender: "girls", count: 20, seed: 5, provider: "rule34" })
  const brief = castBrief(ownerBrief(drawn))
  const env = { provider: "rule34" as const, rating: "explicit" as const, includeSensitive: false, compositions: [{ girls: 1, boys: 1 }, { girls: 1, boys: 2 }] }
  const plan = planSources(brief, env)
  assert.equal(plan.appearance.length, 0, "every look from the profile")
  assert.equal(plan.lookFromProfile?.length, 20)
  assert.ok(plan.scenes.length >= 1 && plan.scenes.length <= 3)
  assert.ok(plan.scenes.every((s) => s.kind === "theme" && !s.character), plan.scenes.map((s) => s.query).join(" | "))
  assert.ok(plan.scenes.every((s) => s.tags.includes("sex")), "the act leads every search")
  // Nothing asked: one search for all.
  const plain = planSources(castBrief(setRandomCast(briefFromCharacters([]), popular("auto", drawn.slice(0, 2)))), { provider: "rule34", rating: "explicit", includeSensitive: false })
  assert.deepEqual(plain.scenes.map((s) => [s.query, s.everyone]), [["solo", true]])
  assert.equal(plain.appearance.length, 0)
})

// ── 5. The pack ───────────────────────────────────────────────────────────────

check("Rule34, a sexual act, With 1 boy + With 2 boys, 20 prompts: each a different known girl, none an original character", async () => {
  const drawn = drawRandomCast(INDEX, { source: { kind: "popular" }, gender: randomCastGender("auto", withMakeUps(briefFromCharacters([]))), count: 20, seed: 12, provider: "rule34" })
  const brief = castBrief(ownerBrief(drawn))
  const permanence = createPermanence(PERMANENCE_DATA, OVERRIDES)
  // Each character's look from their profile: their own hair colour.
  const looks: Record<string, ResolvedLook> = Object.fromEntries(brief.who.map((c, i) => [c.tag!, { look: [i % 2 ? "purple hair" : "brown hair"], subject: [], source: "profile" as const }]))
  const who = briefIdentity({ brief, looks, permanence, overrides: OVERRIDES })
  assert.equal(who.turns?.length, 20)
  assert.ok(who.turns!.every((t) => t.subject === "girl"))
  // The "With 1 boy" make-up's pool: posts of a girl and a boy with the act, each a different scene.
  const places = ["classroom", "garden", "beach", "park", "bedroom", "indoors"]
  const faces = ["smile", "blush", "open_mouth"]
  const views = ["looking_at_viewer", "from_above", "from_side"]
  const props = ["chair", "bed", "wall"]
  const wear = ["shirt skirt", "dress boots", "shirt scarf", "dress", "skirt boots"]
  const posts = Array.from({ length: 60 }, (_, i) => makePost(5000 + i, [
    "1girl 1boy hetero sex excessive_cum blonde_hair blue_eyes", i % 3 ? "cum_overflow" : "cum_pool", places[i % 6], faces[i % 3],
    views[Math.floor(i / 3) % 3], props[Math.floor(i / 2) % 3], wear[i % 5], i % 4 === 0 ? "arms_up" : "sunset",
  ].join(" ")))
  const people = { girls: 1, boys: 1 }
  const pool = buildScenePool(posts, { overrides: OVERRIDES, permanence, subject: "girl", cast: { girls: 1, boys: 0 }, people, provider: "rule34" })
  const solos = turnBriefs(brief)
  const characters = brief.who.map((c) => c.tag!)
  const order = assignTurns(Array.from({ length: 20 }, (_, i) => i), characters)
  assert.equal(new Set(order).size, 20, "one character per prompt, each once")
  const out = await generateTurnsAsync(order, (character) => {
    const i = characters.indexOf(character)
    return {
      character,
      pool,
      args: briefPackArgs(solos[i], who.turns![i], { overrides: OVERRIDES, permanence, count: 99, seed: 4, people, outfit: { kind: "scene" }, clean: (tags) => tags.join(", ") }),
    }
  }, { pause: async () => {}, cancelled: () => false })
  assert.ok(out)
  assert.equal(out.prompts.length, 20)
  assert.equal(new Set(out.prompts.map((p) => p.character)).size, 20, "a different character in each prompt")
  for (const p of out.prompts) {
    assert.ok(KNOWN.has(p.character!), `known: ${p.character}`)
    const tags = new Set(p.prompt.split(",").map((t) => normalizeTagForPack(t)))
    assert.deepEqual([...KNOWN].filter((name) => tags.has(name)), [p.character], `one name, theirs: ${p.prompt}`)
    assert.ok(!tags.has("someone's oc") && !tags.has("original"), p.prompt)
    assert.ok(tags.has("sex"), `the act: ${p.prompt}`)
  }
})

// ── 6. Saved pack ─────────────────────────────────────────────────────────────

check("saved pack: the draw and each prompt's character come back", () => {
  const drawn = drawRandomCast(INDEX, { source: { kind: "series", series: "genshin impact" }, gender: "girls", count: 6, seed: 2, provider: "danbooru" })
  const brief = setRandomCast(briefFromCharacters([]), { source: { kind: "series", series: "genshin impact" }, gender: "girls", drawn })
  const engine = castBrief(brief)
  const turns = drawn.map((m) => normalizeTagForPack(m.tag))
  const result: LiveResult = {
    prompts: turns.map((c) => ({ prompt: `${c}, 1girl, solo`, values: [], character: c })),
    locked: [0], shortBy: 0, issues: [], count: 6, brief: engine, outfit: { kind: "usual" },
    made: { seed: 1, genCount: 6, preferredPosts: [], lockedScenes: [], slots: [0, 1, 2, 3, 4, 5], rerolls: [], sourceKey: "k", turns },
  }
  const stored = savedPackToStore({ brief, outfit: { kind: "usual" }, provider: "danbooru", gallerySearch: "", result: savedResultOf(result, engine, { kind: "usual" }) }, 1)
  const back = readSavedPack(JSON.parse(JSON.stringify(stored)))
  assert.ok(back)
  assert.deepEqual(back.brief.randomCast, brief.randomCast)
  assert.deepEqual(castBrief(back.brief).who.map((c) => c.tag), turns, "the same characters after a reload")
  assert.deepEqual(back.result?.made.turns, turns)
  assert.equal(back.result?.brief, undefined, "the result's brief is the reloaded draw's, not stored twice")
  // A broken draw doesn't load.
  assert.equal(readSavedPack({ ...JSON.parse(JSON.stringify(stored)), brief: { ...brief, randomCast: { source: { kind: "nowhere" }, gender: "girls", drawn: [] } } }), null)
})

Promise.all(pending).then(
  () => console.log(`pack-random-cast: ${passed} passed`),
  () => process.exit(1),
)
