/**
 * From a brief to a pack (lib/pack/brief-pack.ts): the identity the engine gets for a
 * character chosen by name, traits taken off and added, the fit line before and after
 * generating, and when the People line shows.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-brief-pack.verify.ts
 */
import assert from "node:assert/strict"
import { addLook, addNever, addTag, leaveOutScene, removeLook, setCharacterRole } from "../lib/pack/brief"
import { briefFromPrompt, toSceneRequests } from "../lib/pack/brief"
import { briefFromCharacters } from "../lib/pack/brief-history"
import {
  briefIdentity, briefPackArgs, issuesFit, outfitSetting, peopleFromCountTags, peopleLineState, pickedPeopleNote, predictFit,
  preferredPostIds, resolveLook, slotSuggestions, withSearchProgress, briefFromSearch, withPromptPeople, type FitNote,
  type ResolvedLook,
} from "../lib/pack/brief-pack"
import { lookYieldingTo, splitSignature, subjectForPool } from "../lib/pack/character-identity"
import { REUSES_PER_SCENE, castChips, type ScenePackIssue } from "../lib/pack/scene-pack"
import type { Permanence } from "../lib/pack/scene/permanence"
import { fitText } from "../components/prompt-gallery/pack/pack-text"

let passed = 0
const check = (name: string, fn: () => void) => {
  try {
    fn()
    passed++
  } catch (err) {
    console.error(`FAIL: ${name}`)
    throw err
  }
}

const OVERRIDES: Record<string, string> = {
  "tifa lockhart": "other:character", "aerith gainsborough": "other:character", "cloud strife": "other:character",
  "long hair": "appearance:hair", "black hair": "appearance:hair", "white hair": "appearance:hair",
  "red eyes": "appearance:eyes", "large breasts": "appearance:anatomy", "huge breasts": "appearance:anatomy",
  "1girl": "appearance:demographics", solo: "appearance:demographics",
  "earrings": "clothing:jewelry", glasses: "clothing:eyewear", "crop top": "clothing:top",
  bikini: "clothing:outfit", beach: "scenery:setting", sitting: "pose:posture", "princess carry": "pose:interaction",
  smile: "pose:expression", blush: "pose:expression",
}
const permanence = (tag: string): Permanence => (tag === "crop top" ? "state" : "identity")

const TIFA: ResolvedLook = {
  look: ["long hair", "black hair", "red eyes", "large breasts", "earrings", "crop top"],
  subject: ["1girl", "solo"],
  source: "pool",
}
const looks = { "tifa lockhart": TIFA }
const identityOf = (brief = briefFromCharacters(["tifa lockhart"])) =>
  briefIdentity({ brief, looks, permanence, overrides: OVERRIDES })

// ── Identity with an empty brief: the same as the old builder ─────────────────────

check("empty brief: same identity as usePackMode + usePackScenes", () => {
  // The old path: usePackMode's sceneCast (name, subject for the pool, look, signature
  // accessories after), then usePackScenes' castChips with nothing chosen or removed.
  const { look, signature } = splitSignature(lookYieldingTo(TIFA.look, []), OVERRIDES)
  const candidates = Array.from(new Set(["tifa lockhart", ...subjectForPool(TIFA.subject, 1), ...look, ...signature]))
  const old = castChips({
    members: [{ character: "tifa lockhart", candidates }],
    choices: () => new Map(), added: () => [], removed: () => new Set(), baseExtras: [], baseFixed: [],
    permanence, overrides: OVERRIDES,
  })
  const now = identityOf()
  assert.deepEqual(now.identity, Array.from(new Set(old.pinned)))
  assert.deepEqual(now.never, old.never)
  assert.equal(now.subject, "girl")
  assert.deepEqual(now.cast, { girls: 1, boys: 0 })
  assert.deepEqual(now.missingRoles, [])
  // The name and the look are in; the people counts are not.
  assert.deepEqual(now.identity, ["tifa lockhart", "long hair", "black hair", "red eyes", "large breasts", "earrings", "crop top"])
})

check("no look yet: the name alone", () => {
  const now = briefIdentity({ brief: briefFromCharacters(["tifa lockhart"]), looks: {}, permanence, overrides: OVERRIDES })
  assert.deepEqual(now.identity, ["tifa lockhart"])
  assert.equal(now.members[0].lookSource, "none")
})

// ── Traits taken off and added ──────────────────────────────────────────────────

