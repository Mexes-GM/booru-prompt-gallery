/**
 * Tests for tags the taxonomy leaves without a slot (lib/prompt/natural).
 *
 * Covers:
 *   1. Count tags in other boorus' spellings ("3girls1boy", "duo") are subject information.
 *   2. A tag with no slot goes where its dictionary phrase reads: the phrase's kind picks
 *      the sentence, the slot the phrase pass gave it picks among that sentence's slots.
 *   3. Places, objects, creatures and layout items read the dictionary's noun phrase.
 *   4. The taxonomy's slot wins over the dictionary's.
 *   5. A tag with neither a slot nor a phrase is still written verbatim, and no tag is lost.
 *   6. The card's path (formatPrompt) places tags through the dictionary.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/natural-prompt-unplaced.verify.ts
 */
import { buildScene, normalizeTag, peopleCount, renderAnima, renderFlux2, renderMoss, sceneTagCount, type PhraseDictionary } from "../lib/prompt/natural"
import { formatPrompt } from "../lib/prompt/natural-format"
import { escapeTag } from "../lib/prompt/natural/renderers"

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
  "school uniform": "clothing:outfit",
  sitting: "pose:posture",
  "having sex": "pose:interaction",
  "warm lighting": "scenery:atmosphere",
}

// Entries as the phrase pass writes them for tags the taxonomy has no slot for.
const phrases: PhraseDictionary = {
  makeup: { kind: "wears", text: "makeup", slot: "clothing:accents" },
  "floral print": { kind: "with", text: "a floral print on {pos} clothes", slot: "clothing:accents" },
  "girl on top": { kind: "with", text: "the woman on top", slot: "pose:interaction" },
  "star (symbol)": { kind: "scene", text: "a star symbol", slot: "other:layout" },
  "stuffed animal": { kind: "scene", text: "a stuffed animal", slot: "scenery:props" },
  public: { kind: "scene", text: "a public place", slot: "scenery:setting" },
  mammal: { kind: "scene", text: "a furry mammal", slot: "creature:animal" },
  "suction cup dildo": { kind: "scene", text: "a suction cup dildo", slot: "equipment:handheld" },
  // A kind that does not fit the slot: the kind wins ("a robot" is what she is).
  robot: { kind: "is", text: "a robot", slot: "creature:animal" },
  "shaded face": { kind: "with", text: "{pos} face partly in shadow", slot: "appearance:hair" },
  "male pov": { kind: "framing", text: "a first-person view from a man's perspective", slot: "pose:camera" },
  "seductive look": { kind: "is", text: "giving a seductive look", slot: "pose:camera" },
  // A slot that is not in the taxonomy is ignored.
  "white topwear": { kind: "wears", text: "a white top", slot: "clothing:topwear" },
  // An older entry, without a slot.
  "tied up": { kind: "is", text: "tied up with rope" },
}

const flux = (general: string[], extra: Partial<Parameters<typeof buildScene>[0]> = {}, vocab = overrides) =>
  renderFlux2(buildScene({ general, ...extra }, vocab, { phrases }), { maxWords: null, phrases }).text

// 1. Count tags.
{
  const group = buildScene({ general: ["3girls1boy", "duo", "trio", "multiple females"] }, overrides)
  assert(group.girls === 3 && group.boys === 1, "3girls1boy counts three girls and a boy")
  assert(group.subjectTags.length === 4 && group.unclassified.length === 0, "duo, trio and multiple females are subject information")
  assert(!flux(["2girls", "duo"]).includes("Additional details"), "duo is not a raw detail")
  const pair = buildScene({ general: ["1girl", "1boy", "duo"] }, overrides)
  assert(pair.girls + pair.boys + pair.others === 2, "a group tag is a floor, not more people")
  const named = buildScene({ general: ["duo", "female"], characters: ["ankha (animal crossing)"] }, overrides)
  assert(named.others === 2 && flux(["duo", "female", "sitting"], { characters: ["ankha (animal crossing)"] }).includes("They are sitting"), "duo says two people are there, even with one name")
  assert(peopleCount(["1girl", "duo"]) === 2 && peopleCount(["trio", "2girls"]) === 3, "the people count reads group tags too")
}

