"use client"

import { useMemo, useRef, useEffect } from "react"
import { useFavoritePosts, type FavoriteItem } from "@/hooks/use-favorite-posts"
import type { HistoryItem } from "@/lib/storage"
import type { BooruPost } from "@/lib/booru/types"

/**
 * Hydrates full `BooruPost[]` for a list of copy-history entries.
 *
 * Two-tier strategy, newest-first:
 *  1. **Snapshot (no network).** Since the redesign, `addToHistory` embeds a
 *     self-contained `HistoryItem.post` snapshot captured from the card the user
 *     copied. Those render straight from localStorage with ZERO network calls,
 *     which makes History immune to transient booru/API failures (rate limits,
 *     5xx, timeouts) — the whole reason a copied prompt could previously show up
 *     as "could not be loaded".
 *  2. **Network fallback (legacy only).** Entries WITHOUT a snapshot (written
 *     before the redesign, or whose snapshot was dropped to fit the storage
 *     budget) are hydrated on demand through `useFavoritePosts`, reusing the
 *     exact same layered cache (SWR → localStorage → Supabase → booru API) that
 *     Favorites relies on. This subset also gets a bounded auto-retry below.
 *
 * The merged result preserves the original history order and feeds the same
 * `BooruPost[]` shape into `ResultsGrid`, so cards render identically to
 * Favorites (categories, weights, smart tag exclusion, per-category copy).
 */
export function useHistoryPosts(history: HistoryItem[]) {
  // Tier 1: entries that carry their own snapshot render without any network.
  const snapshotPosts = useMemo<BooruPost[]>(
    () =>
      history
        .filter(item => item.post)
        // Guarantee _provider matches the canonical history provider (the
        // snapshot may predate _provider being stamped, or carry a stale one).
        .map(item => ({ ...(item.post as BooruPost), _provider: item.provider })),
    [history]
  )

  // Tier 2: only snapshot-less (legacy) entries need on-demand hydration.
  const needsFetch = useMemo<FavoriteItem[]>(
    () =>
      history
        .filter(item => !item.post)
        .map(item => ({ provider: item.provider, id: item.postId })),
    [history]
  )

  const fetched = useFavoritePosts(needsFetch)

  // ── Bounded auto-retry for the legacy (network) subset ──
  // Snapshots never fail, but legacy entries still depend on the booru. If the
  // fetch settles short (transient rate limit / 5xx / network), silently retry
  // a couple of times with backoff before the UI surfaces "could not be loaded".
  const MAX_AUTO_RETRIES = 2
  const retryCountRef = useRef(0)
  // Reset the retry budget whenever the legacy set itself changes.
  useEffect(() => {
    retryCountRef.current = 0
  }, [needsFetch])
  useEffect(() => {
    if (needsFetch.length === 0) return
    if (fetched.isLoading || fetched.isValidating) return
    // Everything hydrated → nothing to retry.
    if (fetched.posts.length >= needsFetch.length && !fetched.error) return
    if (retryCountRef.current >= MAX_AUTO_RETRIES) return
    const attempt = retryCountRef.current
    retryCountRef.current += 1
    const delay = 1500 * Math.pow(2, attempt) // 1.5s, 3s
    const timer = setTimeout(() => { fetched.mutate() }, delay)
    return () => clearTimeout(timer)
  }, [needsFetch, fetched.isLoading, fetched.isValidating, fetched.posts.length, fetched.error, fetched.mutate])

  // Merge snapshot + fetched posts, keyed by provider:id, then re-project onto
  // the DEDUPED history order. History entries are NOT unique by (provider, id):
  // copying the same post twice (including copying it again from within History
  // itself) creates two separate HistoryItem rows pointing at the same post. The
  // render list must still be unique per post — ResultsGrid keys cards by
  // `${_provider}-${id}`, so feeding it two entries for the same post produces
  // React's "two children with the same key" warning and a visually duplicated/
  // looping card. Dedup here (first occurrence = newest copy, since history is
  // newest-first) while keeping the missing-count check accurate against the
  // same deduped total.
  const dedupedKeys = useMemo(() => {
    const seen = new Set<string>()
    const keys: string[] = []
    for (const item of history) {
      const key = `${item.provider}:${item.postId}`.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        keys.push(key)
      }
    }
    return keys
  }, [history])

  // ── Stable display order ──
  // `dedupedKeys` reflects the RAW history order (newest HistoryItem first), so
  // re-copying a post that's already in History — including copying it again
  // from within the History view itself — moves its key to the front every
  // time (a new HistoryItem is always prepended). That reordering defeats
  // MasonryGrid's incremental layout cache (which only fast-paths when
  // existing item IDs stay an ID-prefix match), forcing a full relayout on
  // every copy: cards visibly jump/duplicate mid-transition, and are briefly
  // interleaved enough to share Framer Motion `layoutId`/animation state and
  // to interrupt in-flight image loads (looked like "the duplicate never
  // finishes loading").
  //
  // Fix: track the order posts were first shown in and stick to it. A key
  // already in `orderRef` keeps its original slot; only keys that are new
  // (first-ever copy of that post) get appended at the end. Removing a post
  // from history (removeFromHistory) drops it from the tracked order too, so
  // it doesn't leave a stale slot.
  const orderRef = useRef<string[]>([])
  const displayKeys = useMemo(() => {
    const currentSet = new Set(dedupedKeys)
    // Keep previously-shown keys that are still present, in their existing order.
    const stable = orderRef.current.filter(key => currentSet.has(key))
    // Append genuinely new keys (never shown before) at the end.
    const stableSet = new Set(stable)
    for (const key of dedupedKeys) {
      if (!stableSet.has(key)) stable.push(key)
    }
    orderRef.current = stable
    return stable
  }, [dedupedKeys])

  const posts = useMemo<BooruPost[]>(() => {
    const byKey = new Map<string, BooruPost>()
    for (const p of snapshotPosts) {
      byKey.set(`${(p._provider || '').toLowerCase()}:${p.id}`, p)
    }
    for (const p of fetched.posts) {
      byKey.set(`${(p._provider || '').toLowerCase()}:${p.id}`, p)
    }
    return displayKeys
      .map(key => byKey.get(key))
      .filter((p): p is BooruPost => p !== undefined)
  }, [displayKeys, snapshotPosts, fetched.posts])

  return {
    data: posts.length,
    posts,
    // Total UNIQUE posts this history resolves to (after dedup) — the caller's
    // "N could not be loaded" / progress-bar math must compare against this,
    // NOT `history.length`, since history rows aren't unique per post (see
    // dedupedKeys above).
    total: dedupedKeys.length,
    // Loading/validating/error reflect ONLY the network (legacy) subset; if every
    // entry has a snapshot there is no network work and these stay falsy.
    isLoading: fetched.isLoading,
    isValidating: fetched.isValidating,
    error: fetched.error,
    mutate: fetched.mutate,
    progress: fetched.progress,
  }
}
