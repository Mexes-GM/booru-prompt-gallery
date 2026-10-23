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
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/natural-prompt.verify.ts
 */
import { buildScene, normalizeTag, sceneTagCount, renderAnima, renderFlux2, titleCase } from "../lib/prompt/natural"
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

console.log(`${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
