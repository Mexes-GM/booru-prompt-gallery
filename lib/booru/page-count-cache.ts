/**
 * Post counts of the searches Pack Mode pages through, kept in localStorage for a day so
 * a pack opened again on the same search doesn't ask the site again. Keyed by site and the
 * exact query sent. Best-effort, like the favorites cache: no storage, a full one or a
 * corrupt entry behave as an empty cache.
 */
import type { BooruProvider } from "./types"

export const PAGE_COUNT_CACHE_KEY = "pack-page-counts"
export const PAGE_COUNT_TTL_MS = 24 * 60 * 60 * 1000
/** Searches kept; the oldest go first. */
export const MAX_CACHED_COUNTS = 200

interface Entry { n: number; at: number }
type Store = Pick<Storage, "getItem" | "setItem">

const defaultStore = (): Store | null => {
  try {
    return typeof window !== "undefined" ? window.localStorage : null
  } catch {
    return null
  }
}

const entryKey = (provider: BooruProvider, query: string) => `${provider}|${query}`

function readAll(store: Store): Record<string, Entry> {
  try {
    const raw = store.getItem(PAGE_COUNT_CACHE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === "object" ? (parsed as Record<string, Entry>) : {}
  } catch {
    return {}
  }
}

/** The search's post count if it was read less than a day ago, else null. */
export function readCachedCount(provider: BooruProvider, query: string, now = Date.now(), store: Store | null = defaultStore()): number | null {
  if (!store) return null
  const entry = readAll(store)[entryKey(provider, query)]
  if (!entry || typeof entry.n !== "number" || !Number.isFinite(entry.n) || typeof entry.at !== "number") return null
  return now - entry.at < PAGE_COUNT_TTL_MS && now >= entry.at ? entry.n : null
}

/** Keeps the search's post count, dropping expired entries and the oldest past MAX_CACHED_COUNTS. */
export function writeCachedCount(provider: BooruProvider, query: string, count: number, now = Date.now(), store: Store | null = defaultStore()): void {
  if (!store || !Number.isFinite(count)) return
  const all = readAll(store)
  all[entryKey(provider, query)] = { n: count, at: now }
  const kept = Object.entries(all)
    .filter(([, e]) => e && typeof e.at === "number" && now - e.at < PAGE_COUNT_TTL_MS)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_CACHED_COUNTS)
  try {
    store.setItem(PAGE_COUNT_CACHE_KEY, JSON.stringify(Object.fromEntries(kept)))
  } catch { /* full or blocked: the next pack asks the site again */ }
}
