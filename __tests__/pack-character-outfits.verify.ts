/**
 * Tests for the characters' own outfits (lib/pack/character-outfits.ts) in Pack Mode's Scenes.
 *
 * Covers:
 *   1. Parsing a shard entry; which outfit's tags a choice gives.
 *   2. Loading: the shard the trait profiles' function picks, through the alias map;
 *      a failed request means no outfits and is tried again.
 *   3. identityWithOutfits: each character's outfit after their pinned tags, without
 *      duplicates, variants of what they have, or never-wanted tags.
 *   4. Clothing "character": the outfit replaces the scene's clothes in every prompt;
 *      without outfit data the scene's clothes stay; saved configs accept the option.
 *   5. The exported public/character-outfits/ shards: shape, sharding, size budget, block list.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-character-outfits.verify.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { characterOutfitsUrl, loadCharacterOutfits, outfitTags, parseCharacterOutfits } from "../lib/pack/character-outfits"
import { traitShard, traitShardFile } from "../lib/prompt/natural-traits"
import { DEFAULT_SCENE_SETTINGS, generateScenePack, identityWithOutfits, type ScenePackArgs } from "../lib/pack/scene-pack"
import { packEngineConfig } from "../lib/pack/pack-config-migration"
import { isBlockedTheme } from "../lib/pack/scene/blocked"
import { buildScenePool } from "../lib/pack/scene/scene-pool"
import { createPermanence } from "../lib/pack/scene/permanence"
import { OVERRIDES, PERMANENCE_DATA, makeAssert, makePost } from "./fixtures/pack-scene-data"

const { assert, done } = makeAssert()

async function main() {
  // ── 1. Parsing ──
  {
    const entry = { d: ["blue_bowtie", "Blue Ribbon"], o: [["Bunny", ["playboy_bunny", "leotard", "fake_animal_ears"]], ["Bunny", ["x"]], ["", ["y"]], ["Empty", []]] }
    const outfits = parseCharacterOutfits(entry)!
    assert(outfits.usual?.tags.join() === "blue bowtie,blue ribbon", "the usual outfit, normalized")
    assert(outfits.official.map((o) => o.name).join() === "Bunny", "official outfits by name, without duplicates, blanks or empty ones")
    assert(outfitTags(outfits, "").join() === "blue bowtie,blue ribbon", "'' is the usual outfit")
    assert(outfitTags(outfits, "Bunny").join() === "playboy bunny,leotard,fake animal ears", "a name picks that outfit")
    assert(outfitTags(outfits, "Gone").join() === "blue bowtie,blue ribbon", "an outfit the character doesn't have falls back to the usual one")
    const onlyOfficial = parseCharacterOutfits({ o: [["Armor", ["armor", "gauntlets", "cape"]]] })!
    assert(onlyOfficial.usual === null && outfitTags(onlyOfficial, "").join() === "armor,gauntlets,cape", "no usual outfit: the first official one")
    assert(parseCharacterOutfits({}) === null && parseCharacterOutfits(null) === null, "nothing usable: null")
    assert(outfitTags(null, "").length === 0, "no data, no tags")
  }

  // ── 2. Loading ──
  {
    const requested: string[] = []
    const name = "asuna (blue archive)"
    const shardUrl = characterOutfitsUrl(traitShard(name))
    const fake = (async (url: string) => {
      requested.push(url)
      if (url !== shardUrl) return new Response("{}", { status: 404 })
      return new Response(JSON.stringify({ [name]: { o: [["Bunny", ["leotard", "bowtie", "pantyhose"]]] } }))
    }) as typeof fetch
    const viaAlias = await loadCharacterOutfits("asuna ichinose", { "asuna ichinose": name }, fake)
    assert(viaAlias?.official[0]?.name === "Bunny", "another booru's name reaches the Danbooru shard through the alias map")
    assert(requested[0] === shardUrl && shardUrl === `/character-outfits/${traitShardFile(traitShard(name))}`, "the same shard function as the trait profiles")
    await loadCharacterOutfits(name, {}, fake)
    assert(requested.length === 1, "a shard is fetched once per page")
    assert((await loadCharacterOutfits("someone else", {}, fake)) === null, "a character the data doesn't have: null")

    let calls = 0
    const failing = (async () => {
      calls++
      throw new Error("offline")
    }) as typeof fetch
    const missing = "frieren"
    assert((await loadCharacterOutfits(missing, {}, failing)) === null, "a failed request means no outfits")
    await loadCharacterOutfits(missing, {}, failing)
    assert(calls === 2, "and is tried again next time")
  }

  // ── 3. identityWithOutfits ──
  {
    const tags = identityWithOutfits(
      [
        { pinned: ["yor briar", "black hair", "gold hairband"], outfit: ["hairband", "black dress", "black gloves", "earrings", "gold earrings"] },
        { pinned: ["twilight (spy x family)", "blonde hair"], outfit: [] },
      ],
      ["earrings"]
    )
    assert(
      tags.join() === "yor briar,black hair,gold hairband,black dress,black gloves,twilight (spy x family),blonde hair",
      "each outfit after its character's pinned tags; what they have (or a qualified form of it) and never-wanted tags left out: " + tags.join()
    )
  }

  // ── 4. Clothing "character" in a pack ──
  {
    const ctx = { overrides: OVERRIDES, permanence: createPermanence(PERMANENCE_DATA, OVERRIDES), subject: "girl" as const }
    const posts = [
      makePost(1, "1girl solo standing smile from_above bedroom bed indoors skirt shirt"),
      makePost(2, "1girl solo standing blush looking_at_viewer park outdoors sunset dress boots"),
    ]
    const identity = ["my character", "long hair"]
    const pool = buildScenePool(posts, { ...ctx, identity })
    const outfit = ["black dress", "black gloves"]
    const args = (over: Partial<ScenePackArgs> = {}): ScenePackArgs => ({
      identity: identityWithOutfits([{ pinned: identity, outfit }], []),
      characterOutfit: outfit,
      alwaysAdd: [],
      subject: "girl",
      settings: { ...DEFAULT_SCENE_SETTINGS, clothing: "character" },
      count: 2,
      seed: 3,
      overrides: OVERRIDES,
      clean: (tags) => tags.join(", "),
      ...over,
    })
    const { prompts } = generateScenePack(pool, args())
    assert(prompts.length === 2, "two prompts")
    for (const p of prompts) {
      assert(p.prompt.includes("black dress") && p.prompt.includes("black gloves"), "every prompt wears the character's outfit: " + p.prompt)
      assert(!/\b(skirt|shirt|boots)\b/.test(p.prompt) && !/(^|, )dress(,|$)/.test(p.prompt), "the scene's clothes are gone: " + p.prompt)
      assert(p.prompt.includes("standing"), "the rest of the scene stays")
    }
    const noData = generateScenePack(pool, args({ identity, characterOutfit: [] })).prompts
    assert(noData.some((p) => /\b(skirt|shirt|boots)\b/.test(p.prompt)), "no outfit data: the scene's clothes stay")
    const cast = generateScenePack(pool, args({ castSize: 2 })).prompts
    assert(cast.every((p) => p.prompt.includes("black dress") && !/\b(skirt|shirt)\b/.test(p.prompt)), "with a cast, the outfits replace the scene's clothes too")

    const saved = packEngineConfig({ engine: "scenes", sceneSettings: { ...DEFAULT_SCENE_SETTINGS, clothing: "character" } })
    assert(saved.sceneSettings.clothing === "character", "a saved config keeps the option")
    const old = packEngineConfig({ engine: "scenes", sceneSettings: { mix: "remix", clothing: "own", scenery: "vary", extras: true } })
    assert(old.sceneSettings.clothing === "own" && DEFAULT_SCENE_SETTINGS.clothing === "scene", "older configs read as before; new packs start from the scene's clothes")
  }

  // ── 5. The exported shards ──
  {
    const dir = join(__dirname, "..", "public", "character-outfits")
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"))
    let total = 0
    let largest = 0
    let characters = 0
    let wrongShard = 0
    let underscores = 0
    let blocked = 0
    let unparsable = 0
    for (const file of files) {
      const size = statSync(join(dir, file)).size
      total += size
      largest = Math.max(largest, size)
      const data = JSON.parse(readFileSync(join(dir, file), "utf8")) as Record<string, { d?: string[]; o?: [string, string[]][] }>
      for (const [name, entry] of Object.entries(data)) {
        characters++
        if (traitShardFile(traitShard(name)) !== file) wrongShard++
        const outfits = parseCharacterOutfits(entry)
        if (!outfits) unparsable++
        const texts = [name, ...(entry.d ?? []), ...(entry.o ?? []).flatMap(([n, t]) => [n, ...t])]
        if (texts.some((t) => t.includes("_"))) underscores++
        if (texts.some(isBlockedTheme)) blocked++
        if ((entry.o ?? []).some(([, t]) => t.length < 3)) unparsable++
      }
    }
    assert(files.length === 256, `256 shards (${files.length})`)
    assert(total < 2.5 * 1024 * 1024 && largest < 80 * 1024, `within budget (${total} bytes, largest ${largest})`)
    assert(characters > 5000, `thousands of characters (${characters})`)
    assert(wrongShard === 0, `every name sits in its traitShard file (${wrongShard} misplaced)`)
    assert(unparsable === 0, "every entry parses, official outfits have 3+ tags")
    assert(underscores === 0, "tags and names use spaces")
    assert(blocked === 0, "nothing the block list catches")
    const asuna = JSON.parse(readFileSync(join(dir, traitShardFile(traitShard("asuna (blue archive)"))), "utf8"))["asuna (blue archive)"]
    const names = (asuna?.o ?? []).map(([n]: [string]) => n)
    assert(names.includes("Bunny") && names.includes("School uniform"), "asuna (blue archive): Bunny and School uniform, by readable name")
  }
}

main().then(done, (err) => {
  console.error(err)
  process.exit(1)
})
