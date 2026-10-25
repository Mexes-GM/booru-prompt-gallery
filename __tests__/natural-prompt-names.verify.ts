/**
 * Tests for names and series in the tags -> natural language converter
 * (lib/prompt/natural/scene.ts, lib/prompt/natural-format.ts), and for the
 * artist field the card cleaner removes from the prompt (lib/cleanPrompt.ts).
 *
 * Covers:
 *   1. Title case: letters of a title, honorifics.
 *   2. Series: words that are no franchise, the costume's own series.
 *   3. Names read from the post: "name (series)" tags, kinds and categories
 *      typed as characters, other spellings and pieces of a name.
 *   4. One person per name: certain merges, merges by gender, mascots,
 *      more names than people.
 *   5. Character tags for tag renderers: spellings merged away, costume variants kept.
 *   6. The card cleaner removes every artist of a space-separated artist field.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/natural-prompt-names.verify.ts
 */
import { cleanPrompt } from "../lib/cleanPrompt"
import { buildScene, renderAnima, renderFlux2, resolveNames, titleCase, type CharacterTraits, type NaturalPromptInput } from "../lib/prompt/natural"
import { formatPrompt, naturalPromptInput, unclassifiedTags } from "../lib/prompt/natural-format"

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
  "red hair": "appearance:hair",
  "white hair": "appearance:hair",
  "purple eyes": "appearance:eyes",
  breasts: "appearance:anatomy",
  smile: "pose:expression",
  "gold (metal)": "scenery:props",
  black: "appearance:hair",
  bingbingzi: "other:artist",
}
const female = { "solo 1girl": 1, "solo 1boy": 0 }
const male = { "solo 1girl": 0, "solo 1boy": 1 }
const names = (input: NaturalPromptInput, traits: CharacterTraits = {}, characterAliases: Record<string, string> = {}) =>
  buildScene(input, overrides, { traits, characterAliases }).characters.map((c) => c.name)

// 1. Title case.
{
  assert(titleCase("pokemon x and y") === "Pokemon X and Y", "the letters of 'pokemon x and y' are capitals")
  assert(titleCase("spy x family") === "Spy x Family" && titleCase("hunter x hunter") === "Hunter x Hunter", "'x' joining two titles stays lowercase")
  assert(titleCase("mega man x") === "Mega Man X", "a final 'x' is a letter of the title")
  assert(titleCase("dan'in-san") === "Dan'in-san" && titleCase("kobayashi-chan") === "Kobayashi-chan", "honorifics stay lowercase after their hyphen")
  assert(titleCase("jean-luc picard") === "Jean-Luc Picard", "other hyphenated names keep their capitals")
}

// 2. Series.
{
  const noise = buildScene({ general: ["1girl"], characters: ["hyuuga hinata"], copyrights: ["naruto", "under", "series"] }, overrides)
  assert(noise.series.join() === "Naruto" && !noise.copyrightTags.includes("under"), "Rule34's 'under' and 'series' copyrights are no series")
  const indie = buildScene({ general: ["1girl"], characters: ["panky"], copyrights: ["indie virtual youtuber"] }, overrides)
  assert(indie.series.length === 0, "'indie virtual youtuber' is no franchise to come from")
  assert(renderAnima(indie).text.includes("indie virtual youtuber"), "but it stays a tag for Anima")

  const cosplay = buildScene({
    general: ["1girl", "solo", "cosplay", "mash kyrielight (dangerous beast) (cosplay)"],
    characters: ["gentildonna (umamusume)", "mash kyrielight", "mash kyrielight (dangerous beast)"],
    copyrights: ["fate/grand order", "fate (series)", "umamusume"],
  }, overrides)
  const flux = renderFlux2(cosplay, { maxWords: null }).text
  assert(flux.includes("Gentildonna from Umamusume") && flux.includes("cosplaying as Mash Kyrielight from Fate/Grand Order"), "the costume's series goes with the costume")

  // The taxonomy files some general tags as copyrights ("twitter logo"); a Danbooru card's series come from its own field.
  const misfiled = { ...overrides, "twitter logo": "other:copyright", "copyright logo": "other:copyright", "blue archive": "other:copyright" }
  const card = { prompt: "1girl, aris (blue archive), twitter logo, copyright logo, smile", characters: "aris_(blue_archive)", copyrights: "blue_archive" }
  const danbooru = naturalPromptInput({ ...card, provider: "danbooru" }, misfiled)
  assert(danbooru.copyrights?.join() === "blue_archive" && danbooru.general.includes("twitter logo"), "a typed booru's series are its own field")
  const scene = buildScene(danbooru, misfiled)
  assert(scene.series.join() === "Blue Archive" && scene.unclassified.includes("twitter logo") && scene.dropped.includes("copyright logo"), "a misfiled logo is content to keep, a copyright logo text is dropped")
  const pasted = naturalPromptInput({ prompt: "1girl, aris (blue archive), blue archive, smile" }, misfiled)
  assert(pasted.copyrights?.join() === "blue archive", "a pasted prompt still gets its series from the taxonomy")
}

