/**
 * Regression tests for "Random outfit" (lib/outfit-swap.ts).
 *
 * The behaviour being pinned:
 *   1. Only one clothed female subject gets a new outfit. Groups, male
 *      subjects, nudity and depicted acts keep their own tags.
 *   2. The post's clothing and garment poses go; hair accessories and
 *      everything else stay, and the outfit lands where the clothing was.
 *   3. The pick is stable per post, follows the chosen styles and the scene,
 *      and leaves out what the framing can't show.
 *   4. Through derivePostPrompt, the card text and the pure prompt agree.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/outfit-swap.verify.ts
 */
import {
  DEFAULT_OUTFIT_STYLES,
  isOutfitEligible,
  outfitDescription,
  outfitTags,
  parseOutfitDescriptions,
  parseOutfitLibrary,
  pickOutfit,
  swapOutfit,
  type Outfit,
  type PickedOutfit,
  type OutfitSettings,
} from "../lib/outfit-swap"
import { derivePostPrompt } from "../lib/prompt/derive-post-prompt"
import { formatPrompt, naturalPromptInput } from "../lib/prompt/natural-format"
import type { BooruPost } from "../lib/booru/types"
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

const library = parseOutfitLibrary(rawLibrary)
assert(library.length > 1000, `library parses (${library.length} outfits)`)
assert(library.every((o) => Object.keys(o.slots).length > 0), "every outfit has at least one slot")

const settings = (over: Partial<OutfitSettings> = {}): OutfitSettings => ({
  mode: "random", styles: DEFAULT_OUTFIT_STYLES, detail: "full", library, ...over,
})

// ─── 1. Eligibility ─────────────────────────────────────────────────────────
assert(isOutfitEligible(["1girl", "solo", "long hair"]), "1girl solo is eligible")
assert(isOutfitEligible(["female", "solo", "anthro"]), "e621 solo female is eligible")
assert(!isOutfitEligible(["1boy", "solo"]), "1boy is not eligible")
assert(!isOutfitEligible(["1girl", "1boy"]), "a couple is not eligible")
assert(!isOutfitEligible(["2girls"]), "two girls are not eligible")
assert(!isOutfitEligible(["female", "male", "duo"]), "e621 duo is not eligible")
assert(!isOutfitEligible(["1girl", "nude"]), "nudity is left alone")
assert(!isOutfitEligible(["1girl", "sex"]), "a depicted act is left alone")
assert(!isOutfitEligible(["long hair", "smile"]), "no subject count is not eligible")

// ─── 2. Swapping ────────────────────────────────────────────────────────────
const post = ["1girl", "solo", "long hair", "hair ribbon", "school uniform", "pleated skirt", "white shirt", "skirt lift", "smile", "classroom"]
const swapped = swapOutfit(post, ["red dress", "black boots"])
assert(!swapped.includes("school uniform") && !swapped.includes("pleated skirt") && !swapped.includes("white shirt"), "post clothing removed")
assert(!swapped.includes("skirt lift"), "garment pose removed")
assert(swapped.includes("hair ribbon"), "hair accessory kept")
assert(["1girl", "solo", "long hair", "smile", "classroom"].every((t) => swapped.includes(t)), "other tags kept")
assert(swapped.indexOf("red dress") === swapped.indexOf("hair ribbon") + 1, "outfit lands where the clothing was")
assert(swapOutfit(post, null).join() === post.join(), "no outfit leaves tags untouched")
assert(swapOutfit(["1girl", "red dress"], ["red dress"]).filter((t) => t === "red dress").length === 1, "no duplicate tags")

// ─── 3. Picking ─────────────────────────────────────────────────────────────
const base = ["1girl", "solo", "standing", "full body"]
const first = pickOutfit(base, settings(), 1234)
assert(first !== null && first.tags.length > 0, "eligible post gets an outfit")
assert(JSON.stringify(pickOutfit(base, settings(), 1234)) === JSON.stringify(first), "same post, same outfit")
const distinct = new Set(Array.from({ length: 40 }, (_, i) => JSON.stringify(pickOutfit(base, settings(), i + 1))))
assert(distinct.size > 25, `different posts get different outfits (${distinct.size}/40)`)
assert(pickOutfit(base, settings({ mode: "keep" }), 1) === null, "keep mode picks nothing")
assert(pickOutfit(base, settings({ styles: [] }), 1) === null, "no styles picks nothing")
assert(pickOutfit(["1boy", "solo"], settings(), 1) === null, "ineligible post picks nothing")

const styleOf = (picked: PickedOutfit | null, pool: Outfit[]) => pool.find((o) => o.id === picked?.id)?.style
const winterOnly = settings({ styles: ["winter"] })
const winterPicks = Array.from({ length: 20 }, (_, i) => styleOf(pickOutfit(base, winterOnly, i + 1), library))
assert(winterPicks.every((s) => s === "winter"), "picks follow the chosen styles")
const beachPicks = Array.from({ length: 20 }, (_, i) => styleOf(pickOutfit([...base, "beach"], settings(), i + 1), library))
assert(beachPicks.every((s) => s === "swimwear" || s === "summer"), "a beach scene gets swimwear or summer clothes")
const dryPicks = Array.from({ length: 40 }, (_, i) => styleOf(pickOutfit(base, settings(), i + 1), library))
assert(!dryPicks.includes("swimwear"), "no swimwear away from the water")
const snowPicks = Array.from({ length: 20 }, (_, i) => styleOf(pickOutfit([...base, "snow"], settings(), i + 1), library))
assert(snowPicks.every((s) => s === "winter"), "a snowy scene gets winter clothes")

