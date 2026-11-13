/**
 * Loader for the "added tags" dataset: for each Danbooru post, the clothing,
 * scenery and framing tags its image shows but the post isn't tagged with
 * (https://huggingface.co/datasets/Mexes/danbooru-added-tags, CC BY 4.0).
 *
 * Layout: `tags.json` is the list of tag names (a tag's id is its position)
 * and `shards/<floor(block/1000)>/<block>.json`, with block = floor(id/1000),
 * maps `String(id - block*1000)` to that post's tag ids. A post with no added
 * tags is absent; a block with no posts doesn't exist (404).
 *
 * This module is only imported dynamically (see hooks/use-dataset-tags.ts), so
 * none of it ships in the initial bundle. Everything is best-effort: any
 * failure leaves the card's prompt as it was.
 *
 * Caching, from cheapest to most expensive:
 * - memory: one promise per block for the whole page, so concurrent cards on
 *   the same block share one request;
 * - IndexedDB: tags.json and every block fetched in the last 30 days, capped
 *   (oldest evicted), so a return visit makes no requests at all;
 * - network: at most 6 requests at a time. The Hub sends no Cache-Control, so
 *   the browser cache can't be relied on, and it rate-limits per IP: after a
 *   429 nothing is requested for 5 minutes. Other failures are remembered for a
 *   minute per block so cards that remount don't retry in a loop.
 *
 * The Hub's resolve URL redirects to a URL holding the dataset's commit. Blocks
 * record that commit; a block from a newer commit than the cached tags.json
 * refreshes tags.json once, and if the list changed, cached blocks are dropped
 * (their ids point into the old list).
 */

export const DEFAULT_ADDED_TAGS_URL = "https://huggingface.co/datasets/Mexes/danbooru-added-tags/resolve/main"
/** Highest post id the dataset covers. */
export const ADDED_TAGS_MAX_POST_ID = 11_581_021

export const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const MAX_CACHED_BLOCKS = 1500
export const MAX_CONCURRENT_REQUESTS = 6
export const RATE_LIMIT_PAUSE_MS = 5 * 60 * 1000
export const FAILURE_RETRY_MS = 60 * 1000

type BlockData = Record<string, number[]>

export interface CacheEntry {
  key: string
  savedAt: number
  /** Dataset commit the entry was read at, when the URL tells ("" otherwise). */
  commit: string
  names?: string[]
  block?: BlockData
}

/** Persistent storage for the loader; IndexedDB in the browser, a Map in tests. */
export interface AddedTagsStore {
  get(key: string): Promise<CacheEntry | undefined>
  put(entry: CacheEntry): Promise<void>
  /** Drops every cached block (tags.json stays). */
  clearBlocks(): Promise<void>
}

export interface FetchResponseLike {
  ok: boolean
  status: number
  url?: string
  json(): Promise<unknown>
}
export type FetchLike = (url: string) => Promise<FetchResponseLike>

export function resolveBaseUrl(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim().replace(/\/+$/, "")
  return trimmed || DEFAULT_ADDED_TAGS_URL
}

export function isCoveredPostId(postId: number): boolean {
  return Number.isInteger(postId) && postId >= 1 && postId <= ADDED_TAGS_MAX_POST_ID
}

export function blockOf(postId: number): number {
  return Math.floor(postId / 1000)
}

export function blockUrl(baseUrl: string, postId: number): string {
  const block = blockOf(postId)
  return `${baseUrl}/shards/${Math.floor(block / 1000)}/${block}.json`
}

/** A post's tag names from its block; [] when the post isn't in it. Unknown ids are skipped. */
export function decodePostTags(block: BlockData, names: readonly string[], postId: number): string[] {
  const ids = block[String(postId - blockOf(postId) * 1000)]
  if (!Array.isArray(ids)) return []
  const out = new Set<string>()
  for (const id of ids) {
    const name = typeof id === "number" ? names[id] : undefined
    if (name) out.add(name)
  }
  return [...out]
}

