/**
 * The measured tag relations where they're used: the conflict resolver (measured
 * pairs first, people counted with the added tag, the bundled core before the file
 * loads), Classic's sampling (no contradictions, requirements brought along) and
 * Scenes' dangling references.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/tag-relations-use.verify.ts
 */
import { parseTagRelations, setTagRelations, type TagRelationsFile } from "../lib/tag-relations"
import { resolveTagConflicts } from "../lib/tag-conflicts"
import { generatePackPrompts } from "../lib/pack/pack-generator"
import { danglingReferences } from "../lib/pack/scene/scene-compose"
import { createSeededRng } from "../lib/pack/pack-generator"
import { coherentPromptTags } from "../lib/pack/prompt-coherence"

let failed = 0
let passed = 0
const assert = (ok: unknown, label: string) => {
  if (ok) passed++
  else { failed++; console.log("FAIL: " + label) }
}

const CONTEXTS = ["solo:all", "solo:sfw", "solo:q", "solo:e", "solo:both", "multi:all", "multi:sfw", "multi:q", "multi:e", "multi:both"]
const SOLO = CONTEXTS.filter((c) => c.startsWith("solo")).reduce((m, c) => m | (1 << CONTEXTS.indexOf(c)), 0)
const ALL = (1 << CONTEXTS.length) - 1
const TAGS = ["crouching", "leaning back", "sunrise", "midnight", "skirt lift", "skirt", "drinking", "cup", "scarf", "bandana", "looking at another", "gold earrings", "earrings", "poster (object)", "bouquet"]
const id = (t: string) => TAGS.indexOf(t)
const file: TagRelationsFile = {
  v: 2,
  contexts: CONTEXTS,
  tags: TAGS,
  // crouching / leaning back: one person only, rare (0.005); sunrise / midnight: never, anyone;
  // scarf / bandana: one person, 0.06 (only choosing among candidates uses it).
  ex: [id("crouching"), id("leaning back"), SOLO, 5, 255, id("sunrise"), id("midnight"), ALL, 0, 0, id("scarf"), id("bandana"), SOLO, 60, 255],
  req: [id("skirt lift"), id("skirt"), id("gold earrings"), id("earrings")],
  reqSlot: { "equipment:handheld": [id("drinking")] },
  company: [id("looking at another")],
  held: [id("bouquet")],
  notHeld: [id("poster (object)")],
}
const relations = parseTagRelations(file)
const overrides: Record<string, string> = { skirt: "clothing:bottom", cup: "equipment:handheld", crouching: "pose:posture", "leaning back": "pose:posture" }

// ── Resolver ──
{
  setTagRelations(null)
  const before = resolveTagConflicts(["1girl", "crouching"], ["leaning back"])
  assert(before.validTags.includes("leaning back"), "before the file loads, a pair only it knows passes")
  const core = resolveTagConflicts(["1girl", "standing"], ["sitting"])
  assert(core.conflictingTags.some((c) => c.tag === "sitting"), "the bundled core (a confirmed hand rule) works before the file loads")

  setTagRelations(relations)
  const one = resolveTagConflicts(["1girl", "crouching"], ["leaning back"])
  assert(one.conflictingTags[0]?.tag === "leaning back" && one.conflictingTags[0].reason.includes("crouching"), "loaded: the added tag gives way to the base")
  assert(resolveTagConflicts(["2girls", "crouching"], ["leaning back"]).validTags.includes("leaning back"), "with two people one can crouch while the other leans back")
  assert(resolveTagConflicts(["1girl", "sunrise"], ["midnight"]).conflictingTags.length === 1, "never together: blocked for one person")
  assert(resolveTagConflicts(["2girls", "sunrise"], ["midnight"]).conflictingTags.length === 1, "and for several")
  assert(resolveTagConflicts(["1girl", "scarf"], ["bandana"]).validTags.includes("bandana"), "a pair only somewhat rare doesn't make the resolver remove a tag")
  assert(resolveTagConflicts(["1girl", "crouching"], ["crouching"]).validTags.includes("crouching"), "a tag the base already has is never a conflict")
  // People are counted with the added tag: "1girl" added to "1boy" makes a pair.
  assert(resolveTagConflicts(["1boy", "hetero"], ["1girl"]).validTags.includes("1girl"), "1girl next to 1boy is a pair, not a contradiction")
  assert(resolveTagConflicts(["1girl"], ["2girls"]).conflictingTags.length === 1, "1girl and 2girls still contradict")
}

