/**
 * Tests for Scene ideas (lib/pack/scene-ideas.ts) and how a chosen scene reaches the prompts.
 *
 * Covers:
 *   1. Parsing: malformed and blocked scenes are dropped; tags are normalized.
 *   2. The pack's content rating decides which scenes are offered (general packs: general only).
 *   3. Order: this month's scenes first, then by category; search by title, tag or category.
 *   4. Chips: a scene's own tags pinned, the rest dashed, any removable; what the added
 *      scenes put in the prompts, by id (titles repeat across ratings).
 *   5. Classic: a dashed added trait isn't in every prompt but joins its category's pool.
 *   6. Scenes: a pinned place replaces the scene's place and wins over a plain background.
 *   7. The exported public/scene-ideas.json: shape, size, ratings, block list, the
 *      sensitive floor and the left-out themes.
 *   8. One title, several ratings: the real "Library shelves" and "Kitchen cooking"
 *      entries; an SFW pack gets nothing of the higher ones.
 *   9. Scenes with a picked scene: matching posts first; other posts lend only the person;
 *      dashed clothing tags follow the Clothing option.
 *  10. Where the scenes apply: Classic always; Scenes only on Scenery › Pick a scene (kept
 *      but unused on the other options, back when it's picked again); Pick a scene with
 *      no scene works as the default; saved configs accept the option.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-scene-ideas.verify.ts
 */
import { readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import {
  activeSceneIdeas,
  groupSceneIdeas,
  matchedOptionalTags,
  maxSceneIdeaRating,
  offeredSceneIdeas,
  parseSceneIdeas,
  sceneIdeaChips,
  sceneIdeaOwnTags,
  sceneIdeasForRating,
  sceneIdeasInUse,
  searchSceneIdeas,
  sortSceneIdeas,
  type SceneIdea,
} from "../lib/pack/scene-ideas"
import { classicKeptTags, dashedAddedByCategory } from "../lib/pack/classic-chips"
import { isBlockedTheme } from "../lib/pack/scene/blocked"
import { buildScenePool } from "../lib/pack/scene/scene-pool"
import { composePack, type ComposeOptions } from "../lib/pack/scene/scene-compose"
import { createPermanence } from "../lib/pack/scene/permanence"
import { DEFAULT_SCENE_SETTINGS, MIN_IDEA_DONORS, generateScenePack, type ChipState, type ScenePackArgs } from "../lib/pack/scene-pack"
import { packEngineConfig } from "../lib/pack/pack-config-migration"
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
  const chips = sceneIdeaChips(beach, () => undefined)
  assert(chips.map((c) => `${c.tag}:${c.state}`).join() === "beach:pinned,ocean:pinned,swimsuit:scene,sand:scene", "own tags pinned, the rest dashed")
  const chosen = sceneIdeaChips(beach, (t) => (t === "ocean" ? "scene" : t === "sand" ? "removed" : t === "swimsuit" ? "pinned" : undefined))
  assert(chosen.map((c) => c.state).join() === "pinned,scene,pinned,removed", "the user's pin, dash or removal wins")
  const withCount: SceneIdea = { id: "x", title: "Leash", category: "adult", rating: "e", tags: ["leash", "solo focus"], optional: [] }
  assert(sceneIdeaChips(withCount, () => undefined).map((c) => c.tag).join() === "leash", "people counts are left out")

  const pier: SceneIdea = { id: "p", title: "Pier", category: "place", rating: "g", tags: ["pier", "ocean"], optional: ["swimsuit", "sand"] }
  const states = new Map([["sand", "removed" as const], ["swimsuit", "pinned" as const]])
  const active = activeSceneIdeas([beach, pier], (t) => states.get(t), "sfw")
  assert(active.pinned.join() === "beach,ocean,swimsuit,pier", "pinned: both scenes' own tags and the pinned optional one: " + active.pinned.join())
  assert(active.never.join() === "sand" && active.dashed.length === 0, "removed tags are never used")
  assert(active.core.join() === "beach,ocean,pier", "own tags in use")
  const lingerie = ideas.find((i) => i.id === "d")!
  assert(activeSceneIdeas([lingerie], () => undefined, "sfw").pinned.length === 0, "a scene above the pack's rating has no effect")
  assert(activeSceneIdeas([lingerie], () => undefined, "questionable").pinned.join() === "lingerie,bed", "and works again at its rating")
  assert(sceneIdeaOwnTags(beach, [beach, pier]).join() === "beach", "a scene's own choices go with it, except tags another added scene has")

  assert(matchedOptionalTags(beach, "sand").join() === "sand", "a search that matched an optional tag says which")
  assert(matchedOptionalTags(beach, "beach").length === 0 && matchedOptionalTags(beach, "beach sw").join() === "swimsuit", "only for the words the title and own tags don't explain")
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
  const floor = ["cigarette", "smoking", "alcohol", "beer", "sake", "wine", "handcuffs", "bdsm", "bondage", "whip", "gun to another's head", "at gunpoint", "blood"]
  assert(parsed.filter((i) => i.tags.some((t) => floor.includes(t))).every((i) => i.rating !== "g"), "scenes about smoking, drinking, restraints, guns or blood are never general")
  assert(parsed.every((i) => ![...i.tags, ...i.optional].some((t) => t === "marijuana" || t === "drugs")), "drug scenes are left out")
}