check("a removed trait leaves the identity and goes to never", () => {
  const brief = removeLook(briefFromCharacters(["tifa lockhart"]), "tifa lockhart", "long hair")
  const now = identityOf(brief)
  assert.ok(!now.identity.includes("long hair"))
  assert.ok(now.never.includes("long hair"))
})

check("an added trait joins the identity and replaces one of its kind", () => {
  let brief = addLook(briefFromCharacters(["tifa lockhart"]), "tifa lockhart", "white hair")
  brief = addLook(brief, "tifa lockhart", "huge breasts")
  const now = identityOf(brief)
  assert.ok(now.identity.includes("white hair"))
  assert.ok(now.identity.includes("huge breasts"))
  assert.ok(!now.identity.includes("black hair"))
  assert.ok(!now.identity.includes("large breasts"))
})

check("Never joins the engine's never", () => {
  const now = identityOf(addNever(briefFromCharacters(["tifa lockhart"]), "smile"))
  assert.ok(now.never.includes("smile"))
})

check("role: the brief, then the subject, then the profile; a cast asks for what is missing", () => {
  let brief = briefFromCharacters(["tifa lockhart", "cloud strife"])
  const two = briefIdentity({ brief, looks, permanence, overrides: OVERRIDES })
  assert.deepEqual(two.missingRoles, ["cloud strife"])
  const profiled = briefIdentity({ brief, looks, profileRoles: { "cloud strife": "boy" }, permanence, overrides: OVERRIDES })
  assert.deepEqual(profiled.missingRoles, [])
  assert.deepEqual(profiled.cast, { girls: 1, boys: 1 })
  brief = setCharacterRole(brief, "tifa lockhart", "boy")
  assert.equal(briefIdentity({ brief, looks, permanence, overrides: OVERRIDES }).members[0].role, "boy")
})

check("resolveLook: solo, then the pool, then the profile (a cast waits for solo posts)", () => {
  const solo = { status: "ready" as const, look: ["white hair"], subject: ["1girl"] }
  assert.equal(resolveLook({ solo, pool: TIFA, profile: ["red eyes"] }).source, "solo")
  assert.equal(resolveLook({ pool: TIFA, profile: ["red eyes"] }).source, "pool")
  assert.equal(resolveLook({ solo: { status: "loading", look: null, subject: [] }, profile: ["red eyes"] }).source, "profile")
  assert.equal(resolveLook({ solo: { status: "loading", look: null, subject: [] }, profile: ["red eyes"], inCast: true }).source, "loading")
  assert.equal(resolveLook({ solo: { status: "none", look: null, subject: [] }, profile: [] }).source, "none")
})

// ── Arguments ───────────────────────────────────────────────────────────────────

check("briefPackArgs: requests, left-out scenes, defaults for what the brief doesn't show", () => {
  let brief = briefFromCharacters(["tifa lockhart"])
  for (const t of ["bikini", "beach", "sitting"]) brief = addTag(brief, t, OVERRIDES)
  brief = leaveOutScene(brief, "123")
  const args = briefPackArgs(brief, identityOf(brief), {
    overrides: OVERRIDES, permanence, count: 10, seed: 1, people: { girls: 1, boys: 0 }, preferredPosts: [5],
    outfit: { kind: "usual" }, characterOutfits: new Map([["tifa lockhart", ["white tank top"]]]), clean: (t) => t.join(", "),
  })
  assert.deepEqual(args.requests, { select: ["sitting"], wearing: ["bikini"], where: ["beach"], also: [], literal: [] })
  assert.deepEqual(args.removedScenes, [123])
  assert.deepEqual(args.preferredPosts, [5])
  assert.deepEqual(args.alwaysAdd, [])
  // Asking for clothes switches the outfit menu off.
  assert.equal(args.settings.clothing, "scene")
  assert.equal(args.settings.mix, "faithful")
})

