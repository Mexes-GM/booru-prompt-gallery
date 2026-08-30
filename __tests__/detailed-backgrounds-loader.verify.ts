/**
 * Regression tests for the shared loader behind the "Detailed Random" mode
 * (hooks/use-detailed-backgrounds.ts).
 *
 * The same class of bug shipped twice: the dataset never reached
 * processBackgroundTags, so Detailed Random silently degraded into "Remove All"
 * — background stripped, nothing injected, no error surfaced. Both times the
 * cause was dedupe bookkeeping that could never recover:
 *   - a `loadedRef` set BEFORE the fetch settled, so StrictMode's
 *     mount/unmount/remount aborted the only attempt and the remount returned
 *     early on a ref that was still `true`;
 *   - resetting that ref in `.catch` fixed nothing, because the effect re-runs
 *     on `enabled` alone and `enabled` never changed.
 *
 * So the two properties pinned here are exactly the ones that were broken:
 *   1. concurrent / repeated calls share ONE request (dedupe still works);
 *   2. a failed load leaves no poisoned cache — the next call refetches.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/detailed-backgrounds-loader.verify.ts
 */
import { loadDetailedBackgrounds, toSceneryList } from "../hooks/use-detailed-backgrounds"

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

type FetchLike = (input: unknown, init?: unknown) => Promise<unknown>
const globalWithFetch = globalThis as unknown as { fetch?: FetchLike }

let calls = 0
let nextResponse: () => Promise<unknown> = async () => ({ ok: true, json: async () => [] })

globalWithFetch.fetch = (async () => {
  calls++
  return nextResponse()
}) as FetchLike

const ok = (body: unknown) => async () => ({ ok: true, json: async () => body })
const httpError = (status: number) => async () => ({ ok: false, status, json: async () => ({}) })
const networkError = () => Promise.reject(new Error("network down"))

async function main() {
  // NOTE ON ORDER: a RESOLVED load is intentionally sticky (the dataset is an
  // immutable public asset), so every failure case has to run before the first
  // successful one. Only failures clear the cache.

  // ── 1) A network error propagates and does not poison the cache ──
  {
    calls = 0
    nextResponse = networkError
    let rejected = false
    try {
      await loadDetailedBackgrounds()
    } catch {
      rejected = true
    }
    assert(rejected, "failure: a network error propagates to the caller")
    assert(calls === 1, `failure: exactly one request attempted (got ${calls})`)
  }

  // ── 2) A non-OK HTTP response is a failure, not an empty dataset ──
  //    Silently resolving to [] here is what made the mode look functional
  //    while it injected nothing. Also proves the previous failure left the
  //    cache clear: this call must issue a FRESH request.
  {
    calls = 0
    nextResponse = httpError(404)
    let rejected = false
    try {
      await loadDetailedBackgrounds()
    } catch {
      rejected = true
    }
    assert(rejected, "http: a 404 rejects instead of resolving to an empty list")
    assert(calls === 1, `retry: the call after a failure issues a FRESH request (got ${calls})`)
  }

  // ── 3) Recovery + dedupe: the retry loads real data, and concurrent /
  //    repeated callers collapse onto ONE request ──
  {
    calls = 0
    nextResponse = ok([{ scenery: ["indoors", "library"] }, { scenery: ["outdoors", "park"] }])
    const [a, b] = await Promise.all([loadDetailedBackgrounds(), loadDetailedBackgrounds()])
    const c = await loadDetailedBackgrounds()
    assert(
      calls === 1,
      `dedupe: two concurrent + one later caller share ONE request (got ${calls})`,
    )
    assert(a === b && b === c, "dedupe: all callers receive the same resolved list")
    assert(
      a.length === 2 && a[0][1] === "library" && a[1][1] === "park",
      "retry: resolves with real data instead of replaying the earlier rejection",
    )
  }

  // ── 4) Only the `scenery` axis is exposed ──
  //    Detailed Random REPLACES the background; injecting pose/clothing would
  //    fight the post's own tags. Tested through the pure mapper because a
  //    resolved load is intentionally sticky for the rest of the process.
  {
    const list = toSceneryList([
      { scenery: ["indoors", "kitchen"], pose: ["sitting"], clothing: ["apron"], appearance: ["blue eyes"] },
      { pose: ["standing"] },
      null,
    ])
    const flat = list.flat()
    assert(flat.includes("indoors") && flat.includes("kitchen"), "scenery-only: scenery tags are kept")
    assert(
      !flat.includes("sitting") && !flat.includes("apron") && !flat.includes("blue eyes"),
      "scenery-only: pose / clothing / appearance are dropped",
    )
    assert(list.length === 3 && list[1].length === 0 && list[2].length === 0,
      "scenery-only: presets without scenery map to empty lists instead of throwing")
  }

  // ── 5) A malformed payload is a failure, not a silent empty dataset ──
  //    Resolving to [] here is precisely what made the mode look functional
  //    while it injected nothing.
  {
    let threw = false
    try {
      toSceneryList({ not: "an array" })
    } catch {
      threw = true
    }
    assert(threw, "malformed: a non-array payload throws instead of yielding an empty dataset")
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

void main()
