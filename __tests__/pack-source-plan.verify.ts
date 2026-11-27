/**
 * The source plan (lib/pack/source-plan.ts): which searches a brief's posts come from,
 * that every one fits the booru's tag limit, and that a requested tag that doesn't fit
 * is reported. Also the fixed feed slots the hook runs a plan on.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-source-plan.verify.ts
 */
import assert from "node:assert/strict"
import { addCharacter, addTag, emptyBrief, setCharacterRole, setPeople, type PackBrief } from "../lib/pack/brief"
import {
  assignFeedSlots, feedSeed, MAX_DONOR_FEEDS, MAX_DONOR_SEARCHES, MAX_FEEDS, MAX_RATINGS, MAX_SCENE_SEARCHES, planDonorFeeds, planFeeds, planSources,
  type FeedSlot, type SourcePlan, type SourcePlanEnv,
} from "../lib/pack/source-plan"
import { getProviderTagLimit, PROVIDER_TAG_LIMITS } from "../lib/booru/tag-limits"
import type { BooruProvider } from "../lib/booru/types"

let passed = 0
const check = (fn: () => void) => { fn(); passed++ }

const OVERRIDES: Record<string, string> = {
  sitting: "pose:posture", "princess carry": "pose:interaction", hug: "pose:interaction", running: "pose:kinetic",
  bikini: "clothing:outfit", beach: "scenery:setting", smile: "pose:expression",
  "tifa lockhart": "other:character", "cloud strife": "other:character",
}

const withTags = (brief: PackBrief, ...tags: string[]) => tags.reduce((b, t) => addTag(b, t, OVERRIDES), brief)
const tifa = () => addCharacter(emptyBrief(), "tifa lockhart")
const pair = () => addCharacter(tifa(), "cloud strife")
const env = (over: Partial<SourcePlanEnv> = {}): SourcePlanEnv => ({ provider: "danbooru", rating: "sfw", includeSensitive: false, ...over })

const FREE = /^(rating|score|tagcount):/i
const counted = (tags: readonly string[]) => tags.filter((t) => !FREE.test(t)).length

/** Every plan: within limits, nothing requested lost, sane keys. */
function invariants(plan: SourcePlan, brief: PackBrief, label: string) {
  const limit = getProviderTagLimit(plan.provider)
  assert(plan.scenes.length >= 1 && plan.scenes.length <= MAX_SCENE_SEARCHES, `${label}: 1..${MAX_SCENE_SEARCHES} scene searches`)
  assert(plan.ratings.length >= 1 && plan.ratings.length <= MAX_RATINGS, `${label}: 1..${MAX_RATINGS} ratings`)
  for (const s of plan.scenes) {
    assert(counted(s.tags) <= limit, `${label}: scene search "${s.query}" fits ${limit}`)
    assert(s.query === s.tags.join(", "), `${label}: query is the tags`)
    assert(!s.tags.some((t) => /\s/.test(t)), `${label}: booru spelling in "${s.query}"`)
  }
  for (const a of plan.appearance) {
    // The "popular" order takes one slot where there is a limit.
    assert(counted(a.tags) + (Number.isFinite(limit) ? 1 : 0) <= limit, `${label}: appearance search "${a.query}" fits with its order tag`)
    assert(a.ratingFilter === plan.ratings[0], `${label}: appearance at the first rating`)
  }
  const ids = plan.scenes.map((s) => s.id)
  assert(new Set(ids).size === ids.length, `${label}: no repeated search`)
  // Every requested pose is in a pose search, or declared left out.
  const poses = brief.requests.filter((r) => r.role === "doing").map((r) => r.tag)
  const inSearch = new Set(plan.scenes.flatMap((s) => s.poses))
  for (const pose of poses) {
    assert(inSearch.has(pose) || plan.leftOut.some((l) => l.tag === pose && l.from === "pose"), `${label}: "${pose}" searched or reported`)
  }
  // Nothing the brief asks besides poses goes in a search (the gallery's own search is the user's, as typed).
  for (const s of plan.scenes.filter((x) => x.kind !== "gallery")) {
    for (const t of ["bikini", "beach", "smile"]) assert(!s.tags.includes(t), `${label}: "${t}" is not searched`)
  }
}

