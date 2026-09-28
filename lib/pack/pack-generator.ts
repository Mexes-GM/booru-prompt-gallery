/**
 * Pure, framework-free core for the Image Pack Builder ("Pack Mode").
 *
 * Two responsibilities, both pure (no React, no DOM) so they can be unit-tested
 * with ts-node (see __tests__/pack-generator.verify.ts):
 *
 *   1. extractAxisValues() — given the currently loaded booru posts, pull the
 *      candidate values for a single variation axis (a TagCategory), ranked by
 *      how often they appear across those posts. This is the "prioritize
 *      sampling from booru results" requirement, reusing the DB tag
 *      classification (tagOverrides) via classifyTags.
 *
 *   2. generatePackPrompts() — given the locked/constant base tags and the
 *      active axes (category -> candidate values), produce N distinct prompts,
 *      each = base + one sampled value per axis, with Smart Tag Exclusion
 *      (resolveTagConflicts) applied against the base and optional global
 *      weights. Random sampling of the cartesian product with a configurable
 *      cap, deterministic when a seeded rng is supplied.
 */
import { BooruPost } from "../booru/types"
import { TagCategory, classifyTags } from "../tag-classifier"
import { resolveTagConflicts } from "../tag-conflicts"
import { conflictsWithBackground } from "./background-coherence"
import { applyWeights } from "../weight-utils"
import { normalize, buildPostMetaTagSet, isMetaTag } from "../cleanPrompt"
import {
  PACK_AXES,
  SLOT_CONSTRAINTS,
  SLOT_GROUP_CONSTRAINTS,
  getTagSlotFromOverrides,
  slotsOf,
} from "../tag-taxonomy"
import { splitTags, splitCommaSeparatedTags, joinTags } from "../utils/tag-utils"

/** Mode of tag collection for a variation axis: individual tags vs card-cohesive bundles. */
export type AxisTagMode = 'individual' | 'bundle'

/** Maximum values per axis allowed in "Min tags" slider when sampling individual tags. */
export const MAX_MIN_TAGS_SLIDER = 30

/** Maximum values per axis allowed in "Min packs" slider when sampling card tag bundles. */
export const MAX_MIN_PACKS_SLIDER = 10

/** Hard ceiling on how many prompts a single generation can emit — the
 *  user-facing cap (slider max, promptCount clamp). */
export const MAX_PACK_PROMPTS = 100

/**
 * Internal ceiling for the OVER-generation pass only (see use-pack-mode.ts's
 * regenerate): raw candidates are generated at up to `promptCount * 3` so
 * the near-duplicate filter + cleaner pipeline downstream has room to reject
 * some and still reach `promptCount`. That over-generate count used to be
 * capped at MAX_PACK_PROMPTS itself, which meant requesting close to 100
 * prompts left ZERO headroom for the multiplier — a user asking for 100
 * silently got back however many survived deduping, often far fewer, with
 * no indication anything was capped. This is deliberately higher than
 * MAX_PACK_PROMPTS (never user-facing, never clamps promptCount) so the 3x
 * multiplier has room to work even when the user requests the max.
 */
export const MAX_PACK_OVERGENERATE = MAX_PACK_PROMPTS * 3

/** The variation axes we expose (a subset of TagCategory — "other" is noise).
 *  Sourced from lib/tag-taxonomy.ts (`isPackAxis`); re-exported here so the
 *  existing `import { PACK_AXES } from '.../pack-generator'` call sites keep
 *  working. */
export { PACK_AXES }

/** Below this many sampled values, top up an axis pool with curated fallbacks. */
export const SPARSE_POOL_THRESHOLD = 5
/** Cap on how many fallback values to blend in per axis. */
export const MAX_FALLBACK_VALUES = 20

/**
 * Merge booru-sampled values with curated fallback values when the sampled
 * pool is too sparse (niche searches with few loaded posts). Sampled values
 * always come first and are never displaced; fallbacks only fill the gap up
 * to MAX_FALLBACK_VALUES extra entries, and never duplicate an existing value.
 */
export function withAxisFallback(sampled: string[], fallback: string[] | undefined): string[] {
  if (sampled.length >= SPARSE_POOL_THRESHOLD || !fallback || fallback.length === 0) {
    return sampled
  }
  const seen = new Set(sampled)
  const extra: string[] = []
  for (const value of fallback) {
    if (seen.has(value)) continue
    seen.add(value)
    extra.push(value)
    if (extra.length >= MAX_FALLBACK_VALUES) break
  }
  return [...sampled, ...extra]
}

/** Normalize a raw booru tag to display form: lowercase, spaces, trimmed. */
export function normalizeTagForPack(tag: string): string {
  return tag.toLowerCase().replace(/_/g, " ").trim()
}

/** Split + normalize a space-delimited booru tag string, dropping empties. */
function normalizedTagList(tagString: string | undefined): string[] {
  if (!tagString) return []
  return splitTags(tagString).map(normalizeTagForPack).filter(Boolean)
}

