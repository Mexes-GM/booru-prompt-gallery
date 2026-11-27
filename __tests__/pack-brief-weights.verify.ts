/**
 * Prompt weights typed into the brief: "(excessive cum:2)" in Doing asks for "excessive cum" and
 * writes "(excessive cum:2)" in every prompt. Every way in (each row, a pasted prompt, a card,
 * several tags at once, Always/Never, saved packs, Style defaults) reads the weight the same way;
 * the engine only sees the bare tag, so a weighted pack makes the bare pack's prompts with the
 * weight written on them.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-brief-weights.verify.ts
 */
import fs from "fs"
import path from "path"
import assert from "node:assert/strict"
import { buildScenePool } from "../lib/pack/scene/scene-pool"
import { createPermanence, type PermanenceData } from "../lib/pack/scene/permanence"
import { cleanSyntheticPrompt } from "../lib/pack/bulk-send"
import { generateScenePack, sceneCandidates, tagKindsFromPosts } from "../lib/pack/scene-pack"
import {
  addCharacter, addLook, addNever, addOther, addTag, addTagExactly, briefConditions, briefFromCard, briefFromPrompt, briefTagName,
  emptyBrief, liftBriefWeights, removeCharacter, removeLook, removeTag, routeTag, settleStart, tagWeight, toSceneRequests,
  turnBriefs, typedRole, weighPrompt, writeBriefWeights, type PackBrief, type TypedRow,
} from "../lib/pack/brief"
import { DEFAULT_ROWS, commit, rowMatchesDefaults, seedDefaults, seedStyle, startHistory, undo, withoutRowDefault } from "../lib/pack/brief-history"
import { briefIdentity, briefPackArgs, lockedWithTag } from "../lib/pack/brief-pack"
import { readSavedPack, savedPackToStore } from "../lib/pack/saved-pack"
import { packNaturalSource } from "../lib/pack/pack-natural"
import { formatPrompt, naturalPromptInput } from "../lib/prompt/natural-format"
import { readWeightedTag } from "../lib/weight-utils"
import type { PackPreferences } from "../lib/storage"
import { makePost } from "./fixtures/pack-scene-data"

const root = path.join(__dirname, "..")
const CORE: Record<string, string> = JSON.parse(fs.readFileSync(path.join(root, "public/tags-core.json"), "utf8"))
const PERMANENCE: PermanenceData = JSON.parse(fs.readFileSync(path.join(root, "public/tag-permanence.json"), "utf8"))
const overrides: Record<string, string> = {}
for (const [tag, slot] of Object.entries(CORE)) overrides[tag.replace(/_/g, " ")] = slot
const permanence = createPermanence(PERMANENCE, overrides)

let passed = 0
const check = (name: string, fn: () => void) => {
  try { fn(); passed++ } catch (err) { console.error(`FAIL: ${name}`); throw err }
}
/** The brief without its weights: what the engine is given. */
const bare = (brief: PackBrief): PackBrief => {
  const { weights: _w, ...rest } = brief
  void _w
  return rest
}

// ── Reading the syntax ─────────────────────────────────────────────────────────

check("the weight forms the app reads", () => {
  assert.deepEqual(readWeightedTag("(excessive cum:2)"), { tag: "excessive cum", weight: 2 })
  assert.deepEqual(readWeightedTag(" ( Smile : 1.25 ) "), { tag: "Smile", weight: 1.25 })
  assert.deepEqual(readWeightedTag("(smile)"), { tag: "smile", weight: 1.1 })
  assert.deepEqual(readWeightedTag("((smile))"), { tag: "smile", weight: 1.21 })
  assert.deepEqual(readWeightedTag("((smile:2))"), { tag: "smile", weight: 2.2 })
  assert.deepEqual(readWeightedTag("[smile]"), { tag: "smile", weight: 0.909 })
  assert.deepEqual(readWeightedTag("score_9:1.2"), { tag: "score_9", weight: 1.2 })
  assert.deepEqual(readWeightedTag("(smile:1)"), { tag: "smile", weight: 1 })
  assert.deepEqual(readWeightedTag("(kashima \\(kancolle\\):1.3)"), { tag: "kashima (kancolle)", weight: 1.3 })
})

check("tags that only look like weights stay tags", () => {
  for (const tag of ["smile", "kashima (kancolle)", ":3", ":d", "(o)_(o)", "re:zero", "16:9", "@artist", "()"]) {
    assert.deepEqual(readWeightedTag(tag), { tag }, tag)
  }
  assert.equal(briefTagName("(Excessive_Cum:2)"), "excessive cum")
})