check("outfit menu → engine clothing", () => {
  const has = { characterOutfits: true, library: true }
  assert.equal(outfitSetting({ kind: "scene" }, false, has), "scene")
  assert.equal(outfitSetting({ kind: "usual" }, false, has), "character")
  assert.equal(outfitSetting({ kind: "official", name: "Advent Children" }, false, has), "character")
  assert.equal(outfitSetting({ kind: "library" }, false, has), "library")
  assert.equal(outfitSetting({ kind: "usual" }, false, { characterOutfits: false, library: true }), "scene")
  assert.equal(outfitSetting({ kind: "library" }, true, has), "scene")
  const brief = briefFromCharacters(["tifa lockhart"])
  const args = briefPackArgs(brief, identityOf(brief), {
    overrides: OVERRIDES, permanence, count: 10, seed: 1, people: null, outfit: { kind: "usual" },
    characterOutfits: new Map([["tifa lockhart", ["white tank top", "black skirt"]]]), clean: (t) => t.join(", "),
  })
  assert.equal(args.settings.clothing, "character")
  assert.deepEqual(args.characterOutfit, ["white tank top", "black skirt"])
  assert.ok(args.identity.includes("white tank top"))
})

check("preferredPostIds: the posts of the character's own search", () => {
  const origin = new Map([[1, "own"], [2, "theme"], [3, "own"]])
  assert.deepEqual(preferredPostIds(origin, new Set(["own"])), [1, 3])
})

// ── Prediction before generating ────────────────────────────────────────────────

const scenes = (have: number, imposable = 0) => [
  ...Array.from({ length: have }, () => ({ hasPose: true })),
  ...Array.from({ length: imposable }, () => ({ hasPose: false })),
]
const base = { count: 10, finding: false, canOfferSensitive: false }

check("prediction: enough scenes", () => {
  assert.deepEqual(predictFit({ ...base, candidates: scenes(41), poses: [] }), [{ kind: "fit", scenes: 41 }])
  assert.deepEqual(predictFit({ ...base, candidates: scenes(12, 30), poses: ["sitting"] }), [{ kind: "fit", scenes: 12 }])
})

check("prediction: still loading", () => {
  assert.deepEqual(predictFit({ ...base, candidates: null, poses: [] }), [{ kind: "finding", found: 0 }])
  assert.deepEqual(predictFit({ ...base, candidates: scenes(4), poses: [], finding: true }), [{ kind: "finding", found: 4 }])
})

check("prediction: scenes reused", () => {
  assert.equal(REUSES_PER_SCENE, 1)
  assert.deepEqual(predictFit({ ...base, candidates: scenes(8), poses: ["princess carry"] }), [{ kind: "reuse", scenes: 8, reused: 2 }])
})

check("prediction: imposed, then short", () => {
  assert.deepEqual(predictFit({ ...base, count: 60, candidates: scenes(24, 100), poses: ["sitting"] }), [
    { kind: "reuse", scenes: 24, reused: 24 },
    { kind: "imposed", tag: "sitting", prompts: 12 },
  ])
  assert.deepEqual(predictFit({ ...base, count: 20, candidates: scenes(9), poses: ["princess carry"] }), [
    { kind: "reuse", scenes: 9, reused: 9 },
    { kind: "short", made: 18, asked: 20, scenes: 9, what: "this pose" },
  ])
  assert.deepEqual(predictFit({ ...base, candidates: scenes(0), poses: ["princess carry"] }), [
    { kind: "short", made: 0, asked: 10, scenes: 0, what: "this pose" },
  ])
  assert.deepEqual(predictFit({ ...base, candidates: scenes(6), poses: [] }), [{ kind: "short", made: 6, asked: 10, scenes: 6 }])
})

check("prediction: offer sensitive pictures when short at the safe rating", () => {
  const notes = predictFit({ ...base, candidates: scenes(6), poses: [], canOfferSensitive: true })
  assert.deepEqual(notes[0], { kind: "few-rated" })
  const fine = predictFit({ ...base, candidates: scenes(20), poses: [], canOfferSensitive: true })
  assert.deepEqual(fine, [{ kind: "fit", scenes: 20 }])
})

// ── After generating: every issue says something ────────────────────────────────

const cast = { girls: 1, boys: 0 }
const after = (issues: ScenePackIssue[], made = 10, count = 10) =>
  issuesFit({ issues, count, made, cast, scenes: 41, canOfferSensitive: false })

