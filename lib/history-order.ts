import type { BooruProvider } from "./booru/types"
import type { BooruPost } from "./booru/types"

/**
 * Deduplicates history keys (`provider:postId`, lowercased) preserving the
 * newest-first order of `history`: the FIRST occurrence of a post wins,
 * which is its most recent copy since history is prepend-ordered (newest
 * entry first — see `userPreferences.addToHistory` in `lib/storage.ts`).
 *
 * Keys prefer each entry's embedded snapshot `_provider` over the sibling
 * `provider` field when both are present — `item.provider` was, for a time,
 * written from whichever provider tab was active at copy time instead of the
 * copied post's actual provider, so older localStorage entries can have it
 * wrong while the snapshot (taken from the real post object) is still
 * correct. Must match the key derivation in `hooks/use-history-posts.ts`'s
 * `snapshotPosts`/`byKey`, or deduped keys and hydrated posts diverge and
 * entries silently disappear from History instead of resolving.
 *
 * Pure/no React deps on purpose, so it's directly unit-testable — see
 * `__tests__/history-order.verify.ts` — and reusable from
 * `hooks/use-history-posts.ts` without dragging its dependency tree in.
 */
export function dedupeHistoryKeys(history: { provider: BooruProvider; postId: number; post?: BooruPost }[]): string[] {
  const seen = new Set<string>()
  const keys: string[] = []
  for (const item of history) {
    const provider = item.post?._provider || item.provider
    const key = `${provider}:${item.postId}`.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      keys.push(key)
    }
  }
  return keys
}