// ── Every row ──────────────────────────────────────────────────────────────────

check("a weighted tag goes where its bare tag goes, in every row", () => {
  const rows: Array<[string, TypedRow]> = [
    ["bikini", "wearing"], ["sitting", "doing"], ["excessive cum", "doing"], ["beach", "where"], ["night", "where"],
    ["blush", "also"], ["masterpiece", "style"], ["@angeltights", "style"], ["long hair", "who"], ["tifa lockhart", "who"],
    ["dark-skinned male", "also"], ["1girl", "who"], ["hetero", "also"],
  ]
  for (const [tag, row] of rows) {
    const weighted = `(${tag}:1.4)`
    assert.deepEqual(routeTag(weighted, overrides), routeTag(tag, overrides), `route of ${weighted}`)
    assert.equal(typedRole(weighted, row, overrides), typedRole(tag, row, overrides), `typed role of ${weighted} in ${row}`)
    const withWeight = addTag(emptyBrief(), weighted, overrides, typedRole(weighted, row, overrides))
    const without = addTag(emptyBrief(), tag, overrides, typedRole(tag, row, overrides))
    assert.deepEqual(bare(withWeight), without, `${weighted} typed in ${row} is ${tag} in the same place`)
    const counted = routeTag(tag, overrides).kind === "people" || routeTag(tag, overrides).kind === "composition"
    assert.equal(tagWeight(withWeight, tag), counted ? undefined : 1.4, `weight of ${tag}`)
  }
})

check("Doing: the request is the bare tag, Any/Exactly and conditions read it", () => {
  let brief = addTag(emptyBrief(), "(excessive cum:2)", overrides, "doing")
  assert.deepEqual(brief.requests, [{ tag: "excessive cum", role: "doing" }])
  assert.deepEqual(toSceneRequests(brief).select, ["excessive cum"])
  brief = addTag(brief, "(bikini:1.3)", overrides, "wearing")
  assert.deepEqual(briefConditions(brief, overrides), ["bikini"], "a weighted garment is still a condition")
  const exact = addTagExactly(brief, "(bikini:1.3)", overrides, "wearing")
  assert.deepEqual(exact.requests.find((r) => r.tag === "bikini"), { tag: "bikini", role: "wearing", exact: true })
  assert.deepEqual(exact.weights, { "excessive cum": 2, bikini: 1.3 })
})

check("the same tag again: no repeat; a new weight replaces the old, weight 1 clears it, the bare tag leaves it", () => {
  let brief = addTag(emptyBrief(), "(sitting:2)", overrides)
  brief = addTag(brief, "sitting", overrides)
  assert.equal(brief.requests.length, 1)
  assert.equal(tagWeight(brief, "sitting"), 2, "typing the bare tag keeps its weight")
  brief = addTag(brief, "(sitting:1.5)", overrides)
  assert.equal(tagWeight(brief, "sitting"), 1.5)
  brief = addTag(brief, "(sitting:1)", overrides)
  assert.equal(brief.weights, undefined, "weight 1 is no weight")
})

check("Style keeps the tag as typed, without the brackets", () => {
  const brief = addTag(emptyBrief(), "(Score_9:1.2)", overrides)
  assert.deepEqual(brief.literal, ["Score_9"])
  assert.deepEqual(brief.weights, { "score 9": 1.2 })
  assert.deepEqual(toSceneRequests(brief).literal, ["Score_9"])
})

check("Who, a character's look, Others", () => {
  let brief = addTag(emptyBrief(), "(tifa lockhart:1.1)", overrides)
  assert.equal(brief.who[0].tag, "tifa lockhart")
  brief = addTag(brief, "(long hair:1.3)", overrides)
  assert.deepEqual(brief.who[0].addedLook, ["long hair"])
  brief = addLook(brief, "tifa lockhart", "(red eyes:0.8)")
  brief = addOther(brief, "(dark-skinned male:1.2)")
  brief = addCharacter(brief, "(aerith gainsborough:1.15)")
  assert.deepEqual(brief.others, ["dark-skinned male"])
  assert.deepEqual(brief.weights, { "tifa lockhart": 1.1, "long hair": 1.3, "red eyes": 0.8, "dark-skinned male": 1.2, "aerith gainsborough": 1.15 })
  // Each brief of a pack in turns keeps the weights.
  assert.deepEqual(turnBriefs({ ...brief, castMode: "turns" }).map((b) => b.weights), [brief.weights, brief.weights])
})