/**
 * Classify a single post's tags (character + general, meta-filtered) into the
 * 5 category buckets, in display-normalized form. Character tags are passed as
 * knownCharacterTags so they land in `appearance` (important for the
 * "clothing pack varying characters" use case).
 */
export function classifyPostForPack(
  post: BooruPost,
  tagOverrides: Record<string, string> = {}
): Record<TagCategory, string[]> {
  const charTags = normalizedTagList(post.tag_string_character)
  // The post's own tag_string_meta covers Danbooru's real category-5 vocabulary
  // for this post; the curated set inside isMetaTag covers the editorial
  // removals Danbooru classifies as `general` (signature, watermark, text...).
  const postMetaTags = buildPostMetaTagSet(post.tag_string_meta)
  const generalTags = normalizedTagList(post.tag_string).filter(
    (t) => !isMetaTag(t, postMetaTags)
  )
  const allTags = Array.from(new Set([...charTags, ...generalTags]))
  return classifyTags(allTags, tagOverrides, charTags)
}

/**
 * Filter an `appearance`-bucket tag list (as returned by classifyPostForPack)
 * down to just ONE character tag — the "primary" one, i.e. `characterTags[0]`
 * — dropping every OTHER character tag from the bucket while leaving every
 * non-character appearance tag (hair color, body type, etc.) untouched.
 *
 * Why this exists: classifyPostForPack folds EVERY character tag on a post
 * into `appearance` by design (it classifies one post in isolation; it has
 * no concept of "the pack's character"). A 'character' pack's default
 * locked category is exactly ['appearance'], so picking a multi-character
 * base card (crossovers, group art) as the base silently locked ALL of
 * those character names as constant tags into every generated prompt — an
 * 8-character crossover post produced packs where all 8 unrelated names
 * were forced into every prompt, which Smart Tag Exclusion then (correctly)
 * rejected almost everywhere, leaving a handful of nonsensical survivors.
 *
 * `characterTags` should be the SAME normalized list classifyPostForPack
 * itself derived from the post's tag_string_character (use-pack-mode.ts
 * already computes this once via normalizeTagForPack), so the "primary"
 * pick lines up with what was actually folded into `appearanceTags`.
 * A no-op when there are 0 or 1 character tags.
 */
export function filterAppearanceForPrimaryCharacter(
  appearanceTags: string[],
  characterTags: string[]
): string[] {
  if (characterTags.length <= 1) return appearanceTags
  const primary = characterTags[0]
  const others = new Set(characterTags.slice(1))
  return appearanceTags.filter((tag) => tag === primary || !others.has(tag))
}

/**
 * Extract candidate values for one axis from the loaded posts, ranked by
 * frequency (descending), deduped, capped at `limit`. Ties keep first-seen
 * order for stability.
 *
 * The cap here is NOT a memory/performance safeguard — that's
 * ENUMERATE_THRESHOLD below, which already handles arbitrarily large pools by
 * switching from exhaustive enumeration to random sampling (sampleCombination
 * never materializes the full C(n, k) space, so it's O(k) regardless of pool
 * size). The default was historically 40 — the same number used in this
 * file's own "C(40, 20) ≈ 1.4e11" example of what ENUMERATE_THRESHOLD
 * protects against — but that protection makes the axis-pool cap redundant:
 * a 200+ value pool is exactly as safe as a 40 value one. Raised to 200 so
 * loading more posts (see hooks/use-pack-seed.ts) actually pays off with more
 * variety instead of being silently truncated back down.
 */
export function extractAxisValues(
  posts: BooruPost[],
  category: TagCategory,
  tagOverrides: Record<string, string> = {},
  limit = 200
): string[] {
  return extractAxisValuesWithCounts(posts, category, tagOverrides, limit).map((v) => v.value)
}

/** Rank a per-value frequency map into the same
 *  {value, count}[] shape extractAxisValuesWithCounts returns: descending by
 *  count, ties broken by first-seen order, capped at `limit`. Shared by
 *  extractAxisValuesWithCounts (single category) and
 *  extractAllAxisValuesWithCounts (all categories at once) so both apply
 *  the exact same ranking rule. */
function rankAxisCounts(
  counts: Map<string, number>,
  firstSeen: Map<string, number>,
  limit: number
): Array<{ value: string; count: number }> {
  return Array.from(counts.keys())
    .sort((a, b) => {
      const diff = (counts.get(b) ?? 0) - (counts.get(a) ?? 0)
      if (diff !== 0) return diff
      return (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0)
    })
    .slice(0, limit)
    .map((value) => ({ value, count: counts.get(value) ?? 0 }))
}

/**
 * Same ranking/dedupe/limit behavior as `extractAxisValues`, but also returns
 * the raw cross-post frequency count for each value. `extractAxisValues` is a
 * thin wrapper over this so existing callers (bulk-send.ts's
 * `buildAxesFromSeedPosts`, use-pack-mode.ts) keep working unchanged; new
 * callers that want frequency-weighted sampling (see `axisWeights` on
 * `generatePackPromptsArgs` / `sampleWeightedCombination`) use this directly.
 */