// ── 8. One title, several ratings (the real entries) ──
{
  const real = parseSceneIdeas(JSON.parse(readFileSync(join(__dirname, "..", "public", "scene-ideas.json"), "utf8")))
  const shelves = real.filter((i) => i.title === "Library shelves").map((i) => i.id).sort()
  assert(shelves.join() === "e-0021,q-0017,sfw-0006", "Library shelves has three entries: " + shelves.join())
  const kitchen = real.filter((i) => i.title === "Kitchen cooking").map((i) => i.id).sort()
  assert(kitchen.join() === "q-0039,sfw-0029", "Kitchen cooking has two: " + kitchen.join())
  const titleOnce = (rating: Parameters<typeof offeredSceneIdeas>[1]) => {
    const offered = offeredSceneIdeas(real, rating)
    return offered.length === new Set(offered.map((i) => i.title.toLowerCase())).size
  }
  assert(["sfw", "questionable", "explicit", "both", null].every((r) => titleOnce(r as Parameters<typeof offeredSceneIdeas>[1])), "each title is offered once, whatever the rating")
  const pick = (title: string, rating: Parameters<typeof offeredSceneIdeas>[1]) => offeredSceneIdeas(real, rating).find((i) => i.title === title)?.id
  assert(pick("Library shelves", "sfw") === "sfw-0006" && pick("Library shelves", "questionable") === "q-0017" && pick("Library shelves", "explicit") === "e-0021", "the highest entry the rating allows")
  assert(pick("Kitchen cooking", "sfw") === "sfw-0029" && pick("Kitchen cooking", "explicit") === "q-0039", "Kitchen cooking: general in SFW, questionable above")

  // Adding the offered entry adds only it; in an SFW pack nothing of the higher entries gets in.
  const sfwPicks = ["Library shelves", "Kitchen cooking"].map((title) => offeredSceneIdeas(real, "sfw").find((i) => i.title === title)!)
  assert(sfwPicks.every((i) => i.rating === "g"), "SFW offers the general entries")
  const active = activeSceneIdeas(sfwPicks, () => undefined, "sfw")
  const used = new Set([...active.pinned, ...active.dashed])
  const higherOnly = real
    .filter((i) => (i.title === "Library shelves" || i.title === "Kitchen cooking") && i.rating !== "g")
    .flatMap((i) => [...i.tags, ...i.optional])
    .filter((t) => !sfwPicks.some((p) => p.tags.includes(t) || p.optional.includes(t)))
  assert(higherOnly.includes("naked apron") && higherOnly.every((t) => !used.has(t)), "no tag of a higher entry reaches an SFW pack: " + higherOnly.join())
  // Even added by hand before the rating changed, a higher entry does nothing in an SFW pack.
  const explicitShelves = real.find((i) => i.id === "e-0021")!
  const kitchenQ = real.find((i) => i.id === "q-0039")!
  assert(activeSceneIdeas([explicitShelves, kitchenQ], () => undefined, "sfw").pinned.length === 0, "higher entries added earlier are not used in an SFW pack")
}

