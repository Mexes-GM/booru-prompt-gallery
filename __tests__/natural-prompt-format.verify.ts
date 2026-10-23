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
 *   6. Format metadata.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/natural-prompt-format.verify.ts
 */
import { formatPrompt, naturalPromptInput, ratingLetter, unclassifiedTags } from "../lib/prompt/natural-format"
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

// 6. Format metadata.
{
  assert(PROMPT_FORMATS[0] === "tags", "tags is the first and default format")
  assert(isPromptFormat("moss") && !isPromptFormat("nl") && !isPromptFormat(null), "stored values are validated")
  assert(hasWordBudget("flux2") && hasWordBudget("moss") && !hasWordBudget("anima") && !hasWordBudget("tags"), "only prose formats have a budget")
  assert(PROMPT_FORMAT_INFO.flux2.shortWords === 80 && PROMPT_FORMAT_INFO.moss.shortWords === 180, "budgets match the renderers")
}

console.log(`natural-prompt-format: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
