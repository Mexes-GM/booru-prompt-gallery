/**
 * Which posts loaded for a pack stay when its plan changes (lib/pack/source-fit.ts), checked on
 * the plans planSources makes: a post stays when it fits a search of the new plan (same site, one
 * of its ratings, every tag the search asks for).
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-source-fit.verify.ts
 */
import assert from "node:assert/strict"
import { firstFittingSearch, postFitsSearch, postTagSet, tagsFitSearch, type LoadedPost } from "../lib/pack/source-fit"
import { planSources, type SourcePlan, type SourcePlanEnv } from "../lib/pack/source-plan"
import type { PackBrief } from "../lib/pack/brief"
import { briefFromCharacters } from "../lib/pack/brief-history"
import type { BooruPost, BooruProvider } from "../lib/booru/types"

let passed = 0
const check = (fn: () => void) => { fn(); passed++ }

const env: SourcePlanEnv = { provider: "danbooru", rating: "sfw", includeSensitive: false, roles: ["girl"] }
const solo: PackBrief = briefFromCharacters(["frieren"])
const sitting: PackBrief = { ...solo, requests: [{ tag: "sitting", role: "doing" }] }
const MIX = [{ girls: 1, boys: 0 }, { girls: 1, boys: 1 }]
const COMPANY = [{ girls: 1, boys: 1 }, { girls: 2, boys: 0 }]

function post(id: number, general: string, character: string, provider: BooruProvider = "danbooru", ratings = ["rating:general"]): LoadedPost & { id: number } {
  const p = { id, tag_string: `${general} ${character}`, tag_string_character: character, tag_string_copyright: "", tag_string_artist: "" } as Pick<BooruPost, "tag_string" | "tag_string_character" | "tag_string_copyright" | "tag_string_artist">
  return { id, tags: postTagSet(p), provider, ratings }
}

/** The posts that stay under `plan`, by the scene search they fit first. */
const kept = (posts: ReadonlyArray<LoadedPost & { id: number }>, plan: SourcePlan) =>
  posts.flatMap((p) => {
    const i = firstFittingSearch(p, plan.scenes, { provider: plan.provider, ratings: plan.ratings })
    return i >= 0 ? [{ id: p.id, search: plan.scenes[i].kind }] : []
  })

// The posts a "frieren, solo" search brings: all of them alone, some sitting.
const soloPosts = [
  post(1, "1girl solo sitting white_hair", "frieren"),
  post(2, "1girl solo standing", "frieren"),
  post(3, "1girl solo sitting outdoors", "frieren"),
]
// What "frieren" brings besides: pictures with someone else.
const withOthers = [
  post(4, "1girl 1boy sitting", "frieren himmel_(sousou_no_frieren)"),
  post(5, "2girls standing", "fern_(sousou_no_frieren) frieren"),
]
// What "sitting" brings: anyone sitting.
const anyoneSitting = [
  post(6, "1girl solo sitting", "fern_(sousou_no_frieren)"),
  post(7, "1girl solo sitting", "makima_(chainsaw_man)"),
]

/** A plan of one search of the character's own posts with these tags. */
const ownPlan = (tags: string[]): SourcePlan => ({ ...planSources(solo, env), scenes: [{ id: `scene|danbooru|${tags.join(" ")}`, tags, query: tags.join(", "), kind: "own", poses: [] }] })

check(() => {
  // "frieren, solo" becomes "frieren" (a make-up with company marked): every post it had stays.
  assert.deepEqual(kept(soloPosts, ownPlan(["frieren"])).map((k) => k.id), [1, 2, 3])
  assert.ok(kept(soloPosts, ownPlan(["frieren"])).every((k) => k.search === "own"))
  // A mix without her alone: the plan searches her by name only, and keeps them too.
  const withCompany = planSources(solo, { ...env, compositions: COMPANY })
  assert.deepEqual(withCompany.scenes.map((s) => s.tags), [["1girl", "1boy"], ["2girls", "-1boy"], ["frieren"]])
  assert.deepEqual(kept(soloPosts, withCompany).map((k) => k.id), [1, 2, 3])
})

check(() => {
  // Both own searches at once ("frieren, solo" to fill, "frieren" for the make-ups): a post of
  // her alone fits both and counts for the first; one with company fits "frieren" only.
  const both = planSources(solo, { ...env, compositions: MIX })
  assert.deepEqual(both.scenes.map((s) => s.tags), [["frieren", "solo"], ["1girl", "1boy"], ["frieren"]])
  const fits = (p: LoadedPost) => both.scenes.map((s) => postFitsSearch(p, s, { provider: both.provider, ratings: both.ratings }))
  assert.deepEqual(fits(soloPosts[0]), [true, false, true])
  assert.deepEqual(fits(withOthers[0]), [false, true, true])
  const firsts = [...soloPosts, ...withOthers].map((p) => firstFittingSearch(p, both.scenes, { provider: both.provider, ratings: both.ratings }))
  assert.deepEqual(firsts, [0, 0, 0, 1, 2])
  // The same with no make-up marked.
  assert.deepEqual(planSources(solo, env).scenes.map((s) => s.tags), [["frieren", "solo"], ["frieren"]])
})

