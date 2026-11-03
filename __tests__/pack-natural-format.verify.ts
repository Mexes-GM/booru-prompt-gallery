/**
 * Regression tests for Pack Mode in the natural-language prompt formats
 * (lib/pack/pack-natural.ts, packOutfitDescription in lib/outfit-swap.ts).
 *
 * The behaviour being pinned:
 *   1. Each pack prompt converts from the same NaturalPromptSource a card
 *      builds: the kept character's name (only while the prompt has it), the
 *      base's series, and a rating that follows the pack's content rating.
 *   2. A prompt whose clothing came from the outfit library carries that
 *      outfit's sentences, trimmed to the parts still in the prompt.
 *   3. The converted text uses those names and sentences.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-natural-format.verify.ts
 */
import {
  outfitPackDraw,
  outfitPackPool,
  outfitTags,
  packOutfitDescription,
  parseOutfitDescriptions,
  parseOutfitLibrary,
  type Outfit,
} from "../lib/outfit-swap"
import { packNaturalSource, packPromptRating, type PackNaturalContext } from "../lib/pack/pack-natural"
import type { PackPrompt } from "../lib/pack/pack-generator"
import { formatPrompt, naturalPromptInput } from "../lib/prompt/natural-format"
import rawLibrary from "../public/outfits.json"
import rawDescriptions from "../public/outfit-descriptions.json"

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

// ─── 1. Outfit sentences for a pack prompt ──────────────────────────────────
const outfit: Outfit = {
  id: 3,
  style: "spring",
  slots: { top: ["blue cardigan"], bottom: ["pink skirt"], legwear: ["white thighhighs"], footwear: ["sandals"], handheld: ["handbag"] },
}
const text = "A blue ribbed knit cardigan. A pink pleated skirt. White thigh-high stockings. White sandals with a bow. A small handbag."
const full = "1girl, solo, blue cardigan, pink skirt, white thighhighs, sandals, handbag, smile"
assert(packOutfitDescription(outfit, text, full) === text, "every part in the prompt keeps every sentence")
const noShoes = "1girl, solo, blue cardigan, pink skirt, white thighhighs, handbag, smile"
assert(packOutfitDescription(outfit, text, noShoes) === "A blue ribbed knit cardigan. A pink pleated skirt. White thigh-high stockings. A small handbag.", "a muted slot drops its sentence")
const simple = "1girl, blue cardigan, pink skirt, sandals"
assert(packOutfitDescription(outfit, text, simple) === "A blue ribbed knit cardigan. A pink pleated skirt. White sandals with a bow.", "simple detail keeps garments and shoes")
assert(packOutfitDescription(outfit, text, "1girl, solo, school uniform") === undefined, "an outfit no longer in the prompt says nothing")
assert(packOutfitDescription(outfit, text, "1girl, (blue cardigan:1.2), pink_skirt") === "A blue ribbed knit cardigan. A pink pleated skirt.", "weights and underscores still match")

// ─── 2. The draw keeps each outfit with its tags ────────────────────────────
const library = parseOutfitLibrary(rawLibrary)
const descriptions = parseOutfitDescriptions(rawDescriptions)
const draw = outfitPackDraw(library, ["winter", "autumn"], "simple", 7, 60)
assert(JSON.stringify(draw.map((o) => o.tags)) === JSON.stringify(outfitPackPool(library, ["winter", "autumn"], "simple", 7, 60)), "the pool is the draw's tag lists")
assert(draw.every((o) => outfitTags(o.outfit, "simple").join() === o.tags.join()), "each drawn outfit carries its own tags")

// ─── 3. Rating ──────────────────────────────────────────────────────────────
assert(packPromptRating("1girl, sex, bed", "both") === "explicit", "an explicit tag makes the prompt explicit")
assert(packPromptRating("1girl, bed", "both") === "questionable", "the other half of a 'both' pack is questionable")
assert(packPromptRating("1girl, bed", "explicit") === "explicit", "an explicit pack stays explicit")
assert(packPromptRating("1girl, bed", "sfw") === "general", "a safe pack is general")
assert(packPromptRating("1girl, bed", null, "s") === "s", "with no pack rating the base card's rating is used")

// ─── 4. Source per prompt ───────────────────────────────────────────────────
const context: PackNaturalContext = {
  provider: "danbooru",
  character: "kashima (kancolle)",
  copyrights: "kantai_collection",
  contentRating: "sfw",
  outfits: new Map([[outfit.id, outfit]]),
  descriptions: Object.assign([], { [outfit.id]: text }),
}
const pack = (prompt: string, extra: Partial<PackPrompt> = {}): PackPrompt => ({ prompt, values: [], ...extra })

const named = packNaturalSource(pack("1girl, solo, kashima (kancolle), grey hair, beret, smile"), context)
assert(named.characters === "kashima_(kancolle)", `the kept character goes in the names field (${named.characters})`)
assert(named.copyrights === "kantai_collection", "with the base's series")
assert(named.rating === "general" && named.provider === "danbooru", "rating and provider come from the pack")
assert(named.outfitDescription === undefined, "a prompt without a library outfit has no outfit sentences")

const unnamed = packNaturalSource(pack("1girl, solo, grey hair, smile"), context)
assert(unnamed.characters === undefined && unnamed.copyrights === undefined, "no name or series when the prompt left the character out")

const dressed = packNaturalSource(pack("1girl, solo, kashima (kancolle), blue cardigan, pink skirt, sandals, smile", { outfitId: outfit.id }), context)
assert(dressed.outfitDescription === "A blue ribbed knit cardigan. A pink pleated skirt. White sandals with a bow.", `the library outfit's sentences come along (${dressed.outfitDescription})`)
const unloaded = packNaturalSource(pack("1girl, blue cardigan, pink skirt", { outfitId: outfit.id }), { ...context, descriptions: [] })
assert(unloaded.outfitDescription === undefined, "no sentences before the descriptions load")

// A real library outfit, from the draw to the prose.
const real = draw.find((o) => descriptions[o.outfit.id])!
const realPrompt = pack(`1girl, solo, ${real.tags.join(", ")}, standing`, { outfitId: real.outfit.id })
const realSource = packNaturalSource(realPrompt, { ...context, character: null, outfits: new Map(library.map((o) => [o.id, o])), descriptions })
assert(!!realSource.outfitDescription, `a drawn library outfit has its sentences (outfit ${real.outfit.id})`)

// ─── 5. Through the converter ───────────────────────────────────────────────
const flux = formatPrompt("flux2", naturalPromptInput(dressed, {}), {}, { fullDetail: true }).text
assert(flux.includes("She wears a blue ribbed knit cardigan."), `flux2 says the library outfit in its own sentences (${flux})`)
assert(/kashima/i.test(flux), `flux2 names the kept character (${flux})`)
const anima = formatPrompt("anima", naturalPromptInput(named, {}), {}).text
assert(anima.includes("kashima \\(kancolle\\)") && anima.includes("kantai collection"),`anima keeps the character and series tags (${anima})`)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
