/**
 * Collapses near-duplicate posts in Pack Mode's pool. Uploaders often post a
 * series of the same character in the same outfit with tiny variations;
 * since pools rank and weight values by how many posts carry them, ten such
 * variations count as ten votes for one outfit and crowd everything else
 * out. Keeping one post per near-identical group restores the variety.
 */
import type { BooruPost } from "../booru/types"
import { splitTags } from "../utils/tag-utils"

/** Share of tags two posts must have in common (Jaccard) to count as one. */
export const NEAR_DUPLICATE_THRESHOLD = 0.8
/** Posts with fewer tags than this are never collapsed — too little to compare. */
const MIN_TAGS_TO_COMPARE = 8

function jaccard(a: Set<string>, b: Set<string>): number {
  let shared = 0
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  small.forEach((tag) => { if (large.has(tag)) shared++ })
  return shared / (a.size + b.size - shared)
}

/**
 * Keeps the first post of every group of near-identical ones (order is
 * preserved, so put the posts you'd rather keep first). Only posts with the
 * same character tags are compared — a series shares its character, and it
 * keeps this well under quadratic on a mixed pool.
 */
export function collapseNearDuplicates(posts: BooruPost[], threshold = NEAR_DUPLICATE_THRESHOLD): BooruPost[] {
  const keptByCharacter = new Map<string, Set<string>[]>()
  const out: BooruPost[] = []
  for (const post of posts) {
    const tags = new Set(splitTags(post.tag_string || ""))
    if (tags.size < MIN_TAGS_TO_COMPARE) {
      out.push(post)
      continue
    }
    const character = splitTags(post.tag_string_character || "").sort().join(" ")
    const kept = keptByCharacter.get(character) ?? []
    if (kept.some((other) => jaccard(tags, other) >= threshold)) continue
    kept.push(tags)
    keptByCharacter.set(character, kept)
    out.push(post)
  }
  return out
}