type Row = { label: string; brief: PackBrief; env: SourcePlanEnv; scenes: string[]; appearance: string[]; leftOut?: string[]; ratings?: string[] }

const ROWS: Row[] = [
  { label: "one character, nothing asked", brief: tifa(), env: env(),
    scenes: ["own: tifa_lockhart, solo", "own: tifa_lockhart"], appearance: ["tifa_lockhart"] },
  { label: "one character, clothes and a place asked", brief: withTags(tifa(), "bikini", "beach", "smile"), env: env(),
    scenes: ["own: tifa_lockhart, solo", "own: tifa_lockhart"], appearance: ["tifa_lockhart"] },
  { label: "one character, one pose", brief: withTags(tifa(), "princess carry"), env: env(),
    scenes: ["own: tifa_lockhart, princess_carry", "theme: princess_carry"], appearance: ["tifa_lockhart"] },
  { label: "one character, two poses, Danbooru", brief: withTags(tifa(), "princess carry", "sitting"), env: env(),
    scenes: ["own: tifa_lockhart, princess_carry", "theme: princess_carry, sitting", "anchor: princess_carry"], appearance: ["tifa_lockhart"] },
  { label: "one character, three poses, Danbooru", brief: withTags(tifa(), "princess carry", "sitting", "running"), env: env(),
    scenes: ["own: tifa_lockhart, princess_carry", "theme: princess_carry, sitting", "anchor: princess_carry"], appearance: ["tifa_lockhart"],
    leftOut: ["running"] },
  { label: "one character, three poses, Gelbooru", brief: withTags(tifa(), "princess carry", "sitting", "running"), env: env({ provider: "gelbooru" }),
    scenes: ["own: tifa_lockhart, princess_carry", "theme: princess_carry, sitting, running", "anchor: princess_carry"], appearance: ["tifa_lockhart, solo"] },
  { label: "one character, two poses, Gelbooru", brief: withTags(tifa(), "hug", "sitting"), env: env({ provider: "gelbooru" }),
    scenes: ["own: tifa_lockhart, hug", "theme: hug, sitting", "anchor: hug"], appearance: ["tifa_lockhart, solo"] },
  { label: "unnamed, nothing asked, gallery search", brief: emptyBrief(), env: env({ gallerySearch: "beach, sunset" }),
    scenes: ["gallery: beach, sunset"], appearance: [] },
  { label: "unnamed, gallery search over the limit", brief: emptyBrief(), env: env({ gallerySearch: "beach, sunset, rating:general, ocean" }),
    scenes: ["gallery: beach, sunset, rating:general"], appearance: [], leftOut: ["ocean"] },
  { label: "unnamed, no gallery search", brief: emptyBrief(), env: env(),
    scenes: ["gallery: "], appearance: [] },
  { label: "unnamed, one pose", brief: withTags(emptyBrief(), "hug"), env: env({ gallerySearch: "beach" }),
    scenes: ["theme: hug"], appearance: [] },
  { label: "cast of two, roles known, nothing asked", brief: pair(), env: env({ roles: ["girl", "boy"] }),
    scenes: ["group: 1girl, 1boy"], appearance: ["tifa_lockhart", "cloud_strife"] },
  { label: "cast of two, roles known, one pose, Danbooru", brief: withTags(pair(), "hug"), env: env({ roles: ["girl", "boy"] }),
    scenes: ["theme: hetero, hug"], appearance: ["tifa_lockhart", "cloud_strife"] },
  { label: "cast of two, roles known, two poses, Danbooru", brief: withTags(pair(), "hug", "sitting"), env: env({ roles: ["girl", "boy"] }),
    scenes: ["theme: hetero, hug"], appearance: ["tifa_lockhart", "cloud_strife"], leftOut: ["sitting"] },
  { label: "cast of two, roles known, two poses, Gelbooru", brief: withTags(pair(), "hug", "sitting"), env: env({ provider: "gelbooru", roles: ["girl", "boy"] }),
    scenes: ["theme: 1girl, 1boy, hug, sitting", "anchor: 1girl, 1boy, hug"], appearance: ["tifa_lockhart, solo", "cloud_strife, solo"] },
  { label: "cast of two, roles from the brief", brief: setCharacterRole(setCharacterRole(pair(), "tifa lockhart", "girl"), "cloud strife", "boy"), env: env(),
    scenes: ["group: 1girl, 1boy"], appearance: ["tifa_lockhart", "cloud_strife"] },
  { label: "cast of two, a role unknown", brief: pair(), env: env({ roles: ["girl", null] }),
    scenes: ["own: tifa_lockhart"], appearance: ["tifa_lockhart", "cloud_strife"] },
  { label: "one character with a head count of two", brief: setPeople(tifa(), { girls: 1, boys: 1 }), env: env(),
    scenes: ["group: 1girl, 1boy"], appearance: ["tifa_lockhart"] },
  { label: "safe with sensitive", brief: tifa(), env: env({ includeSensitive: true }),
    scenes: ["own: tifa_lockhart, solo", "own: tifa_lockhart"], appearance: ["tifa_lockhart"], ratings: ["rating:general", "rating:sensitive"] },
  { label: "safe without sensitive", brief: withTags(tifa(), "hug"), env: env({ includeSensitive: false }),
    scenes: ["own: tifa_lockhart, hug", "theme: hug"], appearance: ["tifa_lockhart"], ratings: ["rating:general"] },
  { label: "safe with sensitive on e621", brief: tifa(), env: env({ provider: "e621", includeSensitive: true }),
    scenes: ["own: tifa_lockhart, solo", "own: tifa_lockhart"], appearance: ["tifa_lockhart, solo"], ratings: ["rating:general"] },
  { label: "questionable", brief: tifa(), env: env({ rating: "questionable", includeSensitive: true }),
    scenes: ["own: tifa_lockhart, solo", "own: tifa_lockhart"], appearance: ["tifa_lockhart"], ratings: ["rating:questionable"] },
  { label: "explicit", brief: withTags(tifa(), "hug"), env: env({ rating: "explicit" }),
    scenes: ["own: tifa_lockhart, hug", "theme: hug"], appearance: ["tifa_lockhart"], ratings: ["rating:explicit"] },
  { label: "both", brief: tifa(), env: env({ rating: "both" }),
    scenes: ["own: tifa_lockhart, solo", "own: tifa_lockhart"], appearance: ["tifa_lockhart"], ratings: ["rating:questionable", "rating:explicit"] },
]