check("issues: each kind becomes a sentence", () => {
  assert.deepEqual(after([]), [{ kind: "fit", scenes: 41 }])
  assert.deepEqual(after([{ kind: "few-scenes", tags: ["princess carry"], scenes: 9, prompts: 17 }], 17, 20), [
    { kind: "short", made: 17, asked: 20, scenes: 9, what: "this pose" },
  ])
  assert.deepEqual(after([{ kind: "scenes-reused", tags: ["princess carry"], scenes: 9, prompts: 1 }]), [
    { kind: "reuse", scenes: 9, reused: 1, done: true },
  ])
  assert.deepEqual(after([{ kind: "pose-imposed", tag: "sitting", prompts: 18 }]), [
    { kind: "imposed", tag: "sitting", prompts: 18, done: true },
  ])
  assert.deepEqual(after([{ kind: "composition-without-pose", tags: ["princess carry", "sitting"], people: { girls: 1, boys: 0 }, scenes: 29 }], 0), [
    { kind: "short", made: 0, asked: 10, scenes: 0 },
    { kind: "no-pose-here", people: { girls: 1, boys: 0 }, cast, scenes: 29, what: "these poses" },
  ])
  assert.deepEqual(after([{ kind: "needs-company", tag: "hug", role: "also", prompts: 4 }]), [
    { kind: "needs-company", tag: "hug", prompts: 4 },
  ])
  assert.deepEqual(after([{ kind: "request-dropped", tag: "2girls", role: "literal", reason: "composition" }]), [
    { kind: "dropped", tag: "2girls", reason: "composition" },
  ])
  assert.deepEqual(after([{ kind: "request-dropped", tag: "smile", role: "also", reason: "never" }]), [
    { kind: "dropped", tag: "smile", reason: "never" },
  ])
})

check("issues: a short pack without pose issues still says so, and offers sensitive pictures", () => {
  assert.deepEqual(after([], 6), [{ kind: "short", made: 6, asked: 10, scenes: 6 }])
  const offered = issuesFit({ issues: [], count: 10, made: 6, cast, scenes: 6, canOfferSensitive: true })
  assert.deepEqual(offered[0], { kind: "few-rated" })
})

// ── People ──────────────────────────────────────────────────────────────────────

check("People shows only when a requested pose needs company and a scene has it", () => {
  const needsCompany = (tag: string) => tag === "princess carry"
  const compositions = [{ people: { girls: 1, boys: 1 }, scenes: 41 }, { people: { girls: 2, boys: 0 }, scenes: 27 }]
  const current = { girls: 1, boys: 1 }
  assert.equal(peopleLineState({ poses: [], needsCompany, compositions, current }), null)
  assert.equal(peopleLineState({ poses: ["sitting"], needsCompany, compositions, current }), null)
  assert.equal(peopleLineState({ poses: ["princess carry"], needsCompany, compositions: [], current }), null)
  assert.deepEqual(peopleLineState({ poses: ["sitting", "princess carry"], needsCompany, compositions, current }), {
    options: compositions, value: current, poseNeeds: 2,
  })
})

// ── A typed count sets People ───────────────────────────────────────────────────

check("peopleFromCountTags: counts keep the cast and fill the gender they don't name", () => {
  const one = { girls: 1, boys: 0 }
  assert.deepEqual(peopleFromCountTags(["2girls"], one), { girls: 2, boys: 0 })
  assert.deepEqual(peopleFromCountTags(["1boy"], one), { girls: 1, boys: 1 })
  assert.deepEqual(peopleFromCountTags(["1girl", "1boy"], one), { girls: 1, boys: 1 })
  assert.deepEqual(peopleFromCountTags(["6+girls"], one), { girls: 6, boys: 0 })
  assert.deepEqual(peopleFromCountTags(["2_boys"], { girls: 1, boys: 1 }), { girls: 1, boys: 2 })
  assert.deepEqual(peopleFromCountTags(["solo"], one), one)
  // Never fewer people than the characters themselves.
  assert.deepEqual(peopleFromCountTags(["1girl"], { girls: 2, boys: 0 }), { girls: 2, boys: 0 })
  assert.equal(peopleFromCountTags(["bikini"], one), null)
  assert.equal(peopleFromCountTags([], one), null)
})

check("People shows for a count the user set, with a composition the pool lacks listed empty", () => {
  const available = [{ people: { girls: 1, boys: 0 }, scenes: 80 }, { people: { girls: 1, boys: 1 }, scenes: 12 }]
  const none = () => false
  assert.equal(peopleLineState({ poses: [], needsCompany: none, compositions: [], current: { girls: 1, boys: 0 }, available }), null)
  const kept = peopleLineState({ poses: [], needsCompany: none, compositions: [], current: { girls: 1, boys: 1 }, picked: { girls: 1, boys: 1 }, available })
  assert.deepEqual(kept, { options: available, value: { girls: 1, boys: 1 } })
  const missing = peopleLineState({ poses: [], needsCompany: none, compositions: [], current: { girls: 1, boys: 0 }, picked: { girls: 3, boys: 0 }, available })
  assert.deepEqual(missing?.options[2], { people: { girls: 3, boys: 0 }, scenes: 0 })
})

