/**
 * Picking several characters at once (lib/pack/cast-picker.ts) and packs of more than MAX_CAST
 * characters, one per prompt:
 *   1. the content rule and reading the index;
 *   2. the series lookup and the gender filter, on a small index and on the shipped one;
 *   3. the random draw: the same seed draws the same characters;
 *   4. the brief: a quick cast is one per prompt and holds up to MAX_TURNS_CAST; Together keeps MAX_CAST;
 *   5. the saved pack with many characters;
 *   6. the plan of a 10-character pack: one scene search for all, look searches only for the first few;
 *   7. the pack itself: one character per prompt, each with their own look.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-cast-picker.verify.ts
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { addCast, addCharacter, addTag, castLimit, castTurns, setCastMode, turnBriefs, type PackBrief } from "../lib/pack/brief"
import { briefFromCharacters } from "../lib/pack/brief-history"
import { briefIdentity, briefPackArgs, type ResolvedLook } from "../lib/pack/brief-pack"
import {
  castCandidates, castMembers, characterAllowed, drawCast, drawReach, findSeries, readCharacterIndex, siteCharacterName,
  YOUNG_SHARE, type IndexedCharacter, type StoredCharacterIndex,
} from "../lib/pack/cast-picker"
import { assignTurns, generateTurnsAsync, turnShares } from "../lib/pack/cast-turns"
import { normalizeTagForPack } from "../lib/pack/pack-generator"
import { readSavedPack, savedPackToStore } from "../lib/pack/saved-pack"
import { traitShard, traitShardFile } from "../lib/prompt/natural-traits"
import { MAX_CAST, MAX_TURNS_CAST } from "../lib/pack/scene/cast"
import { createPermanence } from "../lib/pack/scene/permanence"
import { buildScenePool } from "../lib/pack/scene/scene-pool"
import { MAX_LOOK_SEARCHES, MAX_SCENE_SEARCHES, planFeeds, planSources } from "../lib/pack/source-plan"
import { profileLookDescription, searchDescription } from "../components/prompt-gallery/pack/search-text"
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

// A small index: two series, girls and boys, one character of unknown gender, one marked young.
const STORED: StoredCharacterIndex = {
  version: 1,
  series: ["genshin_impact", "final fantasy vii", "spy x family"],
  characters: [
    ["raiden_shogun", 0, 14690, "g"],
    ["yae miko", 0, 9576, "g"],
    ["ningguang (genshin impact)", 0, 2384, "g"],
    ["beidou (genshin impact)", 0, 1877, "g"],
    ["zhongli (genshin impact)", 0, 4000, "b"],
    ["slime (genshin impact)", 0, 2095, ""],
    ["tifa lockhart", 1, 20000, "g", "tifa lockhart (cosplay)"],
    ["cloud strife", 1, 12000, "b"],
    ["yor briar", 2, 9000, "g"],
    ["loli character (spy x family)", 2, 5000, "g"],
  ],
}
const INDEX = readCharacterIndex(STORED)!

// ── 1. Content rule and index ─────────────────────────────────────────────────

check("content rule: names, series, core tags, profile and young share", () => {
  assert.equal(characterAllowed({ tag: "raiden shogun", series: "genshin impact", coreTags: ["1girl", "purple hair"], profile: { "purple hair": 0.84 } }), true)
  assert.equal(characterAllowed({ tag: "young link" }), false, "a blocked word in the name")
  assert.equal(characterAllowed({ tag: "someone", coreTags: ["1girl", "loli", "pink hair"] }), false, "a blocked core tag")
  assert.equal(characterAllowed({ tag: "someone", profile: { randoseru: 0.3 } }), false, "a blocked tag on many of their posts")
  assert.equal(characterAllowed({ tag: "someone", profile: { randoseru: 0.05 } }), true, "on a few of them it says little")
  assert.equal(characterAllowed({ tag: "someone", youngShare: YOUNG_SHARE }), false, "drawn young on enough posts")
  assert.equal(characterAllowed({ tag: "someone", youngShare: YOUNG_SHARE / 2 }), true)
})

check("reading the index: most posted first, blocked names dropped, series totals", () => {
  assert.equal(readCharacterIndex(null), null)
  assert.equal(readCharacterIndex({ ...STORED, version: 99 }), null)
  assert.equal(INDEX.characters[0].tag, "tifa lockhart")
  assert.equal(INDEX.characters.find((c) => c.tag.startsWith("loli")), undefined, "the reader applies the content rule too")
  assert.equal(INDEX.characters.find((c) => c.tag === "raiden shogun")?.series, "genshin impact", "underscores read as spaces")
  assert.deepEqual(INDEX.series.map((s) => [s.name, s.characters]), [["genshin impact", 6], ["final fantasy vii", 2], ["spy x family", 1]])
})

// ── 2. Series lookup and gender ───────────────────────────────────────────────

check("series lookup: whole name, prefix, a word, any case or underscores", () => {
  assert.deepEqual(findSeries(INDEX, "Genshin Impact").map((s) => s.name), ["genshin impact"])
  assert.deepEqual(findSeries(INDEX, "genshin_imp").map((s) => s.name), ["genshin impact"])
  assert.deepEqual(findSeries(INDEX, "impact").map((s) => s.name), ["genshin impact"])
  assert.deepEqual(findSeries(INDEX, "fantasy").map((s) => s.name), ["final fantasy vii"])
  assert.deepEqual(findSeries(INDEX, "g"), [], "one letter finds nothing")
})

check("a series' characters by gender, most posted first; Any keeps the unknown ones", () => {
  const genshin = { kind: "series", series: "Genshin Impact" } as const
  assert.deepEqual(castCandidates(INDEX, { source: genshin, gender: "girls" }).map((c) => c.tag), [
    "raiden shogun", "yae miko", "ningguang (genshin impact)", "beidou (genshin impact)",
  ])
  assert.deepEqual(castCandidates(INDEX, { source: genshin, gender: "boys" }).map((c) => c.tag), ["zhongli (genshin impact)"])
  assert.ok(castCandidates(INDEX, { source: genshin, gender: "any" }).some((c) => c.tag === "slime (genshin impact)"))
  assert.deepEqual(castCandidates(INDEX, { source: { kind: "popular" }, gender: "girls" }).map((c) => c.tag).slice(0, 2), ["tifa lockhart", "raiden shogun"])
  // Names already in the pack are never picked again, in either site's spelling.
  const left = castCandidates(INDEX, { source: { kind: "popular" }, gender: "girls", exclude: ["Raiden_Shogun", "tifa lockhart (cosplay)"] })
  assert.ok(!left.some((c) => c.tag === "raiden shogun" || c.tag === "tifa lockhart"))
})

check("the shipped index: Genshin Impact girls include the adults tested with and none of the young ones", () => {
  const raw = JSON.parse(readFileSync(join(__dirname, "../public/character-index.json"), "utf8"))
  const index = readCharacterIndex(raw)
  assert.ok(index)
  assert.equal(index.characters.length, raw.characters.length, "the build already left out every character the rule blocks")
  assert.equal(findSeries(index, "genshin")[0]?.name, "genshin impact")
  const girls = castCandidates(index, { source: { kind: "series", series: "genshin impact" }, gender: "girls" }).map((c) => c.tag)
  for (const adult of ["raiden shogun", "yae miko", "beidou (genshin impact)", "ningguang (genshin impact)"]) assert.ok(girls.includes(adult), adult)
  for (const young of ["nahida (genshin impact)", "qiqi (genshin impact)", "klee (genshin impact)"]) assert.ok(!girls.includes(young), young)
  assert.ok(index.characters.every((c) => !/\b(loli|shota|child)\b/.test(c.tag)))
})

check("the shipped index: every character has a trait profile, each once, none of the young ones", () => {
  const raw = JSON.parse(readFileSync(join(__dirname, "../public/character-index.json"), "utf8"))
  const index = readCharacterIndex(raw)!
  const shards = new Map<number, Record<string, unknown>>()
  const profileOf = (tag: string) => {
    const shard = traitShard(tag)
    if (!shards.has(shard)) shards.set(shard, JSON.parse(readFileSync(join(__dirname, "../public/natural-traits", traitShardFile(shard)), "utf8")))
    return shards.get(shard)![tag]
  }
  const missing = index.characters.filter((c) => !profileOf(c.tag)).map((c) => c.tag)
  assert.deepEqual(missing, [], "a picked character's look comes from their profile, with no search")
  assert.equal(new Set(index.characters.map((c) => c.tag)).size, index.characters.length, "nobody twice")
  for (const tag of ["aglaea (honkai: star rail)", "carlotta (wuthering waves)", "the herta (honkai: star rail)"]) {
    assert.equal(index.characters.find((c) => c.tag === tag)?.series, tag.slice(tag.indexOf("(") + 1, -1), tag)
  }
  for (const left of ["rumia", "noumi kudryavka", "trainer (umamusume)", "hasumi (swimsuit) (blue archive)"]) {
    assert.ok(!index.characters.some((c) => c.tag === left), left)
  }
})

// ── 3. The draw ───────────────────────────────────────────────────────────────

check("random draw: the same seed draws the same characters, another seed others; popular is the top", () => {
  const many: IndexedCharacter[] = Array.from({ length: 60 }, (_, i) => ({ tag: `c${String(i).padStart(2, "0")}`, series: null, posts: 1000 - i, role: "girl" }))
  const a = drawCast(many, 6, "random", 42)
  assert.deepEqual(drawCast(many, 6, "random", 42), a, "deterministic for a seed")
  assert.notDeepEqual(drawCast(many, 6, "random", 43), a)
  assert.equal(new Set(a.map((c) => c.tag)).size, 6, "no one twice")
  assert.ok(a.every((c) => many.indexOf(c) < drawReach(6)), "from the top of the list")
  assert.deepEqual(a, [...a].sort((x, y) => y.posts - x.posts), "most posted first")
  assert.deepEqual(drawCast(many, 3, "popular", 42).map((c) => c.tag), ["c00", "c01", "c02"])
  assert.equal(drawCast(many.slice(0, 2), 5, "random", 1).length, 2, "never more than there are")
})

check("names on the pack's site: Rule34's own where it differs", () => {
  const tifa = INDEX.characters.find((c) => c.tag === "tifa lockhart")!
  assert.equal(siteCharacterName(tifa, "rule34"), "tifa lockhart (cosplay)")
  assert.equal(siteCharacterName(tifa, "danbooru"), "tifa lockhart")
  assert.equal(siteCharacterName(tifa, "gelbooru"), "tifa lockhart")
  assert.deepEqual(castMembers([tifa], "danbooru"), [{ tag: "tifa lockhart", role: "girl" }])
})

// ── 4. The brief ──────────────────────────────────────────────────────────────

const names = (n: number) => Array.from({ length: n }, (_, i) => ({ tag: `character ${i + 1}`, role: "girl" as const }))
const named = (brief: PackBrief) => brief.who.filter((c) => c.tag !== null).map((c) => c.tag)

check("a quick cast: one per prompt, each with their gender, in the order picked", () => {
  const brief = addCast(briefFromCharacters([]), [{ tag: "Raiden Shogun", role: "girl" }, { tag: "zhongli (genshin impact)", role: "boy" }, { tag: "slime (genshin impact)", role: null }])
  assert.deepEqual(named(brief), ["raiden shogun", "zhongli (genshin impact)", "slime (genshin impact)"])
  assert.equal(brief.castMode, "turns")
  assert.equal(castTurns(brief), true)
  assert.deepEqual(brief.who.map((c) => c.role), ["girl", "boy", undefined])
  // Added to a pack that has a character: after them, theirs kept, nobody twice.
  const tifa = { ...briefFromCharacters(["tifa lockhart"]), who: [{ tag: "tifa lockhart", role: "girl" as const, addedLook: ["red eyes"], removedLook: [] }] }
  const more = addCast(tifa, [{ tag: "tifa lockhart", role: "boy" }, { tag: "yae miko", role: "girl" }])
  assert.deepEqual(named(more), ["tifa lockhart", "yae miko"])
  assert.equal(more.who[0].role, "girl")
  assert.deepEqual(more.who[0].addedLook, ["red eyes"])
  // One character alone is not a cast.
  assert.equal(addCast(briefFromCharacters([]), [{ tag: "yae miko", role: "girl" }]).castMode, undefined)
})

check("one per prompt holds up to MAX_TURNS_CAST; Together stays at MAX_CAST", () => {
  assert.ok(MAX_TURNS_CAST > MAX_CAST)
  const big = addCast(briefFromCharacters([]), names(MAX_TURNS_CAST + 4))
  assert.equal(named(big).length, MAX_TURNS_CAST)
  assert.equal(castLimit(big), MAX_TURNS_CAST)
  assert.equal(named(addCharacter(big, "one more")).length, MAX_TURNS_CAST)
  // Together can't hold them: the choice is refused and the pack stays one per prompt.
  assert.equal(setCastMode(big, "together"), big)
  // With MAX_CAST or fewer, Together is still there.
  const three = addCast(briefFromCharacters([]), names(3))
  const together = setCastMode(three, "together")
  assert.equal(together.castMode, undefined)
  assert.equal(castLimit(together), MAX_CAST)
  assert.equal(named(addCharacter(together, "a fourth")).length, MAX_CAST, "Together takes no fourth")
  assert.equal(named(addCast(together, names(5).slice(3))).length, 5, "a quick cast makes room by going one per prompt")
  // Typed one by one in a pack of one per prompt: past three as well.
  const typed = [4, 5, 6].reduce((b, i) => addCharacter(b, `character ${i}`), three)
  assert.equal(named(typed).length, 6)
})

check("turns with many characters: one brief and one identity per character", () => {
  const brief = addCast(briefFromCharacters([]), names(12))
  assert.equal(turnBriefs(brief).length, 12)
  const order = assignTurns(Array.from({ length: 30 }, (_, i) => i), named(brief) as string[])
  assert.deepEqual(new Set(turnShares(order).map((s) => s.share)), new Set([2, 3]), "30 prompts for 12: two or three each")
})

// ── 5. Saved pack ─────────────────────────────────────────────────────────────

check("saved pack: a pack of 12 characters, one per prompt, comes back whole", () => {
  const brief = addCast(briefFromCharacters([]), names(12))
  const stored = savedPackToStore({ brief, outfit: { kind: "usual" }, provider: "danbooru", gallerySearch: "", result: null }, 1)
  const back = readSavedPack(JSON.parse(JSON.stringify(stored)))
  assert.ok(back)
  assert.deepEqual(named(back.brief), named(brief))
  assert.equal(back.brief.castMode, "turns")
  assert.deepEqual(back.brief.who.map((c) => c.role), brief.who.map((c) => c.role))
})

// ── 6. The plan ───────────────────────────────────────────────────────────────

const ENV = { provider: "danbooru" as const, rating: "sfw" as const, includeSensitive: true }
const ten = () => addCast(briefFromCharacters([]), names(10))

check("plan for 10 characters with nothing asked: one search for all, three look searches", () => {
  const plan = planSources(ten(), { ...ENV, profiled: Array(10).fill(true) })
  assert.deepEqual(plan.scenes.map((s) => [s.kind, s.query, s.everyone]), [["theme", "solo", true]])
  assert.equal(searchDescription(plan.scenes[0], null, plan.people), "Anyone alone, for every character")
  assert.deepEqual(plan.appearance.map((s) => s.character), ["character 1", "character 2", "character 3"])
  assert.equal(plan.lookFromProfile?.length, 7)
  assert.equal(profileLookDescription(["Ningguang", "Beidou"]), "Looks of Ningguang and Beidou: from what the app already knows about them, no search needed")
  assert.deepEqual(plan.leftOutSearches, [])
  // The requests it starts with: the first page of each scene search at each rating, and one per look search.
  const feeds = planFeeds(plan, 1)
  assert.equal(feeds.length, 2)
  assert.equal(feeds.length + plan.appearance.length, 5)
  // Characters without a profile still get theirs.
  const some = planSources(ten(), { ...ENV, profiled: [true, true, true, true, false, true, true, true, true, false] })
  assert.deepEqual(some.appearance.map((s) => s.character), ["character 1", "character 2", "character 3", "character 5", "character 10"])
  // Without profile data, every character is searched, as before.
  assert.equal(planSources(ten(), ENV).appearance.length, 10)
})

check("plan for 10 characters with People or a pose: the shared search follows them", () => {
  const withBoy = planSources({ ...ten(), people: { girls: 1, boys: 1 } }, ENV)
  assert.equal(withBoy.scenes.length, 1)
  assert.ok(withBoy.scenes[0].everyone && !withBoy.scenes[0].tags.includes("solo"), withBoy.scenes[0].query)
  assert.equal(searchDescription(withBoy.scenes[0], null, withBoy.people), "Anyone, with 1 girl and 1 boy, for every character")
  const overrides = { ...SCENE_OVERRIDES, sitting: "pose:posture" }
  const sitting = planSources(addTag(ten(), "sitting", overrides), ENV)
  assert.deepEqual(sitting.scenes.map((s) => [s.kind, s.query]), [["theme", "sitting"]])
  assert.ok(sitting.scenes.length <= MAX_SCENE_SEARCHES)
})

check("plan for MAX_CAST characters or fewer is what it was: each one's own pictures, every look searched", () => {
  const three = addCast(briefFromCharacters([]), names(3))
  const plan = planSources(three, { ...ENV, profiled: [true, true, true] })
  assert.deepEqual(plan.scenes.map((s) => [s.kind, s.query]), [["own", "character_1, solo"], ["own", "character_2, solo"], ["own", "character_3, solo"]])
  assert.equal(plan.appearance.length, 3)
  assert.equal(plan.lookFromProfile, undefined)
  assert.deepEqual(plan, planSources(three, ENV), "profile data changes nothing up to MAX_LOOK_SEARCHES characters")
  assert.equal(MAX_LOOK_SEARCHES, MAX_CAST)
})

// ── 7. The pack ───────────────────────────────────────────────────────────────

const CAST = ["raiden shogun", "yae miko", "beidou (genshin impact)", "ningguang (genshin impact)", "tifa lockhart", "yor briar"]
const HAIR = ["purple hair", "pink hair", "brown hair", "white hair", "black hair", "red hair"]
const OVERRIDES: Record<string, string> = {
  ...SCENE_OVERRIDES,
  ...Object.fromEntries(CAST.map((c) => [c, "other:character"])),
  ...Object.fromEntries(HAIR.map((h) => [h, "appearance:hair"])),
  sitting: "pose:posture", chair: "scenery:props", classroom: "scenery:setting", garden: "scenery:setting",
}
const permanence = createPermanence(PERMANENCE_DATA, OVERRIDES)

check("a pack of six characters: each prompt has one of them, with their own hair only", async () => {
  const brief = addTag(addCast(briefFromCharacters([]), CAST.map((tag) => ({ tag, role: "girl" as const }))), "sitting", OVERRIDES)
  const looks: Record<string, ResolvedLook> = Object.fromEntries(CAST.map((c, i) => [c, { look: [HAIR[i]], subject: [], source: "profile" as const }]))
  const who = briefIdentity({ brief, looks, permanence, overrides: OVERRIDES })
  assert.equal(who.turns?.length, 6)
  // As pack-cast-turns.verify.ts: thirty pictures of someone sitting, each a different scene.
  const places = ["classroom", "garden", "beach", "park", "bedroom", "indoors"]
  const faces = ["smile", "blush", "open_mouth"]
  const views = ["looking_at_viewer", "from_above", "from_side"]
  const props = ["chair", "bed", "wall"]
  const wear = ["shirt skirt", "dress boots", "shirt scarf", "dress", "skirt boots"]
  const posts = Array.from({ length: 30 }, (_, i) => makePost(2000 + i, [
    "1girl solo sitting blonde_hair blue_eyes", places[i % 6], faces[i % 3], views[Math.floor(i / 3) % 3],
    props[Math.floor(i / 2) % 3], wear[i % 5], i % 4 === 0 ? "arms_up" : "sunset",
  ].join(" ")))
  const pool = buildScenePool(posts, { overrides: OVERRIDES, permanence, subject: "girl", cast: { girls: 1, boys: 0 }, people: { girls: 1, boys: 0 } })
  const solos = turnBriefs(brief)
  const order = assignTurns(Array.from({ length: 12 }, (_, i) => i), CAST)
  const out = await generateTurnsAsync(order, (character) => {
    const i = CAST.indexOf(character)
    return {
      character,
      pool,
      args: briefPackArgs(solos[i], who.turns![i], { overrides: OVERRIDES, permanence, count: 99, seed: 5, people: { girls: 1, boys: 0 }, outfit: { kind: "scene" }, clean: (tags) => tags.join(", ") }),
    }
  }, { pause: async () => {}, cancelled: () => false })
  assert.ok(out)
  assert.equal(out.prompts.length, 12)
  assert.deepEqual(out.prompts.map((p) => p.character), order)
  for (const p of out.prompts) {
    const tags = new Set(p.prompt.split(",").map((t) => normalizeTagForPack(t)))
    assert.deepEqual(CAST.filter((c) => tags.has(c)), [p.character], `one name: ${p.prompt}`)
    const own = HAIR[CAST.indexOf(p.character!)]
    assert.ok(tags.has(own), `${p.character} keeps ${own}: ${p.prompt}`)
    assert.ok(HAIR.filter((h) => h !== own).every((h) => !tags.has(h)), `no one else's hair: ${p.prompt}`)
  }
})

Promise.all(pending).then(
  () => console.log(`pack-cast-picker: ${passed} passed`),
  () => process.exit(1),
)
