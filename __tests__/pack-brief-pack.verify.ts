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
import { chooseChanges, leaveOutVariant, restoreVariant, setBaseScene } from "../lib/pack/brief"
import { briefFromCharacters } from "../lib/pack/brief-history"
import { seedNever } from "../lib/pack/brief-history"
import {
  briefIdentity, briefPackArgs, issuesFit, outfitSetting, peopleFromCountTags, peopleLineState, pickedPeopleNote, predictFit,
  preferredPostIds, resolveLook, slotSuggestions, packProviderChoices, loadedState, packCopyText, promptSize, withSearchProgress, briefFromSearch, withPromptPeople, type FitNote,
} from "../lib/pack/brief-pack"
import {
  placeRows, changedRows, lockedWithTag, usableSearchTags, leftOutPosts, axisRequests, oneAxis, castPeopleNote,
  keptRows, opAfterEnd, correctionAfterBriefChange, lookOwner, briefFromCardPost,
  generateLayout, placeGenerated, preferredForAgain, rotationPlan, rotationAfter, mergeFitNotes,
  type ResolvedLook,
} from "../lib/pack/brief-pack"
import { lookYieldingTo, splitSignature, subjectForPool } from "../lib/pack/character-identity"
import { REUSES_PER_SCENE, castChips, type ScenePackIssue } from "../lib/pack/scene-pack"
import type { Permanence } from "../lib/pack/scene/permanence"
import { poseNeedsScene } from "../lib/pack/scene-pack"
import { CORRECTION_TEXT, copyNoteText, fitText } from "../components/prompt-gallery/pack/pack-text"
import { leftOutSentence, noPostsSentence, ratingsSentence, searchDescription, searchTagsText } from "../components/prompt-gallery/pack/search-text"
import { planSources } from "../lib/pack/source-plan"
import { sameBriefStart } from "../components/prompt-gallery/pack/builder-switch"

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

