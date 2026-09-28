/**
 * Pure helper: detect near-duplicate prompts in Bulk Send (both "Real posts"
 * and "Synthetic" modes) so a batch doesn't end up with N prompts that are
 * effectively the same tag set repeated with minor variations (e.g. two posts
 * from the same character/pose cluster, or two synthetic combinations that
 * only differ by one filler tag).
 *
 * Similarity is computed as Jaccard similarity over each prompt's tag set
 * (weights/brackets stripped, tags normalized to lowercase+underscore-free
 * form so "1girl" and "1girl" from different sources always compare equal,
 * and "blue_eyes" vs "blue eyes" don't count as different tags).
 *
 * No React/DOM here — testable with ts-node like pack-generator.verify.ts.
 */

/** Strip weighting syntax ("(tag:1.2)", "((tag))", "[tag]") down to the bare tag text. */
function stripWeightSyntax(rawTag: string): string {
  let tag = rawTag.trim()
  // Strip outer bracket wrapping first ("(((tag)))", "[tag]", "<tag>") — the
  // weight number (if any) lives INSIDE the brackets (e.g. "(blue_eyes:1.3)"),
  // so brackets must come off before we can see the trailing ":<number>".
  tag = tag.replace(/^[([{<]+/, "").replace(/[)\]}>]+$/, "")
  // Drop a trailing ":<number>" weight left exposed after unwrapping
  // (e.g. "detailed background:1.3", or "blue_eyes:1.3" after the () above).
  tag = tag.replace(/:\s*[\d.]+\s*$/, "")
  // A second unwrap pass in case the weight itself was still wrapped in an
  // inner bracket layer (e.g. "((tag):1.2)" — unusual but not invalid syntax).
  tag = tag.replace(/^[([{<]+/, "").replace(/[)\]}>]+$/, "")
  return tag.trim()
}

/** Normalize a single tag for similarity comparison: lowercase, spaces, trimmed. */
function normalizeTagForSimilarity(rawTag: string): string {
  return stripWeightSyntax(rawTag).toLowerCase().replace(/_/g, " ").trim()
}

/**
 * Parse a comma-separated prompt string into a normalized, deduped tag set
 * suitable for Jaccard comparison.
 */
export function promptToTagSet(prompt: string): Set<string> {
  const tags = prompt
    .split(",")
    .map(normalizeTagForSimilarity)
    .filter(Boolean)
  return new Set(tags)
}

/**
 * Jaccard similarity between two tag sets: |intersection| / |union|, in
 * [0, 1]. Two empty sets are treated as maximally similar (1) — callers
 * comparing against an empty-prompt edge case should filter those out via
 * the `.filter((item) => item.prompt.trim().length > 0)` step that already
 * runs upstream (use-bulk-send.ts / bulk-send.ts), so this case is rare.
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0

  let intersectionSize = 0
  for (const tag of a) {
    if (b.has(tag)) intersectionSize++
  }
  const unionSize = a.size + b.size - intersectionSize
  return unionSize === 0 ? 1 : intersectionSize / unionSize
}

/** Default similarity threshold above which two prompts are considered near-duplicates. */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.85

/**
 * Incremental near-duplicate filter: call `isDuplicate(prompt)` for each
 * candidate prompt, in order. Accepted (non-duplicate) prompts are
 * remembered so later candidates are also compared against them — this
 * catches duplicates spread anywhere across the batch, not just adjacent
 * ones. `threshold` is the Jaccard similarity (0..1) at or above which a
 * candidate is rejected as too similar to an already-accepted prompt.
 */
export class NearDuplicateFilter {
  private readonly threshold: number
  private readonly acceptedTagSets: Set<string>[] = []
  private readonly ignored: Set<string>

  /**
   * `ignoreTags` are left out of the comparison — pass the tags every
   * candidate shares (e.g. Pack Mode's locked base). Otherwise a large shared
   * base drowns the varying part: 30 shared tags + 1 differing tag scores
   * ~0.94 and every prompt after the first is rejected.
   */
  constructor(threshold: number = DEFAULT_SIMILARITY_THRESHOLD, ignoreTags: Iterable<string> = []) {
    this.threshold = threshold
    this.ignored = new Set(Array.from(ignoreTags, normalizeTagForSimilarity))
  }

  /** Returns true and records the prompt if it's NOT a near-duplicate of any
   *  previously accepted prompt; returns false (and does not record it) otherwise. */
  tryAccept(prompt: string): boolean {
    const tagSet = promptToTagSet(prompt)
    this.ignored.forEach((tag) => tagSet.delete(tag))
    for (const existing of this.acceptedTagSets) {
      if (jaccardSimilarity(tagSet, existing) >= this.threshold) return false
    }
    this.acceptedTagSets.push(tagSet)
    return true
  }
}
