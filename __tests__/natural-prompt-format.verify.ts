/**
 * Tests for the card-side bridge to the natural-language converter
 * (lib/prompt/natural-format.ts, lib/prompt/prompt-format.ts).
 *
 * Covers:
 *   1. Rating letters across boorus (Danbooru letters, Gelbooru/Rule34 words, e621's "s").
 *   2. A cleaned card prompt (escaped parentheses, weights, "@artist") becomes the
 *      converter's input, with names taken from the post fields and deduplicated.
 *   3. Flat-tag posts get their names split out through the taxonomy.
 *   4. Tags without an exact classification are reported for lookup.
 *   5. FLUX.2 short stays within its budget and reports what it left out;
 *      full detail keeps everything. Anima keeps the tag block and reports nothing.
 *   6. Character traits: only cards with two or more characters load profiles,
 *      other boorus' names find the Danbooru profile, attribution and aliases apply.
 *   7. Trait shards: the hash is stable and public/natural-traits/ agrees with it.
 *   8. Format metadata.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/natural-prompt-format.verify.ts
 */
import fs from "fs"
import path from "path"
import { normalizeTag } from "../lib/prompt/natural"
import { cardTraits, formatPrompt, naturalPromptInput, ratingLetter, traitNames, unclassifiedTags } from "../lib/prompt/natural-format"
import { TRAIT_SHARD_COUNT, traitShard, traitShardFile } from "../lib/prompt/natural-traits"
import { PROMPT_FORMATS, PROMPT_FORMAT_INFO, hasWordBudget, isPromptFormat } from "../lib/prompt/prompt-format"

let passed = 0
let failed = 0

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++
  } else {
    failed++
    console.error(`FAIL: ${label}`)
  }
}

const overrides: Record<string, string> = {
  "long hair": "appearance:hair",
  "black hair": "appearance:hair",
  "red eyes": "appearance:eyes",
  "black dress": "clothing:outfit",
  dress: "clothing:outfit",
  "white gloves": "clothing:accents",
  "thighhighs": "clothing:legwear",
  "high heels": "clothing:footwear",
  bedroom: "scenery:setting",
  window: "scenery:props",
  curtains: "scenery:props",
  "sunlight": "scenery:atmosphere",
  smile: "pose:expression",
  "looking at viewer": "pose:camera",
  "cowboy shot": "pose:camera",
  sitting: "pose:posture",
  "hand on own chest": "pose:gesture",
  "yor briar": "other:character",
  "spy x family": "other:copyright",
  "kashima (kancolle)": "other:character",
  "kantai collection": "other:copyright",
}

// 1. Ratings.
{
  assert(ratingLetter("g") === "g" && ratingLetter("e") === "e", "Danbooru letters pass through")
  assert(ratingLetter("general") === "g" && ratingLetter("Explicit") === "e", "spelled-out ratings become letters")
  assert(ratingLetter("safe", "rule34") === "g", "Rule34's safe is general")
  assert(ratingLetter("s", "e621") === "g" && ratingLetter("s", "danbooru") === "s", "only e621's s means safe")
  assert(ratingLetter("") === undefined && ratingLetter("unknown") === undefined, "unknown ratings are left out")
}

// 2. Cleaned card prompt with post fields.
{
  const input = naturalPromptInput({
    prompt: "@some artist, kashima \\(kancolle\\), 1girl, (long hair:1.2), black hair, red eyes, smile",
    characters: "kashima_(kancolle)",
    copyrights: "kantai_collection",
    rating: "s",
    provider: "danbooru",
  }, overrides)
  assert(input.characters?.length === 1, "a name in the prompt and in the post field counts once")
  assert(input.copyrights?.[0] === "kantai_collection", "the series comes from the post field")
  assert(input.artists?.[0] === "some artist", "@artist is read as the artist")
  assert(input.general.includes("long hair") && !input.general.some((t) => t.includes(":1.2")), "weights are removed")
  assert(!input.general.some((t) => t.includes("kashima")), "the name does not stay among the general tags")
  assert(input.rating === "s", "rating is passed on")
}

