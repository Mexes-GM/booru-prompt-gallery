/**
 * Tests for the tags -> natural language converter (lib/prompt/natural).
 *
 * Covers:
 *   1. Every input tag lands somewhere: a scene slot, unclassified, or dropped as meta.
 *   2. Pronouns follow the count tags, not the number of character tags
 *      (a cosplay post tags two characters for one person).
 *   3. Costume variants of one character and cosplayed characters are not extra people.
 *   4. Prose drops tags another tag implies ("shirt" next to "grey shirt").
 *   5. Anima output: tag order from the model card, @artist, escaped parentheses,
 *      followed by a prose block.
 *   6. FLUX.2 output: prose only, no rating, quality or artist tags.
 *   7. The phrase dictionary and its precedence.
 *   8. Pasted prompts: hand-written names, gender and size tags.
 *   9-10. Word budget; trait attribution between characters.
 *   11. One character under several names; placeholder names.
 *   12. Gender per character: sexual anatomy stays shared, possessives follow it.
 *   13. Cleaned-prompt input: merged hair tags, skin colour redundancy.
 *   14. Things said twice: held items and their generic words, series, relations, phrases.
 *   15. No phrase for content involving minors.
 *   16. Wording: demographic tags, garments worn somewhere, "is/are visible", "it" for a robot.
 *   17. Several people: who has what (named or not), gendered tags, pairings, acts between two.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/natural-prompt.verify.ts
 */
import { buildScene, normalizeTag, sceneTagCount, renderAnima, renderFlux2, renderMoss, splitPromptTags, titleCase } from "../lib/prompt/natural"
import { dropImplied, mergeSharedPrefix, splitHairCompound, withArticle } from "../lib/prompt/natural/english"
import { readFileSync } from "fs"
import path from "path"

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
  "hair bun": "appearance:hair",
  "red eyes": "appearance:eyes",
  "large breasts": "appearance:anatomy",
  breasts: "appearance:anatomy",
  shirt: "clothing:top",
  "grey shirt": "clothing:top",
  nightgown: "clothing:outfit",
  "black nightgown": "clothing:outfit",
  bedroom: "scenery:setting",
  "warm lighting": "scenery:atmosphere",
  "lying on stomach": "pose:posture",
  smile: "pose:expression",
  "looking at viewer": "pose:camera",
  "cowboy shot": "pose:camera",
  highres: "other:meta",
  "commentary request": "other:meta",
}

// 1. Coverage.
{
  const general = ["1girl", "solo", "black_hair", "long_hair", "red_eyes", "black_nightgown", "nightgown", "bedroom", "lying_on_stomach", "smile", "looking_at_viewer", "cowboy_shot", "warm_lighting", "highres", "commentary_request", "mystery_tag"]
  const scene = buildScene({ general, characters: ["yor_briar"], copyrights: ["spy_x_family"], artists: ["some_artist"], rating: "s" }, overrides)
  const input = new Set(general.map(normalizeTag))
  assert(sceneTagCount(scene) + scene.dropped.length === input.size, "every input tag is rendered or dropped on purpose")
  assert(scene.dropped.includes("highres") && scene.dropped.includes("commentary request"), "meta tags are dropped")
  assert(scene.unclassified.includes("mystery tag"), "unknown tags are kept as unclassified, not lost")
  assert(scene.camera.gaze.includes("looking at viewer") && scene.camera.framing.includes("cowboy shot"), "camera tags are split into gaze and framing")
  assert(scene.characters[0]?.name === "Yor Briar" && scene.series[0] === "Spy x Family", "names come from the post fields, title-cased")
}

// 2 + 3. Pronouns, cosplay, costume variants.
{
  const cosplay = buildScene({
    general: ["1girl", "cosplay", "mash_kyrielight_(cosplay)", "long_hair", "smile"],
    characters: ["aozaki_aoko", "mash_kyrielight"],
    copyrights: ["fate/grand_order"],
  }, overrides)
  assert(cosplay.characters.length === 1 && cosplay.characters[0].name === "Aozaki Aoko", "the cosplayed character is not an extra person")
  const flux = renderFlux2(cosplay).text
  assert(flux.includes("cosplaying as Mash Kyrielight"), "cosplay is described")
  assert(flux.includes("She is smiling"), "one girl -> singular pronoun despite two character tags")

  const variants = buildScene({ general: ["2girls"], characters: ["rapi_(nikke)", "rapi_(red_hood)_(nikke)", "modernia_(nikke)"] }, overrides)
  assert(variants.characters.map((c) => c.name).join(",") === "Rapi,Modernia", "costume variants of one character are merged")
  assert(variants.characterTags.length === 3, "tag renderers still get every character tag")
  assert(titleCase("fate/grand order") === "Fate/Grand Order", "title case capitalizes after a slash")
}

