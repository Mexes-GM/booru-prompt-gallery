/**
 * Tests for lib/pack/scene/permanence.ts and lib/pack/scene/blocked.ts.
 *
 * Covers:
 *   1. Default permanence by slot (hair/eyes/anatomy identity, demographics state,
 *      accessories state, everything else state) and the listed exceptions.
 *   2. Composition patterns win over the slot ("solo focus" is a camera tag).
 *   3. Tags without a slot are state; underscores are accepted.
 *   4. Blocked themes match whole words, with spaces and with underscores.
 *   5. A post with any blocked tag is blocked as a whole.
 *   6. Photographs are told apart from drawings by the booru's own medium tags.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-scene-permanence.verify.ts
 */
import { createPermanence, isCompositionPattern, isKinshipTag } from "../lib/pack/scene/permanence"
import { isBlockedTheme, postIsBlocked } from "../lib/pack/scene/blocked"
import { isPhotoPost } from "../lib/pack/scene/medium"
import { OVERRIDES, PERMANENCE_DATA, makeAssert, makePost } from "./fixtures/pack-scene-data"

const { assert, done } = makeAssert()
const permanence = createPermanence(PERMANENCE_DATA, OVERRIDES)

// ── Slot defaults and exceptions ──
assert(permanence("blue hair") === "identity", "hair is identity by default (slot inherited from 'hair')")
assert(permanence("wet hair") === "state", "listed hair exception is state")
assert(permanence("large breasts") === "identity", "anatomy is identity by default")
assert(permanence("horns") === "identity", "anatomy tag is identity")
assert(permanence("navel") === "state", "listed anatomy exception is state")
assert(permanence("red eyes") === "identity", "eye colour is identity")
assert(permanence("closed eyes") === "state", "listed eyes exception is state")
assert(permanence("nurse") === "state", "demographics is state by default")
assert(permanence("elf") === "identity", "listed demographics tag is identity")
assert(permanence("couple") === "composition", "listed demographics tag is composition")
assert(permanence("glasses") === "signature", "listed eyewear is signature")
assert(permanence("hat") === "signature", "listed headwear is signature")
assert(permanence("sun hat") === "state", "unlisted headwear is state")
assert(permanence("scarf") === "state", "unlisted accessory is state")
assert(permanence("skirt") === "state", "clothing is state")
assert(permanence("blue skirt") === "state", "clothing variant inherits the slot")
assert(permanence("standing") === "state", "pose is state")
assert(permanence("bedroom") === "state", "scenery is state")

// ── What the data names wins over the slot ──
assert(permanence("lion boy") === "identity", "a listed identity tag is identity even without a known slot")
assert(permanence("size difference") === "relative" && permanence("interspecies") === "relative", "listed comparisons between people are relative")

// ── Relative to the donor's canon ──
for (const tag of ["cosplay", "yor briar (cosplay)", "alternate costume", "official alternate costume", "official alternate hairstyle",
  "alternate hairstyle", "alternate hair color", "alternate hair length", "alternate hair length (longer)", "adapted costume",
  "costume switch", "genderswap", "genderswap (mtf)", "aged up"]) {
  assert(permanence(tag) === "relative", `${tag} is relative`)
}
for (const tag of ["costume", "halloween costume", "cosplay photo", "alternate", "hair color"]) {
  assert(permanence(tag) !== "relative", `${tag} is not relative`)
}

// ── Composition patterns ──
for (const tag of ["1girl", "2boys", "6+girls", "3others", "multiple girls", "multiple boys", "solo", "solo focus",
  "male focus", "female focus", "hetero", "yuri", "yaoi", "futa with male", "couple", "duo", "trio", "group"]) {
  assert(permanence(tag) === "composition", `${tag} is composition`)
  assert(isCompositionPattern(tag), `${tag} matches the composition pattern`)
}
assert(permanence("solo_focus") === "composition", "underscores are accepted")
assert(permanence("solo focus") === "composition", "'solo focus' is composition although its slot is camera")
assert(!isCompositionPattern("group photo"), "'group photo' is not a composition tag")

// ── Unknown tags ──
assert(permanence("unknown thing") === "state", "tag without slot is state")
assert(permanence("") === "state", "empty tag does not throw")
assert(isKinshipTag("mother and son") && isKinshipTag("sisters") && !isKinshipTag("hetero"), "kinship tags are recognised")

// ── Blocked themes ──
for (const tag of ["loli", "young girl", "young_girl", "age regression", "age_regression", "age regressed", "aged down",
  "aged_down", "younger female", "younger_female", "younger male", "younger_woman", "younger man", "older male and younger female",
  "older_male_and_younger_female", "older woman and younger man", "child", "children", "schoolgirl", "school_girl", "teenage girl", "little_girl", "baby", "shota", "underage"]) {
  assert(isBlockedTheme(tag), `${tag} is blocked`)
}
for (const tag of ["lolita fashion", "childhood friends", "school uniform", "long hair", "standing", "yellow room", "older male", "older sister", "older brother", "elder male"]) {
  assert(!isBlockedTheme(tag), `${tag} is not blocked`)
}

// ── Photographs ──
assert(isPhotoPost(makePost(90, "1girl solo photo_(medium) standing")), "photo (medium) marks a photograph")
assert(isPhotoPost(makePost(91, "1girl standing", { tag_string_meta: "photo_(medium)" })), "the meta field is read")
assert(isPhotoPost(makePost(92, "1girl standing", { tag_string_copyright: "real_life" })), "real life series marks a photograph")
assert(!isPhotoPost(makePost(93, "1girl photoshop_(medium) marker_(medium) 3d cosplay standing")), "other medium tags are drawings")

// ── Whole-post blocking ──
assert(postIsBlocked(makePost(1, "1girl solo age_regression standing")), "tag with underscore blocks the post")
assert(postIsBlocked(makePost(2, "1girl solo young_girl standing")), "young_girl blocks the post")
assert(postIsBlocked(makePost(3, "1girl standing", { tag_string_character: "little_girl_x" })), "character field is checked")
assert(postIsBlocked(makePost(4, "1girl standing", { tag_string_copyright: "baby_series" })), "copyright field is checked")
assert(!postIsBlocked(makePost(5, "1girl solo standing smile bedroom")), "clean post is not blocked")

done()