// ── 9. Scenes with a picked scene ──
{
  const overrides: Record<string, string> = {
    ...OVERRIDES, library: "scenery:setting", bookshelf: "scenery:props", book: "equipment:handheld",
    reading: "pose:gesture", apron: "clothing:accents", maid: "clothing:outfit", forest: "scenery:setting",
  }
  const ctx = { overrides, permanence: createPermanence(PERMANENCE_DATA, overrides), subject: "girl" as const }
  const identity = ["my character", "long hair", "library", "bookshelf", "book"]
  const P = {
    1: makePost(1, "1girl solo sitting reading smile from_side library bookshelf book indoors skirt shirt boots"),
    2: makePost(2, "1girl solo standing arms_up blush looking_at_viewer library bookshelf indoors dress"),
    3: makePost(3, "1girl solo lying on_back open_mouth from_above library book indoors maid_outfit glasses"),
    4: makePost(4, "1girl solo standing blush from_above forest outdoors sunset sword skirt shirt"),
    5: makePost(5, "1girl solo sitting smile looking_at_viewer park outdoors cat dress boots hat scarf"),
    6: makePost(6, "1girl solo running open_mouth from_side beach outdoors sunset apron skirt shirt glasses"),
  }
  const posts = Object.values(P)
  const pool = buildScenePool(posts, { ...ctx, identity })
  assert(pool.scenes.length === 6, `a pool of six scenes (${pool.scenes.length})`)
  const args = (over: Partial<ScenePackArgs> = {}): ScenePackArgs => ({
    identity,
    alwaysAdd: [],
    subject: "girl",
    settings: DEFAULT_SCENE_SETTINGS,
    count: 6,
    seed: 5,
    overrides,
    clean: (tags) => tags.join(", "),
    sceneIdea: { core: ["library", "bookshelf", "book"], dashed: ["apron", "indoors"] },
    ...over,
  })
  const { prompts } = generateScenePack(pool, args())
  assert(prompts.length === 6, "six prompts")
  assert(MIN_IDEA_DONORS === 3, "three matching posts are enough to go first")
  assert(prompts.slice(0, 3).every((p) => [1, 2, 3].includes(p.scene!.postId)), "posts that have the scene come first: " + prompts.map((p) => p.scene!.postId).join())
  const fromOthers = prompts.filter((p) => [4, 5, 6].includes(p.scene!.postId))
  assert(fromOthers.length === 3, "then the others")
  for (const p of fromOthers) {
    const tags = p.prompt.split(", ")
    assert(!tags.some((t) => ["forest", "park", "beach", "outdoors", "sunset", "sword", "cat"].includes(t)), "another post lends no place, sky, object or animal: " + p.prompt)
    assert(tags.includes("library"), "the picked place stays")
  }
  const p4 = fromOthers.find((p) => p.scene!.postId === 4)!.prompt.split(", ")
  assert(p4.includes("standing") && p4.includes("blush") && p4.includes("from above") && p4.includes("skirt"), "it lends the posture, the expression, the framing and, with From the scene, its clothes")
  const matching = prompts.find((p) => p.scene!.postId === 1)!
  assert(matching.prompt.includes("reading") && matching.prompt.includes("indoors"), "a post with the scene keeps its own surroundings")
  assert(prompts.some((p) => p.prompt.split(", ").includes("apron")), "From the scene: a dashed clothing tag can come with a post")

  const own = generateScenePack(pool, args({ settings: { ...DEFAULT_SCENE_SETTINGS, clothing: "base" }, baseClothing: ["red dress"] })).prompts
  assert(own.length > 0 && own.every((p) => !p.prompt.split(", ").includes("apron")), "another Clothing option: the scene's dashed clothing tags don't apply")
  const pinnedApron = generateScenePack(pool, args({
    identity: [...identity, "apron"],
    settings: { ...DEFAULT_SCENE_SETTINGS, clothing: "base" },
    baseClothing: ["red dress"],
    sceneIdea: { core: ["library", "bookshelf", "book"], dashed: ["indoors"] },
  })).prompts
  assert(pinnedApron.every((p) => p.prompt.split(", ").includes("apron")), "a pinned one does")

  const few = buildScenePool([P[1], P[4], P[5]], { ...ctx, identity })
  const fewPrompts = generateScenePack(few, args({ count: 3 })).prompts
  assert(fewPrompts.length === 3, "with fewer matching posts than that, every post is used at once")
  assert(fewPrompts.filter((p) => p.scene!.postId !== 1).every((p) => !p.prompt.includes("forest")), "and the others still lend only the person")

  // A post without the scene lends only the person: no combat, no harm or intoxication; light states stay.
  {
    const ov: Record<string, string> = { ...overrides, blood: "pose:physiological", "dual wielding": "pose:combat", drunk: "pose:expression", sweat: "pose:physiological" }
    const c = { overrides: ov, permanence: createPermanence(PERMANENCE_DATA, ov), subject: "girl" as const }
    const donor = makePost(30, "1girl solo sitting blush blood dual_wielding drunk from_side forest outdoors")
    const idea = ["library", "bookshelf", "book"]
    const harmPool = buildScenePool([donor], { ...c, identity })
    const options: ComposeOptions = { identity: ["my character"], subject: "girl", mix: "faithful", clothing: "scene", scenery: "scene", extras: true, count: 1, seed: 1, overrides: ov, sceneIdeaTags: idea }
    const sceneTags = harmPool.scenes[0] ? Object.values(harmPool.scenes[0].units).flat() : []
    const lent = composePack(harmPool, options).prompts[0]
    const fromDonor = lent ? lent.tags.filter((t) => !lent.locked.includes(t)) : []
    assert(["blood", "dual wielding", "drunk", "blush", "sitting"].every((t) => sceneTags.includes(t)), "the donor has all five tags: " + sceneTags.join(", "))
    assert(fromDonor.slice().sort().join() === "blush,from side,sitting", "only blush and sitting (and the framing) are lent: " + fromDonor.join(", "))
    const without = composePack(harmPool, { ...options, sceneIdeaTags: undefined }).prompts[0]
    assert(!!without && without.tags.includes("blood"), "without a picked scene the post is used whole, as before")
  }

  // Two picked scenes: a post matching either one counts.
  const two = generateScenePack(pool, args({ sceneIdea: { core: ["library", "bookshelf", "book", "forest"], dashed: [] } })).prompts
  assert(two.some((p) => p.scene!.postId === 4 && p.prompt.includes("forest")), "with two scenes, a post that has the other one keeps its surroundings")
}