// 4. Implied tags.
{
  assert(dropImplied(["shirt", "grey shirt"]).join() === "grey shirt", "generic tag dropped next to its specific form")
  assert(dropImplied(["long hair", "very long hair"]).join() === "very long hair", "shorter hair length dropped")
  assert(dropImplied([":d", "smile", "open mouth"]).join() === ":d", ":d implies smile and open mouth")
}

// 5 + 6. Renderers.
{
  const scene = buildScene({
    general: ["1girl", "black_hair", "long_hair", "red_eyes", "shirt", "grey_shirt", "lying_on_stomach", "looking_at_viewer", "bedroom", "warm_lighting", "cowboy_shot"],
    characters: ["kashima_(kancolle)"],
    copyrights: ["kantai_collection"],
    artists: ["some_artist"],
    rating: "g",
  }, overrides)

  const anima = renderAnima(scene).text
  const [tags, prose] = [anima.slice(0, anima.indexOf(". ")), anima.slice(anima.indexOf(". ") + 2)]
  assert(tags.startsWith("safe, 1girl, kashima \\(kancolle\\), kantai collection, @some artist"), "anima: safety, count, character, series, @artist first")
  assert(tags.includes("grey shirt") && tags.includes(", shirt"), "anima keeps redundant tags in the tag block")
  assert(prose.startsWith("Kashima from Kantai Collection, with long black hair and red eyes."), "anima prose names the character with hair and eyes")

  const flux = renderFlux2(scene).text
  assert(flux.startsWith("An anime-style illustration of Kashima from Kantai Collection, with long black hair and red eyes."), "flux2 opens with medium and subject")
  assert(!/(safe|@some|highres|\\\()/.test(flux), "flux2 has no rating, artist or escaped tags")
  assert(flux.includes("She wears a grey shirt.") && !flux.includes("a shirt"), "flux2 drops the implied generic garment")
  assert(flux.includes("The lighting is warm."), "lighting tags become a lighting sentence")
}

// 7. Phrase dictionary: used when no hand-written wording exists, {pos} follows the pronoun.
{
  const phrases = {
    "lying on stomach": { kind: "is" as const, text: "lying flat on {pos} stomach" },
    smile: { kind: "is" as const, text: "beaming" },
    "mole under eye": { kind: "has" as const, text: "a mole under {pos} eye" },
    "warm lighting": { kind: "scene" as const, text: "ignored, lighting tags have their own sentence" },
  }
  const solo = buildScene({ general: ["1girl", "lying_on_stomach", "smile", "mole_under_eye"] }, { ...overrides, "mole under eye": "appearance:anatomy" })
  const flux = renderFlux2(solo, { phrases }).text
  assert(flux.includes("lying flat on her stomach"), "dictionary phrase replaces the generic rule")
  assert(flux.includes("smiling") && !flux.includes("beaming"), "hand-written lexicon wins over the dictionary")
  assert(flux.includes("She has a mole under her eye."), "anatomy uses the dictionary with the possessive filled in")

  const duo = buildScene({ general: ["2girls", "lying_on_stomach"] }, overrides)
  assert(renderFlux2(duo, { phrases }).text.includes("They are lying flat on their stomach"), "{pos} follows a plural subject")
  assert(!renderFlux2(solo).text.includes("lying flat"), "without a dictionary the rules alone apply")
}

// 8. Pasted prompts in other boorus' style (names written by hand, gender and size tags).
{
  const names: Record<string, string> = {
    ...overrides,
    "haruno sakura": "other:character",
    "tsunade (naruto)": "other:character",
    haruno: "other:artist",
    "big ass": "appearance:anatomy",
    "huge ass": "appearance:anatomy",
    "mature female": "appearance:demographics",
    // As in the real taxonomy: "curvy female" reaches demographics through its suffix.
    female: "appearance:demographics",
  }
  const input = splitPromptTags("sakura haruno, tsunade, 2girls, (smile:1.3), @some artist, score_9", names)
  assert(input.characters?.join() === "haruno sakura,tsunade (naruto)", "names found by swapped order and by base name")
  assert(input.artists?.join() === "some artist" && input.general.includes("smile") && input.general.includes("score_9"), "weights removed, @artist split, score spelling kept")

  const scene = buildScene({ ...input, general: [...input.general, "big ass", "huge ass", "blonde female", "curvy female", "mature female", "female only", "blonde hair"] }, names)
  assert(scene.series.join() === "Naruto", "series taken from the character qualifier when the prompt names none")
  assert(scene.subjectTags.includes("female only"), "gender tags count as subject tags")
  assert(!scene.dropped.includes("sakura haruno"), "a suffix guess never drops a tag as an artist name")
  const flux = renderFlux2(scene).text
  assert(flux.includes("One of the girls is curvy and mature.") && !flux.includes("blonde."), "gendered tags describe one of the girls, without repeating the hair colour")
  assert(flux.includes("a huge ass") && !flux.includes("big ass"), "only the largest size of a body part is kept")

  const withBases = { ...names, "lifeguard (lilo & stitch)": "other:character", "overwatch 2": "other:copyright", mercy: "other:character" }
  const r34 = splitPromptTags("mercy, overwatch 2, lifeguard, 2d_(artwork)", withBases)
  assert(r34.characters?.join() === "mercy" && r34.general.includes("lifeguard"), "a base-name guess from another series is not taken")
  assert(r34.general.includes("2d_(artwork)"), "a tag's own qualifier is not stripped as a weight")
  assert(splitPromptTags("tsunade", withBases, { guessNames: false }).characters?.length === 0, "booru posts skip name guessing")
}

// 9. Length and repetition: FLUX.2 stays within 80 words, the subject always survives.
{
  const many: Record<string, string> = { ...overrides }
  const garments = ["red dress", "white gloves", "black boots", "blue scarf", "gold necklace", "silver ring", "lace choker", "fur coat", "wool hat", "leather belt"]
  garments.forEach((g) => (many[g] = "clothing:accents"))
  const places = ["forest", "river", "bridge", "castle", "mountain", "village"]
  places.forEach((t) => (many[t] = "scenery:setting"))
  const scene = buildScene({ general: ["1girl", "1girls", "long hair", "black hair", "red eyes", "smile", "sitting", ...garments, ...places, "warm lighting", "cowboy shot"], characters: ["kashima (kancolle)"] }, many)
  assert(scene.girls === 1, "1girl and 1girls count one girl, not two")
  const flux = renderFlux2(scene)
  const words = flux.text.split(/\s+/).length
  assert(words <= 80, `flux2 stays within 80 words (got ${words})`)
  assert(flux.text.startsWith("An anime-style illustration of Kashima"), "the subject is never cut")
  assert(flux.omitted > 0, "what was cut is reported")
  assert(renderFlux2(scene, { maxWords: 400 }).omitted < flux.omitted, "a larger budget cuts less")
  const unlimited = renderFlux2(scene, { maxWords: null })
  assert(unlimited.omitted === 0 && unlimited.text.includes("a village"), "maxWords: null keeps every detail")

  const moss = renderMoss(scene)
  assert(moss.text.split(/\s+/).length <= 180 && moss.omitted <= flux.omitted, "MOSS-Image keeps more detail, within its 180-word default")
  assert(!/@|\\\(|best quality/.test(moss.text) && moss.text.startsWith("An anime-style illustration of Kashima"), "MOSS-Image is prose with names written out")

  const phrases = { "oral sex": { kind: "is" as const, text: "performing oral sex" }, "fellatio deep": { kind: "is" as const, text: "performing oral sex on a penis" } }
  const repeated = buildScene({ general: ["1girl", "oral sex", "fellatio deep"] }, { ...overrides, "oral sex": "pose:physiological", "fellatio deep": "pose:physiological" })
  const text = renderFlux2(repeated, { phrases }).text
  assert(text.includes("performing oral sex on a penis") && !/performing oral sex(,| and)/.test(text), "a phrase contained in another is dropped")
}

// 10. Trait attribution between characters (Danbooru related-tag shares, rounded).
{
  const traits = {
    "hatsune miku": { twintails: 0.83, "aqua hair": 0.51, "aqua eyes": 0.38, necktie: 0.38, skirt: 0.39, "detached sleeves": 0.37, "blue eyes": 0.27 },
    "kagamine rin": { "blonde hair": 0.81, "short hair": 0.63, "hair ribbon": 0.25, "blue eyes": 0.47, "sailor collar": 0.31, shorts: 0.29, "detached sleeves": 0.3, "aqua eyes": 0.22, twintails: 0.24, "aqua hair": 0.16, necktie: 0.19, skirt: 0.19 },
  }
  const vocab: Record<string, string> = {
    ...overrides,
    twintails: "appearance:hair", "aqua hair": "appearance:hair", "blonde hair": "appearance:hair", "short hair": "appearance:hair", "hair ribbon": "appearance:hair",
    "aqua eyes": "appearance:eyes", "blue eyes": "appearance:eyes",
    necktie: "clothing:accents", skirt: "clothing:bottom", shorts: "clothing:bottom", "sailor collar": "clothing:top", "detached sleeves": "clothing:accents",
  }
  const general = ["2girls", "twintails", "aqua hair", "blonde hair", "short hair", "hair ribbon", "aqua eyes", "blue eyes", "detached sleeves", "necktie", "sailor collar", "shorts", "skirt", "smile"]
  const input = { general, characters: ["hatsune_miku", "kagamine_rin"], copyrights: ["vocaloid"] }

  const scene = buildScene(input, vocab, { traits })
  const owned = (name: string) => Object.values(scene.assigned.find((a) => a.character.name === name)?.slots ?? {}).flat()
  assert(["twintails", "aqua hair", "aqua eyes", "necktie", "skirt"].every((t) => owned("Hatsune Miku").includes(t)), "Miku gets twintails, aqua hair and eyes, necktie, skirt")
  assert(["blonde hair", "short hair", "hair ribbon", "blue eyes", "sailor collar", "shorts"].every((t) => owned("Kagamine Rin").includes(t)), "Rin gets blonde short hair, ribbon, blue eyes, sailor collar, shorts")
  assert(scene.slots.accents?.includes("detached sleeves") ?? false, "a trait both share stays shared")
  assert(sceneTagCount(scene) + scene.dropped.length === new Set(general).size, "attribution moves tags, it does not lose them")

  const flux = renderFlux2(scene, { maxWords: null }).text
  assert(/Hatsune Miku has [^.]*aqua hair[^.]*, and wears [^.]*necktie/.test(flux), "Miku gets her own sentence")
  assert(/Kagamine Rin has [^.]*blonde hair/.test(flux) && !/with [^.]*aqua[^.]*blonde/.test(flux), "Rin gets her own sentence; hair colours are no longer merged")
  assert(renderAnima(scene).text.includes("Hatsune Miku has"), "Anima prose describes each character too")

  const cosplay = buildScene({ ...input, general: [...general, "cosplay"] }, vocab, { traits })
  assert(!Object.values(cosplay.assigned.find((a) => a.character.name === "Hatsune Miku")?.slots ?? {}).flat().includes("necktie"), "on costume posts only hair, eyes and body are attributed")
  assert(buildScene(input, vocab).assigned.length === 0, "without profiles nothing is attributed")
}

// 11. One character under several names (Rule34), placeholder names.
{
  const names = (characters: string[], general: string[], characterAliases?: Record<string, string>) =>
    buildScene({ general, characters }, overrides, { characterAliases }).characters.map((c) => c.name)
  const aliased = names(["kasumi (pokemon)", "misty (pokemon)"], ["1girl"], { "kasumi (pokemon)": "misty (pokemon)", "misty (pokemon)": "misty (pokemon)" })
  assert(aliased.join() === "Misty", "names the alias map joins are one person, under the canonical tag")
  assert(names(["kitagawa marin", "marin kitagawa"], ["1girl"]).length === 1, "swapped given and family name is one person")
  assert(names(["gotoh naoki", "gotou naoki"], ["1girl"]).length === 1, "romanisation variants are one person")
  assert(names(["marceline", "marceline the vampire queen"], ["1girl"]).join() === "Marceline", "a longer form of the same name is one person")
  assert(names(["jeanne d'arc", "jeanne d'arc alter"], ["2girls"]).length === 2, "similar names stay apart when the post has that many people")
  assert(names(["kitagawa marin", "marin kitagawa"], []).length === 2, "without a people count only the alias map merges")
  assert(names(["anonymous male", "background character", "kitagawa marin"], ["1girl", "1boy"]).join() === "Kitagawa Marin", "placeholder names are not characters")

  const vampire = buildScene({ general: ["1girl", "grey-skinned girl", "vampire girl", "busty girl"], characters: ["marceline abadeer"] }, { ...overrides, "grey-skinned girl": "appearance:anatomy", "vampire girl": "appearance:anatomy", "busty girl": "appearance:anatomy" })
  assert(renderFlux2(vampire).text.includes("Marceline Abadeer, a grey-skinned, busty vampire girl"), "one person's species tags make one noun")
  assert(normalizeTag("grabbing_another&#039;s_breast") === "grabbing another's breast", "HTML entities in Rule34 tags are decoded")
}

// 12. Gender per character: sexual anatomy stays shared, gendered traits and possessives follow it.
{
  // Danbooru related-tag shares (rounded): his posts carry her breasts and nipples.
  const traits = {
    "gojou wakana": { "solo 1girl": 0.51, "solo 1boy": 0.49, "1girl": 0.845, "1boy": 0.818, breasts: 0.64, "large breasts": 0.398, nipples: 0.289, penis: 0.286, pussy: 0.177, collarbone: 0.135, "black hair": 0.8 },
    "kitagawa marin": { "solo 1girl": 1, "solo 1boy": 0, "1girl": 0.93, "1boy": 0.21, breasts: 0.805, "large breasts": 0.502, collarbone: 0.233, nipples: 0.166, penis: 0.117, "blonde hair": 0.9 },
  }
  const vocab: Record<string, string> = { ...overrides, penis: "appearance:anatomy", pussy: "appearance:anatomy", nipples: "appearance:anatomy", "large breasts": "appearance:anatomy", collarbone: "appearance:anatomy", "blonde hair": "appearance:hair", "black hair": "appearance:hair" }
  const general = ["1girl", "1boy", "penis", "pussy", "nipples", "large breasts", "collarbone", "blonde hair", "black hair"]
  const scene = buildScene({ general, characters: ["gojou wakana", "kitagawa marin"] }, vocab, { traits })
  const owned = (name: string) => Object.values(scene.assigned.find((a) => a.character.name === name)?.slots ?? {}).flat()
  assert(scene.characters.map((c) => c.gender).join() === "male,female", "with everyone named, the higher 1boy share is the boy")
  // His profile carries "nipples" and "pussy" from the women he is drawn with: only gender decides these.
  assert(owned("Gojou Wakana").includes("penis") && owned("Kitagawa Marin").includes("pussy") && !owned("Gojou Wakana").includes("pussy"), "sexual anatomy goes by gender, not by the characters' profiles")
  assert(owned("Kitagawa Marin").includes("large breasts") && !owned("Gojou Wakana").includes("large breasts"), "breast tags cannot go to a male character")
  const phrases = { collarbone: { kind: "has" as const, text: "{pos} collarbones visible" } }
  const flux = renderFlux2(scene, { phrases, maxWords: null }).text
  assert(/Kitagawa Marin has [^.]*her collarbones visible/.test(flux) && !/their collarbones/.test(flux), "a character's own sentence uses her possessive in a mixed scene")
  const crowd = buildScene({ general: ["1girl", "2boys"], characters: ["gojou wakana", "kitagawa marin"] }, vocab, { traits })
  assert(crowd.characters.map((c) => c.gender).join() === "male,female", "with someone unnamed, clear 1boy/1girl ratios still decide")
  assert(buildScene({ general: ["1girl", "1boy"], characters: ["fujimaru ritsuka (male)", "kitagawa marin"] }, vocab).characters[0].gender === "male", "a (male) qualifier decides without a profile")

  // Without solo posts, all-post shares mostly measure the partner: a girl always drawn with the boy looks male.
  const noSolo = { "nagiha": { "1girl": 0.619, "1boy": 0.952, "large breasts": 0.5 }, "ashihara seiji": { "1girl": 0.778, "1boy": 0.889 } }
  const unsure = buildScene({ general: ["1girl", "1boy", "large breasts"], characters: ["nagiha", "ashihara seiji"] }, vocab, { traits: noSolo })
  assert(unsure.characters.every((c) => !c.gender), "unclear all-post shares leave the gender unknown")
  assert(unsure.assigned.some((a) => a.character.name === "Nagiha"), "an unknown gender does not block a trait")
  const twoMen = { a: { "solo 1boy": 1, breasts: 0.5 }, b: { "solo 1boy": 1, breasts: 0.3 } }
  assert(buildScene({ general: ["2boys", "large breasts"], characters: ["a", "b"] }, vocab, { traits: twoMen }).assigned.length === 0, "a female-only trait with no woman to own it stays shared")
}

// 13. Cleaned-prompt input: the site merges one noun's adjectives ("blue long hair").
{
  assert(splitHairCompound("blue long hair")?.join() === "blue hair,long hair", "a merged hair tag splits back into its tags")
  assert(splitHairCompound("very long light blue hair")?.join() === "very long hair,light blue hair", "two-word lengths and colours stay whole")
  assert(splitHairCompound("long hair") === null && splitHairCompound("hair over one eye") === null && splitHairCompound("blue hair ornament hair") === null, "plain or non-trait hair tags are left alone")
  const vocab = { ...overrides, "brown eyes": "appearance:eyes", "colored skin": "appearance:anatomy", "grey skin": "appearance:anatomy", "pointy ears": "appearance:anatomy" }
  const text = renderFlux2(buildScene({ general: ["1boy", "blue long hair", "brown eyes", "colored skin", "grey skin", "pointy ears"] }, vocab), { maxWords: null }).text
  assert(text.includes("long blue hair") && !text.includes("blue long hair"), "merged hair reads as length then colour")
  assert(text.includes("grey skin") && !text.includes("colored skin"), "a specific skin colour makes colored skin redundant")
  assert(dropImplied(["colored skin", "dark skin"]).includes("colored skin"), "a natural skin tone does not replace colored skin")
}

// 14. Things said twice, which a model may draw twice.
{
  const vocab: Record<string, string> = {
    ...overrides,
    "holding umbrella": "equipment:handheld", parasol: "equipment:handheld", "umbrella over shoulder": "equipment:handheld",
    "holding knife": "equipment:weapon", weapon: "equipment:weapon", "holding gun": "equipment:weapon", handgun: "equipment:weapon",
    "buster sword": "equipment:weapon", "sword on back": "equipment:weapon", "weapon on back": "equipment:weapon",
    watch: "clothing:accents", wristwatch: "clothing:accents", "lily (flower)": "scenery:props",
    "husband and wife": "appearance:demographics",
  }
  const flux = (general: string[], extra: Partial<Parameters<typeof buildScene>[0]> = {}, phrases = {}) =>
    renderFlux2(buildScene({ general, ...extra }, vocab), { maxWords: null, phrases }).text

  const umbrella = flux(["1girl", "holding umbrella", "parasol", "umbrella over shoulder"])
  assert(umbrella.includes("holding a parasol over her shoulder") && !/has [^.]*(parasol|umbrella)/.test(umbrella), "one umbrella: the kind is held, the placement joins it")
  assert(!flux(["1girl", "holding knife", "weapon"]).includes("weapon"), "a held knife makes the generic weapon redundant")
  const gun = flux(["2girls", "holding gun", "weapon", "handgun"])
  assert(gun.includes("holding a handgun") && !/\ba gun\b|weapon/.test(gun), "a held gun takes the specific kind, and the generic weapon goes")
  const sword = flux(["1boy", "buster sword", "sword on back", "weapon on back"])
  assert(sword.includes("a buster sword on his back") && !sword.includes("weapon"), "a placement joins the item it describes")
  assert(!/\ba watch\b/.test(flux(["1girl", "watch", "wristwatch"])), "a wristwatch is the watch")
  assert(flux(["1girl", "lily (flower)", "outdoors"]).includes("a lily") && !flux(["1girl", "lily (flower)"]).includes("(flower)"), "a tag's qualifier stays out of the sentence")

  const touhou = buildScene({ general: ["1girl"], characters: ["kazami yuuka"], copyrights: ["touhou", "touhou (pc-98)"] }, vocab)
  assert(touhou.series.join() === "Touhou", "a series and its qualified variant are one series")
  assert(titleCase("final fantasy vii remake") === "Final Fantasy VII Remake" && titleCase("spy x family") === "Spy x Family", "Roman numerals are upper case; x between words is not")

  const married = flux(["1girl", "1boy", "husband and wife", "couple"])
  assert(married.includes("They are husband and wife.") && !married.includes("a couple"), "relations read as relations, and husband and wife already says couple")
  assert(!married.includes("One of them") && !married.includes("Additional details"), "a relation is neither one person's role nor a raw tag")
  assert(flux(["1girl", "1boy", "couple"]).includes("They are a couple."), "an unclassified couple still reads as a relation")

  const kiss = mergeSharedPrefix(["kissing another person's hair", "kissing another person's head", "blushing"])
  assert(kiss.join("|") === "kissing another person's hair and head|blushing", "phrases that differ only in the last word are said once")
  assert(withArticle("arms around another's back") === "arms around another's back", "no article before a plural body part")
}

// 15. The phrase dictionary has nothing for content involving minors (same terms as the data export filter).
{
  const dictionary: Record<string, { text: string }> = JSON.parse(readFileSync(path.join(__dirname, "../public/natural-prompt-phrases.json"), "utf8"))
  const MINORS = /\b(loli|lolicon|shota|shotacon|child|children|toddlers?|kindergarten|aged down|young|underage|baby|babies|infant|cub|elementary|teens?|teenage|teenaged|teenagers?|preteens?|little (girl|boy|sister|brother)s?|school ?(girl|boy)s?|high school students?|diapers?|newborns?)\b/
  const leaks = Object.entries(dictionary).filter(([tag, entry]) => MINORS.test(tag.replace(/_/g, " ")) || MINORS.test(entry.text))
  assert(leaks.length === 0, `no phrase for content involving minors (found: ${leaks.slice(0, 5).map(([t]) => t).join(", ")})`)
}

// 16. Wording the generic rules got wrong ("She has an aged up", "a goggles on head").
{
  const vocab: Record<string, string> = {
    "goggles on head": "clothing:eyewear", "eyewear on head": "clothing:eyewear", dress: "clothing:outfit",
    "gothic lolita": "clothing:outfit", "lolita fashion": "clothing:outfit",
    "aged up": "appearance:demographics", priest: "appearance:demographics", genderswap: "appearance:demographics",
    erune: "appearance:demographics", "no humans": "appearance:demographics",
    ass: "appearance:anatomy", feet: "appearance:anatomy", "dark-skinned female": "appearance:anatomy", "dark skin": "appearance:anatomy",
    "holding weapon": "equipment:weapon", "beam rifle": "equipment:weapon",
  }
  const flux = (general: string[], extra: Partial<Parameters<typeof buildScene>[0]> = {}) =>
    renderFlux2(buildScene({ general, ...extra }, vocab), { maxWords: null }).text

  assert(flux(["1girl", "goggles on head"]).includes("She wears goggles on her head."), "a garment worn somewhere says where, with the possessive")
  assert(flux(["1girl", "eyewear on head"]).includes("eyewear on her head") && !flux(["1girl", "eyewear on head"]).includes("an eyewear"), "no article before a mass noun worn somewhere")
  const lolita = flux(["1girl", "dress", "gothic lolita", "lolita fashion"])
  assert(lolita.includes("a gothic lolita outfit") && !lolita.includes("lolita fashion"), "a fashion style is an outfit, and the specific style implies the generic one")

  const aged = flux(["1girl", "aged up"])
  assert(aged.includes("She is drawn older than usual.") && !/has an? aged/.test(aged), "aged up says how the subject is drawn")
  const priest = flux(["1girl", "priest", "genderswap"])
  assert(priest.includes("She is a priest.") && priest.includes("Additional details: genderswap") && !/has an? /.test(priest), "a kind of person is what the subject is; other demographic tags stay raw")
  assert(flux(["2girls", "erune"]).includes("One of them is an erune."), "with several people a kind of person is one of them")

  assert(flux(["1girl", "ass"]).includes("Her ass is visible."), "a singular body part ending in s takes is")
  assert(flux(["1girl", "feet"]).includes("Her feet are visible."), "an irregular plural takes are")
  const skin = flux(["1girl", "dark-skinned female", "dark skin"])
  assert(skin.includes("dark-skinned") && !skin.includes("dark skin."), "dark-skinned female already says dark skin")

  const robot = flux(["solo", "no humans", "holding weapon", "beam rifle"], { characters: ["gundam zirius"] })
  assert(robot.includes("It is holding a beam rifle.") && !/\bShe\b/.test(robot), "one named character with no humans is it")
}

// 17. Several people: a shared "They have breasts and a large penis" gives both to everyone.
{
  const vocab: Record<string, string> = {
    "large breasts": "appearance:anatomy", "large penis": "appearance:anatomy", penis: "appearance:anatomy",
    "dark-skinned female": "appearance:anatomy", "muscular male": "appearance:anatomy", "smaller female": "appearance:anatomy",
    "bigger female": "appearance:anatomy", "clothed female nude male": "appearance:anatomy", "futa with female": "appearance:demographics",
    bikini: "clothing:underwear", dress: "clothing:outfit", crossdressing: "clothing:outfit",
    "long hair": "appearance:hair", "short hair": "appearance:hair", "brown hair": "appearance:hair", "purple hair": "appearance:hair",
    twintails: "appearance:hair", cunnilingus: "pose:interaction", "male penetrated": "pose:interaction",
  }
  // Fixed gender profiles, so the test does not move when the bundled ones are regenerated.
  const genderAffinity = { "long hair": [0.59, 0.2, 0.52, 0.15], "short hair": [0.16, 0.48, 0.14, 0.27] } as const
  const phrases = { cunnilingus: { kind: "is" as const, text: "performing oral sex on a woman" }, "male penetrated": { kind: "is" as const, text: "being penetrated by a man" } }
  const scene = (general: string[], extra: Partial<Parameters<typeof buildScene>[0]> = {}, options: Parameters<typeof buildScene>[2] = {}) =>
    buildScene({ general, ...extra }, vocab, { genderAffinity, ...options })
  const flux = (...args: Parameters<typeof scene>) => renderFlux2(scene(...args), { phrases, maxWords: null }).text

  const couple = flux(["1girl", "1boy", "large breasts", "large penis", "dark-skinned female", "muscular male", "bikini"], { rating: "e" })
  assert(couple.includes("The woman is dark-skinned, has large breasts, and wears a bikini.") && couple.includes("The man is muscular, and has a large penis."), "each person's traits go to that person")
  assert(!/\bThey (have|are|wear)\b/.test(couple), "nothing only one of them has is said of both")
  assert(couple.startsWith("An anime-style illustration of a woman and a man."), "an explicit post names a woman and a man")
  assert(flux(["1girl", "1boy"], { rating: "g" }).includes("of a girl and a boy"), "a general post keeps the booru's girl and boy")

  const hair = scene(["1girl", "1boy", "long hair", "short hair"], { rating: "g" })
  const ownedBy = (s: ReturnType<typeof scene>, name: string) => Object.values(s.assigned.find((a) => a.character.name === name)?.slots ?? {}).flat()
  assert(ownedBy(hair, "the girl").includes("long hair") && ownedBy(hair, "the boy").includes("short hair"), "the gender profiles decide what tends to be one gender's")
  const traits = { sesshoumaru: { "solo 1boy": 1, "solo 1girl": 0, "long hair": 0.9 } }
  const named = scene(["1girl", "1boy", "long hair"], { rating: "g", characters: ["sesshoumaru"] }, { traits })
  assert(!ownedBy(named, "the girl").includes("long hair"), "a tendency of women does not take a named man's own trait")

  const three = flux(["3girls", "smaller female", "bigger female", "dark-skinned female"], { rating: "e" })
  assert(three.includes("One of the women is smaller and dark-skinned, and another is bigger."), "gendered tags among several women describe one of them, opposites another")
  const cfnm = flux(["1girl", "1boy", "clothed female nude male"], { rating: "e" })
  assert(cfnm.includes("The woman is clothed.") && cfnm.includes("The man is nude."), "clothed female nude male gives each person a state")

  const futa = flux(["futa with female", "penis", "large breasts"], { rating: "e" })
  assert(futa.includes("two women") && futa.includes("The futanari's penis is visible.") && !futa.includes("futa with"), "a pairing counts people and its futanari owns the penis")
  const dressed = scene(["1girl", "1boy", "dress", "crossdressing"], { rating: "g" })
  assert(dressed.assigned.length === 0, "with crossdressing, a dress has no owner by gender")

  assert(flux(["1girl", "1boy", "cunnilingus"], { rating: "e" }).includes("The man is performing oral sex on the woman."), "an act that names a woman gets the man as its subject")
  assert(flux(["2girls", "cunnilingus"]).includes("One of the girls is performing oral sex on the other."), "between two women the object is the other")
  const alone = flux(["1boy", "solo", "male penetrated"], { rating: "e" })
  assert(alone.includes("He is being penetrated.") && !alone.includes("by a man"), "a penetrated man alone is not given a second man")

  const marin = { "kitagawa marin": { "solo 1girl": 1, "solo 1boy": 0 } }
  const partner = flux(["1girl", "1boy", "large penis"], { rating: "e", characters: ["kitagawa marin"] }, { traits: marin })
  assert(partner.includes("of Kitagawa Marin and a man") && partner.includes("The man has a large penis."), "the unnamed partner is named in the opening and owns his traits")
  const unknown = scene(["1girl", "1boy", "large breasts", "large penis"], { rating: "e", characters: ["takane (blue archive)"] })
  assert(ownedBy(unknown, "the woman").includes("large breasts") && ownedBy(unknown, "the man").includes("large penis"), "with a named character of unknown gender, stand-ins still take what gender decides")
  const girls = { a: { "solo 1girl": 1 }, b: { "solo 1girl": 1 }, c: { "solo 1boy": 1 } }
  const group = flux(["2girls", "1boy", "large breasts"], { characters: ["a", "b", "c"] }, { traits: girls })
  assert(group.includes("The girls have large breasts.") && !group.includes("They have"), "what several named girls share by gender is said of the girls, not of everyone")

  const pair = { sandrone: { "solo 1girl": 1, "brown hair": 0.9 }, columbina: { "solo 1girl": 1, twintails: 0.5 } }
  const leftover = scene(["2girls", "brown hair", "purple hair"], { characters: ["sandrone", "columbina"] }, { traits: pair })
  assert(ownedBy(leftover, "Columbina").includes("purple hair") && !(leftover.slots.hair ?? []).includes("purple hair"), "with two people, the colour one does not own is the other's")
  assert(flux(["2girls", "long hair", "short hair", "purple hair"]).includes("long and short hair"), "two lengths in a group are two people's")
  const lynae = { lynae: { "solo 1girl": 1, "blonde hair": 0.8 } }
  const withMan = scene(["1girl", "1boy", "blonde hair", "green hair"], { rating: "e", characters: ["lynae"] }, { traits: lynae })
  assert(!ownedBy(withMan, "the man").includes("green hair"), "an unnamed partner does not take the colours a named character leaves")

  // A pose sentence too long for the budget is cut to its first actions, not lost.
  const busy = renderFlux2(buildScene({ general: ["1girl", "sitting", "dancing", "jumping", "running", "crossed arms"] }, vocab), { maxWords: 12 }).text
  assert(busy.includes("She is sitting and dancing."), "a long pose keeps its first actions within the budget")
}

console.log(`${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
