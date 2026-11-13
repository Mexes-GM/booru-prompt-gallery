/**
 * The added-tags dataset loader (lib/added-tags.ts), the card gate
 * (hooks/use-dataset-tags.ts) and how the tags land in a card's prompt
 * (lib/prompt/derive-post-prompt.ts).
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/added-tags.verify.ts
 */
import {
  blockUrl,
  commitFromUrl,
  createAddedTagsLoader,
  decodePostTags,
  resolveBaseUrl,
  DEFAULT_ADDED_TAGS_URL,
  RATE_LIMIT_PAUSE_MS,
  CACHE_TTL_MS,
  type AddedTagsStore,
  type CacheEntry,
  type FetchResponseLike,
} from "../lib/added-tags"
import { requestDatasetTags, wantsDatasetTags } from "../hooks/use-dataset-tags"
import { derivePostPrompt } from "../lib/prompt/derive-post-prompt"
import type { BooruPost } from "../lib/booru/types"

let passed = 0
let failed = 0
function assert(condition: boolean, label: string) {
  if (condition) passed++
  else {
    failed++
    console.error(`FAIL: ${label}`)
  }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const BASE = "https://example.test/ds"
const NAMES = ["blazer", "building", "collared_shirt", "outdoors", "ribbon", "tree", "long_hair"]
const SHA_A = "a".repeat(40)
const SHA_B = "b".repeat(40)
const resolved = (sha: string, path: string) => `https://huggingface.co/api/resolve-cache/datasets/Mexes/danbooru-added-tags/${sha}/${path}`

/** A fake network: url -> response factory, counting every call. */
function fakeFetch(routes: Record<string, () => FetchResponseLike | Promise<FetchResponseLike>>) {
  const calls: string[] = []
  let inFlight = 0
  let maxInFlight = 0
  const fetch = async (url: string) => {
    calls.push(url)
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise((r) => setTimeout(r, 5))
    inFlight--
    const route = routes[url]
    return route ? route() : { ok: false, status: 404, json: async () => null }
  }
  return { fetch, calls, maxInFlight: () => maxInFlight }
}
const okJson = (body: unknown, url?: string): FetchResponseLike => ({ ok: true, status: 200, url, json: async () => body })

function memoryStore(): AddedTagsStore & { map: Map<string, CacheEntry> } {
  const map = new Map<string, CacheEntry>()
  return {
    map,
    async get(key) { return map.get(key) },
    async put(entry) { map.set(entry.key, entry) },
    async clearBlocks() { for (const k of [...map.keys()]) if (k.startsWith("b:")) map.delete(k) },
  }
}

async function main() {
  // --- URLs and decoding -------------------------------------------------
  assert(blockUrl(BASE, 804094) === `${BASE}/shards/0/804.json`, "block URL of 804094")
  assert(blockUrl(BASE, 11_581_021) === `${BASE}/shards/11/11581.json`, "block URL of the last covered post")
  assert(blockUrl(BASE, 999) === `${BASE}/shards/0/0.json`, "block URL of a post under 1000")
  assert(resolveBaseUrl(undefined) === DEFAULT_ADDED_TAGS_URL, "empty env var falls back to the public dataset")
  assert(resolveBaseUrl(" https://x.test/a/ ") === "https://x.test/a", "env var is trimmed, trailing slash dropped")
  assert(commitFromUrl(resolved(SHA_A, "tags.json")) === SHA_A, "commit read from the resolved URL")
  assert(commitFromUrl(`${BASE}/tags.json`) === "", "no commit in a plain URL")

  const block804 = { "94": [0, 1, 2, 3, 4, 5], "5": [6, 99] }
  assert(eq(decodePostTags(block804, NAMES, 804094), ["blazer", "building", "collared_shirt", "outdoors", "ribbon", "tree"]), "decodes 804094")
  assert(eq(decodePostTags(block804, NAMES, 804005), ["long_hair"]), "unknown tag ids are skipped")
  assert(eq(decodePostTags(block804, NAMES, 804001), []), "post absent from its block has no tags")

  // --- loader: decode, absent post, 404, dedupe, cache --------------------
  {
    const net = fakeFetch({
      [`${BASE}/tags.json`]: () => okJson(NAMES),
      [`${BASE}/shards/0/804.json`]: () => okJson(block804),
    })
    const store = memoryStore()
    const loader = createAddedTagsLoader({ fetch: net.fetch, baseUrl: BASE, store })
    const [a, b, c] = await Promise.all([loader.getTags(804094), loader.getTags(804094), loader.getTags(804001)])
    assert(eq(a, ["blazer", "building", "collared_shirt", "outdoors", "ribbon", "tree"]), "loader returns the post's tags")
    assert(eq(b, a), "concurrent call gets the same tags")
    assert(eq(c, []), "post absent from the block gets []")
    assert(net.calls.filter((u) => u.endsWith("804.json")).length === 1, "one request for a block shared by three calls")
    assert(net.calls.filter((u) => u.endsWith("tags.json")).length === 1, "tags.json requested once")

    assert(eq(await loader.getTags(55_123), []), "404 block resolves to []")
    const before = net.calls.length
    assert(eq(await loader.getTags(55_999), []), "same 404 block again")
    assert(net.calls.length === before, "a 404 block is remembered in memory")
    assert(eq(store.map.get("b:55")?.block, {}), "a 404 block is stored as empty")

    assert(eq(await loader.getTags(0), []) && eq(await loader.getTags(11_581_022), []), "ids outside the dataset get []")
    assert(net.calls.length === before, "ids outside the dataset request nothing")

    // A second page load: everything comes from the persistent cache.
    const net2 = fakeFetch({})
    const loader2 = createAddedTagsLoader({ fetch: net2.fetch, baseUrl: BASE, store })
    assert(eq(await loader2.getTags(804094), a), "second visit decodes from the persistent cache")
    assert(eq(await loader2.getTags(55_500), []), "second visit remembers the empty block")
    assert(net2.calls.length === 0, "second visit makes no requests")

    // 31 days later the cache has expired.
    const later = Date.now() + CACHE_TTL_MS + 1000
    const net3 = fakeFetch({
      [`${BASE}/tags.json`]: () => okJson(NAMES),
      [`${BASE}/shards/0/804.json`]: () => okJson(block804),
    })
    const loader3 = createAddedTagsLoader({ fetch: net3.fetch, baseUrl: BASE, store, now: () => later })
    await loader3.getTags(804094)
    assert(net3.calls.length === 2, "expired entries are fetched again")
  }

  // --- concurrency cap ----------------------------------------------------
  {
    const routes: Record<string, () => FetchResponseLike> = { [`${BASE}/tags.json`]: () => okJson(NAMES) }
    for (let b = 1; b <= 20; b++) routes[`${BASE}/shards/0/${b}.json`] = () => okJson({ "1": [3] })
    const net = fakeFetch(routes)
    const loader = createAddedTagsLoader({ fetch: net.fetch, baseUrl: BASE })
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => loader.getTags((i + 1) * 1000 + 1)))
    assert(results.every((r) => eq(r, ["outdoors"])), "20 blocks all decode")
    assert(net.maxInFlight() <= 6, `at most 6 requests at a time (saw ${net.maxInFlight()})`)
  }

  // --- 429 pause, failures, bad JSON --------------------------------------
  {
    let clock = 1_000_000
    let limited = true
    const net = fakeFetch({
      [`${BASE}/tags.json`]: () => okJson(NAMES),
      [`${BASE}/shards/0/1.json`]: () => (limited ? { ok: false, status: 429, json: async () => null } : okJson({ "1": [3] })),
      [`${BASE}/shards/0/2.json`]: () => okJson({ "1": [3] }),
      [`${BASE}/shards/0/3.json`]: () => okJson("not a block"),
      [`${BASE}/shards/0/4.json`]: () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad json") } }),
    })
    const loader = createAddedTagsLoader({ fetch: net.fetch, baseUrl: BASE, now: () => clock })
    assert((await loader.getTags(1001)) === null, "429 resolves to null")
    const afterLimit = net.calls.length
    assert((await loader.getTags(2001)) === null, "other blocks are not requested during the pause")
    assert(net.calls.length === afterLimit, "no request at all during the pause")
    limited = false
    clock += RATE_LIMIT_PAUSE_MS + 1
    assert(eq(await loader.getTags(2001), ["outdoors"]), "requests resume after the pause")
    assert(eq(await loader.getTags(1001), ["outdoors"]), "the rate-limited block loads after the pause")

    assert((await loader.getTags(3001)) === null, "a block that isn't an object resolves to null")
    assert((await loader.getTags(4001)) === null, "invalid JSON resolves to null")
    const n = net.calls.length
    assert((await loader.getTags(4002)) === null, "a failed block isn't retried right away")
    assert(net.calls.length === n, "no retry loop on a failed block")

    const down = createAddedTagsLoader({ fetch: async () => { throw new TypeError("network") }, baseUrl: BASE })
    assert((await down.getTags(804094)) === null, "network error resolves to null")
  }

  // --- a newer dataset commit refreshes tags.json and drops stale blocks --
  {
    const store = memoryStore()
    const oldNames = ["shirt", "outdoors"]
    store.map.set("tags", { key: "tags", savedAt: Date.now(), commit: SHA_A, names: oldNames })
    store.map.set("b:9", { key: "b:9", savedAt: Date.now(), commit: SHA_A, block: { "1": [0] } })
    const net = fakeFetch({
      [`${BASE}/tags.json`]: () => okJson(NAMES, resolved(SHA_B, "tags.json")),
      [`${BASE}/shards/0/804.json`]: () => okJson(block804, resolved(SHA_B, "shards/0/804.json")),
    })
    const loader = createAddedTagsLoader({ fetch: net.fetch, baseUrl: BASE, store })
    assert(eq(await loader.getTags(804094), ["blazer", "building", "collared_shirt", "outdoors", "ribbon", "tree"]), "block from a newer commit decodes with the new tags.json")
    assert(eq(store.map.get("tags")?.names, NAMES), "new tags.json is stored")
    assert(!store.map.has("b:9"), "blocks of the old list are dropped")
  }

  // --- card gate: setting off or not Danbooru = no request ---------------
  {
    let fetches = 0
    const fetcher = async () => { fetches++; return ["outdoors"] }
    const post = { id: 804094 }
    assert((await requestDatasetTags(false, "danbooru", post, fetcher)) === null, "setting off resolves to null")
    assert((await requestDatasetTags(true, "gelbooru", post, fetcher)) === null, "other boorus resolve to null")
    assert((await requestDatasetTags(true, "danbooru", { id: 20_000_000 }, fetcher)) === null, "posts past the dataset resolve to null")
    assert(fetches === 0, "setting off, other boorus and uncovered posts make zero requests")
    assert(!wantsDatasetTags(true, "danbooru", { id: 5, ai_metadata: { prompt: "x" } }), "posts with an AI prompt are skipped")
    assert(eq(await requestDatasetTags(true, "danbooru", post, fetcher), ["outdoors"]), "setting on requests the tags")
    await requestDatasetTags(true, "danbooru", post, fetcher)
    assert(fetches === 1, "a post's tags are requested once per page")
  }

  // --- the card's prompt ---------------------------------------------------
  {
    const post: BooruPost = {
      id: 804094,
      file_url: "", large_file_url: "", preview_file_url: "",
      tag_string: "1girl solo long_hair school_uniform ribbon smile",
      tag_string_artist: "", tag_string_character: "", tag_string_copyright: "",
      rating: "g", score: 0,
    }
    const base = { addInput: "", includeCharacters: true, optimizeTags: false }
    const dataset = ["blazer", "building", "collared_shirt", "outdoors", "ribbon", "tree"]

    const plain = derivePostPrompt(post, { ...base, excludeInput: "" })
    const filled = derivePostPrompt(post, { ...base, excludeInput: "", datasetTags: dataset })
    const tags = filled.baseContent.split(", ")
    assert(eq(plain.datasetAddedTags, []), "no dataset tags, nothing marked")
    for (const t of ["blazer", "building", "collared shirt", "outdoors", "tree"]) assert(tags.includes(t), `prompt gains "${t}"`)
    assert(tags.filter((t) => t === "ribbon").length === 1, "a tag the post already has is not duplicated")
    assert(new Set(tags).size === tags.length, "no tag appears twice")
    assert(!filled.datasetAddedTags.includes("ribbon"), "the post's own tag isn't marked as added")
    assert(eq([...filled.datasetAddedTags].sort(), ["blazer", "building", "collared shirt", "outdoors", "tree"]), "the added tags are reported for marking")

    const excluded = derivePostPrompt(post, { ...base, excludeInput: "outdoors, tree", datasetTags: dataset })
    const exTags = excluded.baseContent.split(", ")
    assert(!exTags.includes("outdoors") && !exTags.includes("tree"), "excluded tags stay out")
    assert(!excluded.datasetAddedTags.includes("outdoors"), "excluded tags aren't marked")

    const userAdded = derivePostPrompt(post, { ...base, excludeInput: "", addInput: "outdoors", datasetTags: dataset })
    assert(userAdded.baseContent.split(", ").filter((t) => t === "outdoors").length === 1, "a tag the user adds isn't duplicated")
    assert(!userAdded.datasetAddedTags.includes("outdoors"), "a tag the user adds counts as theirs")

    const replaced = derivePostPrompt(post, { ...base, excludeInput: "", datasetTags: dataset, backgroundMode: "remove_all" })
    assert(!replaced.baseContent.split(", ").includes("outdoors"), "background options apply to dataset scenery")

    const ai = derivePostPrompt({ ...post, ai_metadata: { prompt: "1girl, smile" } }, { ...base, excludeInput: "", datasetTags: dataset })
    assert(eq(ai.datasetAddedTags, []), "hand-written AI prompts are left alone")
  }

  console.log(`${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
