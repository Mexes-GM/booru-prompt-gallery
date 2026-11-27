/**
 * Page-range requests (Danbooru/Aibooru page counts, and the binary search without a count)
 * stay out of Pack Mode's automatic request cap but count in the session cap
 * (lib/pack/request-budget.ts), and go through the site's pacer like any other request.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-request-range-cap.verify.ts
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { PackRequestBudget, requestCaps } from "../lib/pack/request-budget"

let passed = 0
const check = (name: string, fn: () => void) => {
  try { fn(); passed++ } catch (err) { console.error(`FAIL: ${name}`); throw err }
}

check("budget: range requests are counted apart, and in the total", () => {
  const budget = new PackRequestBudget()
  let heard = 0
  budget.subscribe(() => { heard++ })
  budget.record(4)
  budget.record(2, "range")
  budget.record(1, "range")
  assert.equal(budget.spent, 7)
  assert.equal(budget.rangeRequests, 3)
  assert.equal(budget.getRangeSnapshot(), 3)
  assert.equal(heard, 3)
  budget.record(0, "range")
  assert.equal(budget.rangeRequests, 3)
})

/** A one-rating Danbooru pack: first pages, then turns by itself; each search's 2nd page also asks for its count. */
function autoPages(searches: number, rangeOutOfAuto: boolean): { pages: number; budget: PackRequestBudget } {
  const caps = requestCaps(1)
  const budget = new PackRequestBudget()
  budget.record(searches)
  let pages = searches
  const counted = new Set<number>()
  for (let turn = 0; ; turn++) {
    const autoCap = caps.auto + (rangeOutOfAuto ? budget.rangeRequests : 0)
    if (budget.spent >= autoCap) break
    const search = turn % searches
    if (!counted.has(search)) { counted.add(search); budget.record(1, "range") }
    budget.record(1)
    pages++
  }
  return { pages, budget }
}

check("automatic cap: page-range requests don't take pages away from the pack", () => {
  // With them in the cap, a four-search pack would get 4 fewer pages than the old 15-page cap.
  assert.equal(autoPages(4, false).pages, 15 - 4)
  const { pages, budget } = autoPages(4, true)
  assert.equal(pages, 15)
  assert.equal(budget.rangeRequests, 4)
})

check("session cap: page-range requests count in it", () => {
  const caps = requestCaps(1)
  const budget = new PackRequestBudget()
  budget.record(caps.session - 1, "range")
  assert.equal(budget.allows(1, caps.session), true)
  budget.record(1, "range")
  assert.equal(budget.allows(1, caps.session), false)
})

check("the source and the page-range hook wire it so", () => {
  const sources = readFileSync(join(__dirname, "../hooks/use-pack-sources.ts"), "utf8")
  assert.match(sources, /getRangeSnapshot/)
  assert.match(sources, /const autoRequestCap = autoPageCap \+ rangeSpent/)
  // The session cap stays on every request sent.
  assert.match(sources, /spent \+ Math\.max\(1, targetRequests\) > sessionRequestCap/)
  const range = readFileSync(join(__dirname, "../hooks/use-random-page-order.ts"), "utf8")
  assert.match(range, /await sitePacer\(provider\)\.acquire\(\)\s*\n\s*budget\?\.record\(1, "range"\)/)
})

console.log(`pack-request-range-cap: ${passed} checks passed`)
