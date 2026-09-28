/**
 * Persistent, growing cache of the posts Pack Mode samples from — one entry
 * per source (provider + rating + search tags), kept in IndexedDB so that
 * reopening Pack Mode on a known source is instant and every session adds a
 * few new posts on top instead of starting from zero.
 *
 * Only the tag fields sampling needs are stored (no URLs/images), so a post
 * is ~1-2 KB. Everything here is best-effort: private windows, blocked
 * storage or quota errors just behave like an empty cache.
 */
import type { BooruPost, BooruProvider } from "../booru/types"

const DB_NAME = "pack-pool-cache"
const DB_VERSION = 1
const STORE = "sources"

/** Newest posts kept per source — enough variety without unbounded growth. */
export const MAX_CACHED_POSTS_PER_SOURCE = 600
/** Sources kept overall; the least recently used ones are evicted first. */
export const MAX_CACHED_SOURCES = 20

interface SlimPost {
  id: number
  t: string
  c: string
  m?: string
  r: string
}

interface CacheRecord {
  key: string
  posts: SlimPost[]
  updatedAt: number
}

export function poolCacheKey(provider: BooruProvider, ratingMode: string, searchTags: string): string {
  const tags = searchTags
    .split(",")
    .map((t) => t.trim().toLowerCase().replace(/\s+/g, "_"))
    .filter(Boolean)
    .sort()
    .join(",")
  return `${provider}|${ratingMode}|${tags}`
}

function toSlim(post: BooruPost): SlimPost {
  return {
    id: post.id,
    t: post.tag_string || "",
    c: post.tag_string_character || "",
    m: post.tag_string_meta || undefined,
    r: post.rating || "",
  }
}

function fromSlim(p: SlimPost): BooruPost {
  return {
    id: p.id,
    file_url: "",
    large_file_url: "",
    preview_file_url: "",
    tag_string: p.t,
    tag_string_artist: "",
    tag_string_character: p.c,
    tag_string_copyright: "",
    tag_string_meta: p.m,
    rating: p.r,
    score: 0,
  }
}

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null)
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "key" }).createIndex("updatedAt", "updatedAt")
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

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Cached posts for a source, newest first; [] when nothing is cached or storage is unavailable. */
export async function loadPoolCache(key: string): Promise<BooruPost[]> {
  try {
    const db = await openDb()
    if (!db) return []
    const record = await requestToPromise<CacheRecord | undefined>(
      db.transaction(STORE, "readonly").objectStore(STORE).get(key)
    )
    return record ? record.posts.map(fromSlim) : []
  } catch {
    return []
  }
}

/**
 * Merges `posts` into the source's cached posts (new ones first, deduped by
 * id, capped), bumps its recency, then evicts the oldest sources over the cap.
 * Returns how many posts the source now holds.
 */
export async function savePoolCache(key: string, posts: BooruPost[]): Promise<number> {
  try {
    const db = await openDb()
    if (!db) return 0
    const store = () => db.transaction(STORE, "readwrite").objectStore(STORE)
    const existing = await requestToPromise<CacheRecord | undefined>(store().get(key))

    const seen = new Set<number>()
    const merged: SlimPost[] = []
    for (const p of [...posts.map(toSlim), ...(existing?.posts ?? [])]) {
      if (seen.has(p.id)) continue
      seen.add(p.id)
      merged.push(p)
      if (merged.length >= MAX_CACHED_POSTS_PER_SOURCE) break
    }
    await requestToPromise(store().put({ key, posts: merged, updatedAt: Date.now() } satisfies CacheRecord))

    const allKeys = await requestToPromise(store().index("updatedAt").getAllKeys())
    const overflow = allKeys.length - MAX_CACHED_SOURCES
    if (overflow > 0) {
      // getAllKeys on the updatedAt index returns primary keys oldest-first.
      const tx = db.transaction(STORE, "readwrite").objectStore(STORE)
      allKeys.slice(0, overflow).forEach((k) => tx.delete(k))
    }
    return merged.length
  } catch {
    return 0
  }
}

/** Forgets one source's cached posts, or every source when `key` is omitted. */
export async function clearPoolCache(key?: string): Promise<void> {
  try {
    const db = await openDb()
    if (!db) return
    const store = db.transaction(STORE, "readwrite").objectStore(STORE)
    await requestToPromise(key ? store.delete(key) : store.clear())
  } catch {
    // Best-effort, like every other operation here.
  }
}

/** Freshly fetched posts first, then cached ones not already among them (deduped by id). */
export function mergePostLists(fetched: BooruPost[], cached: BooruPost[]): BooruPost[] {
  const seen = new Set<number>()
  const out: BooruPost[] = []
  for (const post of [...fetched, ...cached]) {
    if (!post || seen.has(post.id)) continue
    seen.add(post.id)
    out.push(post)
  }
  return out
}