for (const row of ROWS) {
  check(() => {
    const plan = planSources(row.brief, row.env)
    invariants(plan, row.brief, row.label)
    const scenes = plan.scenes.map((s) => `${s.kind}: ${s.query}`)
    assert.deepEqual(scenes, row.scenes, `${row.label}: scene searches ${JSON.stringify(scenes)}`)
    assert.deepEqual(plan.appearance.map((a) => a.query), row.appearance, `${row.label}: appearance ${JSON.stringify(plan.appearance.map((a) => a.query))}`)
    assert.deepEqual(plan.leftOut.map((l) => l.tag), row.leftOut ?? [], `${row.label}: left out ${JSON.stringify(plan.leftOut)}`)
    if (row.ratings) assert.deepEqual(plan.ratings, row.ratings, `${row.label}: ratings`)
  })
}

// Every provider and rating, with many poses and a cast: still within the limits.
check(() => {
  const providers: BooruProvider[] = ["danbooru", "aibooru", "gelbooru", "rule34", "e621", "e6ai"]
  const briefs = [tifa(), withTags(tifa(), "hug", "sitting", "running", "princess carry"), withTags(pair(), "hug", "sitting", "running"), withTags(emptyBrief(), "hug", "sitting", "running")]
  for (const provider of providers) {
    for (const rating of ["sfw", "questionable", "explicit", "both"] as const) {
      for (const brief of briefs) {
        for (const roles of [["girl", "boy"], ["girl", "girl"], ["boy", "boy"]] as const) {
          invariants(planSources(brief, { provider, rating, includeSensitive: true, roles, gallerySearch: "a, b, c, d" }), brief, `${provider}/${rating}`)
        }
      }
    }
  }
})