// 3. Names read from the post.
{
  const fortnite = resolveNames({ general: ["2girls", "sugar (fortnite)", "gold (metal)", "mystery (thing)"], characters: ["spice (fortnite)"], copyrights: ["fortnite"] }, overrides)
  assert(fortnite.characters?.includes("sugar (fortnite)") === true, "an unknown tag qualified by the post's series is a character")
  assert(fortnite.general.includes("gold (metal)") && fortnite.general.includes("mystery (thing)"), "other qualified tags stay general")
  const edgerunners = resolveNames({ general: ["1girl", "capri (edgerunners)"], characters: [], copyrights: ["cyberpunk: edgerunners"] }, overrides)
  assert(edgerunners.characters?.join() === "capri (edgerunners)", "a qualifier can be the last part of the series name")
  const oc = resolveNames({ general: ["1girl", "robot commander (bingbingzi)"], characters: [], copyrights: [] }, overrides)
  assert(oc.characters?.join() === "robot commander (bingbingzi)", "a tag qualified by an artist is that artist's original character")

  const kinds = resolveNames({ general: ["1girl", "1boy"], characters: ["generation 5 pokemon", "pokemon (species)", "zoroark", "pokemon trainer"], copyrights: ["pokemon"] }, overrides)
  assert(kinds.characters?.join() === "zoroark,pokemon trainer", "a kind or a category of the series is no character")
  assert(kinds.general.includes("generation 5 pokemon") && kinds.general.includes("pokemon (species)"), "and it stays as a general tag")

  const spellings = resolveNames({ general: ["1girl", "retsu unohana", "hyuuga", "black"], characters: ["unohana retsu", "hyuuga hinata", "black hanekawa"] }, overrides)
  assert(!spellings.general.includes("retsu unohana") && !spellings.general.includes("hyuuga"), "another spelling or a piece of a character's name goes")
  assert(spellings.general.includes("black"), "a known tag is never taken for a piece of a name")

  // The web's path: Rule34 leaves "sugar_(fortnite)" among the general tags.
  const source = { prompt: "2girls, spice (fortnite), sugar (fortnite), fortnite, smile", characters: "spice_(fortnite)", copyrights: "fortnite" }
  const input = naturalPromptInput({ ...source, provider: "rule34" }, overrides)
  assert(formatPrompt("flux2", input, overrides).text.includes("Spice and Sugar from Fortnite"), "both characters are named")
  assert(unclassifiedTags(input, overrides).includes("sugar (fortnite)"), "a name read from a general tag is still looked up")
  const item = { ...overrides, "sugar (fortnite)": "equipment:handheld" }
  assert(!naturalPromptInput({ ...source, provider: "rule34" }, item).characters?.includes("sugar (fortnite)"), "once the taxonomy files it as something else, it is that")
  assert(!naturalPromptInput({ ...source, provider: "danbooru" }, overrides).characters?.includes("sugar (fortnite)"), "a booru with its own character field is trusted: its general tags are no names")
}