export function extractAxisValuesWithCounts(
  posts: BooruPost[],
  category: TagCategory,
  tagOverrides: Record<string, string> = {},
  limit = 200
): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>()
  const firstSeen = new Map<string, number>()
  let order = 0

  for (const post of posts) {
    const classified = classifyPostForPack(post, tagOverrides)
    // Dedupe within a post so one post can't inflate a tag's frequency.
    const unique = new Set(classified[category] ?? [])
    for (const tag of unique) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
      if (!firstSeen.has(tag)) firstSeen.set(tag, order++)
    }
  }

  return rankAxisCounts(counts, firstSeen, limit)
}

/**
 * Same result as calling extractAxisValuesWithCounts once per PACK_AXES
 * category, but classifies each post ONLY ONCE instead of once per
 * category — classifyPostForPack re-splits/re-classifies a post's full tag
 * string from scratch on every call, so reseedAllAxes calling
 * extractAxisValuesWithCounts in a per-category loop (the original shape)
 * was classifying the same posts 4x on every "Load more posts" / initial
 * seed. Use this whenever every axis needs reseeding at once; use the
 * single-category function above when only one axis does (reseedAxis's
 * "Re-sample" button).
 */
export function extractAllAxisValuesWithCounts(
  posts: BooruPost[],
  categories: readonly TagCategory[],
  tagOverrides: Record<string, string> = {},
  limit = 200
): Partial<Record<TagCategory, Array<{ value: string; count: number }>>> {
  const countsByCategory = new Map<TagCategory, Map<string, number>>()
  const firstSeenByCategory = new Map<TagCategory, Map<string, number>>()
  const orderByCategory = new Map<TagCategory, number>()
  categories.forEach((cat) => {
    countsByCategory.set(cat, new Map())
    firstSeenByCategory.set(cat, new Map())
    orderByCategory.set(cat, 0)
  })

  for (const post of posts) {
    const classified = classifyPostForPack(post, tagOverrides)
    for (const cat of categories) {
      const counts = countsByCategory.get(cat)!
      const firstSeen = firstSeenByCategory.get(cat)!
      // Dedupe within a post so one post can't inflate a tag's frequency.
      const unique = new Set(classified[cat] ?? [])
      for (const tag of unique) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1)
        if (!firstSeen.has(tag)) {
          firstSeen.set(tag, orderByCategory.get(cat)!)
          orderByCategory.set(cat, orderByCategory.get(cat)! + 1)
        }
      }
    }
  }

  const result: Partial<Record<TagCategory, Array<{ value: string; count: number }>>> = {}
  categories.forEach((cat) => {
    result[cat] = rankAxisCounts(countsByCategory.get(cat)!, firstSeenByCategory.get(cat)!, limit)
  })
  return result
}

/**
 * Format an array of tags into a canonical bundle string:
 * lowercase, spaces, trimmed, deduped, and sorted alphabetically for deterministic matching.
 */
export function canonicalizeBundleTags(tags: string[]): string {
  const normalized = Array.from(new Set(tags.map(normalizeTagForPack).filter(Boolean)))
  normalized.sort()
  return normalized.join(", ")
}

/**
 * Extract candidate tag bundles for one axis from the loaded posts, where all tags
 * of that category on a single post stay together as a cohesive unit (e.g. an entire outfit).
 * Deduplicated canonically (same tags in different order = same bundle) and ranked by frequency.
 */
export function extractAxisBundlesWithCounts(
  posts: BooruPost[],
  category: TagCategory,
  tagOverrides: Record<string, string> = {},
  limit = 200
): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>()
  const firstSeen = new Map<string, number>()
  let order = 0

  for (const post of posts) {
    const classified = classifyPostForPack(post, tagOverrides)
    const rawTags = classified[category] ?? []
    if (rawTags.length === 0) continue

    const bundleKey = canonicalizeBundleTags(rawTags)
    if (!bundleKey) continue

    counts.set(bundleKey, (counts.get(bundleKey) ?? 0) + 1)
    if (!firstSeen.has(bundleKey)) {
      firstSeen.set(bundleKey, order++)
    }
  }

  return rankAxisCounts(counts, firstSeen, limit)
}

/**
 * Same as extractAxisBundlesWithCounts, but classifies each post ONCE across
 * all requested categories simultaneously.
 */
export function extractAllAxisBundlesWithCounts(
  posts: BooruPost[],
  categories: readonly TagCategory[],
  tagOverrides: Record<string, string> = {},
  limit = 200
): Partial<Record<TagCategory, Array<{ value: string; count: number }>>> {
  const countsByCategory = new Map<TagCategory, Map<string, number>>()
  const firstSeenByCategory = new Map<TagCategory, Map<string, number>>()
  const orderByCategory = new Map<TagCategory, number>()

  categories.forEach((cat) => {
    countsByCategory.set(cat, new Map())
    firstSeenByCategory.set(cat, new Map())
    orderByCategory.set(cat, 0)
  })

  for (const post of posts) {
    const classified = classifyPostForPack(post, tagOverrides)
    for (const cat of categories) {
      const rawTags = classified[cat] ?? []
      if (rawTags.length === 0) continue

      const bundleKey = canonicalizeBundleTags(rawTags)
      if (!bundleKey) continue

      const counts = countsByCategory.get(cat)!
      const firstSeen = firstSeenByCategory.get(cat)!

      counts.set(bundleKey, (counts.get(bundleKey) ?? 0) + 1)
      if (!firstSeen.has(bundleKey)) {
        firstSeen.set(bundleKey, orderByCategory.get(cat)!)
        orderByCategory.set(cat, orderByCategory.get(cat)! + 1)
      }
    }
  }

  const result: Partial<Record<TagCategory, Array<{ value: string; count: number }>>> = {}
  categories.forEach((cat) => {
    result[cat] = rankAxisCounts(countsByCategory.get(cat)!, firstSeenByCategory.get(cat)!, limit)
  })
  return result
}

