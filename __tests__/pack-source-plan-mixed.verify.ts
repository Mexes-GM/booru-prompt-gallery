/**
 * The source plan of a pack that mixes several People compositions (lib/pack/source-plan.ts):
 * each composition of two or more people gets the search a pack of only that composition has,
 * between the character's own search and the search that reaches every composition, within the
 * feed slots, and what doesn't fit is reported.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-source-plan-mixed.verify.ts
 */
import assert from "node:assert/strict"
import { addCharacter, addTag, emptyBrief, type PackBrief } from "../lib/pack/brief"
import { MAX_FEEDS, MAX_SCENE_SEARCHES, planFeeds, planSources, preferredSearchIds, type SourcePlan, type SourcePlanEnv } from "../lib/pack/source-plan"
import { compositionQuery } from "../lib/pack/scene/cast"
import { getProviderTagLimit } from "../lib/booru/tag-limits"
import type { PackPeople } from "../lib/pack/scene/scene-pool"

let passed = 0
const check = (fn: () => void) => { fn(); passed++ }

const OVERRIDES: Record<string, string> = { hug: "pose:interaction", sitting: "pose:posture", "tifa lockhart": "other:character" }
const withTags = (brief: PackBrief, ...tags: string[]) => tags.reduce((b, t) => addTag(b, t, OVERRIDES), brief)
const tifa = () => addCharacter(emptyBrief(), "tifa lockhart")
const env = (over: Partial<SourcePlanEnv> = {}): SourcePlanEnv => ({ provider: "gelbooru", rating: "explicit", includeSensitive: false, roles: ["girl"], ...over })
const show = (plan: SourcePlan) => plan.scenes.map((s) => `${s.kind}: ${s.query}`)
const FREE = /^(rating|score|tagcount):/i
const counted = (tags: readonly string[]) => tags.filter((t) => !FREE.test(t)).length

const ALONE: PackPeople = { girls: 1, boys: 0 }
const ONE_BOY: PackPeople = { girls: 1, boys: 1 }
const TWO_BOYS: PackPeople = { girls: 1, boys: 2 }
const TWO_GIRLS: PackPeople = { girls: 2, boys: 0 }

/** The search a pack of only `people` has, without a pose. */
const unmixedGroup = (people: PackPeople, over: Partial<SourcePlanEnv> = {}) => {
  const e = env(over)
  return compositionQuery(people, e.provider, "", e.rating)
}

// Alone + With 2 boys: alone, the composition's own search, by name.
check(() => {
  const plan = planSources(tifa(), env({ compositions: [ALONE, TWO_BOYS] }))
  assert.deepEqual(show(plan), ["own: tifa_lockhart, solo", `group: ${unmixedGroup(TWO_BOYS)}`, "own: tifa_lockhart"])
  assert.deepEqual(plan.scenes[1].people, TWO_BOYS, "the composition search says its composition")
  assert.deepEqual(plan.leftOutSearches, [])
  assert.equal(plan.people, null, "no one head count for the plan")
  assert.equal(plan.baseLookFromPool, false, "the look is read apart")
  // The same composition search a pack of only "With 2 boys" has: same id, same feeds and cache.
  const only = planSources({ ...tifa(), people: { ...TWO_BOYS } }, env())
  assert.equal(plan.scenes[1].id, only.scenes[0].id)
  // Their posts go first with the character's own: the composition isn't left for last.
  assert.deepEqual(preferredSearchIds(plan), plan.scenes.map((s) => s.id))
  assert.deepEqual(preferredSearchIds(only), [], "a pack of one composition prefers nothing, as before")
  assert.deepEqual(preferredSearchIds(planSources(tifa(), env())), planSources(tifa(), env()).scenes.map((s) => s.id), "a character alone: their own searches, as before")
})