// ── 10. Where the scenes apply ──
{
  const beach = ideas.find((i) => i.id === "a")!
  const added = activeSceneIdeas([beach], () => undefined, "sfw")
  assert(sceneIdeasInUse("classic", "scene", added) === added, "Classic: the picked scenes always apply")
  assert(sceneIdeasInUse("scenes", "picked", added).pinned.join() === "beach,ocean", "Scenes on Pick a scene: they apply")
  for (const other of ["scene", "vary", "plain"]) {
    const off = sceneIdeasInUse("scenes", other, added)
    assert(off.pinned.length + off.dashed.length + off.core.length + off.never.length === 0, `Scenes on ${other}: nothing of the scenes reaches the prompts`)
  }
  assert(sceneIdeasInUse("scenes", "picked", added).core.join() === "beach,ocean", "back on Pick a scene, the same scenes apply again")

  // Pick a scene with no scene picked: the same prompts as the default Scenery option.
  const ctx = { overrides: OVERRIDES, permanence: createPermanence(PERMANENCE_DATA, OVERRIDES), subject: "girl" as const }
  const posts = [
    makePost(1, "1girl solo standing smile from_above bedroom bed indoors skirt shirt"),
    makePost(2, "1girl solo lying on_back blush looking_at_viewer beach outdoors sunset dress boots"),
  ]
  const pool = buildScenePool(posts, { ...ctx, identity: ["my character"] })
  const args = (scenery: typeof DEFAULT_SCENE_SETTINGS.scenery): ScenePackArgs => ({
    identity: ["my character"], alwaysAdd: [], subject: "girl", settings: { ...DEFAULT_SCENE_SETTINGS, scenery },
    count: 2, seed: 9, overrides: OVERRIDES, clean: (tags) => tags.join(", "),
  })
  const picked = generateScenePack(pool, args("picked")).prompts.map((p) => p.prompt)
  const scene = generateScenePack(pool, args("scene")).prompts.map((p) => p.prompt)
  assert(picked.length === 2 && picked.join("|") === scene.join("|"), "Pick a scene with nothing picked = From the scene")

  const saved = packEngineConfig({ engine: "scenes", sceneSettings: { ...DEFAULT_SCENE_SETTINGS, scenery: "picked" } })
  assert(saved.sceneSettings.scenery === "picked", "a saved config keeps Pick a scene")
  const unknown = packEngineConfig({ engine: "scenes", sceneSettings: { ...DEFAULT_SCENE_SETTINGS, scenery: "elsewhere" as never } })
  assert(unknown.sceneSettings.scenery === "scene" && DEFAULT_SCENE_SETTINGS.scenery === "scene", "anything else, and new packs, start from the scene's place")
}

done()