// ── Classic: sampling without contradictions, requirements brought along ──
{
  setTagRelations(relations)
  const prompts = generatePackPrompts({
    lockedTags: ["1girl"],
    axes: { pose: ["crouching", "leaning back"], scenery: ["sunrise", "midnight"] },
    axisMinCounts: { pose: 2, scenery: 2 },
    count: 20,
    rng: createSeededRng(7),
    tagOverrides: overrides,
  })
  assert(prompts.length > 0, "Classic makes prompts")
  assert(prompts.every((p) => !(p.prompt.includes("crouching") && p.prompt.includes("leaning back"))), "never crouching and leaning back together")
  assert(prompts.every((p) => !(p.prompt.includes("sunrise") && p.prompt.includes("midnight"))), "never sunrise and midnight together")
  assert(prompts.every((p) => p.prompt.split(", ").length === 3), "each axis still fills its place: no slot is lost to a conflict")

  const lift = (args: Partial<Parameters<typeof generatePackPrompts>[0]>) => generatePackPrompts({
    lockedTags: ["1girl"], axes: { clothing: ["skirt lift"] }, count: 5, rng: createSeededRng(3), tagOverrides: overrides, ...args,
  })
  assert(lift({}).every((p) => p.prompt.includes("skirt lift") && p.prompt.split(", ").includes("skirt")), "skirt lift brings a skirt")
  assert(lift({ userExcluded: (t) => t === "skirt" }).every((p) => !p.prompt.includes("skirt lift")), "not drawn when the user excluded what it requires")
  assert(lift({ offCategories: ["clothing"] }).every((p) => !p.prompt.includes("skirt lift")), "not drawn when what it requires is in an Off category")
  assert(lift({ lockedTags: ["1girl", "pleated skirt"] }).every((p) => p.prompt.split(", ").filter((t) => t === "skirt").length === 0), "a pleated skirt already names the skirt")

  setTagRelations(null)
  const plain = generatePackPrompts({ lockedTags: ["1girl"], axes: { clothing: ["skirt lift"] }, count: 5, rng: createSeededRng(3) })
  assert(plain.every((p) => p.prompt === "1girl, skirt lift"), "without the relations, sampling is as before")
}

// ── Scenes: dangling references ──
{
  setTagRelations(relations)
  assert(danglingReferences(["1girl", "drinking"], overrides).has("drinking"), "drinking with nothing in hand dangles (measured)")
  assert(!danglingReferences(["1girl", "drinking", "cup"], overrides).has("drinking"), "with a cup it doesn't")
  assert(danglingReferences(["1girl", "skirt lift", "shirt"], overrides).has("skirt lift"), "a skirt lift without a skirt dangles")
  assert(!danglingReferences(["1girl", "skirt lift", "pleated skirt"], { ...overrides, "pleated skirt": "clothing:bottom" }).has("skirt lift"), "a pleated skirt is a skirt")
  assert(danglingReferences(["1girl", "dual wielding"], overrides).has("dual wielding"), "dual wielding stays on the hand list")
  setTagRelations(null)
  assert(danglingReferences(["1girl", "reverse grip"], overrides).has("reverse grip"), "before the file loads, reverse grip is still caught")
}

// ── The last pass Classic and Scenes share ──
{
  setTagRelations(relations)
  const out = coherentPromptTags(["1girl", "earrings", "gold earrings", "holding", "smile"], { keep: ["1girl", "earrings"], overrides })
  assert(out.join() === "1girl,gold earrings,smile", "the generic gives way to its qualified form, even from the base; holding with nothing held goes: " + out.join())
  const scene = coherentPromptTags(["1girl", "earrings", "gold earrings"], { keep: ["1girl", "earrings"], fixed: ["earrings"], overrides })
  assert(scene.includes("earrings"), "a fixed tag is never replaced")
  assert(coherentPromptTags(["1girl", "drinking", "cup"], { keep: ["1girl"], overrides }).includes("drinking"), "drinking with a cup stays")
}

// ── A grip verb only with something carried ──
{
  setTagRelations(relations)
  const ov: Record<string, string> = { ...overrides, bed: "scenery:props", dog: "creature:animal", horse: "creature:animal", "poster (object)": "equipment:handheld", bouquet: "scenery:props", sword: "equipment:weapon" }
  const dangles = (tags: string[]) => danglingReferences(tags, ov).has(tags[1])
  assert(dangles(["1girl", "holding", "bed"]), "holding next to a bed holds nothing")
  assert(dangles(["1girl", "holding", "dog"]), "nor next to a dog")
  assert(dangles(["1girl", "holding", "poster (object)", "bed"].filter((t) => t !== "poster (object)")), "nor furniture")
  assert(!dangles(["1girl", "holding", "poster (object)"]), "a tag filed with hand objects counts")
  assert(!dangles(["1girl", "holding", "cup"]) && !dangles(["1girl", "holding", "sword"]), "a cup or a sword is held")
  assert(!dangles(["1girl", "holding", "bouquet"]), "a prop people do hold counts")
  assert(!dangles(["1girl", "riding", "horse"]) && !dangles(["1girl", "carrying", "dog"]), "riding a horse, carrying a dog")
  assert(!dangles(["1girl", "holding", "holding dog"]), "holding dog names what is held")
  setTagRelations(null)
  assert(!danglingReferences(["1girl", "holding", "dog"], ov).has("holding"), "before the relations load, any creature still counts")
}

// ── Tags that need company ──
{
  setTagRelations(relations)
  assert(resolveTagConflicts(["1girl", "solo"], ["looking at another"]).conflictingTags[0]?.reason === "Needs more than one person", "not with one person")
  assert(resolveTagConflicts(["1girl", "1boy"], ["looking at another"]).validTags.length === 1, "fine with two")
  assert(resolveTagConflicts(["smile"], ["looking at another"]).validTags.length === 1, "and when the prompt doesn't say how many")
  const classic = generatePackPrompts({ lockedTags: ["1girl", "solo"], axes: { pose: ["looking at another", "crouching"] }, count: 10, rng: createSeededRng(5) })
  assert(classic.length > 0 && classic.every((p) => !p.prompt.includes("looking at another")), "Classic doesn't draw it for one person")
  setTagRelations(null)
}

console.log(`${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