const sample: Outfit = { id: 0, style: "autumn", slots: { top: ["sweater"], bottom: ["skirt"], legwear: ["black thighhighs"], footwear: ["boots"], handheld: ["handbag"] } }
assert(outfitTags(sample, "full").join() === "sweater,skirt,black thighhighs,boots,handbag", "full detail keeps every slot in order")
assert(outfitTags(sample, "simple").join() === "sweater,skirt,boots", "simple detail keeps the main garments")
assert(!outfitTags(sample, "full", ["upper body"]).some((t) => t === "boots" || t === "black thighhighs"), "upper body drops shoes and legwear")
assert(!outfitTags(sample, "full", ["cowboy shot"]).includes("boots") && outfitTags(sample, "full", ["cowboy shot"]).includes("black thighhighs"), "cowboy shot drops only shoes")
const layered: Outfit = { id: 0, style: "winter", slots: { top: ["turtleneck sweater", "turtleneck", "ribbed sweater"], bottom: ["skirt"] } }
assert(outfitTags(layered, "simple").join() === "turtleneck sweater,turtleneck,skirt", "simple detail keeps the two surest tags per piece")
assert(outfitTags(layered, "full").length === 4, "full detail keeps them all")
const lingerie: Outfit = { id: 0, style: "lingerie", slots: { underwear: ["black bra", "black panties"], legwear: ["garter straps"] } }
assert(outfitTags(lingerie, "simple").join() === "black bra,black panties", "simple lingerie keeps the underwear")

// ─── Descriptions ───────────────────────────────────────────────────────────
const descriptions = parseOutfitDescriptions(rawDescriptions)
assert(descriptions.length === library.length && descriptions.every((d) => d.length > 0), "one description per outfit")
const text = "A blue ribbed knit cardigan with a belt at the waist. Pink pleated skirt. White lace-top thigh-high stockings. White sandals with a bow. A straw hat with a black band. A small handbag."
assert(outfitDescription(text, "full") === text, "full detail keeps every sentence")
assert(outfitDescription(text, "simple") === "A blue ribbed knit cardigan with a belt at the waist. Pink pleated skirt. White sandals with a bow.", "simple keeps garments and shoes, even a garment sentence that mentions a belt")
assert(!outfitDescription(text, "full", ["upper body"]).includes("sandals") && !outfitDescription(text, "full", ["upper body"]).includes("stockings"), "close framing drops shoes and legwear sentences")
const withText = pickOutfit(base, settings({ descriptions }), 1234)
assert(!!withText?.description && withText.id === first?.id, "a pick carries its description")
assert(pickOutfit(base, settings(), 1234)?.description === undefined, "no description before they load")

// ─── 4. Through the prompt pipeline ─────────────────────────────────────────
const booruPost: BooruPost = {
  id: 4242, file_url: "", large_file_url: "", preview_file_url: "", rating: "g", score: 0,
  tag_string: "1girl solo long_hair school_uniform pleated_skirt smile classroom full_body",
  tag_string_artist: "", tag_string_character: "", tag_string_copyright: "",
}
const derived = derivePostPrompt(booruPost, {
  excludeInput: "", addInput: "", includeCharacters: true, optimizeTags: true, outfitSettings: settings(),
})
const expected = pickOutfit(["1girl", "solo", "long hair", "smile", "classroom", "full body"], settings(), booruPost.id)
assert(expected !== null && expected.tags.every((t) => derived.pureContent.includes(t)), "pure prompt carries the outfit")
assert(!derived.pureContent.includes("pleated skirt") && !derived.displayContent.includes("pleated skirt"), "both prompts drop the post's clothing")
assert(derived.pureContent.split(", ").join() === derived.displayContent.split(", ").join(), "pure and display prompts agree")

const searched = derivePostPrompt(booruPost, {
  excludeInput: "", addInput: "", includeCharacters: true, optimizeTags: true, outfitSettings: settings(),
  searchTags: "1girl, school uniform, smile, blue eyes",
})
assert(!searched.displayContent.includes("school uniform"), "searched clothing isn't added back over the outfit")
assert(searched.displayContent.includes("blue eyes"), "other searched tags are still added")

// ─── 5. Natural-language formats ────────────────────────────────────────────
const desc = "A blue ribbed knit cardigan with a deep V-neck. A pink pleated skirt. White sandals with a bow."
const source = { prompt: "1girl, solo, long hair, blue cardigan, pink skirt, sandals, smile, standing", rating: "g" }
const withDesc = naturalPromptInput({ ...source, outfitDescription: desc }, {})
const flux = formatPrompt("flux2", withDesc, {}, { fullDetail: true }).text
assert(flux.includes("She wears a blue ribbed knit cardigan with a deep V-neck."), `flux2 says the outfit in its own sentences (${flux})`)
const anima = formatPrompt("anima", withDesc, {}).text
assert(anima.includes("pink skirt") && anima.includes("She wears a blue ribbed knit cardigan"), `anima keeps the outfit tags and adds the sentences (${anima})`)
const plain = formatPrompt("flux2", naturalPromptInput(source, {}), {}, { fullDetail: true }).text
assert(!plain.includes("ribbed knit"), "without a description the outfit comes from the tags")

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
