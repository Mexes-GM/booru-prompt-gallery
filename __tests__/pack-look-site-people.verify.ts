/**
 * Tests for reading a character's look from posts of any site: who is in each
 * picture is read in the vocabulary of the site the posts come from
 * (lib/pack/character-identity.ts typicalLook, typicalSubject, postsAloneShare),
 * and a solo look read from an odd few of a search's posts does not stand for
 * the character (lib/pack/brief-pack.ts resolveLook).
 *
 * Covers:
 *   1. Rule34: "1girls, solo, female" is one girl alone; "1girls, 2girls",
 *      "1girls, male" and "1girls, threesome" are not.
 *   2. A Rule34 pool keeps the character's hair and eyes.
 *   3. Danbooru and Gelbooru read as before, with or without the provider.
 *   4. resolveLook: a solo look read from few of the posts gives way to the profile.
 *   5. A multi-character Rule34 base keeps the chosen character's "1girls".
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-look-site-people.verify.ts
 */
import type { BooruPost } from "../lib/booru/types"
import { postsAloneShare, typicalLook, typicalSubject } from "../lib/pack/character-identity"
import { MIN_SOLO_LOOK_SHARE, resolveLook } from "../lib/pack/brief-pack"
import { buildSoloCharacterProfiles, focusAppearanceOnCharacter } from "../lib/pack/character-focus"

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

const post = (id: number, tags: string, chars = "tifa_lockhart"): BooruPost => ({
  id, file_url: "", large_file_url: "", preview_file_url: "", tag_string: tags, tag_string_artist: "", tag_string_character: chars, tag_string_copyright: "", rating: "q", score: 0,
})

const overrides: Record<string, string> = {
  "black hair": "appearance:hair", "long hair": "appearance:hair", "red eyes": "appearance:eyes", "large breasts": "appearance:anatomy",
  "blonde hair": "appearance:hair", "blue eyes": "appearance:eyes", "1girl": "appearance:demographics", "1girls": "appearance:demographics",
}
const TIFA = "tifa lockhart"

// ── 1) Rule34: one girl alone, and company ──
{
  const alone = [1, 2, 3, 4, 5].map((i) => post(i, "1girls solo female black_hair long_hair red_eyes large_breasts"))
  assert(typicalLook(alone, TIFA, overrides, null, "rule34") !== null, "Rule34: 1girls, solo, female is one girl alone")
  assert(postsAloneShare(alone, TIFA, "rule34") === 1, "Rule34: all five posts read as her alone")
  assert(typicalLook(alone, TIFA, overrides, null) === null, "the Danbooru reading takes 1girls for a group (why the site matters)")

  for (const company of ["1girls 2girls female", "1girls female male", "1girls female threesome", "multiple_girls female", "1girls female hetero"]) {
    const posts = [...alone.slice(0, 4), post(9, `${company} blonde_hair`)]
    assert(typicalLook(posts, TIFA, overrides, null, "rule34") === null, `Rule34: "${company}" is not her alone`)
  }
  // A post whose tags don't count the people at all is hers alone, as on Danbooru.
  const uncounted = [...alone.slice(0, 4), post(10, "female black_hair long_hair red_eyes")]
  assert(typicalLook(uncounted, TIFA, overrides, null, "rule34") !== null, "Rule34: a post with no count is her alone")
}

// ── 2) A Rule34 pool keeps hair and eyes ──
{
  const pool = [
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => post(i, "1girls solo female black_hair long_hair red_eyes large_breasts")),
    ...[11, 12, 13, 14, 15, 16, 17, 18].map((i) => post(i, "1girls solo female black_hair long_hair red_eyes large_breasts big_breasts")),
    // An odd few with company: a male partner, a second girl.
    ...[21, 22].map((i) => post(i, "1girls female male blonde_hair blue_eyes large_breasts")),
    post(23, "1girls 2girls female blonde_hair blue_eyes large_breasts"),
  ]
  const look = typicalLook(pool, TIFA, overrides, null, "rule34")!
  assert(!!look && look.includes("black hair") && look.includes("long hair") && look.includes("red eyes"), `Rule34: hair and eyes are kept (got ${look})`)
  assert(!look.includes("blonde hair") && !look.includes("blue eyes"), "Rule34: a partner's hair and eyes are not hers")
  assert(eq(typicalSubject(pool, TIFA, overrides, "rule34"), ["1girls"]), `Rule34: her subject in the site's spelling (got ${typicalSubject(pool, TIFA, overrides, "rule34")})`)
  assert(postsAloneShare(pool, TIFA, "rule34") === 1, "Rule34: every post the site tags solo reads as her alone")
  // The same pool read the Danbooru way sets all of them aside.
  assert(postsAloneShare(pool, TIFA) === 0, "the Danbooru reading disagrees with the site's own solo tag")
}