check("Never takes no weight, and a tag moved to Never loses it", () => {
  let brief = addNever(emptyBrief(), "(smile:1.5)")
  assert.deepEqual(brief.never, ["smile"])
  assert.equal(brief.weights, undefined)
  brief = addTag(brief, "(blush:1.3)", overrides)
  brief = addNever(brief, "blush")
  assert.deepEqual(brief.never, ["smile", "blush"])
  assert.equal(brief.weights, undefined, "the weight goes with the tag")
  // Asking for it again takes it off Never, with the new weight.
  brief = addTag(brief, "(blush:1.1)", overrides)
  assert.deepEqual(brief.never, ["smile"])
  assert.deepEqual(brief.weights, { blush: 1.1 })
})

check("removing a tag, a look or a character forgets its weight", () => {
  let brief = addTag(emptyBrief(), "(tifa lockhart:1.1)", overrides)
  brief = addTag(brief, "(long hair:1.3)", overrides)
  brief = addTag(brief, "(sitting:2)", overrides)
  assert.equal(tagWeight(removeTag(brief, "sitting"), "sitting"), undefined)
  assert.equal(tagWeight(removeTag(brief, "(sitting:2)"), "sitting"), undefined, "the chip's weighted text works too")
  assert.equal(tagWeight(removeLook(brief, "tifa lockhart", "long hair"), "long hair"), undefined)
  const gone = removeCharacter(brief, "tifa lockhart")
  assert.equal(tagWeight(gone, "tifa lockhart"), undefined)
  assert.equal(tagWeight(gone, "sitting"), 2, "the other weights stay")
})

// ── Paste, card, several at once, corrections ─────────────────────────────────

check("a pasted prompt: every weight form, counts apart, the bare brief the same as without weights", () => {
  const pasted = "1girl, (tifa lockhart:1.1), ((long hair)), (sitting:2), [smile], beach:1.2, (excessive cum:2), (masterpiece:1.2), kashima \\(kancolle\\)"
  const plain = "1girl, tifa lockhart, long hair, sitting, smile, beach, excessive cum, masterpiece, kashima (kancolle)"
  const weighted = briefFromPrompt(pasted, overrides, permanence)
  const unweighted = briefFromPrompt(plain, overrides, permanence)
  assert.deepEqual(weighted.peopleTags, ["1girl"])
  assert.deepEqual(bare(weighted.brief), unweighted.brief)
  assert.deepEqual(weighted.brief.weights, {
    "tifa lockhart": 1.1, "long hair": 1.21, sitting: 2, smile: 0.909, beach: 1.2, "excessive cum": 2, masterpiece: 1.2,
  })
  // Placed again once the permanence data loads, a moved tag keeps its weight.
  const early = briefFromPrompt(pasted, overrides)
  const settled = settleStart(early.brief, weighted.brief, early.brief)
  assert.deepEqual(settled.weights, weighted.brief.weights)
})

check("a card: its look comes with the weight it had", () => {
  const { brief, offered } = briefFromCard(["tifa lockhart", "(long hair:1.3)", "(bikini:1.2)", "1girl"], overrides, permanence)
  assert.deepEqual(brief.weights, { "long hair": 1.3 })
  assert.deepEqual(offered.outfit, ["bikini"])
})

check("several tags at once (the hook's addTags)", () => {
  const brief = ["(bikini:1.2)", "(sitting:2)", "beach"].reduce((b, tag) => addTag(b, tag, overrides), emptyBrief())
  assert.deepEqual(brief.requests.map((r) => r.tag), ["bikini", "sitting", "beach"])
  assert.deepEqual(brief.weights, { bikini: 1.2, sitting: 2 })
})

check("Always and Never from a result row: the row's weighted tag asks for the bare tag", () => {
  const brief = addTag(emptyBrief(), "(sitting:2)", overrides)
  // A prompt tag carries its weight ("(sitting:2)"); a tag with a qualifier keeps it.
  assert.equal(lockedWithTag([{ prompt: "1girl, (sitting:2), smile" }], [0], "sitting"), 1)
  assert.equal(lockedWithTag([{ prompt: "1girl, (kashima (kancolle):1.2)" }], [0], "kashima (kancolle)"), 1)
  const always = addTagExactly(brief, readWeightedTag("(bikini:1.3)").tag, overrides, typedRole("bikini", "also", overrides))
  assert.equal(always.requests.find((r) => r.tag === "bikini")?.exact, true)
  assert.equal(tagWeight(always, "bikini"), undefined, "Always asks for the tag, not the weight a row had")
  const never = addNever(brief, readWeightedTag("(sitting:2)").tag)
  assert.deepEqual(never.never, ["sitting"])
  assert.equal(never.weights, undefined)
})

