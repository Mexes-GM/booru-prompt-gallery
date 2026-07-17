"use client"

import { useMemo, useRef, useEffect } from "react"
import { useFavoritePosts, type FavoriteItem } from "@/hooks/use-favorite-posts"
import type { HistoryItem } from "@/lib/storage"
import type { BooruPost } from "@/lib/booru/types"
import { dedupeHistoryKeys } from "@/lib/history-order"

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
        // Prefer the snapshot's OWN `_provider` (stamped from the real post
        // object at copy time — see prompt-gallery.tsx's copyToClipboard) over
        // `item.provider`. They should match, but `item.provider` was for a
        // time written from the currently-selected provider TAB instead of the
        // copied post's actual provider (e.g. copying a Gelbooru post while
        // viewing Favorites/History could tag it as whatever tab was active).
        // That bug is fixed at the write site now, but existing localStorage
        // history entries may still carry a stale/wrong `item.provider` — the
        // embedded snapshot's `_provider` was always correct, so trust it first.
        .map(item => ({ ...(item.post as BooruPost), _provider: item.post!._provider || item.provider })),
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
  const dedupedKeys = useMemo(() => dedupeHistoryKeys(history), [history])

  // `dedupedKeys` is already the correct display order: RAW history order
  // (newest HistoryItem first), deduped so each post appears once at its
  // most-recent copy position. Re-copying a post that's already in History
  // (including from within the History view itself) moves its key to the
  // front, same as any other "newest first" list — that's correct, expected
  // behavior, not a bug.
  //
  // MasonryGrid's incremental layout cache used to force a full relayout on
  // any reordering and, separately, mis-animated ALL existing cards as
  // "newly added" whenever items were prepended (its append-detection was
  // index-based, not ID-based) — that's what caused cards to visibly
  // jump/duplicate on every copy. Both were fixed directly in MasonryGrid
  // (ID-based new-item diffing + scroll-anchored full recompute), so this
  // hook no longer needs to freeze display order to work around it.
  const posts = useMemo<BooruPost[]>(() => {
    const byKey = new Map<string, BooruPost>()
    for (const p of snapshotPosts) {
      byKey.set(`${(p._provider || '').toLowerCase()}:${p.id}`, p)
    }
    for (const p of fetched.posts) {
      byKey.set(`${(p._provider || '').toLowerCase()}:${p.id}`, p)
    }
    return dedupedKeys
      .map(key => byKey.get(key))
      .filter((p): p is BooruPost => p !== undefined)
  }, [dedupedKeys, snapshotPosts, fetched.posts])

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
