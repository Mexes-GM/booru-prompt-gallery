import type { BooruProvider } from "./booru/types"

/**
 * Deduplicates history keys (`provider:postId`, lowercased) preserving the
 * newest-first order of `history`: the FIRST occurrence of a post wins,
 * which is its most recent copy since history is prepend-ordered (newest
 * entry first — see `userPreferences.addToHistory` in `lib/storage.ts`).
 *
 * Pure/no React deps on purpose, so it's directly unit-testable — see
 * `__tests__/history-order.verify.ts` — and reusable from
 * `hooks/use-history-posts.ts` without dragging its dependency tree in.
 */
export function dedupeHistoryKeys(history: { provider: BooruProvider; postId: number }[]): string[] {
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
}
