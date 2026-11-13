/**
 * Tests for Scene ideas (lib/pack/scene-ideas.ts) and how a chosen scene reaches the prompts.
 *
 * Covers:
 *   1. Parsing: malformed and blocked scenes are dropped; tags are normalized.
 *   2. The pack's content rating decides which scenes are offered (general packs: general only).
 *   3. Order: this month's scenes first, then by category; search by title, tag or category.
 *   4. Chips: a scene's own tags pinned, the rest dashed; taking a scene back keeps shared tags.
 *   5. Classic: a dashed added trait isn't in every prompt but joins its category's pool.
 *   6. Scenes: a pinned place replaces the scene's place and wins over a plain background.
 *   7. The exported public/scene-ideas.json: shape, size, ratings, block list.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-scene-ideas.verify.ts
 */
import { readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import {
  groupSceneIdeas,
  isSceneIdeaAdded,
  maxSceneIdeaRating,
  parseSceneIdeas,
  sceneIdeaChips,
  sceneIdeaRemoval,
  sceneIdeasForRating,
  searchSceneIdeas,
  sortSceneIdeas,
  type SceneIdea,
} from "../lib/pack/scene-ideas"
import { classicKeptTags, dashedAddedByCategory } from "../lib/pack/classic-chips"
import { isBlockedTheme } from "../lib/pack/scene/blocked"
import { buildScenePool } from "../lib/pack/scene/scene-pool"
import { composePack, type ComposeOptions } from "../lib/pack/scene/scene-compose"
import { createPermanence } from "../lib/pack/scene/permanence"
import type { ChipState } from "../lib/pack/scene-pack"
import { OVERRIDES, PERMANENCE_DATA, makeAssert, makePost } from "./fixtures/pack-scene-data"

const { assert, done } = makeAssert()

const RAW = {
  v: 1,
  scenes: [
    { id: "a", t: "Beach day", c: "place", r: "g", k: ["beach", "ocean"], o: ["swimsuit", "beach", "sand"] },
    { id: "b", t: "Christmas tree", c: "occasion", r: "g", m: 12, k: ["christmas_tree", "gift_box"], o: ["christmas"] },
    { id: "c", t: "Hot spring", c: "place", r: "s", k: ["onsen", "steam"], o: ["towel"] },
    { id: "d", t: "Lingerie shoot", c: "adult", r: "q", k: ["lingerie", "bed"] },
    { id: "e", t: "Explicit scene", c: "adult", r: "e", k: ["sex"] },
    { id: "f", t: "Valentine chocolate", c: "food", r: "g", m: 2, k: ["valentine", "heart-shaped box"] },
    { id: "bad1", t: "Blocked", c: "place", r: "g", k: ["school_girl"] },
    { id: "bad2", t: "Young love", c: "situation", r: "g", k: ["hug"] },
    { id: "bad3", t: "No tags", c: "place", r: "g", k: [] },
    { id: "bad4", t: "Unknown category", c: "space", r: "g", k: ["moon"] },
    { id: "bad5", t: "Unknown rating", c: "place", r: "x", k: ["moon"] },
  ],
}

// ── 1. Parsing ──
const ideas = parseSceneIdeas(RAW)
{
  assert(ideas.map((i) => i.id).join() === "a,b,c,d,e,f", "malformed and blocked scenes are dropped: " + ideas.map((i) => i.id).join())
  const tree = ideas.find((i) => i.id === "b")!
  assert(tree.tags.join() === "christmas tree,gift box" && tree.month === 12, "tags use spaces; the month is kept")
  const beach = ideas.find((i) => i.id === "a")!
  assert(beach.optional.join() === "swimsuit,sand", "an optional tag that is also a scene tag is left out")
  assert(parseSceneIdeas(null).length === 0 && parseSceneIdeas({ scenes: "x" }).length === 0, "anything else parses to no scenes")
}

// ── 2. Content rating ──
{
  const ids = (rating: Parameters<typeof sceneIdeasForRating>[1]) => sceneIdeasForRating(ideas, rating).map((i) => i.id).join()
  assert(ids("sfw") === "a,b,f", "a general (SFW) pack only offers general scenes: " + ids("sfw"))
  assert(ids(null) === "a,b,f", "with no rating known, only general scenes")
  assert(ids("questionable") === "a,b,c,d,f", "a questionable pack offers up to questionable")
  assert(ids("explicit") === "a,b,c,d,e,f" && ids("both") === "a,b,c,d,e,f", "explicit and both offer every scene")
  assert(maxSceneIdeaRating("sfw") === "g" && maxSceneIdeaRating("questionable") === "q", "rating ceilings")
}

// ── 3. Order and search ──
{
  const december = groupSceneIdeas(ideas, 12)
  assert(december[0].key === "season" && december[0].ideas.map((i) => i.id).join() === "b", "December: the Christmas scene comes first, marked as this month's")
  assert(december.map((g) => g.key).join() === "season,place,food,adult", "then the categories in order: " + december.map((g) => g.key).join())
  assert(!december.some((g) => g.key === "occasion"), "a seasonal scene isn't listed twice")
  const february = sortSceneIdeas(ideas, 2).map((i) => i.id)
  assert(february[0] === "f", "February: the Valentine scene comes first")
  assert(february.indexOf("b") > february.indexOf("a"), "out of season, the Christmas scene goes back to its category")
  assert(groupSceneIdeas(ideas, 6)[0].key === "place", "a month without seasonal scenes has no season group")
  assert(sortSceneIdeas(ideas, 6).filter((i) => i.category === "place").map((i) => i.title).join() === "Beach day,Hot spring", "by title inside a category")

  const find = (q: string) => searchSceneIdeas(ideas, q).map((i) => i.id).join()
  assert(find("christ") === "b", "a title word prefix finds the scene")
  assert(find("gift") === "b", "so does a tag")
  assert(find("sand") === "a", "and an optional tag")
  assert(find("places") === "a,c", "and the category name")
  assert(find("beach ocean") === "a" && find("beach tree") === "", "every word must match")
  assert(find("  ") === "a,b,c,d,e,f", "an empty search lists everything")
  assert(find("each") === "", "words match from their start")
}

// ── 4. Chips ──
{
  const beach = ideas.find((i) => i.id === "a")!
  const chips = sceneIdeaChips(beach, ["sand"])
  assert(chips.pinned.join() === "beach,ocean", "the scene's own tags are pinned")
  assert(chips.dashed.join() === "swimsuit", "the tags that come with it are dashed, unless already a trait")
  assert(isSceneIdeaAdded(beach, ["beach", "ocean", "red scarf"]) && !isSceneIdeaAdded(beach, ["beach"]), "a scene is added while all its own tags are")
  const pier: SceneIdea = { id: "p", title: "Pier", category: "place", rating: "g", tags: ["pier", "ocean"], optional: ["swimsuit"] }
  const back = sceneIdeaRemoval(beach, ["beach", "ocean", "swimsuit", "sand", "pier", "red scarf"], [beach, pier])
  assert(back.join() === "beach,sand", "taking a scene back keeps tags another added scene has, and other traits: " + back.join())
}

// ── 5. Classic: dashed added traits ──
{
  const choices = new Map<string, ChipState>([["swimsuit", "scene"]])
  const kept = classicKeptTags(["1girl"], [], (t) => choices.get(t), ["beach", "swimsuit"])
  assert(kept.join() === "1girl,beach", "a dashed added trait is not in every Classic prompt: " + kept.join())
  const pools = dashedAddedByCategory(["beach", "swimsuit"], (t) => choices.get(t), (t) => (t === "swimsuit" ? "clothing" : "scenery"))
  assert(JSON.stringify(pools) === JSON.stringify({ clothing: ["swimsuit"] }), "it joins its category's pool instead")
}

// ── 6. Scenes: a scene idea's place in the identity ──
{
  const ctx = { overrides: OVERRIDES, permanence: createPermanence(PERMANENCE_DATA, OVERRIDES), subject: "girl" as const }
  const identity = ["1girl", "solo", "long hair", "beach"]
  const pool = buildScenePool([makePost(1, "1girl solo standing smile from_above bedroom bed indoors skirt shirt")], { ...ctx, identity })
  const options = (over: Partial<ComposeOptions> = {}): ComposeOptions => ({
    identity, subject: "girl", mix: "faithful", clothing: "scene", scenery: "scene", extras: false, count: 1, seed: 1, overrides: OVERRIDES, ...over,
  })
  const scene = composePack(pool, options()).prompts[0]
  assert(!!scene && scene.tags.includes("beach") && !scene.tags.includes("bedroom"), "the pinned place replaces the scene's: " + scene?.tags.join(", "))
  assert(scene.tags.includes("standing") && scene.tags.includes("skirt"), "the rest of the scene stays")
  const plain = composePack(pool, options({ scenery: "plain" })).prompts[0]
  assert(!!plain && plain.tags.includes("beach") && !plain.tags.includes("simple background"), "a pinned place wins over Plain background: " + plain?.tags.join(", "))
  const noPlace = composePack(pool, options({ identity: ["1girl", "solo", "long hair"], scenery: "plain" })).prompts[0]
  assert(noPlace.tags.includes("simple background"), "without a pinned place, Plain background works as before")
}

// ── 7. The exported file ──
{
  const file = join(__dirname, "..", "public", "scene-ideas.json")
  const raw = JSON.parse(readFileSync(file, "utf8")) as { v: number; scenes: Array<Record<string, unknown>> }
  assert(raw.v === 1 && Array.isArray(raw.scenes), "version 1 with a scene list")
  assert(statSync(file).size < 60 * 1024, `under 60 KB (${statSync(file).size} bytes)`)
  const parsed = parseSceneIdeas(raw)
  assert(parsed.length === raw.scenes.length && parsed.length > 200, `every exported scene parses (${parsed.length})`)
  assert(new Set(parsed.map((i) => i.id)).size === parsed.length, "ids are unique")
  const keys = new Set(["id", "t", "c", "r", "m", "k", "o"])
  assert(raw.scenes.every((s) => Object.keys(s).every((k) => keys.has(k))), "only the compact keys")
  assert(raw.scenes.every((s) => [...(s.k as string[]), ...((s.o as string[] | undefined) ?? [])].every((t) => !t.includes("_"))), "tags use spaces")
  assert(parsed.every((i) => ![i.title, ...i.tags, ...i.optional].some(isBlockedTheme)), "nothing the block list catches")
  assert(parsed.every((i) => (i.category === "adult") === (i.rating === "q" || i.rating === "e")), "mature scenes are rated questionable or explicit, the rest general or sensitive")
  assert(["g", "s", "q", "e"].every((r) => parsed.some((i) => i.rating === r)), "every rating level is present")
  assert(parsed.some((i) => i.month === 12) && parsed.some((i) => i.month === 1), "seasonal scenes are marked")
  assert(sceneIdeasForRating(parsed, "sfw").every((i) => i.rating === "g"), "a general pack gets general scenes only")
}

done()