// 3. Flat-tag posts: names found through the taxonomy.
{
  const input = naturalPromptInput({ prompt: "yor briar, spy x family, 1girl, black dress, smile" }, overrides)
  assert(input.characters?.[0] === "yor briar" && input.copyrights?.[0] === "spy x family", "names are split out of a flat prompt")
  assert(!input.general.includes("yor briar"), "split names are not general tags")
}

// 4. Lookups.
{
  const known = { ...overrides, "1girl": "other:demographics", "tsukinoki koto": "other:character" }
  const input = naturalPromptInput({
    prompt: "komari chika, 1girl, black hair, frilled black dress, mystery_prop, Mystery Prop, odd tag, saga tsukinoki koto",
    characters: "komari_chika",
  }, known)
  const missing = unclassifiedTags(input, known)
  assert(missing.length === 3 && missing.includes("mystery prop") && missing.includes("odd tag"), "only tags the taxonomy cannot place are reported, once each")
  assert(!input.general.includes("komari chika"), "a name from the post field is not a general tag")
  assert(!missing.includes("frilled black dress"), "a tag placed through its suffix is not looked up")
  assert(missing.includes("saga tsukinoki koto"), "a suffix that only matches a name is looked up, not trusted")
}

// 5. Budgets.
{
  const prompt = [
    "1girl", "solo", "long hair", "black hair", "red eyes", "black dress", "white gloves", "thighhighs", "high heels",
    "bedroom", "window", "curtains", "sunlight", "smile", "looking at viewer", "cowboy shot", "sitting", "hand on own chest",
    "frilled sleeves", "lace trim", "hair ribbon", "earrings", "necklace", "bracelet", "choker", "bow", "flower", "petals",
  ].join(", ")
  const input = naturalPromptInput({ prompt, characters: "yor_briar", copyrights: "spy_x_family", rating: "g" }, overrides)
  const short = formatPrompt("flux2", input, overrides)
  const full = formatPrompt("flux2", input, overrides, { fullDetail: true })
  assert(short.words <= 80, `FLUX.2 short stays within 80 words (got ${short.words})`)
  assert(full.omitted === 0 && full.words >= short.words, "full detail leaves nothing out")
  assert(short.omitted > 0 === full.words > short.words, "the short version reports what it left out")
  assert(short.text.startsWith("An anime-style illustration of Yor Briar"), "FLUX.2 opens with the subject")

  const anima = formatPrompt("anima", input, overrides)
  assert(anima.text.startsWith("safe, 1girl, solo, yor briar, spy x family"), "Anima starts with the tag block: rating, count, name, series")
  assert(anima.omitted === 0, "Anima has no word budget to report")

  const moss = formatPrompt("moss", input, overrides)
  assert(moss.words <= 180 && moss.words >= short.words, "MOSS-Image short allows more words than FLUX.2")
  assert(!/safe|explicit|masterpiece/.test(short.text), "prose leaves out rating and quality tags")
}

