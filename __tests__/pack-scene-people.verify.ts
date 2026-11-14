/**
 * Tests for who is in a post, read in the vocabulary of its site (lib/pack/scene/people.ts postPeople,
 * and extractScene / buildScenePool with ScenePoolContext.provider).
 *
 * Covers:
 *   D. Danbooru-like sites (and no provider): the reading the scenes always had, counts summed,
 *      a gender without a count is absent.
 *   R. Rule34: the largest count of a gender (it tags "1girls, 2girls, 3girls"); a presence tag
 *      ("male") without a count leaves the people unknown instead of "a girl alone"; "mmf threesome",
 *      "foursome", and "threesome" next to one gender's count fill the other; a count that disagrees
 *      with a group tag, a futa count, an open count: unknown, with the least that is certain.
 *   P. The scene pool with a provider: Rule34 posts land in the right composition; without one,
 *      the pool is the same as before.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-scene-people.verify.ts
 */
import fs from "fs"
import path from "path"
import { postPeople } from "../lib/pack/scene/people"
import { buildScenePool } from "../lib/pack/scene/scene-pool"
import { createPermanence, type PermanenceData } from "../lib/pack/scene/permanence"
import { tagKindsFromPosts } from "../lib/pack/scene-pack"
import { makeAssert, makePost } from "./fixtures/pack-scene-data"

const { assert, done } = makeAssert()
const key = (r: ReturnType<typeof postPeople>) => (r.people ? `${r.people.girls}g${r.people.boys}b` : `null:${r.reason}`)
const t = (s: string) => s.split(",").map((x) => x.trim())

// ── D. Danbooru reading ──────────────────────────────────────────────────────
assert(key(postPeople(t("1girl, 2boys, hetero"))) === "1g2b", "D1: counts")
assert(key(postPeople(t("1girl, 2boys"), "danbooru")) === "1g2b", "D1: the same with the provider named")
assert(key(postPeople(t("1girl, male"), "gelbooru")) === "1g0b", "D2: a Danbooru-like site keeps its convention (no boy count: no boy)")
assert(key(postPeople(t("1girl, multiple boys"))) === "null:open", "D3: an open count")
assert(key(postPeople(t("solo, smile"))) === "null:none", "D4: nothing to count")

// ── R. Rule34 ────────────────────────────────────────────────────────────────
const r34 = (s: string) => postPeople(t(s), "rule34")
assert(key(r34("1girls, 2girls, 3girls, female, fff threesome, threesome")) === "3g0b", "R1: the largest count, not the sum")
assert(key(r34("1girl, 1girls, female, solo")) === "1g0b", "R1: two spellings of one girl are one girl")
assert(key(r34("1girls, female, male")) === "null:uncounted", "R2: a man by his presence tag, not counted: not a girl alone")
assert(r34("1girls, female, male").atLeast.boys === 1 && r34("1girls, female, male, multiple males").atLeast.boys === 2, "R2: the least that is certain")
assert(key(r34("2boys, female, male, mmf threesome, threesome")) === "1g2b", "R3: the group's make-up fills the uncounted girl")
assert(key(r34("female, male, mmf threesome, multiple males")) === "1g2b", "R3: and with no count at all")
assert(key(r34("double penetration, male/male, mmm threesome, multiple boys")) === "0g3b", "R3: mmm threesome")
assert(key(r34("1girls, female, male, threesome")) === "1g2b", "R4: threesome and the count of one gender give the other")
assert(key(r34("female, male, threesome")) === "null:uncounted", "R4: threesome without any count gives no number")
assert(key(r34("1girls, female, male, foursome")) === "1g3b", "R4: foursome")
assert(key(r34("1girls, female, male, threesome, gangbang")) === "null:uncounted", "R4: no total next to a bigger group")
assert(key(r34("1girls, 3boys, female, male, mmf threesome")) === "null:contradiction", "R5: a count against the group's make-up")
assert(key(r34("1girls, 2futas, female, futanari")) === "null:futa", "R6: a futa count")
assert(key(r34("1girls, 2boys, female, male")) === "1g2b", "R7: complete counts")
assert(key(r34("2boys, female")) === "null:uncounted", "R7: a woman by her presence tag, not counted")
assert(key(r34("1girls, female, solo")) === "1g0b", "R7: one girl and nothing else")
assert(key(r34("female, solo")) === "null:uncounted", "R8: no count and no group tag: unknown, whatever 'solo' says")

// ── P. The scene pool with a provider ────────────────────────────────────────
{
  const root = path.join(__dirname, "..")
  const CORE: Record<string, string> = JSON.parse(fs.readFileSync(path.join(root, "public/tags-core.json"), "utf8"))
  const overrides: Record<string, string> = {}
  for (const [tag, slot] of Object.entries(CORE)) overrides[tag.replace(/_/g, " ")] = slot
  const permanence = createPermanence(JSON.parse(fs.readFileSync(path.join(root, "public/tag-permanence.json"), "utf8")) as PermanenceData, overrides)
  const posts = [
    makePost(1, "1girls female male threesome sex standing bedroom indoors open_mouth blush", { rating: "explicit" }),
    makePost(2, "2boys female male mmf_threesome threesome sex kneeling bed indoors closed_eyes", { rating: "explicit" }),
    makePost(3, "1girls female male sex lying bathroom indoors smile sweat", { rating: "explicit" }),
    makePost(4, "1girls 2boys female male sex sitting kitchen indoors looking_at_viewer tongue_out", { rating: "explicit" }),
  ]
  const kinds = tagKindsFromPosts(posts)
  const ctx = { overrides, permanence, subject: "girl" as const, tagKind: (tag: string) => kinds.get(tag), people: { girls: 1, boys: 2 } }
  const before = buildScenePool(posts, ctx)
  const after = buildScenePool(posts, { ...ctx, provider: "rule34" })
  const ids = (pool: typeof before) => pool.scenes.map((s) => s.postId).sort().join(",")
  assert(ids(before) === "4", `P1: read the Danbooru way, only the fully counted post is 1 girl + 2 boys (${ids(before)})`)
  assert(ids(after) === "1,2,4", `P1: read the Rule34 way, the threesome posts join it; the uncounted one doesn't (${ids(after)})`)
  const lone = buildScenePool(posts, { ...ctx, people: { girls: 1, boys: 0 } })
  assert(lone.scenes.some((s) => s.postId === 3), "P2: the Danbooru reading takes '1girls, male' for a girl alone")
  const loneAfter = buildScenePool(posts, { ...ctx, people: { girls: 1, boys: 0 }, provider: "rule34" })
  assert(!loneAfter.scenes.some((s) => s.postId === 3), "P2: the Rule34 reading doesn't")
  const scene2 = after.scenes.find((s) => s.postId === 2)
  assert(!!scene2 && !scene2.pairing.some((tag) => /multiple|boys|girls/.test(tag)), "P3: once the people are known, no open count stays in the pairing")
}

done()