check("People shows whenever the scenes come in more than one make-up (whenSeveral), marking the one in use", () => {
  const none = () => false
  // Measured on Rule34 with double penetration in Doing: the pose doesn't "need company", yet
  // the pack takes one make-up and leaves the others out.
  const withPose = [{ people: { girls: 1, boys: 2 }, scenes: 113 }, { people: { girls: 1, boys: 0 }, scenes: 85 }, { people: { girls: 1, boys: 3 }, scenes: 40 }]
  const current = { girls: 1, boys: 2 }
  const line = peopleLineState({ poses: ["double penetration"], needsCompany: none, compositions: withPose, current, whenSeveral: true })
  assert.deepEqual(line, { options: withPose, value: current })
  // One make-up only: nothing to choose, no line.
  assert.equal(peopleLineState({ poses: ["double penetration"], needsCompany: none, compositions: withPose.slice(0, 1), current, whenSeveral: true }), null)
  // No pose: every make-up of the pool.
  const available = [{ people: { girls: 1, boys: 0 }, scenes: 80 }, { people: { girls: 1, boys: 1 }, scenes: 12 }]
  assert.deepEqual(peopleLineState({ poses: [], needsCompany: none, compositions: [], current: { girls: 1, boys: 0 }, available, whenSeveral: true })?.options, available)
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

check("slotSuggestions: Style offers general, artist, series and meta tags, never characters", () => {
  const found = [
    { name: "tifa_lockhart", postCount: 9000, category: 4 },
    { name: "realistic", postCount: 50000, category: 0 },
    { name: "wlop", postCount: 2000, category: 1 },
    { name: "final_fantasy_vii", postCount: 40000, category: 3 },
    { name: "highres", postCount: 900000, category: 5 },
  ]
  assert.deepEqual(slotSuggestions(found, "style"), [
    { name: "realistic", count: 50000 },
    { name: "wlop", count: 2000, kind: "Artist" },
    { name: "final_fantasy_vii", count: 40000, kind: "Series" },
    { name: "highres", count: 900000, kind: "Meta" },
  ])
})

check("slotSuggestions: Others offers general tags the taxonomy files as appearance", () => {
  const found = [
    { name: "dark-skinned_male", postCount: 90000, category: 0 },
    { name: "bikini", postCount: 50000, category: 0 },
    { name: "wlop", postCount: 2000, category: 1 },
  ]
  const taxonomy = { "dark-skinned male": "appearance:anatomy", bikini: "clothing:outfit" }
  assert.deepEqual(slotSuggestions(found, "look", 8, taxonomy), [{ name: "dark-skinned_male", count: 90000 }])
})

// ── Where the scenes come from ──────────────────────────────────────────────────

check("packProviderChoices: every site in the gallery's order; Rule34 waits for its consent; e621 and e6ai say safe only", () => {
  const sites = ["danbooru", "gelbooru", "aibooru", "rule34", "e621", "e6ai"] as const
  const safe = packProviderChoices(sites, "sfw", false)
  assert.deepEqual(safe.map((c) => c.provider), [...sites])
  assert.deepEqual(safe.find((c) => c.provider === "rule34"), { provider: "rule34", available: false, reason: "adult-consent" })
  assert.deepEqual(safe.find((c) => c.provider === "e621"), { provider: "e621", available: true, note: "no-sensitive" })
  assert.deepEqual(safe.find((c) => c.provider === "e6ai"), { provider: "e6ai", available: true, note: "no-sensitive" })
  assert.deepEqual(safe.find((c) => c.provider === "danbooru"), { provider: "danbooru", available: true })
  // Other ratings exist everywhere; with the confirmation given, Rule34 is offered.
  const explicit = packProviderChoices(sites, "explicit", true)
  assert.ok(explicit.every((c) => c.available && !c.note), JSON.stringify(explicit))
})

check("loadedState: says the posts loaded; Find more whenever the site has more and nothing else is going on", () => {
  const base = { posts: 240, noMoreResults: false, failed: false, sessionCapReached: false, paused: false, finding: false, loading: false }
  assert.deepEqual(loadedState(base), { posts: 240, all: false, more: true }, "enough scenes, the site has more: offered")
  assert.deepEqual(loadedState({ ...base, noMoreResults: true }), { posts: 240, all: true, more: false }, "nothing more: said, not offered")
  assert.equal(loadedState({ ...base, paused: true })?.more, false, "the pause has its own offer")
  assert.equal(loadedState({ ...base, loading: true })?.more, false, "a page on its way")
  assert.equal(loadedState({ ...base, sessionCapReached: true })?.more, false)
  assert.equal(loadedState({ ...base, finding: true }), null, "the progress line speaks while scenes are found")
  assert.equal(loadedState({ ...base, failed: true }), null)
  assert.equal(loadedState({ ...base, posts: 0 }), null)
})

check("search-text: each search of the plan in plain words, with the tags as the site gets them", () => {
  // A character with two poses on Rule34 (no tag limit): their own posts with the first,
  // anyone with both, and the first alone.
  let brief = addTag(addTag(briefFromCharacters(["sui-feng"]), "double penetration", OVERRIDES, "doing"), "sitting", OVERRIDES)
  const plan = planSources(brief, { provider: "rule34", rating: "both", includeSensitive: false })
  const words = plan.scenes.map((s) => searchDescription(s, "Sui-Feng", plan.people))
  assert.deepEqual(plan.scenes.map((s) => s.kind), ["own", "theme", "anchor"])
  assert.deepEqual(words, ["Sui-Feng doing double penetration", "Anyone doing double penetration and sitting", "Anyone doing double penetration"])
  assert.equal(searchTagsText(plan.scenes[0]), "sui-feng double_penetration")
  assert.equal(ratingsSentence(plan.ratings), "Each search runs for Questionable and Explicit pictures.")
  // No pose: the character alone; a head count: pictures with those people.
  assert.equal(searchDescription({ kind: "own", poses: [] }, "Sui-Feng", null), "Sui-Feng, alone or with others")
  assert.equal(searchDescription({ kind: "group", poses: [] }, null, { girls: 2, boys: 1 }), "Pictures with 2 girls and 1 boy")
  assert.equal(searchDescription({ kind: "theme", poses: ["sitting"] }, null, { girls: 1, boys: 1 }), "Anyone doing sitting, with 1 girl and 1 boy")
  assert.equal(searchDescription({ kind: "gallery", poses: [] }, null, null), "Your gallery search")
  assert.equal(ratingsSentence(["rating:general", "rating:sensitive"]), "Each search runs for Safe and Sensitive pictures.")
  // Nothing found, and a pose the limit left out.
  assert.equal(noPostsSentence("own", "Rule34"), "No posts on Rule34 for this search. The site may spell the character's name differently.")
  assert.equal(noPostsSentence("theme", "Rule34"), "No posts on Rule34 for these tags.")
  brief = addTag(brief, "squatting", OVERRIDES, "doing")
  const danbooru = planSources(brief, { provider: "danbooru", rating: "sfw", includeSensitive: false })
  assert.ok(danbooru.leftOut.length > 0, JSON.stringify(danbooru.leftOut))
  assert.equal(
    leftOutSentence(danbooru.leftOut, "Danbooru", 2),
    `${danbooru.leftOut.map((l) => l.tag).join(" and ")} didn't fit in the searches: Danbooru searches at most 2 tags at a time.`
  )
  assert.equal(leftOutSentence([], "Danbooru", 2), null)
})

check("sizes: a row shows its suggested size; Copy all puts [WIDTHxHEIGHT] in front of each prompt that has one", () => {
  const sized = { width: 832, height: 1216 }
  const unsized = {}
  assert.equal(promptSize(sized), "832×1216")
  assert.equal(promptSize(unsized), null)
  const prompts = [sized, unsized, { width: 1216, height: 832 }]
  const bodies = ["1girl, beach", "1girl, library", "A woman sits on a bench."]
  assert.deepEqual(packCopyText(prompts, bodies, false), { text: bodies.join("\n"), unsized: 0 })
  // The extension's Import List form, in any format; the prompt without a size goes without one.
  assert.deepEqual(packCopyText(prompts, bodies, true), {
    text: "[832x1216] 1girl, beach\n1girl, library\n[1216x832] A woman sits on a bench.",
    unsized: 1,
  })
})

check("sameBriefStart: the same card, prompt or characters; switching builders reopens a pack only on the same base", () => {
  const post = { id: 7 } as unknown as import("../lib/booru/types").BooruPost
  assert.equal(sameBriefStart({ kind: "card", post }, { kind: "card", post }), true)
  assert.equal(sameBriefStart({ kind: "card", post }, { kind: "card", post: { ...post, id: 8 } }), false)
  assert.equal(sameBriefStart({ kind: "prompt", text: "1girl, beach " }, { kind: "prompt", text: "1girl, beach" }), true)
  assert.equal(sameBriefStart({ kind: "characters", names: ["Tifa_Lockhart"] }, { kind: "search", search: "x", character: "tifa lockhart" }), true)
  assert.equal(sameBriefStart({ kind: "characters", names: ["tifa lockhart"] }, { kind: "prompt", text: "tifa lockhart" }), false)
  assert.equal(sameBriefStart({ kind: "search", search: "beach", character: null }, { kind: "search", search: "beach", character: null }), false)
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

// ── Correcting from the results (INT-4) ───────────────────────────────────────────

check("placeRows: locked rows keep their place; fresh prompts fill their slots", () => {
  const prev = ["a", "b", "c", "d"]
  // Row 1 locked after the pack was made: the remake doesn't touch it.
  assert.deepEqual(placeRows(prev, new Set([1]), [0, 1, 2, 3], ["A", "B", "C", "D"]), { rows: ["A", "b", "C", "D"], locked: [1], slots: [0, 1, 2, 3] })
  // Fewer prompts than slots: the free rows left over go, the locked one closes up.
  assert.deepEqual(placeRows(prev, new Set([3]), [0, 1, 2], ["A"]), { rows: ["A", "d"], locked: [1], slots: [0] })
  // More than slots: the extra ones go at the end.
  assert.deepEqual(placeRows(["a"], new Set([0]), [], ["X", "Y"]), { rows: ["a", "X", "Y"], locked: [0], slots: [1, 2] })
})

check("changedRows and lockedWithTag", () => {
  const row = (prompt: string) => ({ prompt })
  assert.equal(changedRows([row("a, b"), row("c")], [row("a, b"), row("d")]), 1)
  assert.equal(changedRows([row("a")], [row("a"), row("b")]), 1)
  const rows = [row("1girl, smile"), row("1girl, (smile:1.2)"), row("1girl, grin")]
  assert.equal(lockedWithTag(rows, [0, 1, 2], "smile"), 2)
  assert.equal(lockedWithTag(rows, [2], "smile"), 0)
})

check("usableSearchTags: filters out, exclusions in", () => {
  assert.deepEqual(usableSearchTags("beach, -smile, rating:general, order:score"), ["beach", "-smile"])
  assert.deepEqual(usableSearchTags("rating:general"), [])
  assert.deepEqual(usableSearchTags(""), [])
})

// ── Changes: one part changes (INT-5) ──────────────────────────────────────────

check("chooseChanges / setBaseScene / variants: a one-part pack keeps its choices apart", () => {
  let b = leaveOutScene(briefFromCharacters(["tifa lockhart"]), "101")
  b = chooseChanges(b, "outfit")
  b = leaveOutVariant(b, "202")
  b = setBaseScene(b, 303)
  assert.equal(b.changes, "outfit")
  assert.equal(b.baseScene, 303)
  assert.deepEqual(b.leftOutVariants, ["202"])
  assert.deepEqual(leftOutPosts(b), [101, 202])
  // The scene that repeats can't be left out.
  assert.deepEqual(setBaseScene(b, 202).leftOutVariants, [])
  assert.deepEqual(restoreVariant(b, "202").leftOutVariants, [])
  // Another part starts over; back on Whole scene the scenes left out before are as they were.
  const pose = chooseChanges(b, "pose")
  assert.equal(pose.baseScene, undefined)
  assert.equal(pose.leftOutVariants, undefined)
  const whole = chooseChanges(b, "scene")
  assert.deepEqual(whole.leftOut, ["101"])
  assert.deepEqual(leftOutPosts(whole), [101])
})

check("briefPackArgs: changes and the scene that repeats; Only the outfit ignores the outfit menu", () => {
  let b = chooseChanges(briefFromCharacters(["tifa lockhart"]), "outfit")
  const env = {
    overrides: OVERRIDES, permanence, count: 10, seed: 1, people: null, outfit: { kind: "usual" as const },
    characterOutfits: new Map([["tifa lockhart", ["white tank top"]]]), clean: (t: string[]) => t.join(", "), baseScene: 77,
  }
  let args = briefPackArgs(b, identityOf(b), env)
  assert.equal(args.changes, "outfit")
  assert.equal(args.baseScene, 77)
  assert.equal(args.settings.clothing, "scene")
  assert.ok(!args.identity.includes("white tank top"))
  b = setBaseScene(b, 88)
  args = briefPackArgs(b, identityOf(b), env)
  assert.equal(args.baseScene, 88)
  const whole = chooseChanges(b, "scene")
  args = briefPackArgs(whole, identityOf(whole), env)
  assert.equal(args.changes, undefined)
  assert.equal(args.baseScene, undefined)
  assert.equal(args.settings.clothing, "character")
})

check("predictFit for a one-part pack: variants that fit, short, kept, finding", () => {
  const axis = { axis: "outfit" as const, requested: [] as string[] }
  assert.deepEqual(predictFit({ ...base, candidates: null, poses: [], axis }), [{ kind: "finding-variants", axis: "outfit" }])
  assert.deepEqual(predictFit({ ...base, candidates: scenes(14), poses: [], axis }), [{ kind: "axis-fit", axis: "outfit", variations: 14 }])
  assert.deepEqual(predictFit({ ...base, candidates: scenes(6), poses: [], axis: { axis: "outfit", requested: ["bikini"] } }), [
    { kind: "few-variations", axis: "outfit", variations: 6, made: 6, asked: 10 },
    { kind: "kept-on-axis", axis: "outfit", tags: ["bikini"] },
  ])
  const b = addTag(chooseChanges(briefFromCharacters(["tifa lockhart"]), "place"), "beach", OVERRIDES)
  assert.deepEqual(axisRequests(b, "place"), ["beach"])
  assert.equal(oneAxis(b), "place")
  assert.equal(fitText({ kind: "axis-fit", axis: "outfit", variations: 14 }).text, "14 outfits fit this scene")
  assert.equal(fitText({ kind: "finding-variants", axis: "pose" }).text, "Finding poses that fit this scene…")
})

// ── Cast and roles (INT-5) ──────────────────────────────────────────────────────

check("one character + bikini + a pose that needs company: the brief leads to People", () => {
  let b = briefFromCharacters(["tifa lockhart"])
  b = addTag(b, "bikini", OVERRIDES)
  b = addTag(b, "princess carry", OVERRIDES)
  const r = toSceneRequests(b)
  assert.deepEqual(r.wearing, ["bikini"])
  assert.deepEqual(r.select, ["princess carry"])
  const line = peopleLineState({
    poses: r.select,
    needsCompany: (tag) => poseNeedsScene(tag, OVERRIDES, null),
    compositions: [{ people: { girls: 1, boys: 1 }, scenes: 41 }, { people: { girls: 2, boys: 0 }, scenes: 27 }],
    current: { girls: 1, boys: 1 },
  })
  assert.equal(line?.poseNeeds, 2)
  assert.equal(line?.options.length, 2)
  assert.equal(b.people, null, "no count typed")
})

check("castPeopleNote: People with less room than the characters", () => {
  assert.equal(castPeopleNote(null, { girls: 2, boys: 0 }), null)
  assert.equal(castPeopleNote({ girls: 2, boys: 1 }, { girls: 2, boys: 0 }), null)
  assert.deepEqual(castPeopleNote({ girls: 1, boys: 1 }, { girls: 2, boys: 0 }), { kind: "people-short-of-cast" })
})

check("roles in a cast: assumed from the subject, set by the user", () => {
  const b = briefFromCharacters(["tifa lockhart", "cloud strife"])
  const looks = { "tifa lockhart": TIFA, "cloud strife": { look: [], subject: ["1boy"], source: "solo" as const } }
  const who = briefIdentity({ brief: b, looks, permanence, overrides: OVERRIDES })
  assert.deepEqual(who.members.map((m) => m.role), ["girl", "boy"])
  assert.deepEqual(who.cast, { girls: 1, boys: 1 })
  const fixed = briefIdentity({ brief: setCharacterRole(b, "cloud strife", "girl"), looks, permanence, overrides: OVERRIDES })
  assert.deepEqual(fixed.cast, { girls: 2, boys: 0 })
})

// ── Copy (INT-5) ────────────────────────────────────────────────────────────────

check("copyNoteText: says what Copy all left out or what changed", () => {
  assert.equal(copyNoteText({ missing: 0, stale: false }), undefined)
  assert.equal(copyNoteText({ missing: 1, stale: false }), "1 prompt is missing.")
  assert.equal(copyNoteText({ missing: 4, stale: true }), "4 prompts are missing. These were made before your last changes to the pack.")
  assert.equal(copyNoteText({ missing: 0, stale: true }), "These were made before your last changes to the pack.")
})

// ── Hardening (INT-6) ───────────────────────────────────────────────────────────

check("placeRows: a row locked at Generate and unlocked since stays when a correction remakes the rest", () => {
  // Generated with row 1 locked: slots are 0, 2, 3. Row 1 is unlocked now.
  const prev = ["a", "b", "c", "d"]
  const out = placeRows(prev, new Set<number>(), [0, 2, 3], ["A", "C", "D"])
  assert.deepEqual(out.rows, ["A", "b", "C", "D"])
  assert.deepEqual(out.locked, [])
  assert.deepEqual(keptRows(4, new Set<number>(), [0, 2, 3]), { locked: [], older: [1] })
  // Locked during the run: the row keeps its prompt and its slot stays.
  const during = placeRows(prev, new Set([2]), [0, 1, 2, 3], ["A", "B", "C", "D"])
  assert.deepEqual(during.rows, ["A", "B", "c", "D"])
  assert.deepEqual(during.locked, [2])
  assert.deepEqual(during.slots, [0, 1, 2, 3])
})

check("opAfterEnd: an operation clears only itself; the one that replaced it keeps the indicator", () => {
  const running = { id: 2, kind: "correct" }
  assert.equal(opAfterEnd(running, 2), null)
  assert.equal(opAfterEnd(running, 1), running)
  assert.equal(opAfterEnd(null, 1), null)
})

check("correctionAfterBriefChange: its own change keeps the notice, any other retires it", () => {
  const before = { v: 0 }
  const mine = { v: 1 }
  const other = { v: 2 }
  const c = { briefBefore: before, briefAfter: null as unknown }
  const first = correctionAfterBriefChange(c, mine)
  assert.equal(first.own, true)
  assert.equal(first.correction?.briefAfter, mine)
  assert.equal(correctionAfterBriefChange(first.correction, mine).own, true)
  // Another edit after the correction: its Undo would no longer undo just the correction.
  assert.deepEqual(correctionAfterBriefChange(first.correction, other), { correction: null, own: false })
  assert.deepEqual(correctionAfterBriefChange(null, other), { correction: null, own: false })
})

check("lookOwner: the character whose identity has the tag; nobody when it can't be told", () => {
  const blocks = [
    { character: "tifa lockhart", pinned: ["tifa lockhart", "black hair", "red eyes"] },
    { character: "cloud strife", pinned: ["cloud strife", "spiked hair", "blue eyes"] },
  ]
  assert.equal(lookOwner("spiked hair", blocks), "cloud strife")
  assert.equal(lookOwner("black_hair", blocks), "tifa lockhart")
  assert.equal(lookOwner("long hair", blocks), null)
  assert.equal(lookOwner("long hair", [blocks[0]]), "tifa lockhart")
})

check("briefFromCardPost: the card's characters come from its character field", () => {
  const { brief, offered } = briefFromCardPost(["1girl", "new_heroine", "bikini", "sitting", "black hair"], ["new_heroine"], OVERRIDES)
  assert.equal(brief.who[0].tag, "new heroine")
  assert.deepEqual(brief.who[0].addedLook, ["black hair"])
  assert.deepEqual(offered, { outfit: ["bikini"], pose: ["sitting"] })
})

check("a search start keeps its exclusions in Never (with the defaults after them)", () => {
  const { brief } = briefFromSearch("tifa lockhart, beach, -smile", OVERRIDES, "tifa lockhart")
  assert.deepEqual(seedNever(brief, ["blurry", "smile"]).never, ["smile", "blurry"])
})

check("after generating a one-part pack, the line counts variants", () => {
  assert.deepEqual(issuesFit({ issues: [], count: 10, made: 10, cast, scenes: 18, canOfferSensitive: false, axis: "outfit" }), [
    { kind: "axis-fit", axis: "outfit", variations: 18 },
  ])
  assert.deepEqual(issuesFit({ issues: [], count: 10, made: 4, cast, scenes: 4, canOfferSensitive: false, axis: "pose" }), [
    { kind: "few-variations", axis: "pose", variations: 4, made: 4, asked: 10 },
  ])
})

// ── Second review round (R1, R2) ────────────────────────────────────────────────

const ten = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]

check("R1: Generate 10 → 5 replaces the pack; no unlocked row of the old one survives", () => {
  const layout = generateLayout([], 5)
  assert.deepEqual(layout.slots, [0, 1, 2, 3, 4])
  const out = placeGenerated(ten, layout, ["A", "B", "C", "D", "E"])
  assert.deepEqual(out.rows, ["A", "B", "C", "D", "E"])
  assert.deepEqual(out.locked, [])
  assert.deepEqual(out.slots, [0, 1, 2, 3, 4])
})

check("R1: 10 → 5 with locked rows: they keep their place, the rest is new", () => {
  const layout = generateLayout([1, 3], 5)
  assert.deepEqual(layout.slots, [0, 2, 4])
  const out = placeGenerated(ten, layout, ["A", "C", "E"])
  assert.deepEqual(out.rows, ["A", "b", "C", "d", "E"])
  assert.deepEqual(out.locked, [1, 3])
  // Fewer prompts than free rows: those rows go.
  assert.deepEqual(placeGenerated(ten, layout, ["A"]).rows, ["A", "b", "d"])
})

check("R1: 10 → 5 with a row locked at position 8: it takes the last place", () => {
  const layout = generateLayout([8], 5)
  assert.deepEqual(layout.slots, [0, 1, 2, 3])
  assert.equal(layout.at.get(4), 8)
  const out = placeGenerated(ten, layout, ["A", "B", "C", "D"])
  assert.deepEqual(out.rows, ["A", "B", "C", "D", "i"])
  assert.deepEqual(out.locked, [4])
  // More locked rows than asked: the pack holds them all.
  assert.deepEqual(generateLayout([0, 8, 9], 2).length, 3)
})

check("R1: a row locked while Generate ran keeps its prompt", () => {
  const out = placeGenerated(ten, generateLayout([], 3), ["A", "B", "C"], new Set([1]))
  assert.deepEqual(out.rows, ["A", "b", "C"])
  assert.deepEqual(out.locked, [1])
  assert.deepEqual(out.slots, [0, 1, 2])
})

check("R2: Generate again keeps the source's own posts first", () => {
  const own = [1, 2, 3, 4, 5, 6]
  const pool = [1, 2, 3, 4, 5, 6, 10, 11, 12]
  // Nothing made yet: the source's own posts as they are.
  assert.deepEqual(preferredForAgain(own, new Set(), pool, 3), own)
  // Enough own posts left for the prompts asked: those.
  assert.deepEqual(preferredForAgain(own, new Set([1, 2, 3]), pool, 3), [4, 5, 6])
  // Not enough: the own posts as they are (never the others ahead of them).
  assert.deepEqual(preferredForAgain(own, new Set([1, 2, 3, 4]), pool, 3), own)
  // A source with no posts of its own: the scenes the last pack didn't use.
  assert.deepEqual(preferredForAgain([], new Set([10, 11]), [10, 11, 12], 2), [12])
})

// ── Another set each Generate (INT-3 browser pass, B) ───────────────────────────

check("rotation: 23 scenes, 10 prompts: two runs share nothing, the third only what it must", () => {
  const scenes = Array.from({ length: 23 }, (_, i) => 100 + i)
  // Stand-in for the engine: it always takes the same scenes first (preferred ones before the others).
  const pick = (exclude: readonly number[], preferred: readonly number[]) => {
    const pool = scenes.filter((id) => !exclude.includes(id))
    return [...pool.filter((id) => preferred.includes(id)), ...pool.filter((id) => !preferred.includes(id))].slice(0, 10)
  }
  let used: number[] = []
  const runs: number[][] = []
  for (let i = 0; i < 3; i++) {
    const turn = rotationPlan({ available: scenes, used, needed: 10, own: [] })
    const got = pick(turn.exclude, turn.preferred)
    used = rotationAfter(turn, used, got)
    runs.push(got)
  }
  const shared = (a: number[], b: number[]) => a.filter((id) => b.includes(id)).length
  assert.equal(shared(runs[0], runs[1]), 0)
  // 3 scenes are left after two runs: the third takes them and only 7 already used.
  assert.equal(runs[2].filter((id) => !runs[0].includes(id) && !runs[1].includes(id)).length, 3)
  assert.equal(shared(runs[2], [...runs[0], ...runs[1]]), 7)
})

check("rotation: the source's own posts still go first, and a new brief starts over", () => {
  const turn = rotationPlan({ available: [1, 2, 3, 4, 5, 6], used: [1, 2], needed: 2, own: [2, 3] })
  assert.deepEqual(turn.exclude, [1, 2])
  assert.deepEqual(turn.preferred, [3])
  assert.equal(turn.reset, false)
  assert.deepEqual(rotationPlan({ available: [1, 2, 3], used: [], needed: 2, own: [3] }), { exclude: [], preferred: [3], reset: false })
  const restart = rotationPlan({ available: [1, 2, 3], used: [1, 2], needed: 2, own: [] })
  assert.deepEqual(restart, { exclude: [], preferred: [3], reset: true })
  assert.deepEqual(rotationAfter(restart, [1, 2], [3, 1]), [3, 1])
})

check("Always from the results takes the same path as Never: its own brief change, then a notice with Undo", () => {
  const before = briefFromCharacters(["tifa lockhart"])
  const after = addTag(before, "smile", OVERRIDES, "also")
  assert.notEqual(JSON.stringify(after), JSON.stringify(before), "Always changes the brief")
  const lifecycle = correctionAfterBriefChange({ briefBefore: before, briefAfter: null as unknown }, after)
  assert.equal(lifecycle.own, true)
  assert.equal(CORRECTION_TEXT.always("smile", 7), "Added smile to 7 prompts")
  assert.equal(CORRECTION_TEXT.never("smile", 1), "Removed smile from 1 prompt")
})

// ── One fact, one sentence (INT-3 browser pass, D) ──────────────────────────────

check("mergeFitNotes: the five notes of bikini + Only the outfit become two lines", () => {
  const five: FitNote[] = [
    { kind: "few-rated" },
    { kind: "few-variations", axis: "outfit", variations: 2, made: 2, asked: 10 },
    { kind: "kept-on-axis", axis: "outfit", tags: ["bikini"] },
    { kind: "no-new", exhausted: false },
    { kind: "paused" },
  ]
  const merged = mergeFitNotes(five)
  assert.deepEqual(merged, [
    { kind: "few-variations", axis: "outfit", variations: 2, made: 2, asked: 10, offerSensitive: true, kept: ["bikini"] },
    { kind: "paused", nothingNew: true },
  ])
  assert.equal(fitText(merged[0] as never).text, "2 of 10: only 2 outfits with bikini fit this scene")
  assert.equal(fitText({ kind: "paused", onLoadMore: () => {}, waiting: false, nothingNew: true }).text, "No new scenes on that page. Search again for more.")
  // Nothing to merge: as they were.
  const plain: FitNote[] = [{ kind: "fit", scenes: 12 }, { kind: "kept-on-axis", axis: "place", tags: ["beach"] }]
  assert.deepEqual(mergeFitNotes(plain), plain)
  // The source has nothing more: that note stays alone.
  assert.deepEqual(mergeFitNotes([{ kind: "no-new", exhausted: true }]), [{ kind: "no-new", exhausted: true }])
})

console.log(`pack-brief-pack: ${passed} checks passed`)