check(() => {
  const plan = planSources(withTags(tifa(), "hug", "sitting", "running"), env())
  assert.deepEqual(plan.leftOut, [{ tag: "running", from: "pose", reason: "tag-limit" }], "a left-out pose says what and why")
  assert.equal(plan.sensitive, "excluded")
  assert.equal(planSources(tifa(), env({ includeSensitive: true })).sensitive, "included")
  assert.equal(planSources(tifa(), env({ provider: "e621", includeSensitive: true })).sensitive, "unavailable")
  assert.equal(planSources(tifa(), env({ rating: "explicit" })).sensitive, null)
  assert.equal(planSources(pair(), env({ roles: ["girl", null] })).rolesPending, true, "roles pending is reported")
  assert.deepEqual(planSources(pair(), env({ roles: ["girl", "boy"] })).people, { girls: 1, boys: 1 })
})

// Keys: a change that doesn't touch the searches keeps them; one that does changes them.
check(() => {
  const plain = planSources(withTags(tifa(), "hug"), env())
  const dressed = planSources(withTags(tifa(), "hug", "bikini", "beach", "smile"), env())
  assert.equal(dressed.key, plain.key, "clothes, place and expression keep the plan")
  const more = planSources(withTags(tifa(), "hug", "sitting"), env())
  assert.notEqual(more.sceneKey, plain.sceneKey, "a second pose changes the scene searches")
  assert.equal(more.appearanceKey, plain.appearanceKey, "but not the appearance search")
  const shared = plain.scenes.filter((s) => more.scenes.some((m) => m.id === s.id)).map((s) => s.kind)
  assert.deepEqual(shared, ["own", "theme"], "both searches of the first plan are still searched")
  assert.equal(more.scenes.find((s) => s.kind === "anchor")?.id, plain.scenes.find((s) => s.kind === "theme")?.id, "the first pose alone is the old theme search, same id")
  const sensitive = planSources(withTags(tifa(), "hug"), env({ includeSensitive: true }))
  assert.notEqual(sensitive.sceneKey, plain.sceneKey, "adding a rating changes the scene key")
  assert.deepEqual(sensitive.scenes.map((s) => s.id), plain.scenes.map((s) => s.id), "with the same search ids")
  const other = planSources(withTags(tifa(), "hug"), env({ provider: "gelbooru" }))
  assert.notEqual(other.sceneKey, plain.sceneKey, "another booru is another search")
  assert.equal(planSources(tifa(), env({ gallerySearch: "x" })).key, planSources(tifa(), env({ gallerySearch: "y" })).key, "the gallery search only matters without a name")
})

// Feed slots: fixed count, kept in place, unused ones fetch nothing new.
check(() => {
  const seed = 1234
  const a = planFeeds(planSources(withTags(tifa(), "hug"), env({ includeSensitive: true })), seed)
  assert.equal(a.length, 4, "two searches at two ratings")
  assert.equal(feedSeed("x", seed), feedSeed("x", seed), "a search's seed is stable")
  const first = assignFeedSlots(null, a)
  assert.equal(first.length, MAX_FEEDS)
  assert.deepEqual(first.slice(0, 4).map((s) => s.feedId), a.map((f) => f.feedId), "first plan fills slots in order")
  assert(first.slice(4).every((s) => !s.active && s.feedId === a[0].feedId), "unused slots copy the first feed")

  // A second pose: the own search stays in its slots, the theme moves on.
  const b = planFeeds(planSources(withTags(tifa(), "hug", "sitting"), env({ includeSensitive: true })), seed)
  const second = assignFeedSlots(first, b)
  const at = (slots: FeedSlot[], feedId: string) => slots.findIndex((s) => s.active && s.feedId === feedId)
  for (const feed of a.filter((f) => b.some((x) => x.feedId === f.feedId))) {
    assert.equal(at(second, feed.feedId), at(first, feed.feedId), `feed ${feed.feedId} keeps its slot`)
  }
  assert.equal(second.filter((s) => s.active).length, b.length, "every wanted feed is placed")
  assert.equal(new Set(second.filter((s) => s.active).map((s) => s.feedId)).size, b.length, "no feed twice")

  // Back to one search: the others go idle with their last spec, not another feed's.
  const c = planFeeds(planSources(withTags(tifa(), "hug"), env({ includeSensitive: true })), seed)
  const third = assignFeedSlots(second, c)
  third.forEach((slot, i) => {
    if (!slot.active) assert.equal(slot.feedId, second[i].feedId, `idle slot ${i} keeps its spec`)
  })
  for (const feed of c) assert(at(third, feed.feedId) >= 0, `feed ${feed.feedId} placed`)
  for (const feed of c.filter((f) => second.some((s) => s.active && s.feedId === f.feedId))) {
    assert.equal(at(third, feed.feedId), at(second, feed.feedId), `feed ${feed.feedId} keeps its slot again`)
  }

  // The most a plan needs fits.
  const most = planFeeds(planSources(withTags(tifa(), "hug", "sitting"), env({ rating: "both" })), seed)
  assert.equal(most.length, MAX_FEEDS, "three searches at two ratings fill every slot")
  assert(assignFeedSlots(third, most).every((s) => s.active), "all active")
})