// ────────────────────────────────────────────────────────────────────────────
// Seeded RNG (mulberry32) — deterministic sampling for tests / reproducibility.
// ────────────────────────────────────────────────────────────────────────────
export function createSeededRng(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** In-place-ish Fisher-Yates shuffle returning a new array. */
function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Cartesian product of a list of value-lists. Guards against empty lists.
 *  Generic so it can combine either raw values (string[][]) or pre-built
 *  per-axis "picks" (string[][][], used when axisMinCounts > 1). */
function cartesian<T>(lists: T[][]): T[][] {
  return lists.reduce<T[][]>(
    (acc, list) => {
      const next: T[][] = []
      for (const combo of acc) {
        for (const value of list) next.push([...combo, value])
      }
      return next
    },
    [[]]
  )
}

/** Cartesian product of a list of "pools of k-combinations" — same shape as
 *  `cartesian`, but each axis contributes a combination of `axisMinCount[i]`
 *  distinct values instead of a single one. Combinations are pre-expanded by
 *  the caller (see comboSets in generatePackPrompts) so this stays a plain
 *  cartesian product over string[][] "picks" per axis. */
function combinations<T>(values: T[], k: number): T[][] {
  if (k <= 0) return [[]]
  if (k >= values.length) return [values.slice()]
  const result: T[][] = []
  const combo: T[] = []
  const build = (start: number) => {
    if (combo.length === k) {
      result.push(combo.slice())
      return
    }
    for (let i = start; i < values.length; i++) {
      combo.push(values[i])
      build(i + 1)
      combo.pop()
    }
  }
  build(0)
  return result
}

/** How large the full combination space may be before we switch from
 *  exhaustive enumeration to random sampling. Bounds both memory and time —
 *  see generatePackPrompts. */
const ENUMERATE_THRESHOLD = 5000

/**
 * Count C(n, k) WITHOUT building the combinations, saturating at `cap + 1`
 * once the running product exceeds `cap`. This lets generatePackPrompts decide
 * whether to enumerate or sample without ever allocating an astronomically
 * large combination list: `combinations(vals, k)` for a rich axis pool with
 * the "Min tags" slider at a mid value (e.g. C(40, 20) ≈ 1.4e11) would OOM and
 * crash the tab. Mirrors the edge cases of `combinations`: k <= 0 or k >= n
 * both yield a single combination.
 */
function combinationCount(n: number, k: number, cap = Number.MAX_SAFE_INTEGER): number {
  if (k <= 0 || k >= n) return 1
  const kk = Math.min(k, n - k)
  let result = 1
  for (let i = 0; i < kk; i++) {
    result = (result * (n - i)) / (i + 1)
    if (result > cap) return cap + 1
  }
  return Math.round(result)
}

/**
 * Pick `k` distinct values from `values` uniformly at random, WITHOUT
 * enumerating the C(n, k) space. Partial Fisher-Yates: only the first k slots
 * are shuffled. Mirrors `combinations`' edge cases (k <= 0 -> empty, k >= n ->
 * the whole pool).
 */
function sampleCombination<T>(values: T[], k: number, rng: () => number): T[] {
  if (k <= 0) return []
  if (k >= values.length) return values.slice()
  const pool = values.slice()
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rng() * (pool.length - i))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, k)
}

/**
 * Apply a temperature to a set of positive weights: `w^(1/T)`. T=1 is a
 * no-op; T > 1 flattens the distribution toward uniform (more exploration);
 * T < 1 sharpens it toward the highest-weighted values (more exploitation).
 * Non-finite/non-positive weights are treated as a neutral 1 so a single bad
 * input can't zero out or NaN the whole distribution.
 */
function applyTemperature(weights: number[], temperature: number): number[] {
  if (!Number.isFinite(temperature) || temperature <= 0 || temperature === 1) {
    return weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 1))
  }
  const exponent = 1 / temperature
  return weights.map((w) => {
    const safe = Number.isFinite(w) && w > 0 ? w : 1
    return Math.pow(safe, exponent)
  })
}

