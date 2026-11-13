/**
 * The brief (lib/pack/brief.ts): where a typed tag goes by taxonomy slot, the pure
 * operations that edit it, and what the engine and the gallery cards get from it.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-brief.verify.ts
 */
import assert from "node:assert/strict"
import {
  addNever, addTag, briefFromCard, briefFromPrompt, briefTags, emptyBrief, leaveOutScene, removeCharacter,
  removeNever, removeTag, restoreScene, routeTag, setCharacterRole, setChanges, setPeople, toSceneRequests,
  type BriefRoute, type PackBrief, type RequestRole,
} from "../lib/pack/brief"

let passed = 0
const check = (fn: () => void) => { fn(); passed++ }

const OVERRIDES: Record<string, string> = {
  bikini: "clothing:outfit", maid: "clothing:outfit", "crop top": "clothing:top", "black skirt": "clothing:bottom",
  thighhighs: "clothing:legwear", glasses: "clothing:eyewear", "fingerless gloves": "clothing:accents",
  sitting: "pose:posture", "princess carry": "pose:interaction", hug: "pose:interaction", "peace sign": "pose:gesture",
  running: "pose:kinetic", "fighting stance": "pose:combat", sweat: "pose:physiological",
  smile: "pose:expression", "from behind": "pose:camera",
  beach: "scenery:setting", bench: "scenery:props", night: "scenery:atmosphere",
  sword: "equipment:weapon", umbrella: "equipment:handheld", cat: "creature:animal",
  "silver hair": "appearance:hair", "long hair": "appearance:hair", "black hair": "appearance:hair",
  "red eyes": "appearance:eyes", "large breasts": "appearance:anatomy",
  "1girl": "appearance:demographics", "2boys": "appearance:demographics", solo: "appearance:demographics",
  "mature female": "appearance:demographics",
  "tifa lockhart": "other:character", "aerith gainsborough": "other:character", "cloud strife": "other:character",
  "barret wallace": "other:character", "final fantasy": "other:copyright", absurdres: "other:meta",
}

const req = (role: RequestRole): BriefRoute => ({ kind: "request", role })
const TABLE: Array<[string, BriefRoute]> = [
  ["bikini", req("wearing")], ["maid", req("wearing")], ["crop top", req("wearing")], ["black skirt", req("wearing")],
  ["thighhighs", req("wearing")], ["glasses", req("wearing")], ["fingerless gloves", req("wearing")],
  ["sitting", req("doing")], ["princess carry", req("doing")], ["hug", req("doing")], ["peace sign", req("doing")],
  ["running", req("doing")], ["fighting stance", req("doing")], ["sweat", req("doing")],
  ["smile", req("also")], ["from behind", req("also")],
  ["beach", req("where")], ["bench", req("where")], ["night", req("where")],
  ["sword", req("also")], ["umbrella", req("also")], ["cat", req("also")],
  ["silver hair", { kind: "look" }], ["red eyes", { kind: "look" }], ["large breasts", { kind: "look" }],
  ["1girl", { kind: "people" }], ["2boys", { kind: "people" }], ["solo", { kind: "people" }],
  ["mature female", { kind: "look" }],
  ["tifa lockhart", { kind: "character" }],
  ["final fantasy", { kind: "literal" }], ["masterpiece", { kind: "literal" }], ["best quality", { kind: "literal" }],
  ["absurdres", { kind: "literal" }],
  ["Princess_Carry", req("doing")],
]

// 1. Routing table
check(() => {
  for (const [tag, route] of TABLE) assert.deepEqual(routeTag(tag, OVERRIDES), route, `route of ${tag}`)
  assert.deepEqual(routeTag("6+girls", {}), { kind: "people" }, "a count needs no taxonomy entry")
})

// 2. The pasted prompt that used to lose tags
check(() => {
  const text = "1girl, silver hair, long hair, red eyes, maid, masterpiece, best quality"
  const { brief, peopleTags } = briefFromPrompt(text, OVERRIDES)
  assert.deepEqual(brief.requests, [{ tag: "maid", role: "wearing" }])
  assert.deepEqual(brief.who[0].addedLook, ["silver hair", "long hair", "red eyes"])
  assert.deepEqual(brief.literal, ["masterpiece", "best quality"])
  assert.deepEqual(peopleTags, ["1girl"])
  const all = [...briefTags(brief), ...peopleTags].sort()
  assert.deepEqual(all, text.split(", ").sort(), "no tag is lost")
})

// 3. `into` decides requests and literals, not looks
check(() => {
  const a = addTag(emptyBrief(), "masterpiece", OVERRIDES, "also")
  assert.deepEqual(a.requests, [{ tag: "masterpiece", role: "also" }])
  assert.deepEqual(a.literal, [])
  const b = addTag(emptyBrief(), "silver hair", OVERRIDES, "wearing")
  assert.deepEqual(b.requests, [])
  assert.deepEqual(b.who[0].addedLook, ["silver hair"])
  const c = addTag(emptyBrief(), "sitting", OVERRIDES, "where")
  assert.deepEqual(c.requests, [{ tag: "sitting", role: "where" }], "a request typed in a slot goes to that slot")
  const d = addTag(emptyBrief(), "tifa lockhart", OVERRIDES, "also")
  assert.equal(d.who[0].tag, "tifa lockhart")
  assert.deepEqual(d.requests, [])
})

