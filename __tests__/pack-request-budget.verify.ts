/**
 * The requests Pack Mode's source sends:
 *   1. Danbooru/Aibooru page range from the counts endpoint, one request; binary search only
 *      when the count is missing; the same count gives the same range and order.
 *   2. The count kept for a day per site and query.
 *   3. A condition's donor search pages past its first page only while the condition is short.
 *   4. One pacer per site (burst, then a steady pace, in requests) and one budget per pack
 *      that a change of plan doesn't reset.
 *   5. A search whose first page added nothing new to the pack still gets pages.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-request-budget.verify.ts
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { countFromResponse, lastPageFromCount, lastPageOf, randomPageOrder, MAX_RANDOM_PAGE } from "../lib/booru/page-range"
import { PAGE_COUNT_CACHE_KEY, PAGE_COUNT_TTL_MS, MAX_CACHED_COUNTS, readCachedCount, writeCachedCount } from "../lib/booru/page-count-cache"
import { PACE, RequestPacer, type PacerClock } from "../lib/booru/request-pacer"
import { AUTO_REQUEST_CAP, PackRequestBudget, SESSION_REQUEST_CAP } from "../lib/pack/request-budget"
import { NO_PAGING, TURN_GAP, nextSearch, recordPage, searchEnded, type SearchPaging, type SearchTurn } from "../lib/pack/source-paging"
import { shortConditionRoles, type ConditionSupply } from "../lib/pack/brief-pack"
import { createSeededRng } from "../lib/pack/pack-generator"

let passed = 0
const checks: Array<[string, () => void | Promise<void>]> = []
const check = (name: string, fn: () => void | Promise<void>) => { checks.push([name, fn]) }

// ── 1. Page range from the counts endpoint ─────────────────────────────────────────
check("count path: one request, the range from the count, no binary search", async () => {
  let countCalls = 0
  let probes = 0
  const { lastPage, count } = await lastPageOf({
    perPage: 30,
    count: async () => { countCalls++; return countFromResponse({ counts: { posts: 840 } }) },
    hasPosts: async () => { probes++; return true },
  })
  assert.equal(countCalls, 1)
  assert.equal(probes, 0)
  assert.equal(count, 840)
  assert.equal(lastPage, 28)
  assert.equal(lastPage, lastPageFromCount(840, 30))
  // The same count gives the same range and, with the same seed, the same order as before.
  assert.deepEqual(randomPageOrder(lastPage, createSeededRng(42)), randomPageOrder(lastPageFromCount(840, 30), createSeededRng(42)))
  // A count past the deepest sampled page is capped as before.
  const big = await lastPageOf({ perPage: 30, count: async () => 9017, hasPosts: async () => true })
  assert.equal(big.lastPage, MAX_RANDOM_PAGE)
})

check("count path: a missing, odd or failed count falls back to the binary search", async () => {
  assert.equal(countFromResponse({ counts: { posts: 0 } }), 0)
  assert.equal(countFromResponse({ counts: { posts: null } }), null)
  assert.equal(countFromResponse({ counts: { posts: "840" } }), null)
  assert.equal(countFromResponse({ counts: {} }), null)
  assert.equal(countFromResponse({}), null)
  assert.equal(countFromResponse(null), null)
  assert.equal(countFromResponse({ counts: { posts: Number.NaN } }), null)
  for (const count of [async () => null, async () => { throw new Error("HTTP 500") }]) {
    let probes = 0
    const result = await lastPageOf({ perPage: 30, count, hasPosts: async (page) => { probes++; return page <= 37 } })
    assert.equal(result.lastPage, 37)
    assert.equal(result.count, null)
    assert.ok(probes > 1 && probes <= 10, `${probes} probes`)
  }
})

// ── 2. The count kept for a day ─────────────────────────────────────────────────────
function memoryStore() {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) }, data }
}

check("count cache: per site and query, for a day", () => {
  const store = memoryStore()
  const t0 = 1_700_000_000_000
  assert.equal(readCachedCount("danbooru", "rating:general tifa_lockhart solo", t0, store), null)
  writeCachedCount("danbooru", "rating:general tifa_lockhart solo", 840, t0, store)
  assert.equal(readCachedCount("danbooru", "rating:general tifa_lockhart solo", t0 + 1000, store), 840)
  assert.equal(readCachedCount("aibooru", "rating:general tifa_lockhart solo", t0 + 1000, store), null)
  assert.equal(readCachedCount("danbooru", "rating:general tifa_lockhart", t0 + 1000, store), null)
  assert.equal(readCachedCount("danbooru", "rating:general tifa_lockhart solo", t0 + PAGE_COUNT_TTL_MS, store), null)
  // A corrupt entry reads as empty; no storage at all too.
  store.data.set(PAGE_COUNT_CACHE_KEY, "{not json")
  assert.equal(readCachedCount("danbooru", "rating:general tifa_lockhart solo", t0, store), null)
  assert.equal(readCachedCount("danbooru", "x", t0, null), null)
  writeCachedCount("danbooru", "x", 1, t0, null)
  // Bounded: the oldest go first.
  const many = memoryStore()
  for (let i = 0; i < MAX_CACHED_COUNTS + 5; i++) writeCachedCount("danbooru", `q${i}`, i, t0 + i, many)
  assert.equal(Object.keys(JSON.parse(many.data.get(PAGE_COUNT_CACHE_KEY)!)).length, MAX_CACHED_COUNTS)
  assert.equal(readCachedCount("danbooru", "q0", t0 + 1000, many), null)
  assert.equal(readCachedCount("danbooru", `q${MAX_CACHED_COUNTS + 4}`, t0 + 1000, many), MAX_CACHED_COUNTS + 4)
})

// ── 3. Condition searches page only while their supply is short ────────────────────
const paging = (pages: number, lastAdds: number | null, adds = 100): SearchPaging => ({ pages, posts: adds, adds, lastAdds, dry: 0 })

check("condition search: its first page, then no more while the condition has enough forms", () => {
  const scene: SearchTurn = { paging: paging(1, 20), ended: false, failed: false }
  const donorUnread: SearchTurn = { paging: NO_PAGING, ended: false, failed: false, firstPageOnly: true }
  // Its first page goes as any search's.
  assert.equal(nextSearch([scene, donorUnread]), 1)
  // After it, the donor adds far more posts a page than the scene search, yet the pages go to the scene search.
  const donorRead: SearchTurn = { paging: paging(1, 100), ended: false, failed: false, firstPageOnly: true }
  for (let pages = 1; pages <= 10; pages++) {
    assert.equal(nextSearch([{ ...scene, paging: paging(pages, 20) }, donorRead]), 0, `scene search at ${pages} pages`)
  }
  // Nothing else to page: nothing is chosen, the donor doesn't take the turn.
  assert.equal(nextSearch([{ ...scene, ended: true }, donorRead]), -1)
  // Short of forms: the donor pages like any search.
  assert.equal(nextSearch([scene, { ...donorRead, firstPageOnly: false }]), 1)
})

check("condition search: short when fewer forms are loaded than prompts asked for", () => {
  const wearing: ConditionSupply = { role: "wearing", tags: ["bikini"], variants: 12 }
  const where: ConditionSupply = { role: "where", tags: ["beach"], variants: 60 }
  assert.deepEqual(shortConditionRoles([wearing, where], 50), ["wearing"])
  assert.deepEqual(shortConditionRoles([wearing, where], 10), [])
  assert.deepEqual(shortConditionRoles([wearing, where], 61), ["wearing", "where"])
  // Library styles: their forms are the library's outfits, more pages don't add to them.
  assert.deepEqual(shortConditionRoles([{ role: "wearing", tags: [], styles: ["maid"], variants: 2 }], 50), [])
  assert.deepEqual(shortConditionRoles([{ role: "wearing", tags: ["bikini"], styles: ["maid"], variants: 2 }], 50), [])
  assert.deepEqual(shortConditionRoles([], 50), [])
})

// ── 4. Pacer and budget ────────────────────────────────────────────────────────────
function fakeClock(): PacerClock & { t: number } {
  const clock = {
    t: 0,
    now: () => clock.t,
    sleep: async (ms: number) => { clock.t += ms },
  }
  return clock
}

check("pacer: a burst at once, then one request a second, never more than the burst at an instant", async () => {
  const clock = fakeClock()
  const pacer = new RequestPacer(PACE.burst, PACE.perSecond, clock)
  const at: number[] = []
  await Promise.all(Array.from({ length: 10 }, () => pacer.acquire().then(() => { at.push(clock.t) })))
  assert.deepEqual(at.slice(0, PACE.burst), Array(PACE.burst).fill(0))
  for (let i = PACE.burst; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= 1000 / PACE.perSecond - 1, `request ${i} at ${at[i]}`)
  // Never past Danbooru's 10 a second in any window of a second.
  for (let i = 0; i < at.length; i++) assert.ok(at.filter((t) => t >= at[i] && t < at[i] + 1000).length <= 10)
  // A page of two requests waits for two.
  const idle = new RequestPacer(PACE.burst, PACE.perSecond, clock)
  assert.equal(idle.msUntil(2), 0)
  idle.take(PACE.burst)
  assert.equal(idle.msUntil(1), 1000)
  assert.equal(idle.msUntil(2), 2000)
})

check("pacer: a waiter given up before its turn spends nothing", async () => {
  const clock = fakeClock()
  const pacer = new RequestPacer(1, 1, clock)
  await pacer.acquire()
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(pacer.acquire(controller.signal))
  clock.t += 1000
  assert.equal(pacer.msUntil(1), 0)
})

/**
 * A pack as the source runs it, in requests: the first page of each search at each rating,
 * then pages to the search nextSearch picks while the budget allows them by itself.
 */