/**
 * Pick `k` distinct values from `values` WITHOUT replacement, biased by
 * `weights` (same length/order as `values`; higher weight = more likely to
 * be picked), and WITHOUT ever enumerating the C(n, k) combination space —
 * same constraint `sampleCombination` satisfies, for the same reason (see
 * the OOM note on `combinationCount` above: a rich axis pool with a mid-range
 * "Min tags" count must never allocate the full combination space).
 *
 * Uses weighted random sampling without replacement via the
 * Efraimidis-Spirakis algorithm: assign each value a key `rng()^(1/weight)`
 * and take the k values with the largest keys. This is O(n log k) (one pass
 * + a partial sort) and produces exactly the same "higher weight -> higher
 * selection probability" semantics as repeated weighted draws without
 * replacement, without materializing anything larger than `values` itself.
 *
 * Falls back to uniform `sampleCombination` when weights are absent, empty,
 * or all non-positive (e.g. a value with zero weight and no others) so
 * callers can pass a possibly-empty weight map safely.
 */
function sampleWeightedCombination<T>(
  values: T[],
  k: number,
  weights: number[] | undefined,
  rng: () => number
): T[] {
  if (k <= 0) return []
  if (k >= values.length) return values.slice()
  if (!weights || weights.length !== values.length || weights.every((w) => !(w > 0))) {
    return sampleCombination(values, k, rng)
  }

  const keyed = values.map((value, i) => {
    const w = Number.isFinite(weights[i]) && weights[i] > 0 ? weights[i] : 1e-9
    // rng() in [0, 1); guard against exactly 0 (log/pow edge case) by
    // treating it as the smallest representable positive draw.
    const u = Math.max(rng(), Number.EPSILON)
    // key = u^(1/w) — higher weight compresses the key toward 1, so it wins
    // more partial-sort comparisons against lower-weight keys.
    const key = Math.pow(u, 1 / w)
    return { value, key }
  })
  keyed.sort((a, b) => b.key - a.key)
  return keyed.slice(0, k).map((entry) => entry.value)
}

export interface GeneratePackPromptsArgs {
  /** Constant tags shared by every prompt (already display-normalized). */
  lockedTags: string[]
  /** Active axes: category -> candidate values. Empty arrays are ignored. */
  axes: Partial<Record<TagCategory, string[]>>
  /** How many prompts to emit (clamped to MAX_PACK_PROMPTS and to the space). */
  count: number
  /**
   * Minimum distinct values sampled per axis category (default 1, the
   * original "one value per axis" behavior). Clamped to the axis's own pool
   * size — asking for more values than are available in a category just
   * takes the whole pool for every prompt.
   */
  axisMinCounts?: Partial<Record<TagCategory, number>>
  /**
   * Optional per-axis sampling weights (category -> value -> weight, e.g.
   * cross-post frequency counts from `extractAxisValuesWithCounts`). Higher
   * weight makes a value more likely to be picked; absent/missing entries
   * default to a neutral weight of 1. When omitted entirely, sampling is
   * uniform (the original behavior) — this field is purely additive and
   * never required.
   */
  axisWeights?: Partial<Record<TagCategory, Record<string, number>>>
  /**
   * Temperature applied to axisWeights (`weight^(1/temperature)`). 1 (default)
   * uses the weights as-is; > 1 flattens toward uniform (more exploration);
   * < 1 sharpens toward the highest-weighted values (more exploitation). Has
   * no effect when axisWeights is not provided.
   */
  weightTemperature?: number
  /** Global weight map (lowercase keys); applied when isGlobalWeightsEnabled. */
  globalWeights?: Record<string, number>
  isGlobalWeightsEnabled?: boolean
  /** Deterministic sampling when provided. Defaults to Math.random. */
  rng?: () => number
  /** Hard ceiling override (defaults to MAX_PACK_PROMPTS). */
  maxPrompts?: number
  /** Tag overrides mapping tag names to category or category:subcategory for slot constraint enforcement. */
  tagOverrides?: Record<string, string>
}

export interface PackPrompt {
  /** The final prompt string, comma-joined. */
  prompt: string
  /** The sampled axis values that produced it (post-conflict-resolution). */
  values: string[]
  /** Map of tag -> slot ("category:subcategory") for UI diff highlighting. */
  tagSlots?: Record<string, string>
}

/**
 * Evaluates whether a candidate tag satisfies the 33 orthogonal slot constraints
 * against a list of already-accepted tags, using the slot definitions in lib/tag-taxonomy.ts.
 */