// 6. Character traits: which names load, how they are looked up, what they change.
{
  assert(traitNames(naturalPromptInput({ prompt: "1girl, smile", characters: "yor_briar" }, overrides)).length === 0, "one character loads no profiles")
  const pair = naturalPromptInput({ prompt: "2girls, aqua hair, blonde hair, twintails, hair bow", characters: "hatsune_miku kagamine_rin" }, overrides)
  assert(traitNames(pair).join("|") === "hatsune miku|kagamine rin", "two characters load their profiles, by normalized name")

  const profiles = {
    "hatsune miku": { "aqua hair": 0.9, twintails: 0.85, "solo 1girl": 0.95, "solo 1boy": 0 },
    "kagamine rin": { "blonde hair": 0.9, "hair bow": 0.7, "solo 1girl": 0.9, "solo 1boy": 0.01 },
  }
  const traits = cardTraits(["hatsune miku", "rin (vocaloid)"], { "rin (vocaloid)": "kagamine rin" }, profiles)
  assert(traits["rin (vocaloid)"] === profiles["kagamine rin"], "another booru's name finds the Danbooru profile, keyed by the card's own tag")
  assert(Object.keys(traits).length === 2, "every name with a profile is included")

  const known = { ...overrides, "aqua hair": "appearance:hair", "blonde hair": "appearance:hair", twintails: "appearance:hair", "hair bow": "clothing:headwear" }
  const shared = formatPrompt("flux2", pair, known, { fullDetail: true }).text
  const attributed = formatPrompt("flux2", pair, known, { fullDetail: true, traits: cardTraits(traitNames(pair), {}, profiles) }).text
  assert(shared.includes("with aqua and blonde hair") && !shared.includes("Hatsune Miku has"), "without profiles the hair is described for both")
  assert(attributed.includes("Hatsune Miku has aqua hair") && attributed.includes("Kagamine Rin has blonde hair"), "with profiles each character gets their own hair")

  const twoNames = naturalPromptInput({ prompt: "1girl, smile", characters: "kasumi_(pokemon) misty_(pokemon)" }, overrides)
  const merged = formatPrompt("flux2", twoNames, overrides, { characterAliases: { "kasumi (pokemon)": "misty (pokemon)" } }).text
  assert(merged.includes("Misty") && !merged.includes("Kasumi"), "aliases make one person of two names")
}

// 7. Trait shards: a stable hash, and the exported files agree with it.
{
  assert(traitShard("hatsune miku") === traitShard("hatsune miku") && traitShard("") === traitShard(""), "the shard hash is deterministic")
  const spread = new Set(["hatsune miku", "kagamine rin", "yor briar", "misty (pokemon)", "kashima (kancolle)", "rapi (nikke)"].map(traitShard))
  assert(spread.size >= 4 && [...spread].every((s) => s >= 0 && s < TRAIT_SHARD_COUNT), "names spread over the shard range")
  assert(traitShardFile(0) === "00.json" && traitShardFile(TRAIT_SHARD_COUNT - 1) === `${(TRAIT_SHARD_COUNT - 1).toString(16)}.json`, "shard files are two hex digits")

  const dir = path.join(__dirname, "../public/natural-traits")
  if (fs.existsSync(dir)) {
    let misplaced = 0
    let profilesSeen = 0
    for (let shard = 0; shard < TRAIT_SHARD_COUNT; shard++) {
      const file = path.join(dir, traitShardFile(shard))
      if (!fs.existsSync(file)) { misplaced++; continue }
      for (const [name, profile] of Object.entries(JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, Record<string, number>>)) {
        profilesSeen++
        if (traitShard(name) !== shard || name !== normalizeTag(name) || Object.values(profile).some((v) => typeof v !== "number")) misplaced++
      }
    }
    const aliases: Record<string, string> = JSON.parse(fs.readFileSync(path.join(dir, "aliases.json"), "utf8"))
    assert(misplaced === 0 && profilesSeen > 0, `every exported profile sits in the shard its name hashes to (${misplaced} misplaced)`)
    assert(Object.entries(aliases).every(([from, to]) => from !== to && from === normalizeTag(from)), "aliases only list names that differ, normalized")
  }
}

// 8. Format metadata.
{
  assert(PROMPT_FORMATS[0] === "tags", "tags is the first and default format")
  assert(isPromptFormat("moss") && !isPromptFormat("nl") && !isPromptFormat(null), "stored values are validated")
  assert(hasWordBudget("flux2") && hasWordBudget("moss") && !hasWordBudget("anima") && !hasWordBudget("tags"), "only prose formats have a budget")
  assert(PROMPT_FORMAT_INFO.flux2.shortWords === 80 && PROMPT_FORMAT_INFO.moss.shortWords === 180, "budgets match the renderers")
}

console.log(`natural-prompt-format: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
