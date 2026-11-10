/**
 * Tests for lib/pack/character-identity.ts and searchedCharacterIn
 * (lib/pack/character-focus.ts): what a one-character pack keeps as the
 * character's identity.
 *
 * Covers:
 *   1. Identity from a trait profile: hair and eyes first, the leading colour,
 *      signature accessories, no garments, head counts or bare-body tags.
 *   2. A card's look without other boorus' synonyms or minor details.
 *   3. The typical look from what most of the character's solo posts show.
 *   4. Signature accessories leave the look for Clothing and stay while it varies.
 *   5. The one character a search is about, from its results.
 *   6. The search for a character's own posts.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-character-identity.verify.ts
 */
import type { BooruPost } from "../lib/booru/types"
import {
  characterSearchTags,
  isLookTag,
  isNoiseLookTag,
  pinnedTagsFor,
  profileIdentity,
  splitSignature,
  tidyCardLook,
  typicalLook,
} from "../lib/pack/character-identity"
import { searchedCharacterIn } from "../lib/pack/character-focus"

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

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// ── 1) Identity from a trait profile ──
{
  const overrides: Record<string, string> = {
    "aqua hair": "appearance:hair", twintails: "appearance:hair", "aqua eyes": "appearance:eyes", "large breasts": "appearance:anatomy",
    "detached sleeves": "clothing:top", "1girl": "appearance:demographics", "pink hair": "appearance:hair", headphones: "clothing:headwear",
  }
  const profiles = {
    "hatsune miku": { "aqua hair": 0.9, twintails: 0.85, "aqua eyes": 0.7, "detached sleeves": 0.8, "1girl": 0.9, "long hair": 0.4 },
    "super sonico": { "pink hair": 0.95, "large breasts": 0.9, headphones: 0.95 },
  }
  const miku = profileIdentity("hatsune_miku", profiles, overrides)
  assert(eq(miku, ["aqua hair", "twintails", "aqua eyes"]), `hair and eyes, strongest first, no garments or count tags (got ${JSON.stringify(miku)})`)
  assert(profileIdentity("unknown character", profiles, overrides).length === 0, "no profile: no identity tags")
  const split = profileIdentity("someone", { someone: { "long hair": 0.8, "aqua hair": 0.6, "aqua eyes": 0.38, "blue eyes": 0.27, "red eyes": 0.1, headphones: 0.9, skirt: 0.7, breasts: 0.9, "large breasts": 0.8, nipples: 0.9 } }, overrides)
  assert(split.includes("aqua eyes") && !split.includes("blue eyes") && !split.includes("red eyes"), `the leading eye colour counts under half, only that one (got ${split})`)
  assert(split.includes("headphones"), `a signature accessory is part of who they are (got ${split})`)
  assert(!split.includes("skirt"), `garments are not (got ${split})`)
  assert(!split.includes("nipples") && !split.includes("breasts") && split.includes("large breasts"), `no bare-body tags, and the sized tag replaces "breasts" (got ${split})`)
  assert(split.indexOf("aqua eyes") < split.indexOf("large breasts"), `hair and eyes before body (got ${split})`)
  assert(eq(profileIdentity("miku", profiles, overrides, { miku: "hatsune miku" }), miku), "aliases resolve to the profile")
  const sonico = profileIdentity("super sonico", profiles, overrides)
  assert(sonico.indexOf("headphones") < sonico.indexOf("large breasts"), `signature accessories before body (got ${sonico})`)
}

// ── 2) A card's look without other boorus' synonyms or minor details ──
{
  const look = tidyCardLook(["aqua hair", "boobs", "breasts", "tits", "aqua nails", "red nails", "toenails", "toes", "chest", "twintails", "big breasts", "large breasts"])
  assert(eq(look, ["aqua hair", "breasts", "twintails", "large breasts"]), `synonyms become one tag, minor details go (got ${JSON.stringify(look)})`)
  assert(isNoiseLookTag("tits") && isNoiseLookTag("black nails") && !isNoiseLookTag("aqua hair"), "noise: synonyms and minor details")
  const names = new Set(["super sonico"])
  const overrides = { "1girl": "appearance:demographics" }
  assert(!isLookTag("super sonico", names, overrides) && !isLookTag("solo", names, overrides) && !isLookTag("1girl", names, overrides), "names, head counts and demographics are not the look")
  assert(!isLookTag("rariatto (ganguri) (style)", names, overrides) && isLookTag("pink hair", names, overrides), "an artist's style is not the look; hair is")
}