// 2. Placement by phrase.
{
  const scene = buildScene({ general: ["1girl", "makeup", "floral print", "girl on top", "robot", "shaded face", "male pov", "seductive look", "white topwear", "tied up"] }, overrides, { phrases })
  assert(scene.unclassified.length === 0, "every tag with a phrase has a place")
  assert(scene.slots.accents?.includes("makeup") === true && scene.slots.accents.includes("floral print"), "garment phrases go with the clothing")
  assert(scene.slots.interaction?.includes("girl on top") === true, "a pose phrase goes in the slot the pass chose")
  assert(scene.slots.demographics?.includes("robot") === true, "an 'is' noun phrase is what someone is, whatever slot came with it")
  assert(scene.slots.anatomy?.includes("shaded face") === true, "a trait the pass filed under hair goes with the body")
  assert(scene.camera.framing.includes("male pov") && scene.camera.gaze.includes("seductive look"), "framing and gaze phrases go to the camera")
  assert(scene.slots.accents?.includes("white topwear") === true, "an unknown slot falls back on the kind")
  assert(scene.slots.posture?.includes("tied up") === true, "an entry without a slot is placed by its kind")

  const text = flux(["1girl", "school uniform", "makeup", "floral print", "robot", "shaded face"])
  assert(text.includes("makeup") && text.includes("a floral print on her clothes"), "clothing phrases are written out")
  assert(text.includes("She is a robot and is shown with her face partly in shadow."), "body phrases are written out")
  assert(!text.includes("Additional details"), "nothing with a phrase is left raw")
  assert(flux(["1girl", "1boy", "kissing", "girl on top"]).includes("They are kissing, with the woman on top."), "a 'with' pose phrase joins the pose sentence")
  assert(flux(["1girl", "male pov"]).includes("The image is a first-person view from a man's perspective."), "a framing phrase reads as the shot")
}

// 3. Nouns for places, objects, creatures and layout.
{
  const text = flux(["1girl", "public", "stuffed animal", "mammal", "star (symbol)", "suction cup dildo"])
  assert(text.includes("The background features a public place and a stuffed animal."), "places and objects read the noun phrase")
  assert(text.includes("There is also a furry mammal."), "a creature reads the noun phrase")
  assert(text.includes("The image includes a star symbol."), "a layout item reads the noun phrase")
  assert(text.includes("She has a suction cup dildo."), "an object someone has reads the noun phrase")
}

// 4. The taxonomy wins where the phrase can be said in its slot's sentence.
{
  const filed = buildScene({ general: ["1girl", "makeup"] }, { ...overrides, makeup: "clothing:headwear" }, { phrases })
  assert(filed.slots.headwear?.includes("makeup") === true && !filed.slots.accents?.includes("makeup"), "a taxonomy slot beats the dictionary's")
  const misfiled = buildScene({ general: ["1girl", "makeup"] }, { ...overrides, makeup: "appearance:anatomy" }, { phrases })
  assert(misfiled.slots.accents?.includes("makeup") === true && !misfiled.slots.anatomy?.includes("makeup"), "a phrase that cannot follow \"She has\" leaves the body slot")
}

// 5. Nothing is lost; what has no phrase stays a raw detail.
{
  const general = ["1girl", "makeup", "girl on top", "public", "star (symbol)", "male pov", "mystery tag", "netorare"]
  const scene = buildScene({ general }, overrides, { phrases })
  assert(sceneTagCount(scene) + scene.dropped.length === general.length, "every tag lands somewhere")
  const moss = renderMoss(scene, { phrases }).text
  assert(moss.endsWith("Additional details: mystery tag and netorare."), "a tag with no slot and no phrase is still written verbatim")
  const anima = renderAnima(scene, { phrases }).text
  const block = anima.split(". ")[0].split(", ")
  const tagsKept = general.filter((t) => t !== "girl on top").every((t) => block.includes(escapeTag(normalizeTag(t))))
  assert(tagsKept && anima.includes("with the woman on top"), "Anima keeps the tags in its tag block and the pose in its prose")
  assert(escapeTag("\\m/") === "\\\\m/" && escapeTag("star (symbol)") === "star \\(symbol\\)", "a backslash is escaped before the parentheses")
}