// 4. One person per name.
{
  const hinata = { general: ["1girl", "1boy"], characters: ["hyuuga hinata", "uzumaki hinata", "hinata hyuuga", "hinata"] }
  const traits = { "hyuuga hinata": female, "uzumaki hinata": female }
  assert(names(hinata, traits, { "hyuuga hinata": "hyuuga hinata" }).join() === "Hyuuga Hinata", "one woman's several names in a '1girl, 1boy' post are one person")
  assert(names({ general: ["2girls"], characters: ["hyuuga hinata", "uzumaki hinata"] }, traits).length === 2, "with two women the names stay two people")

  const solo = { general: ["1girl", "solo", "red hair"], characters: ["laevatain (arknights)", "surtr (arknights)"] }
  const surtr = buildScene(solo, overrides, { traits: { "surtr (arknights)": { ...female, "red hair": 0.9 } } })
  assert(surtr.characters.map((c) => c.name).join() === "Surtr", "a solo picture names one person: the one with a profile")
  assert(surtr.characterTags.join() === "laevatain (arknights),surtr (arknights)", "Anima keeps every character tag")
  assert(names({ general: ["1girl", "solo"], characters: ["closure (arknights)", "lambda (arknights)"] }).join() === "Closure", "without profiles the first name is kept")
  assert(names({ general: ["1girl"], characters: ["kronie (ouro kronii)", "ouro kronii"] }, { "kronie (ouro kronii)": female, "ouro kronii": female }).join() === "Ouro Kronii", "a mascot named after another character is not the person")

  const omori = { general: ["1girl", "1boy"], characters: ["aubrey (omori)", "mr. plantegg", "omori (omori)"] }
  assert(names(omori, { "aubrey (omori)": female, "omori (omori)": male }).join() === "Aubrey,Omori", "known women and men fill the places; an unknown extra name goes")
  assert(names({ general: ["2girls"], characters: ["irritable ghost (deltarune)", "mad mew mew", "pink (deltarune)"] }).length === 3, "when nothing tells who is extra, every name stays")
  assert(names({ general: ["1girl", "multiple boys"], characters: ["a", "b", "c"] }).length === 3, "a lower-bound count trims nothing")
  assert(names({ general: ["1girl", "cosplay"], characters: ["aozaki aoko", "mash kyrielight"] }).length === 2, "a cosplay post without 'x (cosplay)' trims nothing")
}

// 5. Character tags for tag renderers.
{
  const fallout = buildScene({ general: ["1girl"], characters: ["assaultron", "assaultron (fallout)"], copyrights: ["fallout"] }, overrides)
  assert(fallout.characterTags.join() === "assaultron (fallout)", "a bare tag next to the same name qualified by the series goes")
  const touhou = buildScene({ general: ["1girl"], characters: ["kazami yuuka", "kazami yuuka (pc-98)"], copyrights: ["touhou"] }, overrides)
  assert(touhou.characterTags.length === 2, "a costume variant and the tag it varies both stay")
  const bleach = buildScene({ general: ["1girl", "1boy"], characters: ["ichigo kurosaki", "kurosaki ichigo", "unohana retsu"] }, overrides, { characterAliases: { "ichigo kurosaki": "kurosaki ichigo" } })
  assert(bleach.characterTags.join() === "kurosaki ichigo,unohana retsu", "a spelling merged into another person goes")
}

// 6. The artist field.
{
  const BASE_OPTS = { optimizeTags: true, includeCharacters: true, includeCopyrights: true, escapeOutput: false }
  const out = cleanPrompt("1girl, solo, oniiyanna, oniyanna, smile", "oniiyanna oniyanna", "", "", BASE_OPTS)
  assert(!out.includes("oniiyanna") && !out.includes("oniyanna"), "every artist of a space-separated field is removed")
  assert(!cleanPrompt("1girl, wlop", "wlop", "", "", BASE_OPTS).includes("wlop"), "a single artist is removed as before")
  assert(!cleanPrompt("1girl, smile, a b", "a b, c", "", "", BASE_OPTS).includes("a b"), "a comma-separated artist list keeps its multi-word names")
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