check("pickedPeopleNote: says so only when the pool has no scene of those people", () => {
  const available = [{ people: { girls: 1, boys: 0 } }]
  const cast = { girls: 1, boys: 0 }
  assert.equal(pickedPeopleNote({ picked: null, available, using: cast, cast }), null)
  assert.equal(pickedPeopleNote({ picked: { girls: 1, boys: 0 }, available, using: cast, cast }), null)
  // Not built yet: nothing to say.
  assert.equal(pickedPeopleNote({ picked: { girls: 2, boys: 0 }, available: null, using: null, cast }), null)
  assert.deepEqual(pickedPeopleNote({ picked: { girls: 2, boys: 0 }, available, using: cast, cast }), {
    kind: "people-missing", asked: { girls: 2, boys: 0 }, using: cast, cast,
  })
})

// ── More scenes by hand once the pace limit stopped the fetching ────────────────

check("paused: offered when short and the source can still load, not when the pack fits", () => {
  assert.deepEqual(predictFit({ ...base, candidates: scenes(6), poses: [], paused: true }), [
    { kind: "short", made: 6, asked: 10, scenes: 6 },
    { kind: "paused" },
  ])
  assert.deepEqual(predictFit({ ...base, candidates: scenes(8), poses: ["princess carry"], paused: true }), [
    { kind: "reuse", scenes: 8, reused: 2 },
    { kind: "paused" },
  ])
  assert.deepEqual(predictFit({ ...base, candidates: scenes(20), poses: [], paused: true }), [{ kind: "fit", scenes: 20 }])
  assert.deepEqual(issuesFit({ issues: [], count: 10, made: 6, cast, scenes: 6, canOfferSensitive: false, paused: true }), [
    { kind: "short", made: 6, asked: 10, scenes: 6 },
    { kind: "paused" },
  ])
  assert.deepEqual(issuesFit({ issues: [], count: 10, made: 10, cast, scenes: 41, canOfferSensitive: false, paused: true }), [
    { kind: "fit", scenes: 41 },
  ])
})

// ── Suggestions ─────────────────────────────────────────────────────────────────

check("slotSuggestions: characters in Who, general tags elsewhere", () => {
  const found = [
    { name: "tifa_lockhart", postCount: 9000, category: 4 },
    { name: "tifa_lockhart_(refined)", postCount: 300, category: 4 },
    { name: "tied_hair", postCount: 50000, category: 0 },
    { name: "final_fantasy_vii", postCount: 40000, category: 3 },
  ]
  assert.deepEqual(slotSuggestions(found, "who").map((s) => s.name), ["tifa_lockhart", "tifa_lockhart_(refined)"])
  assert.equal(slotSuggestions(found, "who")[0].kind, "Character")
  assert.deepEqual(slotSuggestions(found, "other"), [{ name: "tied_hair", count: 50000 }])
  assert.deepEqual(slotSuggestions(found, "who", 1).length, 1)
})

// ── One-part packs (changes) ────────────────────────────────────────────────────

check("axis-requested and few-variations become their own sentences", () => {
  assert.deepEqual(after([{ kind: "axis-requested", axis: "outfit", tags: ["bikini"] }]), [
    { kind: "fit", scenes: 41 },
    { kind: "kept-on-axis", axis: "outfit", tags: ["bikini"] },
  ])
  assert.deepEqual(after([{ kind: "few-variations", axis: "place", variations: 6, prompts: 6 }], 6), [
    { kind: "few-variations", axis: "place", variations: 6, made: 6, asked: 10 },
  ])
  assert.deepEqual(after([
    { kind: "axis-requested", axis: "pose", tags: ["sitting"] },
    { kind: "few-variations", axis: "pose", variations: 4, prompts: 4 },
  ], 4), [
    { kind: "few-variations", axis: "pose", variations: 4, made: 4, asked: 10 },
    { kind: "kept-on-axis", axis: "pose", tags: ["sitting"] },
  ])
})