// 6. The card's path.
{
  const input = { general: ["1girl", "makeup", "girl_on_top", "star_(symbol)"] }
  const moss = formatPrompt("moss", input, overrides, { phrases }).text
  assert(moss.includes("makeup") && moss.includes("a star symbol") && !moss.includes("Additional details"), "formatPrompt places tags through the dictionary")
  const without = formatPrompt("moss", input, overrides).text
  assert(without.includes("Additional details:"), "without the dictionary they stay raw details")
}

// 7. Word budget: phrased details make the prose longer, which should not cut every list.
{
  const vocab = { ...overrides, smile: "pose:expression", "red dress": "clothing:outfit", "white gloves": "clothing:accents", "black boots": "clothing:footwear", "blue scarf": "clothing:accents", "gold necklace": "clothing:accents", "wool hat": "clothing:headwear", "cowboy shot": "pose:camera" }
  const scene = buildScene({ general: ["1girl", "sitting", "smile", "red dress", "white gloves", "black boots", "blue scarf", "gold necklace", "wool hat", "warm lighting", "cowboy shot"] }, vocab)
  const full = renderMoss(scene, { maxWords: null }).text
  const words = full.split(/\s+/).length
  const tight = renderMoss(scene, { maxWords: words - 3 })
  assert(tight.text.includes("a wool hat") && !tight.text.includes("cowboy shot") && tight.omitted > 0, "when only a minor sentence overflows, it goes and every list stays whole")
  const short = renderMoss(scene, { maxWords: 20 })
  assert(short.text.split(/\s+/).length <= 20 && !short.text.includes("a wool hat"), "when a main sentence would not fit, the lists are shortened")
}

// 8. Other boorus' spellings of a known tag.
{
  const vocab = {
    ...overrides,
    "hand on another's chin": "pose:gesture", "body markings": "appearance:anatomy", "succubus tail": "appearance:anatomy",
    "wide-eyed": "pose:expression", "cracked glass": "scenery:props", shorts: "clothing:bottom",
    "cat ears": "appearance:anatomy", "cat-ear": "clothing:headwear", "hatsune miku": "other:character",
  }
  const scene = buildScene({ general: ["1girl", "hand on anothers chin", "body marking", "succubustail", "wideeyed"] }, vocab)
  assert(scene.slots.gesture?.includes("hand on another's chin") === true, "a missing apostrophe reads as the known tag")
  assert(scene.slots.anatomy?.includes("body markings") === true, "the other number of the head noun reads as the known tag")
  assert(scene.slots.anatomy?.includes("succubus tail") === true && scene.slots.expression?.includes("wide-eyed") === true, "words written together read as the known tag")
  const kept = buildScene({ general: ["1girl", "cracked glasses", "short", "cat ear", "hatsune mikus"] }, vocab)
  assert(kept.unclassified.join() === "cracked glasses,cat ear,hatsune mikus", "no reading when the number changes the thing, the match is not unique, or it is a name")
  assert(kept.dropped.includes("short") && !kept.slots.bottom?.includes("shorts"), "a lone word says nothing, and is not read as a garment")
  const twice = buildScene({ general: ["1girl", "body marking", "body markings"] }, vocab)
  assert(twice.slots.anatomy?.join() === "body markings" && twice.dropped.join() === "body markings", "two spellings of one tag say it once")
  assert(sceneTagCount(twice) + twice.dropped.length === 3, "no tag is lost")
  const known = buildScene({ general: ["1girl", "makeup"] }, vocab, { phrases })
  assert(known.slots.accents?.includes("makeup") === true, "a tag with an entry of its own keeps it")
  const spellings: PhraseDictionary = { "dark skinned female": { kind: "is", text: "a dark-skinned woman", slot: "appearance:demographics" } }
  const dark = buildScene({ general: ["1girl", "darkskinned female"] }, { ...vocab, "dark-skinned female": "appearance:anatomy" }, { phrases: spellings })
  assert(dark.slots.anatomy?.includes("dark-skinned female") === true, "of two spellings, the taxonomy's wins")
  // A "keep" entry marks a tag left without a phrase on purpose.
  const keep = { ...phrases, "body markings": { kind: "keep", text: "body markings" }, military: { kind: "keep", text: "military" } } as unknown as PhraseDictionary
  const marked = buildScene({ general: ["1girl", "body marking", "military"] }, overrides, { phrases: keep })
  assert(marked.unclassified.join() === "body marking,military", "a keep entry places nothing and is no spelling to read a tag as")
}

console.log(`${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