function runPack(budget: PackRequestBudget, plan: { searches: number; ratings: number }, autoPages: number): number {
  budget.record(plan.searches * plan.ratings)
  let pages = 0
  while (pages < autoPages && budget.spent + plan.ratings <= AUTO_REQUEST_CAP) {
    budget.record(plan.ratings)
    pages++
  }
  return pages
}

check("budget: counts requests, one budget per pack; a change of plan doesn't reset it", () => {
  const budget = new PackRequestBudget()
  let heard = 0
  const off = budget.subscribe(() => { heard++ })
  // Plan A: two searches at two ratings, then auto pages up to the cap.
  runPack(budget, { searches: 2, ratings: 2 }, 100)
  assert.ok(budget.spent <= AUTO_REQUEST_CAP && budget.spent > AUTO_REQUEST_CAP - 2, `${budget.spent}`)
  const afterA = budget.spent
  // Plan B (an edit): its first pages count on top, and it gets no auto pages of its own.
  const autoB = runPack(budget, { searches: 3, ratings: 2 }, 100)
  assert.equal(autoB, 0)
  assert.equal(budget.spent, afterA + 6)
  // By hand ("Find more scenes") up to the session's cap, wherever the plans left it.
  let byHand = 0
  while (budget.allows(2)) { budget.record(2); byHand++ }
  assert.ok(budget.spent <= SESSION_REQUEST_CAP && !budget.allows(2))
  assert.ok(byHand > 0)
  assert.ok(heard > 0)
  off()
  const before = heard
  budget.record(1)
  assert.equal(heard, before)
  assert.equal(budget.getSnapshot(), budget.spent)
  // The budget has no way to start over, and the source makes one for its whole life.
  assert.equal("reset" in budget, false)
  const source = readFileSync(join(__dirname, "../hooks/use-pack-sources.ts"), "utf8")
  assert.match(source, /useState\(\(\) => \{\s*const budget = new PackRequestBudget\(\)/)
  assert.doesNotMatch(source, /\.reset\(\)/)
  assert.doesNotMatch(source, /useScrollRateLimiter/)
})

check("budget: the caps keep the old page caps at two ratings", () => {
  // 15 pages and 35 pages of a two-rating pack.
  assert.equal(AUTO_REQUEST_CAP, 15 * 2)
  assert.equal(SESSION_REQUEST_CAP, 35 * 2)
  assert.ok(new PackRequestBudget().allows(SESSION_REQUEST_CAP))
  assert.equal(new PackRequestBudget().allows(SESSION_REQUEST_CAP + 1), false)
})

// ── 5. A search whose first page added nothing new ─────────────────────────────────
check("a search whose first page added nothing to the pack still gets pages", () => {
  // The name search's first page: every post was already in the solo search before it.
  // It has thousands more; the solo search keeps adding.
  let solo: SearchPaging = recordPage(NO_PAGING, { pages: 1, posts: 30, adds: 30 })
  let name: SearchPaging = recordPage(NO_PAGING, { pages: 1, posts: 30, adds: 0 })
  assert.equal(name.lastAdds, 0)
  assert.equal(searchEnded(name, false), false)
  const order: number[] = []
  for (let turn = 0; turn < 12; turn++) {
    const next = nextSearch([{ paging: solo, ended: false, failed: false }, { paging: name, ended: false, failed: false }])
    order.push(next)
    if (next === 0) solo = recordPage(solo, { pages: solo.pages + 1, posts: solo.posts + 30, adds: solo.adds + 30 })
    else name = recordPage(name, { pages: name.pages + 1, posts: name.posts + 30, adds: name.adds + 25 })
  }
  assert.ok(order.includes(1), JSON.stringify(order))
  // Its turn comes once it is TURN_GAP pages behind.
  assert.equal(order.indexOf(1), TURN_GAP, JSON.stringify(order))
  // Any search that hasn't run out gets a turn sooner or later, whatever its last page added.
  const stuck = { paging: { pages: 1, posts: 30, adds: 0, lastAdds: 0, dry: 0 }, ended: false, failed: false }
  const leader = (pages: number) => ({ paging: { pages, posts: 30 * pages, adds: 30 * pages, lastAdds: 30, dry: 0 }, ended: false, failed: false })
  assert.equal(nextSearch([leader(1 + TURN_GAP), stuck]), 1)
  assert.equal(nextSearch([leader(TURN_GAP), stuck]), 0)
})

async function main() {
  for (const [name, fn] of checks) {
    try { await fn(); passed++ } catch (err) { console.error(`FAIL: ${name}`); throw err }
  }
  console.log(`pack-request-budget: ${passed} checks passed`)
}
main().catch(() => process.exit(1))