check("fit line wording for the one-part notes", () => {
  assert.equal(fitText({ kind: "kept-on-axis", axis: "outfit", tags: ["bikini"] }).text, "bikini stays in every prompt. The rest of the outfit changes.")
  assert.equal(fitText({ kind: "kept-on-axis", axis: "place", tags: ["beach", "night"] }).text, "beach, night stay in every prompt. The rest of the place changes.")
  assert.equal(fitText({ kind: "few-variations", axis: "outfit", variations: 6, made: 6, asked: 10 }).text, "6 of 10: only 6 outfits fit this scene")
  assert.equal(fitText({ kind: "few-variations", axis: "expression", variations: 1, made: 1, asked: 10 }).text, "1 of 10: only 1 expression fits this scene")
})

// ── Search progress (browser pass, INT-1) ──────────────────────────────────────

check("withSearchProgress: searching while a page is on its way, then whether it brought anything", () => {
  const short: FitNote[] = [{ kind: "short", made: 6, asked: 10, scenes: 6 }, { kind: "paused" }]
  assert.deepEqual(withSearchProgress(short, { loading: true, found: 6 }), [
    { kind: "finding", found: 6 },
    { kind: "short", made: 6, asked: 10, scenes: 6 },
  ])
  assert.deepEqual(withSearchProgress(short, { loading: false, found: 6 }), short)
  assert.deepEqual(withSearchProgress(short, { loading: false, found: 6, nothingNew: { exhausted: false } }), [
    { kind: "short", made: 6, asked: 10, scenes: 6 },
    { kind: "no-new", exhausted: false },
    { kind: "paused" },
  ])
  // Nothing more to search: the offer goes.
  assert.deepEqual(withSearchProgress(short, { loading: false, found: 6, nothingNew: { exhausted: true } }), [
    { kind: "short", made: 6, asked: 10, scenes: 6 },
    { kind: "no-new", exhausted: true },
  ])
})

check("fit line wording: singular and plural", () => {
  assert.equal(fitText({ kind: "fit", scenes: 1 }).text, "1 scene fits")
  assert.equal(fitText({ kind: "fit", scenes: 13 }).text, "13 scenes fit")
  assert.equal(fitText({ kind: "short", made: 1, asked: 10, scenes: 1, what: "this pose" }).text, "1 of 10: only 1 scene has this pose")
  assert.equal(fitText({ kind: "reuse", scenes: 1, reused: 1 }).text, "Only 1 scene: 1 prompt will reuse a scene")
  assert.equal(fitText({ kind: "no-new", exhausted: false }).text, "No new scenes found on that page.")
  assert.equal(fitText({ kind: "no-new", exhausted: true }).text, "No new scenes found. There's nothing more to search.")
})

// ── Entries (INT-3) ──────────────────────────────────────────────────────────────

check("a pasted prompt: tags to their rows, unknown ones to literals, counts to People", () => {
  const { brief, peopleTags } = briefFromPrompt("1girl, 1boy, tifa lockhart, bikini, beach, sitting, my lora trigger", OVERRIDES)
  const started = withPromptPeople(brief, peopleTags)
  assert.equal(started.who[0].tag, "tifa lockhart")
  assert.deepEqual(toSceneRequests(started), { select: ["sitting"], wearing: ["bikini"], where: ["beach"], also: [], literal: ["my lora trigger"] })
  assert.deepEqual(started.people, { girls: 1, boys: 1 })
  // "solo" alone says no number: People stays open.
  const solo = briefFromPrompt("tifa lockhart, solo", OVERRIDES)
  assert.equal(withPromptPeople(solo.brief, solo.peopleTags).people, null)
})

check("a gallery search: its tags, the character, exclusions to Never, filters reported", () => {
  const { brief, skipped } = briefFromSearch("tifa lockhart, beach, -smile, rating:general, order:score", OVERRIDES, "tifa lockhart")
  assert.equal(brief.who.length, 1)
  assert.equal(brief.who[0].tag, "tifa lockhart")
  assert.deepEqual(toSceneRequests(brief).where, ["beach"])
  assert.deepEqual(brief.never, ["smile"])
  assert.deepEqual(skipped, ["rating:general", "order:score"])
  // The results' character joins Who when the search doesn't name it.
  const themed = briefFromSearch("beach, bikini", OVERRIDES, "tifa lockhart")
  assert.equal(themed.brief.who[0].tag, "tifa lockhart")
  assert.deepEqual(toSceneRequests(themed.brief).wearing, ["bikini"])
  assert.deepEqual(themed.skipped, [])
})

console.log(`pack-brief-pack: ${passed} checks passed`)