// ── Undo, reload, defaults ────────────────────────────────────────────────────

check("undo brings the weight back; an edit never changes the brief it started from", () => {
  const first = addTag(emptyBrief(), "(sitting:2)", overrides)
  const copy = JSON.stringify(first)
  let history = startHistory(first)
  history = commit(history, addTag(first, "(sitting:3)", overrides), "Added sitting")
  assert.equal(tagWeight(history.present, "sitting"), 3)
  assert.equal(JSON.stringify(first), copy, "the first brief is untouched")
  history = undo(history).history
  assert.equal(tagWeight(history.present, "sitting"), 2)
})

check("a saved pack keeps its weights across a reload", () => {
  const brief = addTag(addTag(emptyBrief(), "(excessive cum:2)", overrides, "doing"), "(masterpiece:1.2)", overrides)
  const stored = savedPackToStore({ brief, outfit: { kind: "scene" }, provider: "danbooru", gallerySearch: "", result: null }, 1)
  const read = readSavedPack(JSON.parse(JSON.stringify(stored)))
  assert.ok(read)
  assert.deepEqual(read.brief, brief)
  const broken = readSavedPack(JSON.parse(JSON.stringify({ ...stored, brief: { ...brief, weights: { smile: "2" } } })))
  assert.equal(broken, null, "a weight that isn't a number is no pack")
})

check("a pack saved with the weight in its tag reads it as a weight", () => {
  const old: PackBrief = { ...emptyBrief(), requests: [{ tag: "(excessive cum:2)", role: "doing" }], literal: ["(Masterpiece:1.2)"], never: ["(smile:1.3)"] }
  const lifted = liftBriefWeights(old)
  assert.deepEqual(lifted.requests, [{ tag: "excessive cum", role: "doing" }])
  assert.deepEqual(lifted.literal, ["Masterpiece"])
  assert.deepEqual(lifted.never, ["smile"])
  assert.deepEqual(lifted.weights, { "excessive cum": 2, masterpiece: 1.2 })
  const stored = savedPackToStore({ brief: old, outfit: { kind: "scene" }, provider: "danbooru", gallerySearch: "", result: null }, 1)
  assert.deepEqual(readSavedPack(JSON.parse(JSON.stringify(stored)))?.brief, lifted)
  const plain = addTag(emptyBrief(), "sitting", overrides)
  assert.equal(liftBriefWeights(plain), plain, "a brief without weight syntax is the same object")
})

check("Style defaults keep their weights; Never defaults don't", () => {
  const brief = addTag(addTag(emptyBrief(), "(masterpiece:1.2)", overrides), "@angeltights", overrides)
  const saved = DEFAULT_ROWS.style.tagsOf(brief)
  assert.deepEqual(saved, ["(masterpiece:1.2)", "@angeltights"])
  const prefs: PackPreferences = { promptCount: 10, neverDefaults: ["(smile:1.3)"], includeSensitive: false, styleDefaults: saved }
  const seeded = seedDefaults(emptyBrief(), prefs)
  assert.deepEqual(seeded.literal, ["masterpiece", "@angeltights"])
  assert.deepEqual(seeded.weights, { masterpiece: 1.2 })
  assert.deepEqual(seeded.never, ["smile"])
  assert.equal(rowMatchesDefaults(seeded, prefs, "style"), true)
  assert.equal(rowMatchesDefaults(seedStyle(emptyBrief(), ["masterpiece"]), prefs, "style"), false, "another weight is another default")
  assert.deepEqual(withoutRowDefault(prefs, "style", "masterpiece").styleDefaults, ["@angeltights"])
})

// ── The prompts ───────────────────────────────────────────────────────────────

check("the weight is written on the tag, in the app's syntax; weight 1 and no weights change nothing", () => {
  assert.equal(writeBriefWeights("1girl, excessive cum, smile", { "excessive cum": 2 }), "1girl, (excessive cum:2), smile")
  assert.equal(writeBriefWeights("Score_9, 1girl", { "score 9": 1.2 }), "(Score_9:1.2), 1girl")
  const prompt = "1girl, sitting, smile"
  assert.equal(writeBriefWeights(prompt, undefined), prompt)
  assert.equal(writeBriefWeights(prompt, {}), prompt)
  const row = { prompt, values: [] as string[] }
  assert.equal(weighPrompt(row, emptyBrief()), row, "same object without weights")
  assert.equal(weighPrompt(row, addTag(emptyBrief(), "(sitting:1)", overrides)), row, "weight 1 is no weight")
})