export function checkSlotConstraints(
  candidateTag: string,
  existingTags: string[],
  tagOverrides?: Record<string, string>
): boolean {
  if (!tagOverrides) return true
  const candidateSlotInfo = getTagSlotFromOverrides(candidateTag, tagOverrides)
  if (!candidateSlotInfo?.slot) return true

  const candidateSlot = candidateSlotInfo.slot
  const candidateConstraint = SLOT_CONSTRAINTS[candidateSlot]

  // Map existing tags to their slots
  const existingSlots: string[] = []
  for (const t of existingTags) {
    const info = getTagSlotFromOverrides(t, tagOverrides)
    if (info?.slot) existingSlots.push(info.slot)
  }

  // 1. Incompatibility: Does candidate forbid an existing slot?
  if (candidateConstraint?.incompatibleWith) {
    for (const inc of candidateConstraint.incompatibleWith) {
      if (existingSlots.includes(inc)) return false
    }
  }

  // Incompatibility: Does an existing slot forbid the candidate?
  for (const exSlot of existingSlots) {
    const exConstraint = SLOT_CONSTRAINTS[exSlot]
    if (exConstraint?.incompatibleWith?.includes(candidateSlot)) {
      return false
    }
  }

  // 2. Cardinality: Does this candidate exceed the max count for its slot?
  if (candidateConstraint?.maxCount !== undefined) {
    const currentCount = existingSlots.filter((s) => s === candidateSlot).length
    if (currentCount >= candidateConstraint.maxCount) {
      return false
    }
  }

  // 3. Action budgets (SLOT_GROUP_CONSTRAINTS)
  for (const group of Object.values(SLOT_GROUP_CONSTRAINTS)) {
    if (group.slots.includes(candidateSlot)) {
      const currentGroupCount = existingSlots.filter((s) => group.slots.includes(s)).length
      if (currentGroupCount >= group.maxTotal) {
        return false
      }
    }
  }

  return true
}

/** Per-slot state: locked slots are constant (from the base card), muted slots are simply off. */
export interface SlotState {
  lockedSlots: ReadonlySet<string>
  mutedSlots: ReadonlySet<string>
}

/**
 * Drops values that must not vary: tags in a locked or muted slot, and — when
 * the category is partially locked — tags whose slot is unknown, since they
 * can't be shown not to belong to a locked slot. Bundles keep only their
 * surviving tags (re-canonicalized) and vanish if none remain.
 */
export function filterValuesBySlotState(
  category: TagCategory,
  values: string[],
  state: SlotState,
  tagOverrides?: Record<string, string>
): string[] {
  const partiallyLocked = slotsOf(category).some((s) => state.lockedSlots.has(s))
  if (!partiallyLocked && state.mutedSlots.size === 0) return values
  const keep = (tag: string) => {
    const slot = getTagSlotFromOverrides(tag, tagOverrides)?.slot
    if (!slot) return !partiallyLocked
    return !state.lockedSlots.has(slot) && !state.mutedSlots.has(slot)
  }
  const out = new Set<string>()
  for (const value of values) {
    if (!value.includes(',')) {
      if (keep(value)) out.add(value)
      continue
    }
    const kept = splitCommaSeparatedTags(value).filter(keep)
    if (kept.length > 0) out.add(canonicalizeBundleTags(kept))
  }
  return Array.from(out)
}

export interface SlotGroup {
  /** "category:subcategory", or null for bundles and tags with no known slot. */
  slot: string | null
  values: string[]
}

/** Groups an axis's values by slot, in taxonomy order, with the unslotted group last. */
export function groupValuesBySlot(
  category: TagCategory,
  values: string[],
  tagOverrides?: Record<string, string>
): SlotGroup[] {
  const order = slotsOf(category)
  const bySlot = new Map<string | null, string[]>()
  for (const value of values) {
    const slot = value.includes(',') ? null : getTagSlotFromOverrides(value, tagOverrides)?.slot ?? null
    const list = bySlot.get(slot)
    if (list) list.push(value)
    else bySlot.set(slot, [value])
  }
  const rank = (slot: string | null) => {
    if (slot === null) return Number.MAX_SAFE_INTEGER
    const i = order.indexOf(slot)
    return i === -1 ? order.length : i
  }
  return Array.from(bySlot, ([slot, vals]) => ({ slot, values: vals })).sort((a, b) => rank(a.slot) - rank(b.slot))
}

/**
 * Most distinct values one prompt can actually take from these groups once
 * SLOT_CONSTRAINTS / SLOT_GROUP_CONSTRAINTS apply. Unslotted values carry no
 * constraint, so they count in full. This is what the "Min tags" slider tops
 * out at: asking for more would just be dropped by the constraint checks.
 */
export function maxValuesPerPrompt(groups: SlotGroup[]): number {
  const perSlot = new Map<string, number>()
  let total = 0
  for (const { slot, values } of groups) {
    if (slot === null) {
      total += values.length
      continue
    }
    perSlot.set(slot, Math.min(values.length, SLOT_CONSTRAINTS[slot]?.maxCount ?? values.length))
  }
  const budgeted = new Set<string>()
  for (const group of Object.values(SLOT_GROUP_CONSTRAINTS)) {
    let sum = 0
    for (const slot of group.slots) {
      sum += perSlot.get(slot) ?? 0
      budgeted.add(slot)
    }
    total += Math.min(sum, group.maxTotal)
  }
  perSlot.forEach((n, slot) => {
    if (!budgeted.has(slot)) total += n
  })
  return total
}

/**
 * Generate up to `count` distinct pack prompts. Each prompt is:
 *   lockedTags + (axisMinCounts[category] sampled values per active axis,
 *   conflict-resolved) — axisMinCounts defaults to 1 per axis (one value per
 *   category, the original behavior); a category set to 0 deactivates the axis
 *   completely; a category set to e.g. 3 contributes 3 distinct values from
 *   its pool to every generated prompt instead of just one, for users who want
 *   a denser/more-described category (clamped to the axis's own pool size).
 * Optional global weights are applied afterwards. Distinctness is enforced on
 * the final prompt string. When the theoretical combination space fits under
 * a small threshold, the product is enumerated + shuffled so the result is
 * exhaustive and stable; otherwise values are sampled randomly.
 */
