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
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/natural-prompt.verify.ts
 */
import { buildScene, normalizeTag, sceneTagCount, renderAnima, renderFlux2, splitPromptTags, titleCase } from "../lib/prompt/natural"
import { dropImplied } from "../lib/prompt/natural/english"

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
  assert(flux.includes("They are curvy and mature."), "gendered tags become adjectives, without repeating the hair colour")
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

  const phrases = { "oral sex": { kind: "is" as const, text: "performing oral sex" }, "fellatio deep": { kind: "is" as const, text: "performing oral sex on a penis" } }
  const repeated = buildScene({ general: ["1girl", "oral sex", "fellatio deep"] }, { ...overrides, "oral sex": "pose:physiological", "fellatio deep": "pose:physiological" })
  const text = renderFlux2(repeated, { phrases }).text
  assert(text.includes("performing oral sex on a penis") && !/performing oral sex(,| and)/.test(text), "a phrase contained in another is dropped")
}

console.log(`${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