check(() => {
  // And back: "frieren" to "frieren, solo" keeps only the pictures of her alone.
  assert.deepEqual(kept([...soloPosts, ...withOthers], ownPlan(["frieren", "solo"])).map((k) => k.id), [1, 2, 3])
})

check(() => {
  // A pose added: only the posts that have it stay, the character's first.
  const after = planSources(sitting, env)
  assert.deepEqual(after.scenes.map((s) => [s.kind, s.tags]), [["own", ["frieren", "sitting"]], ["theme", ["sitting"]]])
  assert.deepEqual(kept([...soloPosts, ...withOthers], after), [
    { id: 1, search: "own" },
    { id: 3, search: "own" },
    { id: 4, search: "own" },
  ])
})

check(() => {
  // The pose taken away: the theme search's pictures of other characters go; hers stay.
  const before = planSources(sitting, env)
  assert.ok(before.scenes.some((s) => s.kind === "theme"))
  const after = planSources(solo, env)
  const loaded = [post(1, "1girl solo sitting", "frieren"), post(4, "1girl 1boy sitting", "frieren himmel_(sousou_no_frieren)"), ...anyoneSitting]
  assert.deepEqual(kept(loaded, after).map((k) => k.id), [1, 4])
  // With "frieren, solo" instead, only her pictures alone.
  assert.deepEqual(kept(loaded, ownPlan(["frieren", "solo"])).map((k) => k.id), [1])
})

check(() => {
  // Another site: nothing stays, even with the same tags.
  const after = planSources(solo, { ...env, provider: "gelbooru" })
  assert.equal(after.scenes[0].tags.join(" "), "frieren solo")
  assert.deepEqual(kept(soloPosts, after), [])
  const gelbooru = soloPosts.map((p) => ({ ...p, provider: "gelbooru" as BooruProvider }))
  assert.deepEqual(kept(gelbooru, after).map((k) => k.id), [1, 2, 3])
})

check(() => {
  // Another rating: only posts fetched at one of the plan's ratings.
  const explicit = planSources(solo, { ...env, rating: "explicit" })
  assert.deepEqual(kept(soloPosts, explicit), [])
  // Adding sensitive keeps what the safe search had.
  const sensitive = planSources(solo, { ...env, includeSensitive: true })
  assert.deepEqual(kept(soloPosts, sensitive).map((k) => k.id), [1, 2, 3])
})

check(() => {
  // Donor searches: a garment's posts fit the donor search of the plan that asks for it.
  const bikini: PackBrief = { ...solo, requests: [{ tag: "bikini", role: "wearing" }] }
  const plan = planSources(bikini, { ...env, conditions: ["bikini"] })
  assert.equal(plan.donors.length, 1)
  const donor = plan.donors[0]
  const fit = (p: LoadedPost) => postFitsSearch(p, donor, { provider: plan.provider, ratings: [donor.ratingFilter] })
  assert.equal(fit(post(8, "1girl solo bikini beach", "makima_(chainsaw_man)")), true)
  assert.equal(fit(post(9, "1girl solo swimsuit", "makima_(chainsaw_man)")), false)
})

check(() => {
  // How a search's terms are read.
  const tags = new Set(["frieren", "solo", "sitting"])
  assert.equal(tagsFitSearch(tags, ["frieren", "solo", "rating:general", "order:random"]), true)
  assert.equal(tagsFitSearch(tags, ["Frieren", "Solo"]), true)
  assert.equal(tagsFitSearch(tags, ["frieren", "-1boy"]), true)
  assert.equal(tagsFitSearch(tags, ["frieren", "-sitting"]), false)
  // Terms the post's tags can't confirm: not shown to fit.
  assert.equal(tagsFitSearch(tags, ["frieren", "score:>10"]), false)
  assert.equal(tagsFitSearch(tags, ["frier*"]), false)
  assert.equal(tagsFitSearch(tags, ["~frieren", "~fern"]), false)
  // A search that asks nothing but the rating fits every post (the rating is checked apart).
  assert.equal(tagsFitSearch(tags, ["rating:general"]), true)
})

console.log(`pack-source-fit: ${passed} checks passed`)