// ── 3) Typical look, from what most of the character's solo posts show ──
const post = (id: number, tags: string, chars = "super_sonico"): BooruPost => ({
  id, file_url: "", large_file_url: "", preview_file_url: "", tag_string: tags, tag_string_artist: "", tag_string_character: chars, tag_string_copyright: "", rating: "e", score: 0,
})
const posts = [
  post(1, "1girl pink_hair long_hair red_eyes large_breasts"),
  post(2, "1girl pink_hair long_hair red_eyes large_breasts fat"),
  post(3, "1girl pink_hair long_hair red_eyes tits"),
  post(4, "1girl pink_hair short_hair red_eyes large_breasts"),
  post(5, "1girl pink_hair long_hair large_breasts"),
  post(6, "2girls pink_hair aqua_hair", "super_sonico hatsune_miku"),
]
{
  const overrides: Record<string, string> = {
    "pink hair": "appearance:hair", "long hair": "appearance:hair", "red eyes": "appearance:eyes", "large breasts": "appearance:anatomy",
    fat: "appearance:anatomy", "1girl": "appearance:demographics", "short hair": "appearance:hair", tits: "appearance:anatomy",
  }
  const look = typicalLook(posts, "super sonico", overrides)!
  assert(look[0] === "pink hair" && look.includes("long hair") && look.includes("red eyes") && look.includes("large breasts"), `what most posts show (got ${look})`)
  assert(!look.includes("fat") && !look.includes("short hair"), `one card's oddity is left out (got ${look})`)
  assert(!look.includes("1girl") && !look.includes("tits"), "no head count, no other boorus' spellings")
  assert(!look.includes("aqua hair"), "a post with someone else in it does not count")
  assert(eq(typicalLook(posts, "super_sonico", overrides), look), "the booru spelling of the name works too")
  assert(typicalLook(posts.slice(0, 3), "super sonico", overrides) === null, "too few solo posts: no typical look")
}

// ── 4) Signature accessories live in Clothing and stay while it varies ──
{
  const worn = { headphones: "clothing:accents", "pink hair": "appearance:hair", skirt: "clothing:bottom" }
  const parts = splitSignature(["pink hair", "headphones"], worn)
  assert(parts.look.join() === "pink hair" && parts.signature.join() === "headphones", "accessories leave the look for Clothing")
  const state = { lockedCategories: new Set<never>(), excludedBaseTags: new Set<string>(), mutedSlots: new Set<string>(), axisMinCounts: { clothing: 1 } }
  assert(pinnedTagsFor(["headphones"], "clothing", state, worn).join() === "headphones", "Vary keeps them")
  assert(pinnedTagsFor(["headphones"], "clothing", { ...state, axisMinCounts: { clothing: 0 } }, worn).length === 0, "Off takes them out")
  assert(pinnedTagsFor(["headphones"], "clothing", { ...state, excludedBaseTags: new Set(["headphones"]) }, worn).length === 0, "a removed tag stays removed")
  assert(pinnedTagsFor(["headphones"], "clothing", { ...state, mutedSlots: new Set(["clothing:accents"]) }, worn).length === 0, "a muted part takes them out")
}

// ── 5) The character a search is about, from its results ──
{
  assert(searchedCharacterIn(posts, "super_sonico") === "super sonico", "a searched character most results list")
  assert(searchedCharacterIn(posts, "super_sonico rating:explicit -hatsune_miku") === "super sonico", "ratings and exclusions are not the character")
  assert(searchedCharacterIn(posts, "super sonico") === "super sonico", "a name written with a space, as the search box allows")
  assert(searchedCharacterIn(posts, "super sonico, smile") === "super sonico", "comma-separated search with a spaced name")
  assert(searchedCharacterIn(posts, "hatsune_miku") === null, "a character few results list is not what the search is about")
  assert(searchedCharacterIn(posts, "pink_hair") === null && searchedCharacterIn([], "super_sonico") === null, "no character, or no results: nothing")
}

// ── 6) The search for a character's own posts ──
{
  assert(characterSearchTags("super sonico", "danbooru") === "super_sonico, solo", "booru spelling, solo when the limit allows")
  assert(characterSearchTags(" hatsune  miku ", "rule34") === "hatsune_miku, solo", "spaces become one underscore")
}

console.log(`pack-character-identity: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