// Two group compositions: one search each, in the order ticked, then by name.
check(() => {
  const plan = planSources(tifa(), env({ compositions: [TWO_BOYS, ONE_BOY] }))
  assert.deepEqual(show(plan), [`group: ${unmixedGroup(TWO_BOYS)}`, `group: ${unmixedGroup(ONE_BOY)}`, "own: tifa_lockhart"])
  assert.deepEqual(plan.scenes.map((s) => s.people ?? null), [TWO_BOYS, ONE_BOY, null])
  const swapped = planSources(tifa(), env({ compositions: [ONE_BOY, TWO_BOYS] }))
  assert.deepEqual(show(swapped).slice(0, 2), [`group: ${unmixedGroup(ONE_BOY)}`, `group: ${unmixedGroup(TWO_BOYS)}`], "the order ticked")
  // A repeated composition is searched once.
  assert.deepEqual(show(planSources(tifa(), env({ compositions: [TWO_BOYS, TWO_BOYS, ONE_BOY] }))), show(plan))
})

// Too many for the slots: trimmed in priority order, the rest reported.
check(() => {
  const plan = planSources(tifa(), env({ compositions: [ALONE, ONE_BOY, TWO_BOYS] }))
  assert.equal(plan.scenes.length, MAX_SCENE_SEARCHES)
  assert.deepEqual(show(plan), ["own: tifa_lockhart, solo", `group: ${unmixedGroup(ONE_BOY)}`, `group: ${unmixedGroup(TWO_BOYS)}`])
  assert.deepEqual(plan.leftOutSearches, [{ kind: "own", query: "tifa_lockhart", people: null, reason: "search-limit" }], "the name search is the one left out")
  const four = planSources(tifa(), env({ compositions: [ALONE, ONE_BOY, TWO_BOYS, TWO_GIRLS] }))
  assert.deepEqual(four.leftOutSearches.map((s) => [s.kind, s.query, s.people]), [["group", unmixedGroup(TWO_GIRLS), TWO_GIRLS], ["own", "tifa_lockhart", null]])
  // Every plan fits the feed slots, at one rating and at two.
  for (const rating of ["explicit", "both"] as const) {
    const feeds = planFeeds(planSources(tifa(), env({ rating, compositions: [ALONE, ONE_BOY, TWO_BOYS, TWO_GIRLS] })), 1)
    assert(feeds.length <= MAX_FEEDS, `${rating}: ${feeds.length} feeds fit ${MAX_FEEDS} slots`)
  }
  // The plan without them all is still a different plan when one is unticked.
  assert.notEqual(planSources(tifa(), env({ compositions: [ALONE, ONE_BOY] })).sceneKey, plan.sceneKey)
})

// Per provider: Danbooru's two tags, Rule34's own spelling, both from compositionQuery.
check(() => {
  for (const provider of ["danbooru", "aibooru", "gelbooru", "rule34", "e621", "floofgens"] as const) {
    for (const rating of ["sfw", "questionable", "explicit", "both"] as const) {
      for (const brief of [tifa(), withTags(tifa(), "hug"), withTags(tifa(), "hug", "sitting")]) {
        const plan = planSources(brief, env({ provider, rating, includeSensitive: true, compositions: [ALONE, ONE_BOY, TWO_BOYS, TWO_GIRLS] }))
        const limit = getProviderTagLimit(provider)
        assert(plan.scenes.length >= 1 && plan.scenes.length <= MAX_SCENE_SEARCHES, `${provider}/${rating}: within the searches`)
        for (const s of plan.scenes) assert(counted(s.tags) <= limit, `${provider}/${rating}: "${s.query}" fits ${limit}`)
        assert.equal(new Set(plan.scenes.map((s) => s.id)).size, plan.scenes.length, `${provider}/${rating}: no search twice`)
        // Every pose is searched or reported.
        const searched = new Set(plan.scenes.flatMap((s) => s.poses))
        for (const r of brief.requests.filter((x) => x.role === "doing")) {
          assert(searched.has(r.tag) || plan.leftOut.some((l) => l.tag === r.tag && l.from === "pose"), `${provider}/${rating}: "${r.tag}" searched or reported`)
        }
      }
    }
  }
  const danbooru = planSources(tifa(), env({ provider: "danbooru", rating: "sfw", compositions: [ALONE, TWO_BOYS] }))
  assert.deepEqual(danbooru.scenes[1].tags, ["1girl", "2boys"], "Danbooru: the two count tags")
  const danbooruGirls = planSources(tifa(), env({ provider: "danbooru", rating: "explicit", compositions: [ALONE, TWO_GIRLS] }))
  assert.deepEqual(danbooruGirls.scenes[1].tags, ["2girls", "-1boy"], "Danbooru: one exclusion fits, the second doesn't")
  const danbooruPose = planSources(withTags(tifa(), "hug"), env({ provider: "danbooru", rating: "explicit", compositions: [ALONE, TWO_BOYS] }))
  assert.deepEqual(danbooruPose.scenes[1].tags, ["mmf_threesome", "hug"], "Danbooru with a pose: the pairing and the pose")
  const rule34 = planSources(tifa(), env({ provider: "rule34", compositions: [ALONE, TWO_BOYS] }))
  assert.deepEqual(rule34.scenes[1].tags, ["1girls", "2boys"], "Rule34 spells one girl 1girls")
  assert.equal(rule34.scenes[1].query, compositionQuery(TWO_BOYS, "rule34", "", "explicit"))
})