/** The dataset commit in a resolved Hub URL (".../resolve-cache/datasets/<owner>/<name>/<sha>/..."). */
export function commitFromUrl(url: string | undefined): string {
  return url?.match(/\/resolve-cache\/datasets\/[^/]+\/[^/]+\/([0-9a-f]{40})\//)?.[1] ?? ""
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function isBlockData(value: unknown): value is BlockData {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

class RateLimited extends Error {}

export interface AddedTagsLoaderOptions {
  fetch: FetchLike
  baseUrl?: string
  store?: AddedTagsStore | null
  now?: () => number
}

export interface AddedTagsLoader {
  /** The post's added tags (underscore names, possibly []), or null when they couldn't be read. */
  getTags(postId: number): Promise<string[] | null>
}

export function createAddedTagsLoader({ fetch, baseUrl = DEFAULT_ADDED_TAGS_URL, store = null, now = Date.now }: AddedTagsLoaderOptions): AddedTagsLoader {
  let pausedUntil = 0
  let active = 0
  const queue: (() => void)[] = []
  const blocks = new Map<number, Promise<CacheEntry | null>>()
  const failedUntil = new Map<number, number>()
  let names: Promise<CacheEntry | null> | null = null
  let namesFromNetwork = false
  let refreshing: Promise<CacheEntry | null> | null = null

  const fresh = (entry: CacheEntry | undefined): entry is CacheEntry =>
    !!entry && now() - entry.savedAt < CACHE_TTL_MS

  const safeGet = async (key: string) => { try { return await store?.get(key) } catch { return undefined } }
  const safePut = async (entry: CacheEntry) => { try { await store?.put(entry) } catch { /* best-effort */ } }

  async function limited<T>(task: () => Promise<T>): Promise<T> {
    if (active >= MAX_CONCURRENT_REQUESTS) await new Promise<void>((resolve) => queue.push(resolve))
    active++
    try {
      return await task()
    } finally {
      active--
      queue.shift()?.()
    }
  }

  /** null for a 404; throws RateLimited on 429 and Error on anything else. */
  async function request(url: string): Promise<{ body: unknown; commit: string } | null> {
    if (now() < pausedUntil) throw new RateLimited()
    return limited(async () => {
      if (now() < pausedUntil) throw new RateLimited()
      const res = await fetch(url)
      if (res.status === 404) return null
      if (res.status === 429) {
        pausedUntil = now() + RATE_LIMIT_PAUSE_MS
        throw new RateLimited()
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return { body: await res.json(), commit: commitFromUrl(res.url) }
    })
  }

  async function fetchNames(): Promise<CacheEntry | null> {
    const res = await request(`${baseUrl}/tags.json`)
    const list = res?.body
    if (!Array.isArray(list) || !list.every((n) => typeof n === "string")) throw new Error("bad tags.json")
    namesFromNetwork = true
    const entry: CacheEntry = { key: "tags", savedAt: now(), commit: res!.commit, names: list as string[] }
    void safePut(entry)
    return entry
  }

  function loadNames(): Promise<CacheEntry | null> {
    if (!names) {
      names = (async () => {
        const cached = await safeGet("tags")
        if (fresh(cached) && Array.isArray(cached.names)) return cached
        return fetchNames()
      })().catch(() => {
        names = null
        return null
      })
    }
    return names
  }

  /** tags.json again after a block showed a newer dataset commit; drops blocks if the list changed. */
  function refreshNames(previous: CacheEntry): Promise<CacheEntry | null> {
    // Once per page: a list read from the network is as new as it gets.
    if (namesFromNetwork) return loadNames()
    refreshing ??= (async () => {
      const entry = await fetchNames().catch(() => previous)
      names = Promise.resolve(entry)
      if (entry !== previous && !sameList(entry?.names ?? [], previous.names ?? [])) {
        blocks.clear()
        try { await store?.clearBlocks() } catch { /* best-effort */ }
      }
      return entry
    })()
    return refreshing
  }

  function loadBlock(block: number, postId: number): Promise<CacheEntry | null> {
    const pending = blocks.get(block)
    if (pending) return pending
    const promise = (async () => {
      const key = `b:${block}`
      const cached = await safeGet(key)
      if (fresh(cached)) return cached
      const res = await request(blockUrl(baseUrl, postId))
      if (res && !isBlockData(res.body)) throw new Error("bad block")
      // A 404 is a block without posts: remembered as empty.
      const entry: CacheEntry = { key, savedAt: now(), commit: res?.commit ?? "", block: (res?.body as BlockData) ?? {} }
      void safePut(entry)
      return entry
    })().catch(() => {
      blocks.delete(block)
      failedUntil.set(block, now() + FAILURE_RETRY_MS)
      return null
    })
    blocks.set(block, promise)
    return promise
  }

  return {
    async getTags(postId) {
      if (!isCoveredPostId(postId)) return []
      const block = blockOf(postId)
      if ((failedUntil.get(block) ?? 0) > now()) return null
      const entry = await loadBlock(block, postId)
      if (!entry?.block) return null
      const ids = entry.block[String(postId - block * 1000)]
      if (!Array.isArray(ids) || ids.length === 0) return []
      let list = await loadNames()
      if (!list?.names) return null
      if (entry.commit && list.commit && entry.commit !== list.commit) {
        list = await refreshNames(list)
        if (!list?.names) return null
      }
      return decodePostTags(entry.block, list.names, postId)
    },
  }
}

// ---------------------------------------------------------------- IndexedDB

const DB_NAME = "added-tags-cache"
const DB_VERSION = 1
const STORE = "entries"

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** IndexedDB store (same pattern as lib/pack/pool-cache.ts); null where IndexedDB is unavailable. */
export function createIndexedDbStore(now: () => number = Date.now): AddedTagsStore | null {
  if (typeof indexedDB === "undefined") return null
  let dbPromise: Promise<IDBDatabase | null> | null = null
  const openDb = () => {
    dbPromise ??= new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION)
        req.onupgradeneeded = () => {
          const db = req.result
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE, { keyPath: "key" }).createIndex("savedAt", "savedAt")
          }
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => resolve(null)
        req.onblocked = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
    return dbPromise
  }
  let writes = 0

  return {
    async get(key) {
      const db = await openDb()
      if (!db) return undefined
      return requestToPromise<CacheEntry | undefined>(db.transaction(STORE, "readonly").objectStore(STORE).get(key))
    },
    async put(entry) {
      const db = await openDb()
      if (!db) return
      await requestToPromise(db.transaction(STORE, "readwrite").objectStore(STORE).put(entry))
      // Housekeeping every 25 writes: drop expired entries, then the oldest over the cap.
      if (++writes % 25 !== 1) return
      const index = db.transaction(STORE, "readonly").objectStore(STORE).index("savedAt")
      const [keys, expired] = await Promise.all([
        requestToPromise(index.getAllKeys()),
        requestToPromise(index.getAllKeys(IDBKeyRange.upperBound(now() - CACHE_TTL_MS))),
      ])
      const blockKeys = keys.filter((k) => k !== "tags")
      const overflow = Math.max(0, blockKeys.length - MAX_CACHED_BLOCKS)
      const doomed = new Set<IDBValidKey>([...expired, ...blockKeys.slice(0, overflow)])
      if (doomed.size === 0) return
      const tx = db.transaction(STORE, "readwrite").objectStore(STORE)
      doomed.forEach((k) => tx.delete(k))
    },
    async clearBlocks() {
      const db = await openDb()
      if (!db) return
      const tx = db.transaction(STORE, "readwrite").objectStore(STORE)
      await requestToPromise(tx.delete(IDBKeyRange.bound("b:", "b;")))
    },
  }
}

let shared: AddedTagsLoader | null = null

/** The page-wide loader: real fetch, IndexedDB cache, URL from NEXT_PUBLIC_ADDED_TAGS_URL. */
export function getDatasetTags(postId: number): Promise<string[] | null> {
  shared ??= createAddedTagsLoader({
    fetch: (url) => fetch(url),
    baseUrl: resolveBaseUrl(process.env.NEXT_PUBLIC_ADDED_TAGS_URL),
    store: createIndexedDbStore(),
  })
  return shared.getTags(postId).catch(() => null)
}