console.log(`pack-source-plan: ${passed} checks passed`)

// ── Donor searches for conditions (ENG-7) ────────────────────────────────────
check(() => {
  const C_OVERRIDES: Record<string, string> = { ...OVERRIDES, thighhighs: "clothing:legwear", "school uniform": "clothing:outfit", classroom: "scenery:setting", boots: "clothing:footwear" }
  const brief = ["bikini", "thighhighs", "boots", "beach", "classroom", "sitting"].reduce((b, t) => addTag(b, t, C_OVERRIDES), tifa())

  // Without conditions: no donor search, and the plan (its key too) is the one it always was.
  const plain = planSources(brief, env())
  assert.deepEqual(plain.donors, [], "no conditions, no donor search")
  assert.equal(plain.donorKey, "")
  assert.equal(plain.key, `${plain.sceneKey}##${plain.appearanceKey}`, "the key without donors is the old one")
  assert.deepEqual(planSources(brief, env({ conditions: [] })), plain, "an empty list is the same as none")

  // Gelbooru (no tag limit): every garment met as a condition in one search, the places in another.
  const all = planSources(brief, env({ provider: "gelbooru", conditions: ["bikini", "thighhighs", "beach"] }))
  assert.equal(all.donors.length, 2)
  assert.equal(all.donors[0].kind, "wearing")
  assert.deepEqual(all.donors[0].tags, ["bikini", "thighhighs"], "the garments together; boots is exact, not searched")
  assert.equal(all.donors[0].query, "bikini, thighhighs")
  assert.equal(all.donors[1].kind, "where")
  assert.deepEqual(all.donors[1].tags, ["beach"], "classroom is exact, not searched")
  assert(all.donors.every((d) => d.ratingFilter === all.ratings[0]), "donors at the plan's first rating")
  assert.deepEqual(all.scenes, planSources(brief, env({ provider: "gelbooru" })).scenes, "the scene searches don't change")
  assert.notEqual(all.key, planSources(brief, env({ provider: "gelbooru" })).key, "the key changes with the donor searches")

  // Danbooru (2 tags): the first garments written fill the search, the rest are reported.
  const three = ["bikini", "thighhighs", "boots"].reduce((b, t) => addTag(b, t, C_OVERRIDES), tifa())
  const limited = planSources(three, env({ provider: "danbooru", conditions: ["bikini", "thighhighs", "boots"] }))
  assert.deepEqual(limited.donors[0].tags, ["bikini", "thighhighs"])
  assert(limited.leftOut.some((l) => l.tag === "boots" && l.from === "condition" && l.reason === "tag-limit"), "boots left out and reported")
  for (const d of limited.donors) assert(counted(d.tags) <= getProviderTagLimit("danbooru"), `donor search "${d.query}" fits`)

  // A safe pack with sensitive posts: two scene ratings, the donors take the first only (one request each).
  const safe = planSources(brief, env({ provider: "gelbooru", includeSensitive: true, conditions: ["bikini", "beach"] }))
  assert.deepEqual(safe.ratings, ["rating:general", "rating:sensitive"])
  const feeds = planDonorFeeds(safe, 7)
  assert.equal(feeds.length, 2, "one feed per donor search")
  assert(feeds.length <= MAX_DONOR_FEEDS)
  assert(feeds.every((f) => f.ratingFilter === "rating:general"))
  assert.equal(feeds[0].seed, feedSeed(safe.donors[0].id, 7), "seeded like the scene feeds")
  assert.equal(new Set(feeds.map((f) => f.feedId)).size, 2)
  assert(MAX_DONOR_SEARCHES === 2)

  // A condition the brief doesn't ask for does nothing; the conditions follow the brief's spelling.
  const stray = planSources(tifa(), env({ conditions: ["bikini"] }))
  assert.deepEqual(stray.donors, [])
})