// With a pose: "name, pose", each composition's theme search, then the pose without any count.
check(() => {
  const plan = planSources(withTags(tifa(), "hug"), env({ compositions: [ALONE, TWO_BOYS] }))
  assert.deepEqual(show(plan), ["own: tifa_lockhart, hug", "theme: 1girl, 2boys, hug", "theme: hug"])
  assert.deepEqual(plan.scenes[1].people, TWO_BOYS)
  assert.deepEqual(plan.scenes[1].poses, ["hug"])
  // The theme search a pack of only "With 2 boys" and a hug has: same id.
  const only = planSources({ ...withTags(tifa(), "hug"), people: { ...TWO_BOYS } }, env())
  assert(only.scenes.some((s) => s.id === plan.scenes[1].id))
  // Their posts stay after the character's own, as in a pack of one composition with a pose.
  assert.deepEqual(preferredSearchIds(plan), [plan.scenes[0].id])
  // Two poses, two compositions: the compositions' searches keep both poses; the searches past the slots are reported.
  const two = planSources(withTags(tifa(), "hug", "sitting"), env({ compositions: [ONE_BOY, TWO_BOYS] }))
  assert.deepEqual(show(two), ["own: tifa_lockhart, hug", "theme: 1girl, 1boy, hug, sitting", "theme: 1girl, 2boys, hug, sitting"])
  assert.deepEqual(two.leftOutSearches.map((s) => s.query), ["hug, sitting", "hug"])
  assert.deepEqual(two.leftOut, [], "every pose is still searched")
  // On Danbooru the second pose doesn't fit any search kept: reported.
  const tight = planSources(withTags(tifa(), "hug", "sitting"), env({ provider: "danbooru", compositions: [ONE_BOY, TWO_BOYS] }))
  assert.deepEqual(tight.leftOut, [{ tag: "sitting", from: "pose", reason: "tag-limit" }])
})

// Not mixed, unnamed, or a cast: the compositions that can't hold the cast get no search.
check(() => {
  assert.deepEqual(planSources(tifa(), env({ compositions: [TWO_BOYS] })), planSources(tifa(), env()), "one composition: the plan as before")
  const unnamed = planSources(emptyBrief(), env({ roles: [], gallerySearch: "beach", compositions: [ALONE, TWO_BOYS] }))
  assert.deepEqual(show(unnamed), [`group: ${unmixedGroup(TWO_BOYS)}`, "gallery: beach"])
  const pair = addCharacter(tifa(), "cloud strife")
  const cast = planSources(pair, env({ roles: ["girl", "boy"], compositions: [ONE_BOY, TWO_GIRLS, TWO_BOYS] }))
  assert.deepEqual(show(cast), [`group: ${unmixedGroup(ONE_BOY)}`, `group: ${unmixedGroup(TWO_BOYS)}`, "own: tifa_lockhart"], "two girls can't hold a girl and a boy")
})

console.log(`pack-source-plan-mixed: ${passed} checks passed`)