export function generatePackPrompts(args: GeneratePackPromptsArgs): PackPrompt[] {
  const {
    lockedTags,
    axes,
    count,
    axisMinCounts = {},
    axisWeights,
    weightTemperature = 1,
    globalWeights = {},
    isGlobalWeightsEnabled = false,
    rng = Math.random,
    maxPrompts = MAX_PACK_PROMPTS,
    tagOverrides,
  } = args

  const normalizedLocked = Array.from(
    new Set(lockedTags.map(normalizeTagForPack).filter(Boolean))
  )

  // Each active axis contributes a "pick" of k distinct values per prompt,
  // where k is the requested minimum count for that category (clamped to the
  // pool size, floor 1). With k=1 (the default) this is one value per axis.
  //
  // IMPORTANT: we do NOT materialize the full set of k-combinations here.
  // C(poolSize, k) explodes combinatorially (C(40, 20) ≈ 1.4e11), so a rich
  // axis pool with the "Min tags" slider at a mid value used to allocate
  // billions of arrays and crash the tab (heap OOM on slider release). Instead
  // we compute the combination COUNT cheaply (capped), then either enumerate
  // exhaustively when the whole space is small or sample random k-subsets when
  // it isn't.
  const activeAxes = PACK_AXES.map((cat) => {
    const rawVals = axes[cat]
    if (!Array.isArray(rawVals) || rawVals.length === 0) return null
    const vals = Array.from(new Set(rawVals.map(normalizeTagForPack).filter(Boolean)))
    if (vals.length === 0) return null

    const requestedMin = axisMinCounts[cat] ?? 1
    if (requestedMin <= 0) return null
    const k = Math.max(1, Math.min(requestedMin, vals.length))
    // Per-value sampling weight for this axis, aligned index-for-index with
    // `vals`. Missing/absent entries default to 1 (neutral) rather than 0, so
    // a caller passing a partial weight map never accidentally zeroes out
    // values it simply didn't have frequency data for.
    const rawWeights = axisWeights?.[cat]
    const weights = rawWeights
      ? applyTemperature(vals.map((v) => rawWeights[v] ?? 1), weightTemperature)
      : undefined
    return {
      vals,
      k,
      weights,
      comboCount: combinationCount(vals.length, k, ENUMERATE_THRESHOLD),
    }
  }).filter(
    (axis): axis is { vals: string[]; k: number; weights: number[] | undefined; comboCount: number } =>
      axis !== null
  )

  const targetCap = Math.max(0, Math.min(count, maxPrompts))
  if (targetCap === 0) return []

  // No axes to vary → a single prompt of just the base (if any).
  if (activeAxes.length === 0) {
    if (normalizedLocked.length === 0) return []
    const built = buildPrompt(normalizedLocked, [], globalWeights, isGlobalWeightsEnabled, tagOverrides)
    return built ? [built] : []
  }

  const theoreticalMax = activeAxes.reduce((acc, axis) => acc * axis.comboCount, 1)
  const target = Math.min(targetCap, theoreticalMax)

  // Whether ANY axis carries real (non-uniform) weights — drives whether the
  // enumerated branch below orders combinations by weight or falls back to a
  // plain shuffle (cheaper, and behaviorally identical to the pre-weights code
  // path when no caller opts into axisWeights).
  const hasWeights = activeAxes.some((axis) => axis.weights !== undefined)

  // Build the pool of selections (one "pick" — possibly multiple values — per
  // axis). Only enumerate when the whole combination space is small: when it
  // is, every per-axis comboCount is guaranteed small too (their product is
  // <= ENUMERATE_THRESHOLD), so materializing each axis's combinations is safe.
  let selections: string[][][]
  if (theoreticalMax <= ENUMERATE_THRESHOLD) {
    const pools = activeAxes.map((axis) => combinations(axis.vals, axis.k))
    if (hasWeights) {
      // Order every full selection (one combo per axis) by a combined
      // Efraimidis-Spirakis-style key so higher-weighted combinations are
      // more likely to land within the first `target` slice consumed below —
      // same "pick without replacement, biased by weight" semantics as
      // sampleWeightedCombination, just applied over the (small, already
      // enumerated) space of full selections instead of individual axis
      // values. Each axis's contribution to a selection's weight is the sum
      // of its picked values' weights (falls back to k, i.e. neutral, for
      // axes with no weights) — this keeps a plain shuffle's exact behavior
      // when hasWeights is false, since selections are only reordered here.
      const valueWeight = (cat: number, value: string): number => {
        const axis = activeAxes[cat]
        if (!axis.weights) return 1
        const idx = axis.vals.indexOf(value)
        return idx >= 0 ? axis.weights[idx] : 1
      }
      const keyed = cartesian(pools).map((combo) => {
        const totalWeight = combo.reduce(
          (sum, picked, axisIdx) => sum + picked.reduce((s, v) => s + valueWeight(axisIdx, v), 0),
          0
        )
        const u = Math.max(rng(), Number.EPSILON)
        const key = Math.pow(u, 1 / Math.max(totalWeight, 1e-9))
        return { combo, key }
      })
      keyed.sort((a, b) => b.key - a.key)
      selections = keyed.map((entry) => entry.combo)
    } else {
      selections = shuffle(cartesian(pools), rng)
    }
  } else {
    // Huge space: sample selections lazily below.
    selections = []
  }

  const seenPrompts = new Set<string>()
  const results: PackPrompt[] = []

  const trySelection = (picked: string[][]) => {
    const flatValues = picked.flat()
    const built = buildPrompt(normalizedLocked, flatValues, globalWeights, isGlobalWeightsEnabled, tagOverrides)
    if (!built) return
    if (seenPrompts.has(built.prompt)) return
    seenPrompts.add(built.prompt)
    results.push(built)
  }

  if (selections.length > 0) {
    for (const picked of selections) {
      if (results.length >= target) break
      trySelection(picked)
    }
  } else {
    // Random sampling for very large spaces — draw a random k-subset per axis
    // directly, without ever materializing the combinations. Weighted when
    // the axis carries weights, uniform otherwise (sampleWeightedCombination
    // falls back to sampleCombination internally when weights is undefined).
    const maxTries = target * 40
    let tries = 0
    while (results.length < target && tries < maxTries) {
      tries++
      const picked = activeAxes.map((axis) => sampleWeightedCombination(axis.vals, axis.k, axis.weights, rng))
      trySelection(picked)
    }
  }

  return results
}

