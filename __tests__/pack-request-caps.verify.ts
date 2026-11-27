/**
 * Pack Mode's request caps follow the ratings the source asks for (lib/pack/request-budget.ts):
 * the old page caps (15 automatic, 35 per session) times the plan's ratings, so no pack sends
 * more than the page caps allowed, one-rating packs included.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-request-caps.verify.ts
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { AUTO_REQUESTS_PER_RATING, PackRequestBudget, SESSION_REQUESTS_PER_RATING, requestCaps } from "../lib/pack/request-budget"
import { MAX_RATINGS } from "../lib/pack/source-plan"

let passed = 0
const check = (name: string, fn: () => void) => {
  try { fn(); passed++ } catch (err) { console.error(`FAIL: ${name}`); throw err }
}

check("caps: the old page caps times the ratings", () => {
  assert.equal(AUTO_REQUESTS_PER_RATING, 15)
  assert.equal(SESSION_REQUESTS_PER_RATING, 35)
  assert.deepEqual(requestCaps(1), { auto: 15, session: 35 })
  assert.deepEqual(requestCaps(2), { auto: 30, session: 70 })
  // Out of range: at least one rating, at most the plan's maximum.
  assert.deepEqual(requestCaps(0), requestCaps(1))
  assert.deepEqual(requestCaps(MAX_RATINGS + 3), requestCaps(MAX_RATINGS))
})

/** Requests a pack sends by itself and by hand, at most, with the source's rules. */
function worstCase(ratings: number, searches: number): { auto: number; session: number } {
  const caps = requestCaps(ratings)
  const budget = new PackRequestBudget()
  budget.record(searches * ratings) // the first page of each search at each rating
  while (budget.spent < caps.auto && budget.allows(ratings, caps.session)) budget.record(ratings)
  const auto = budget.spent
  while (budget.allows(ratings, caps.session)) budget.record(ratings)
  return { auto, session: budget.spent }
}

check("no pack sends more than the old page caps allowed", () => {
  for (const ratings of [1, 2]) {
    for (const searches of [1, 2, 3]) {
      const { auto, session } = worstCase(ratings, searches)
      // The old caps, in requests: 15 and 35 pages, a page being one request per rating.
      assert.ok(auto <= 15 * ratings, `${ratings} rating(s), ${searches} searches: auto ${auto}`)
      assert.ok(session <= 35 * ratings, `${ratings} rating(s), ${searches} searches: session ${session}`)
    }
  }
  assert.equal(worstCase(1, 2).session, 35)
  assert.equal(worstCase(2, 3).session, 70)
})

check("the source works its caps out from the plan's ratings, and the builder reads them from it", () => {
  const sources = readFileSync(join(__dirname, "../hooks/use-pack-sources.ts"), "utf8")
  assert.match(sources, /requestCaps\(plan\.ratings\.length\)/)
  assert.doesNotMatch(sources, /SESSION_REQUEST_CAP|AUTO_REQUEST_CAP/)
  const builder = readFileSync(join(__dirname, "../components/prompt-gallery/pack/pack-brief-builder.tsx"), "utf8")
  assert.match(builder, /source\.requests < source\.autoRequestCap/)
  assert.doesNotMatch(builder, /AUTO_REQUEST_CAP|AUTO_PAGE_CAP/)
})

console.log(`pack-request-caps: ${passed} checks passed`)
