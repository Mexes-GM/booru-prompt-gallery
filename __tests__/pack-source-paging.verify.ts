/**
 * Paging across a source plan's searches (lib/pack/source-paging.ts): a search that
 * stops bringing new posts runs out, and the next page goes to the search that can
 * bring most. Measured case: Rule34, a character with a pose, read in random order:
 * the character's own search has 95 posts in all and brings the same 95 on every page;
 * the search without a name has 138,845 and brings about 100 new posts a page.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-source-paging.verify.ts
 */
import assert from "node:assert/strict"
import { DRY_PAGES_TO_END, NO_PAGING, TURN_GAP, nextSearch, recordPage, searchEnded, type SearchPaging } from "../lib/pack/source-paging"
import { withWaiting, type FitNote } from "../lib/pack/brief-pack"

let passed = 0
const check = (name: string, fn: () => void) => {
  try { fn(); passed++ } catch (err) { console.error(`FAIL: ${name}`); throw err }
}

/** A search as the site answers it: the posts each page brings (ids), in random order. */
interface SimSearch { pool: number[]; perPage: number; seen: Set<number>; paging: SearchPaging; siteEnded: boolean; pagesAsked: number }

// Deterministic random draw of `n` ids from `pool` (page `k`).
function draw(pool: number[], n: number, k: number): number[] {
  const out = [...pool]
  let x = 9301 * (k + 1)
  for (let i = out.length - 1; i > 0; i--) {
    x = (x * 1103515245 + 12345) % 2147483648
    const j = x % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out.slice(0, n)
}

/** Runs `loads` pages after the first page of each search, choosing with nextSearch; returns the order. */
function run(searches: SimSearch[], loads: number): number[] {
  const all = new Set<number>()
  const fetch = (s: SimSearch) => {
    const page = draw(s.pool, s.perPage, s.pagesAsked++)
    page.forEach((id) => s.seen.add(id))
    // What the search adds to the pack: posts no earlier search (in plan order) had.
    const earlier = new Set(searches.slice(0, searches.indexOf(s)).flatMap((o) => [...o.seen]))
    const adds = [...s.seen].filter((id) => !earlier.has(id)).length
    s.paging = recordPage(s.paging, { pages: s.pagesAsked, posts: s.seen.size, adds })
    page.forEach((id) => all.add(id))
  }
  searches.forEach(fetch)
  const order: number[] = []
  for (let i = 0; i < loads; i++) {
    const next = nextSearch(searches.map((s) => ({ paging: s.paging, ended: searchEnded(s.paging, s.siteEnded), failed: false })))
    if (next < 0) break
    order.push(next)
    fetch(searches[next])
  }
  return order
}

const sim = (from: number, size: number, perPage = 100): SimSearch => ({
  pool: Array.from({ length: size }, (_, i) => from + i), perPage, seen: new Set(), paging: NO_PAGING, siteEnded: false, pagesAsked: 0,
})

check("recordPage: a page that brings the search nothing new ends it; one that does keeps it going", () => {
  let p = recordPage(NO_PAGING, { pages: 1, posts: 95, adds: 95 })
  assert.deepEqual(p, { pages: 1, posts: 95, adds: 95, lastAdds: 95, dry: 0 })
  assert.equal(searchEnded(p, false), false)
  p = recordPage(p, { pages: 2, posts: 95, adds: 95 })
  assert.equal(p.dry, 1)
  assert.equal(p.lastAdds, 0)
  assert.equal(DRY_PAGES_TO_END, 1)
  assert.equal(searchEnded(p, false), true)
  // The same page again (or one on its way) changes nothing.
  assert.equal(recordPage(p, { pages: 2, posts: 95, adds: 95 }), p)
  // The site saying so ends it too.
  assert.equal(searchEnded(NO_PAGING, true), true)
})

check("measured case (Rule34): the pages go to the search without a name, never to the 95 posts again and again", () => {
  const own = sim(0, 95)
  const theme = sim(1000, 138_845)
  const order = run([own, theme], 6)
  // The first page of each: 95 and 100 posts. Every page after goes to the one without a name,
  // except one turn for the character's search when it falls TURN_GAP pages behind; that page
  // brings nothing new and ends it.
  assert.equal(order.filter((i) => i === 0).length, 1, JSON.stringify(order))
  assert.equal(order.indexOf(0), TURN_GAP, JSON.stringify(order))
  assert.equal(searchEnded(own.paging, false), true)
  assert.equal(own.seen.size, 95)
  assert.ok(theme.seen.size >= 590, `the search without a name brought ${theme.seen.size}`)
  // The old way (always the first search not ended by the site) would have brought nothing new in 6 pages.
})

check("nextSearch: never an ended or failed search; -1 when none is left; the preferred one on a tie", () => {
  const live: SearchPaging = { pages: 2, posts: 200, adds: 200, lastAdds: 80, dry: 0 }
  const big: SearchPaging = { pages: 2, posts: 200, adds: 190, lastAdds: 95, dry: 0 }
  assert.equal(nextSearch([{ paging: live, ended: false, failed: false }, { paging: big, ended: false, failed: false }]), 1)
  assert.equal(nextSearch([{ paging: live, ended: false, failed: false }, { paging: big, ended: true, failed: false }]), 0)
  assert.equal(nextSearch([{ paging: live, ended: false, failed: true }, { paging: big, ended: true, failed: false }]), -1)
  assert.equal(nextSearch([{ paging: live, ended: false, failed: false }, { paging: { ...live }, ended: false, failed: false }]), 0)
  // A search with no page yet goes first.
  assert.equal(nextSearch([{ paging: big, ended: false, failed: false }, { paging: NO_PAGING, ended: false, failed: false }]), 1)
})

check("a large search doesn't keep a smaller one that still brings posts waiting for good", () => {
  // Tifa on Rule34, measured: her own search brings 100, 75, 58, 33… new posts a page.
  const own = sim(0, 400)
  const theme = sim(10_000, 138_845)
  const order = run([own, theme], 12)
  assert.ok(order.filter((i) => i === 0).length >= 3, JSON.stringify(order))
  assert.ok(order.filter((i) => i === 1).length >= 6, JSON.stringify(order))
})

check("withWaiting: said in place of Finding scenes…, first; gone once the page goes", () => {
  const notes: FitNote[] = [{ kind: "finding", found: 31 }, { kind: "short", made: 31, asked: 50, scenes: 31 }]
  assert.deepEqual(withWaiting(notes, true), [{ kind: "waiting" }, { kind: "short", made: 31, asked: 50, scenes: 31 }])
  assert.deepEqual(withWaiting(notes, false), notes)
  assert.deepEqual(withWaiting([{ kind: "paused" }], true), [{ kind: "waiting" }])
})

console.log(`pack-source-paging: ${passed} checks passed`)