check("the pack's weight wins over the global weight; other global weights stay", () => {
  const clean = (weights: Record<string, number>) => cleanSyntheticPrompt(["sitting", "smile", "blush"], [], {
    excludeInput: "", addInput: "", includeCharacters: true, optimizeTags: false, tagOverrides: overrides, globalWeights: weights, isGlobalWeightsEnabled: true,
  })
  const global = clean({ sitting: 1.3, smile: 1.2 })
  assert.ok(global.includes("(sitting:1.3)") && global.includes("(smile:1.2)"), global)
  const out = writeBriefWeights(global, { sitting: 2 })
  assert.ok(out.includes("(sitting:2)") && !out.includes("1.3"), out)
  assert.ok(out.includes("(smile:1.2)"), "a global weight the pack doesn't set stays: " + out)
})

// The scenes engine, through the brief route the hook takes (briefPackArgs).
const scene = (id: number, tags: string) => makePost(id, tags, { rating: "explicit" })
const POSTS = [
  scene(201, "1girl solo standing smile bedroom bed indoors white_shirt"),
  scene(202, "1girl solo sitting blush park outdoors tree dress excessive_cum"),
  scene(203, "1girl solo standing closed_eyes street outdoors night jacket"),
  scene(204, "1girl solo sitting smile classroom indoors chair shirt skirt excessive_cum"),
  scene(205, "1girl solo sitting open_mouth cafe indoors table sweater"),
  scene(206, "1girl solo lying on_back bed bedroom indoors pajamas excessive_cum"),
]
const pool = buildScenePool(POSTS, { overrides, permanence, subject: "girl", tagKind: (tag) => tagKindsFromPosts(POSTS).get(tag) })
const clean = (tags: string[], locked: string[]) => cleanSyntheticPrompt(tags, [], {
  excludeInput: "", addInput: "", includeCharacters: true, optimizeTags: false, tagOverrides: overrides, lockedTags: locked,
}, locked)
const run = (brief: PackBrief) => {
  const who = briefIdentity({ brief, looks: {}, permanence, overrides })
  const args = briefPackArgs(brief, who, { overrides, permanence, count: 4, seed: 5, people: null, outfit: { kind: "scene" }, clean })
  return { args, candidates: sceneCandidates(pool, { ...args, count: 1 }), prompts: generateScenePack(pool, args).prompts }
}

check("a weighted Doing tag finds the scenes the bare tag finds, and every prompt carries the weight", () => {
  for (const [typed, tag] of [["(excessive cum:2)", "excessive cum"], ["(sitting:1.5)", "sitting"]]) {
    const weighted = run(addTag(emptyBrief(), typed, overrides, "doing"))
    const plain = run(addTag(emptyBrief(), tag, overrides, "doing"))
    assert.deepEqual(weighted.args.requests, plain.args.requests, `the engine is asked for ${tag}`)
    const fits = weighted.candidates.filter((c) => c.hasPose).map((c) => c.postId)
    assert.ok(fits.length > 0, `some scene has ${tag}`)
    assert.deepEqual(fits, plain.candidates.filter((c) => c.hasPose).map((c) => c.postId), "the same scenes fit")
    assert.deepEqual(weighted.prompts, plain.prompts, "the engine makes the same prompts")
    const brief = addTag(emptyBrief(), typed, overrides, "doing")
    const written = weighted.prompts.map((p) => weighPrompt(p, brief).prompt)
    for (const text of written) {
      const tags = text.split(",").map((t) => t.trim())
      assert.ok(tags.includes(writeBriefWeights(tag, brief.weights)), text)
      assert.ok(!tags.includes(tag), `no bare ${tag} left: ${text}`)
    }
  }
})

check("natural-language formats don't print the weight in prose", () => {
  const brief = addTag(emptyBrief(), "(sitting:2)", overrides, "doing")
  const [first] = run(brief).prompts
  const weighted = weighPrompt(first, brief)
  assert.ok(weighted.prompt.includes("(sitting:2)"))
  const source = packNaturalSource(weighted, { character: null, contentRating: "explicit" })
  for (const format of ["flux2", "anima", "moss"] as const) {
    const text = formatPrompt(format, naturalPromptInput(source, overrides), overrides).text
    assert.ok(!/\(sitting:2\)|:2\)/.test(text), `${format}: ${text}`)
    const plain = formatPrompt(format, naturalPromptInput(packNaturalSource(first, { character: null, contentRating: "explicit" }), overrides), overrides).text
    assert.equal(text, plain, `${format} reads the weighted prompt as the bare one`)
  }
})

console.log(`pack-brief-weights: ${passed} checks passed`)