// ── 3) Danbooru and Gelbooru read as before ──
{
  const solo = [1, 2, 3, 4, 5].map((i) => post(i, "1girl solo black_hair long_hair red_eyes"))
  const crowd = [10, 11, 12].map((i) => post(i, "2girls blonde_hair blue_eyes"))
  const mixed = [20, 21].map((i) => post(i, "1girl 1boy blonde_hair"))
  const other = [30, 31].map((i) => post(i, "1girl 1other blonde_hair"))
  const pool = [...solo, ...crowd, ...mixed, ...other, post(40, "multiple_girls blonde_hair"), post(41, "6+girls blonde_hair")]
  const base = typicalLook(pool, TIFA, overrides, null)
  assert(eq(base, ["long hair", "black hair", "red eyes"]) || eq(base, ["black hair", "long hair", "red eyes"]), `Danbooru: the solo posts' look (got ${base})`)
  for (const provider of ["danbooru", "gelbooru", "aibooru"] as const) {
    assert(eq(typicalLook(pool, TIFA, overrides, null, provider), base), `${provider}: same look as without a provider`)
    assert(eq(typicalSubject(pool, TIFA, overrides, provider), typicalSubject(pool, TIFA, overrides)), `${provider}: same subject as without a provider`)
    assert(postsAloneShare(pool, TIFA, provider) === 1, `${provider}: the solo posts read as her alone`)
  }
  // Company the site tags as company doesn't count against the reading: a search by
  // name alone (Danbooru's look search, the order taking the second tag) brings plenty.
  assert(postsAloneShare([...solo, ...[50, 51, 52, 53, 54, 55].map((i) => post(i, "1girl 1boy hetero"))], TIFA, "danbooru") === 1, "Danbooru: real company is not a misreading")
  assert(postsAloneShare(crowd, TIFA, "danbooru") === null, "no post tagged solo: nothing to tell")
  assert(typicalLook(pool, TIFA, overrides, null, "danbooru") !== null && eq(typicalLook(pool.slice(5), TIFA, overrides, null, "danbooru"), null), "Danbooru: the company posts alone give no look")
  const onlyOther = [1, 2, 3, 4, 5].map((i) => post(i, "1other solo black_hair"))
  assert(typicalLook(onlyOther, TIFA, overrides, null, "danbooru") !== null, "Danbooru: 1other alone is one person, as before")
}

// ── 4) resolveLook: a solo look from an odd few of the posts ──
{
  const profile = ["black hair", "long hair", "red eyes", "large breasts"]
  const solo = (aloneShare?: number | null) => ({ status: "ready" as const, look: ["large breasts"], subject: ["solo"], aloneShare })
  assert(resolveLook({ solo: solo(6 / 83), profile }).source === "profile", "6 of 83 posts: the profile stands")
  assert(eq(resolveLook({ solo: solo(6 / 83), profile }).look, profile), "with the profile's traits")
  assert(resolveLook({ solo: solo(0.95), profile }).source === "solo", "most of the posts: the solo look")
  assert(resolveLook({ solo: solo(MIN_SOLO_LOOK_SHARE), profile }).source === "solo", "half of them is enough")
  assert(resolveLook({ solo: solo(undefined), profile }).source === "solo", "no share known: the solo look, as before")
  assert(resolveLook({ solo: solo(null), profile }).source === "solo", "no post names only them: the solo look, as before")
  const pool = { look: ["black hair"], subject: ["1girls"] }
  assert(resolveLook({ solo: solo(0.1), pool, profile }).source === "pool", "an odd few: the pack's own posts come next")
  assert(resolveLook({ solo: solo(0.1), profile: [] }).source === "none", "an odd few and no profile: nothing but the name")
}

// ── 5) A multi-character Rule34 base keeps the chosen character's "1girls" ──
{
  const characters = ["tifa lockhart", "aerith gainsborough"]
  const pool = [
    ...[1, 2, 3, 4].map((i) => post(i, "1girls solo female black_hair red_eyes")),
    post(5, "1girls 2girls female black_hair red_eyes blonde_hair", "tifa_lockhart aerith_gainsborough"),
  ]
  const profiles = buildSoloCharacterProfiles(pool, characters)
  const focused = focusAppearanceOnCharacter(["tifa lockhart", "aerith gainsborough", "1girls", "2girls", "black hair", "red eyes"], characters, TIFA, profiles[TIFA])
  assert(eq(focused, ["1girls", "tifa lockhart", "black hair", "red eyes"]), `Rule34: the base's counts go, her one-girl subject stays (got ${focused})`)
  // Danbooru as before: 1girl stands in for 2girls.
  const dPool = [
    ...[1, 2, 3, 4].map((i) => post(i, "1girl solo black_hair red_eyes")),
  ]
  const dFocused = focusAppearanceOnCharacter(["tifa lockhart", "aerith gainsborough", "2girls", "black hair", "red eyes"], characters, TIFA, buildSoloCharacterProfiles(dPool, characters)[TIFA])
  assert(eq(dFocused, ["1girl", "tifa lockhart", "black hair", "red eyes"]), `Danbooru: 1girl stands in for the group count (got ${dFocused})`)
}

console.log(`pack-look-site-people: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
