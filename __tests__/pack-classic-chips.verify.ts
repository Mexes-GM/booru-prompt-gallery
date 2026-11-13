/**
 * The character chips in Classic (lib/pack/classic-chips.ts), with the same chip
 * model as Scenes: a pinned tag goes in every prompt and takes its slot, a removed
 * or never-included tag never appears (full sets included), an added trait is
 * pinned and shown under its own category, and one choice serves both methods.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-classic-chips.verify.ts
 */
import { addedTraitCategory, classicKeptTags, pinnedConflicts, poolEntriesFromInput, withoutKeptValues, withoutNeverTags } from "../lib/pack/classic-chips"
import { pinnedConflictLines } from "../components/prompt-gallery/pack-category-list"
import { createSeededRng, generatePackPrompts } from "../lib/pack/pack-generator"
import { castChips, type ChipState } from "../lib/pack/scene-pack"
import { isQualifiedVariant } from "../lib/pack/character-identity"

let failed = 0
let passed = 0
const assert = (ok: unknown, label: string) => {
  if (ok) passed++
  else { failed++; console.log("FAIL: " + label) }
}

// ── What every prompt keeps ──
{
  const choices = new Map<string, ChipState>([["long hair", "scene"], ["black thighhighs", "pinned"]])
  const kept = classicKeptTags(["1girl", "long hair", "blue eyes"], ["long hair", "blue eyes", "black thighhighs", "skirt"], (t) => choices.get(t), ["red scarf"])
  assert(kept.join() === "1girl,blue eyes,black thighhighs,red scarf", "a dash leaves, a pin joins from a varying category, an added trait is pinned: " + kept.join())
}

// ── A category on Keep wins over a dash, and gives it back when it varies again ──
{
  const choices = new Map<string, ChipState>([["black thighhighs", "scene"]])
  const onKeep = classicKeptTags(["1girl", "black thighhighs"], ["black thighhighs"], (t) => choices.get(t), [], (t) => t === "black thighhighs")
  assert(onKeep.includes("black thighhighs"), "on Keep the dashed tag is still in every prompt")
  const onVary = classicKeptTags(["1girl"], ["black thighhighs"], (t) => choices.get(t), [], () => false)
  assert(!onVary.includes("black thighhighs"), "back on Vary, the user's dash applies again")
}

// ── Two pins that rarely go together: both stay, and it's said ──
{
  const reasons: Record<string, string> = { sitting: "Conflicts with 'standing'", standing: "Conflicts with 'sitting'" }
  const conflicts = pinnedConflicts(["standing", "sitting", "smile"], ["standing", "sitting", "smile"], (tag) => reasons[tag] ?? null)
  assert(conflicts.sitting === "standing" && conflicts.standing === "sitting" && !conflicts.smile, "each names the tag it clashes with")
  const lines = pinnedConflictLines(conflicts, ["standing", "sitting", "smile"])
  assert(lines.length === 1 && lines[0] === "standing and sitting rarely go together. Both are pinned, so both stay.", "one line per pair: " + lines.join(" | "))
}

// ── A pinned garment takes its slot ──
{
  const overrides: Record<string, string> = {
    "black thighhighs": "clothing:legwear", "white thighhighs": "clothing:legwear", pantyhose: "clothing:legwear",
    skirt: "clothing:bottom", shorts: "clothing:bottom", "school uniform": "clothing:outfit",
  }
  const prompts = generatePackPrompts({
    lockedTags: ["1girl", "black thighhighs"],
    axes: { clothing: ["white thighhighs", "pantyhose", "skirt", "shorts"] },
    axisMinCounts: { clothing: 2 },
    count: 30,
    rng: createSeededRng(4),
    tagOverrides: overrides,
  })
  assert(prompts.length > 0 && prompts.every((p) => p.prompt.includes("black thighhighs")), "the pinned stockings are in every prompt")
  assert(prompts.every((p) => !/white thighhighs|pantyhose/.test(p.prompt)), "and no other legwear joins them")
  assert(prompts.some((p) => /skirt|shorts/.test(p.prompt)), "the rest of the category still varies")
}

