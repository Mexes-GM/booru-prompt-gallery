/**
 * Tests for lib/pack/character-focus.ts (Pack Mode with a multi-character base)
 * and the cleaner's handling of several character tags.
 *
 * Covers:
 *   1. Only the chosen character survives; group counts and other characters go.
 *   2. Base traits are kept only when the character's solo posts confirm them.
 *   3. Without enough solo posts, every ambiguous trait is dropped.
 *   4. The solo posts' subject tag (1girl…) replaces the group count.
 *   5. No pick yet: no character and no trait survive.
 *   6. Single-character bases are untouched.
 *   7. The search picks the character it's about, ignoring excluded tags.
 *   8. cleanSyntheticPrompt no longer fuses several characters into one tag.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-character-focus.verify.ts
 */
import type { BooruPost } from "../lib/booru/types"
import { classifyPostForPack } from "../lib/pack/pack-generator"
import { cleanSyntheticPrompt, type BulkSendCleanOptions } from "../lib/pack/bulk-send"
import {
  buildSoloCharacterProfiles,
  characterFromSearch,
  focusAppearanceOnCharacter,
  isGroupCountTag,
} from "../lib/pack/character-focus"

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

function makePost(id: number, tag_string: string, character = ""): BooruPost {
  return {
    id,
    file_url: "",
    large_file_url: "",
    preview_file_url: "",
    tag_string,
    tag_string_artist: "",
    tag_string_character: character,
    tag_string_copyright: "",
    rating: "g",
    score: 0,
  }
}

const CHARACTERS = ["akita neru", "hatsune miku", "kasane teto"]
const BASE = makePost(
  1,
  "3girls multiple_girls aqua_hair red_hair blonde_hair aqua_eyes yellow_eyes red_eyes twintails twin_drills side_ponytail smile",
  "akita_neru hatsune_miku kasane_teto"
)
const appearance = classifyPostForPack(BASE).appearance

// Five solo Miku posts (aqua hair, twintails, aqua eyes), one with Teto alone,
// and one group post that must not count for anyone.
const POOL: BooruPost[] = [
  ...Array.from({ length: 5 }, (_, i) =>
    makePost(10 + i, `1girl solo aqua_hair twintails aqua_eyes ${i % 2 ? "smile" : "standing"}`, "hatsune_miku")
  ),
  makePost(20, "1girl solo red_hair twin_drills red_eyes", "kasane_teto"),
  makePost(21, "2girls aqua_hair red_hair twintails", "hatsune_miku kasane_teto"),
]
const profiles = buildSoloCharacterProfiles(POOL, CHARACTERS)

// ── 1 + 2 + 4) The chosen character, its confirmed traits, its subject tag ──
{
  const focused = focusAppearanceOnCharacter(appearance, CHARACTERS, "hatsune miku", profiles["hatsune miku"])
  assert(focused.includes("hatsune miku"), "keeps the chosen character tag")
  assert(!focused.includes("akita neru") && !focused.includes("kasane teto"), "drops the other characters")
  assert(!focused.includes("3girls") && !focused.includes("multiple girls"), "drops the group count tags")
  assert(focused.includes("aqua hair") && focused.includes("twintails") && focused.includes("aqua eyes"),
    `keeps traits the solo posts confirm (got ${focused.join(", ")})`)
  assert(!focused.includes("red hair") && !focused.includes("blonde hair") && !focused.includes("twin drills") && !focused.includes("side ponytail"),
    `drops the other characters' traits (got ${focused.join(", ")})`)
  assert(focused[0] === "1girl", `the solo posts' subject tag stands in for the group count (got ${focused[0]})`)
}
{
  assert(profiles["hatsune miku"]?.posts === 5, `group posts don't count as solo posts (got ${profiles["hatsune miku"]?.posts})`)
  assert(!profiles["akita neru"], "no profile for a character without solo posts")
}

// ── 3) Too few solo posts: only the character tag carries the identity ──
{
  const focused = focusAppearanceOnCharacter(appearance, CHARACTERS, "kasane teto", profiles["kasane teto"])
  assert(JSON.stringify(focused) === JSON.stringify(["kasane teto"]),
    `one solo post isn't enough to vouch for any trait (got ${JSON.stringify(focused)})`)
  const noProfile = focusAppearanceOnCharacter(appearance, CHARACTERS, "akita neru", undefined)
  assert(JSON.stringify(noProfile) === JSON.stringify(["akita neru"]),
    `no profile: every ambiguous trait is dropped (got ${JSON.stringify(noProfile)})`)
}

// ── 5) Nothing picked yet ──
{
  const focused = focusAppearanceOnCharacter(appearance, CHARACTERS, null, undefined)
  assert(focused.length === 0, `no pick: nothing identity-related survives (got ${JSON.stringify(focused)})`)
}

// ── 6) Single character: untouched ──
{
  const tags = ["hatsune miku", "aqua hair", "2girls"]
  assert(
    JSON.stringify(focusAppearanceOnCharacter(tags, ["hatsune miku"], "hatsune miku", undefined)) === JSON.stringify(tags),
    "single-character base is a no-op"
  )
  assert(JSON.stringify(focusAppearanceOnCharacter(tags, [], null, undefined)) === JSON.stringify(tags), "no character is a no-op")
}

// ── Group count detection ──
{
  for (const tag of ["2girls", "3girls", "6+girls", "multiple girls", "multiple_boys", "4boys", "2others"]) {
    assert(isGroupCountTag(tag), `${tag} is a group count`)
  }
  for (const tag of ["1girl", "1boy", "solo", "girls und panzer", "twintails"]) {
    assert(!isGroupCountTag(tag), `${tag} is not a group count`)
  }
}

// ── 7) Character from the search ──
{
  assert(characterFromSearch(CHARACTERS, "hatsune_miku rating:general") === "hatsune miku", "picks the searched character")
  assert(characterFromSearch(CHARACTERS, "1girl, Kasane_Teto") === "kasane teto", "comma-separated and case-insensitive")
  assert(characterFromSearch(CHARACTERS, "-hatsune_miku solo") === null, "an excluded character isn't picked")
  assert(characterFromSearch(CHARACTERS, "hatsune_miku kasane_teto") === null, "two searched characters: no guess")
  assert(characterFromSearch(CHARACTERS, "") === null, "empty search: no guess")
}

// ── 8) The cleaner keeps several character tags apart ──
{
  const options: BulkSendCleanOptions = { excludeInput: "", addInput: "", includeCharacters: true, optimizeTags: true }
  const prompt = cleanSyntheticPrompt(["1girl", "standing", "beach"], CHARACTERS, options, ["1girl"])
  const tags = prompt.split(",").map((t) => t.trim())
  assert(!tags.some((t) => t.includes("akita neru hatsune miku")), `no fused character token (got ${prompt})`)
  const single = cleanSyntheticPrompt(["1girl", "standing", "beach"], ["hatsune miku"], options, ["1girl", "hatsune miku"])
  assert(single.split(",").map((t) => t.trim()).filter((t) => t === "hatsune miku").length === 1,
    `one kept character appears exactly once (got ${single})`)
}

console.log(`pack-character-focus: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