// 4. Always and Never exclude each other
check(() => {
  const asked = addTag(emptyBrief(), "bikini", OVERRIDES)
  const never = addNever(asked, "Bikini")
  assert.deepEqual(never.requests, [])
  assert.deepEqual(never.never, ["bikini"])
  const back = addTag(never, "bikini", OVERRIDES)
  assert.deepEqual(back.never, [])
  assert.deepEqual(back.requests, [{ tag: "bikini", role: "wearing" }])
  const lit = addNever(addTag(emptyBrief(), "masterpiece", OVERRIDES), "masterpiece")
  assert.deepEqual(lit.literal, [])
  const look = addNever(addTag(emptyBrief(), "silver hair", OVERRIDES), "silver hair")
  assert.deepEqual(look.who[0].addedLook, [])
  assert.deepEqual(addNever(look, "silver_hair").never, ["silver hair"], "never has no repeats")
  assert.deepEqual(removeNever(look, "silver hair").never, [])
  assert.ok(!briefTags(addNever(asked, "bikini")).includes("bikini"))
})

// 5. Characters and duplicates
check(() => {
  let b = addTag(emptyBrief(), "tifa lockhart", OVERRIDES)
  assert.equal(b.who.length, 1, "the first named one replaces the empty unnamed one")
  assert.equal(b.who[0].tag, "tifa lockhart")
  b = addTag(b, "Tifa_Lockhart", OVERRIDES)
  assert.equal(b.who.length, 1, "a repeat adds nothing")
  b = addTag(addTag(b, "aerith gainsborough", OVERRIDES), "cloud strife", OVERRIDES)
  assert.equal(b.who.length, 3)
  const full = addTag(b, "barret wallace", OVERRIDES)
  assert.equal(full.who.length, 3, "past the cast limit nothing enters")
  assert.deepEqual(full, b)
  const looked = addTag(emptyBrief(), "silver hair", OVERRIDES)
  assert.equal(addTag(looked, "tifa lockhart", OVERRIDES).who.length, 2, "an unnamed one with a look stays")
  const only = removeCharacter(addTag(emptyBrief(), "tifa lockhart", OVERRIDES), "tifa lockhart")
  assert.deepEqual(only.who, [{ tag: null, addedLook: [], removedLook: [] }], "removing the last leaves the unnamed one")
  assert.equal(removeCharacter(b, "aerith gainsborough").who.length, 2)
  const dup = addTag(addTag(emptyBrief(), "sitting", OVERRIDES), "sitting", OVERRIDES)
  assert.equal(dup.requests.length, 1)
  assert.deepEqual(addTag(emptyBrief(), "1girl", OVERRIDES), emptyBrief(), "counts change nothing")
  const roled = setCharacterRole(addTag(emptyBrief(), "tifa lockhart", OVERRIDES), "tifa lockhart", "girl")
  assert.equal(roled.who[0].role, "girl")
  assert.ok(!("role" in setCharacterRole(roled, "tifa lockhart", undefined).who[0]))
})

// 6. A gallery card
check(() => {
  const tags = ["tifa lockhart", "black hair", "red eyes", "crop top", "black skirt", "sitting", "beach", "smile", "masterpiece", "1girl"]
  const { brief, offered, peopleTags } = briefFromCard(tags, OVERRIDES)
  assert.equal(brief.who[0].tag, "tifa lockhart")
  assert.deepEqual(brief.who[0].addedLook, ["black hair", "red eyes"])
  assert.deepEqual(offered, { outfit: ["crop top", "black skirt"], pose: ["sitting"] })
  assert.deepEqual(peopleTags, ["1girl"])
  const inBrief = briefTags(brief)
  for (const gone of ["beach", "smile", "masterpiece", "crop top", "sitting"]) assert.ok(!inBrief.includes(gone), `${gone} stays out`)
  assert.deepEqual(brief.requests, [])
})

// 7. What the engine receives
check(() => {
  let b = emptyBrief()
  for (const t of ["sitting", "hug", "maid", "beach", "smile", "sword", "masterpiece"]) b = addTag(b, t, OVERRIDES)
  assert.deepEqual(toSceneRequests(b), {
    select: ["sitting", "hug"], wearing: ["maid"], where: ["beach"], also: ["smile", "sword"], literal: ["masterpiece"],
  })
})

// 8. Operations never change their input
check(() => {
  let base: PackBrief = emptyBrief()
  for (const t of ["tifa lockhart", "silver hair", "maid", "masterpiece"]) base = addTag(base, t, OVERRIDES)
  base = addNever(base, "rain")
  const ops: Array<(b: PackBrief) => PackBrief> = [
    (b) => addTag(b, "sitting", OVERRIDES), (b) => addTag(b, "red eyes", OVERRIDES), (b) => addTag(b, "cloud strife", OVERRIDES),
    (b) => addTag(b, "rain", OVERRIDES), (b) => removeTag(b, "maid"), (b) => removeTag(b, "silver hair"),
    (b) => addNever(b, "maid"), (b) => addNever(b, "silver hair"), (b) => removeNever(b, "rain"),
    (b) => removeCharacter(b, "tifa lockhart"), (b) => setCharacterRole(b, "tifa lockhart", "girl"),
    (b) => setPeople(b, { girls: 1, boys: 0 }), (b) => setChanges(b, "outfit"),
    (b) => leaveOutScene(b, "x"), (b) => restoreScene(leaveOutScene(b, "x"), "x"),
  ]
  const snapshot = structuredClone(base)
  for (const op of ops) {
    const out = op(base)
    assert.deepEqual(base, snapshot, "input unchanged")
    assert.notEqual(out, base)
  }
  assert.deepEqual(setPeople(base, { girls: 1, boys: 0 }).people, { girls: 1, boys: 0 })
  assert.equal(setChanges(base, "pose").changes, "pose")
  assert.deepEqual(leaveOutScene(leaveOutScene(base, "x"), "x").leftOut, ["x"])
  assert.deepEqual(restoreScene(leaveOutScene(base, "x"), "x").leftOut, [])
})

console.log(`${passed} passed, 0 failed`)