console.log(`pack-source-plan (conditions): done`)

// ── Mixed compositions (ENG-10) ──────────────────────────────────────────────
check(() => {
  const mix = [{ girls: 1, boys: 2 }, { girls: 1, boys: 3 }]
  // A head count the user set: one composition asks for it; several don't.
  const set = setPeople(withTags(tifa(), "hug"), { girls: 1, boys: 2 })
  const one = planSources(set, env({ provider: "gelbooru" }))
  assert(one.scenes.some((s) => s.tags.includes("2boys")), "one composition: the theme search asks for its count")
  const many = planSources(set, env({ provider: "gelbooru", compositions: mix }))
  assert.deepEqual(many.scenes.map((s) => `${s.kind}: ${s.query}`), ["own: tifa_lockhart, hug", "theme: 1girl, 2boys, hug", "theme: 1girl, 3boys, hug"], "two compositions: each asks for its own count")
  assert(many.scenes.some((s) => s.kind === "theme" && s.tags.includes("hug")), "the pose is still searched")
  assert.equal(many.people, null)
  invariants(many, set, "mixed with a pose")
  // No pose: the character's own posts by name, not only those alone.
  const plain = planSources(tifa(), env({ compositions: mix }))
  assert.deepEqual(plain.scenes.map((s) => s.tags), [["1girl", "2boys"], ["1girl", "3boys"], ["tifa_lockhart"]], "no pose: each composition, then the name alone")
  assert.deepEqual(planSources(tifa(), env({ compositions: [mix[0]] })), planSources(tifa(), env()), "one composition in the list: the plan as before")
})

console.log(`pack-source-plan (compositions): done`)