// ── Removed and never-included tags never appear, full sets included ──
{
  const never = ["earrings", "hat"]
  const isNever = (tag: string) => never.some((n) => isQualifiedVariant(tag.toLowerCase().replace(/_/g, " "), n))
  const pool = ["school uniform, earrings, loafers", "witch hat, black dress", "kimono", "gold earrings", "hat"]
  const { values, originOf } = withoutNeverTags(pool, isNever)
  assert(values.join("|") === "school uniform, loafers|black dress|kimono", "sets lose the tag and stay, singles go: " + values.join("|"))
  assert(originOf.get("school uniform, loafers") === "school uniform, earrings, loafers", "each value remembers where it came from (its weight)")
  const prompts = generatePackPrompts({ lockedTags: ["1girl"], axes: { clothing: values }, count: 20, rng: createSeededRng(2) })
  assert(prompts.length > 0 && prompts.every((p) => !/earrings|hat/.test(p.prompt)), "no prompt has them")
}

// ── Where an added trait shows ──
assert(addedTraitCategory("red scarf", "clothing", "appearance") === "clothing", "under the category the taxonomy gives it, whatever row it came from")
assert(addedTraitCategory("my own tag", "other", "pose") === "pose", "no category: it stays where it was added")
assert(addedTraitCategory("my own tag", "other", undefined) === "appearance", "else with the character")

// ── One choice for both methods ──
{
  const choices = new Map<string, ChipState>([["\u0000short hair", "scene"]])
  const scenes = castChips({
    members: [{ character: "", candidates: ["short hair", "red eyes"] }],
    choices: () => new Map([...choices].map(([k, v]) => [k.split("\u0000")[1], v])),
    added: () => ["red scarf"],
    removed: () => new Set(),
    baseExtras: [],
    baseFixed: [],
    permanence: () => "identity",
    overrides: {},
  })
  const classic = classicKeptTags(["short hair", "red eyes"], ["short hair", "red eyes"], (t) => choices.get(`\u0000${t}`), ["red scarf"])
  assert(scenes.blocks[0].chips.find((c) => c.tag === "short hair")?.state === "scene" && !classic.includes("short hair"), "a dash chosen once shows in both methods")
  assert(scenes.pinned.includes("red scarf") && classic.includes("red scarf"), "and so does an added trait")
}

// ── Pinning a pool value ──
{
  // Pinning a pool value adds it as a trait, pinned: it joins what every prompt keeps.
  const choices = new Map<string, ChipState>([["sitting", "pinned"]])
  const kept = classicKeptTags(["long hair"], ["long hair"], (t) => choices.get(t), ["sitting"])
  assert(kept.includes("sitting"), "a pinned pool value is in every prompt")
  const isKept = (t: string) => kept.includes(t)
  const pool = withoutKeptValues(["sitting", "standing", "sitting, crossed legs", "long hair"], isKept)
  assert(!pool.includes("sitting") && pool.includes("standing"), "the pinned value leaves the pool")
  assert(pool.includes("sitting, crossed legs"), "a full set with one kept tag still varies")
  assert(!pool.includes("long hair"), "a value the base keeps doesn't take a pick either")
  // Unpinned (dashed), it is a value the sampling may pick again.
  choices.set("sitting", "scene")
  const after = classicKeptTags(["long hair"], ["long hair"], (t) => choices.get(t), ["sitting"])
  assert(!after.includes("sitting") && withoutKeptValues(["sitting"], (t) => after.includes(t)).length === 1, "unpinned, it varies again")
}

// ── Typing into a pool ──
{
  assert(poolEntriesFromInput("red scarf, glasses ,  ", "individual").join("|") === "red scarf|glasses", "commas separate loose tags")
  assert(poolEntriesFromInput("hat, hat", "individual").length === 1, "a tag typed twice is added once")
  assert(poolEntriesFromInput("school uniform, red ribbon", "bundle").join("|") === "school uniform, red ribbon", "in full sets the text is one set")
  assert(poolEntriesFromInput(" , ", "bundle").length === 0 && poolEntriesFromInput("", "individual").length === 0, "nothing typed adds nothing")
}

console.log(`${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
