/**
 * Merge Mode's "Tags in at least N of M posts" filter.
 *
 * A post-derived segment carries `count` (how many selected posts contain the
 * tag, the same number the footer's badge shows). Segments without a count are
 * tags the user typed into "Tags to add" or ones injected by the background
 * mode: the user asked for those explicitly, so the filter never drops them.
 */
export interface CountedSegment {
  count?: number
}

/** Highest useful minimum for a selection: one post per tag at least. */
export function maxSharedPosts(selectedCount: number): number {
  return Math.max(1, selectedCount)
}

/** Clamps a stored minimum to what the current selection allows. */
export function clampSharedPosts(minPosts: number, selectedCount: number): number {
  return Math.min(Math.max(1, Math.floor(minPosts) || 1), maxSharedPosts(selectedCount))
}

/**
 * Keeps the segments found in at least `minPosts` selected posts.
 * Returns the kept segments (in their original order) and how many were hidden.
 */
export function filterBySharedCount<T extends CountedSegment>(
  segments: T[],
  minPosts: number
): { kept: T[]; hiddenCount: number } {
  if (minPosts <= 1) return { kept: segments, hiddenCount: 0 }
  const kept: T[] = []
  let hiddenCount = 0
  for (const s of segments) {
    if (s.count === undefined || s.count >= minPosts) kept.push(s)
    else hiddenCount++
  }
  return { kept, hiddenCount }
}