// ── One character with no pose: alone and by name, the look read apart ─────
check(() => {
  const show = (plan: SourcePlan) => ({ scenes: plan.scenes.map((s) => `${s.kind}: ${s.query}`), appearance: plan.appearance.map((a) => a.query), fromPool: plan.baseLookFromPool })
  const both = ["own: tifa_lockhart, solo", "own: tifa_lockhart"]
  // No pose, no People: their posts alone (fills the pack alone) and by name (every composition of theirs).
  for (const provider of ["danbooru", "aibooru", "gelbooru", "rule34", "e621", "e6ai"] as const) {
    const plan = planSources(tifa(), env({ provider }))
    invariants(plan, tifa(), `alone and by name on ${provider}`)
    assert.deepEqual(plan.scenes.map((s) => s.tags), [["tifa_lockhart", "solo"], ["tifa_lockhart"]], `${provider}: "name, solo" and "name"`)
    assert.notEqual(plan.scenes[0].id, plan.scenes[1].id, `${provider}: one id per search`)
    assert.deepEqual(plan.appearance.map((a) => a.character), ["tifa lockhart"], `${provider}: an appearance search for the character`)
    assert.equal(plan.baseLookFromPool, false, `${provider}: the look doesn't come from a pool that mixes "name"`)
  }
  // The ids stay put: the same searches, the same feeds (and the old "name, solo" id is the new solo one).
  assert.deepEqual(planSources(tifa(), env()).scenes.map((s) => s.id), ["scene|danbooru|tifa_lockhart solo", "scene|danbooru|tifa_lockhart"])
  // People set to one person: the character alone, the same two searches.
  assert.deepEqual(show(planSources(setPeople(tifa(), { girls: 1, boys: 0 }), env())),
    { scenes: both, appearance: ["tifa_lockhart"], fromPool: false }, "People set to one: alone and by name")
  // People set to two or more: the search of that composition, as before.
  assert.deepEqual(show(planSources(setPeople(tifa(), { girls: 1, boys: 2 }), env())),
    { scenes: ["group: 1girl, 2boys"], appearance: ["tifa_lockhart"], fromPool: false }, "People set: the composition's search")
  assert.deepEqual(show(planSources(setPeople(tifa(), { girls: 1, boys: 1 }), env({ provider: "gelbooru" }))),
    { scenes: ["group: 1girl, 1boy"], appearance: ["tifa_lockhart, solo"], fromPool: false }, "People set on Gelbooru")
  // Mixed compositions with the character alone: "name, solo", the composition's search and "name"; without it, each composition's search and "name".
  const withAlone = [{ girls: 1, boys: 0 }, { girls: 1, boys: 1 }]
  assert.deepEqual(show(planSources(tifa(), env({ compositions: withAlone }))),
    { scenes: ["own: tifa_lockhart, solo", "group: 1girl, 1boy", "own: tifa_lockhart"], appearance: ["tifa_lockhart"], fromPool: false }, "mixed with alone: alone, the composition and by name, the look read apart")
  assert.deepEqual(show(planSources(tifa(), env({ provider: "gelbooru", compositions: withAlone }))),
    { scenes: ["own: tifa_lockhart, solo", "group: 1girl, 1boy", "own: tifa_lockhart"], appearance: ["tifa_lockhart, solo"], fromPool: false }, "mixed with alone on Gelbooru")
  assert.deepEqual(show(planSources(tifa(), env({ compositions: [{ girls: 1, boys: 1 }, { girls: 1, boys: 2 }] }))),
    { scenes: ["group: 1girl, 1boy", "group: 1girl, 2boys", "own: tifa_lockhart"], appearance: ["tifa_lockhart"], fromPool: false }, "mixed without alone: each composition and the name, no solo search")
  // With a pose, a cast, the gallery: unchanged.
  assert.deepEqual(show(planSources(withTags(tifa(), "hug"), env())).scenes, ["own: tifa_lockhart, hug", "theme: hug"])
  assert.deepEqual(show(planSources(withTags(tifa(), "hug"), env({ compositions: withAlone }))).scenes, ["own: tifa_lockhart, hug", "theme: hetero, hug", "theme: hug"], "mixed with a pose: the composition's pose search between the own and the anyone searches")
  assert.deepEqual(show(planSources(pair(), env({ roles: ["girl", null] }))).scenes, ["own: tifa_lockhart"], "a cast waiting for its roles: the name only")
  assert.deepEqual(show(planSources(emptyBrief(), env({ gallerySearch: "solo, beach" }))),
    { scenes: ["gallery: solo, beach"], appearance: [], fromPool: false }, "unnamed: the gallery search, no look search")
  // The busiest no-pose plan (mixed with alone, two ratings, donors) fits the feed slots.
  const busy = planSources(withTags(tifa(), "bikini", "beach"), env({ provider: "gelbooru", rating: "both", compositions: withAlone, conditions: ["bikini", "beach"] }))
  assert.equal(planFeeds(busy, 1).length, 6, "three scene searches at two ratings")
  assert(planFeeds(busy, 1).length <= MAX_FEEDS && planDonorFeeds(busy, 1).length === 2 && planDonorFeeds(busy, 1).length <= MAX_DONOR_FEEDS)
  // A booru that takes one tag: the name only.
  const saved = PROVIDER_TAG_LIMITS.danbooru
  try {
    PROVIDER_TAG_LIMITS.danbooru = 1
    const one = planSources(tifa(), env())
    assert.deepEqual(one.scenes.map((s) => `${s.kind}: ${s.query}`), ["own: tifa_lockhart"], "one-tag limit: the name")
    assert.deepEqual(one.appearance.map((a) => a.query), ["tifa_lockhart"], "one-tag limit: the look search by name (typicalLook keeps the posts alone)")
  } finally {
    PROVIDER_TAG_LIMITS.danbooru = saved
  }
})

console.log(`pack-source-plan (alone and by name): done`)