/**
 * Combine base + sampled values into one conflict-resolved, optionally-weighted
 * prompt. Returns null if the result is empty. Runs Smart Tag Exclusion twice:
 * once against the locked base, then incrementally within the picked values
 * themselves — augmented by orthogonal slot constraints from lib/tag-taxonomy.ts.
 */
function buildPrompt(
  lockedTags: string[],
  pickedValues: string[],
  globalWeights: Record<string, number>,
  isGlobalWeightsEnabled: boolean,
  tagOverrides?: Record<string, string>
): PackPrompt | null {
  const lockedSet = new Set(lockedTags.map(normalize))

  // Unpack any bundles (comma-separated tags) into individual tags while tracking
  // which original picked value each tag came from.
  const itemToTags = new Map<string, string[]>()
  const flatPickedTags: string[] = []

  for (const item of pickedValues) {
    const rawTags = item.includes(",") ? splitCommaSeparatedTags(item) : [item]
    const cleanTags = Array.from(
      new Set(rawTags.map(normalizeTagForPack).filter(Boolean))
    ).filter((t) => !lockedSet.has(normalize(t)))

    itemToTags.set(item, cleanTags)
    for (const t of cleanTags) {
      if (!flatPickedTags.includes(t)) {
        flatPickedTags.push(t)
      }
    }
  }

  // Pass 1: Smart Tag Exclusion: drop values that contradict the locked base.
  const { validTags: validAgainstBase } = resolveTagConflicts(lockedTags, flatPickedTags)

  // Pass 2: Smart Tag Exclusion, pass 2: incremental contradiction check
  // across remaining tags so mutually contradictory picks don't co-exist,
  // augmented with physical slot constraint checking.
  const validTags: string[] = []
  let contextTags = lockedTags
  for (const candidate of validAgainstBase) {
    const { validTags: stillValid } = resolveTagConflicts(contextTags, [candidate])
    if (
      stillValid.length > 0 &&
      checkSlotConstraints(candidate, contextTags, tagOverrides) &&
      !conflictsWithBackground(candidate, contextTags, tagOverrides)
    ) {
      validTags.push(candidate)
      contextTags = [...contextTags, candidate]
    }
  }

  const validTagsSet = new Set(validTags.map(normalize))
  const finalTags = Array.from(new Set([...lockedTags, ...validTags]))
  if (finalTags.length === 0) return null

  let prompt = joinTags(finalTags)
  if (isGlobalWeightsEnabled) {
    prompt = applyWeights(prompt, globalWeights)
  }
  if (!prompt) return null

  // Report surviving picked values (both original bundle values and individual tags)
  // so downstream learning and categorization can resolve them.
  const survivingValues = new Set<string>()
  for (const item of pickedValues) {
    const itemTags = itemToTags.get(item) ?? []
    if (itemTags.some((t) => validTagsSet.has(normalize(t)))) {
      survivingValues.add(item)
    }
  }
  for (const tag of validTags) {
    survivingValues.add(tag)
  }

  const tagSlots: Record<string, string> = {}
  if (tagOverrides) {
    for (const tag of finalTags) {
      const slotInfo = getTagSlotFromOverrides(tag, tagOverrides)
      if (slotInfo?.slot) {
        tagSlots[tag] = slotInfo.slot
      }
    }
  }

  return { prompt, values: Array.from(survivingValues), tagSlots }
}
