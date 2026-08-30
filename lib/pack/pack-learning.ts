/**
 * Pure, framework-free local learning core for Pack Mode (Fase 1 of
 * docs/pack-mode-learning-plan.md §7). No React, no DOM, no storage access —
 * same criterion as pack-generator.ts and prompt-similarity.ts, so this is
 * unit-testable with ts-node (see __tests__/pack-learning.verify.ts). The
 * hook that wraps this (hooks/use-pack-learning.ts) owns persistence; this
 * module only transforms model <-> model and model -> weights.
 *
 * Scope reminder (docs/pack-mode-learning-plan.md §10): this model is
 * strictly local to one user's browser. It is never sent anywhere, never
 * merged with another user's data, and this module has no network/storage
 * imports that could make that mistake easy.
 *
 * The whole design follows one signal: which prompt (out of N generated) the
 * user copied. `picks` counts how often a value's prompt was the one copied;
 * `shows` counts how often the value appeared in a generated batch at all.
 * `p_hat = picks / shows` answers "when this value showed up, how often was
 * the prompt containing it the one picked" — see §7.2 for why this is a
 * better denominator than treating unpicked prompts as hard negatives.
 */
import type { TagCategory } from "../tag-classifier"

// ────────────────────────────────────────────────────────────────────────────
// Model shape
// ────────────────────────────────────────────────────────────────────────────

/** Decaying pick/show counters for one (context, category, value) triple. */
export interface TagStat {
  /** Weighted count of "this value's prompt was the one copied" events. */
  picks: number
  /** Weighted count of "this value appeared in a shown/generated batch" events. */
  shows: number
  /** Timestamp (ms) this stat was last touched — the decay clock's origin. */
  updatedAt: number
}

export interface PackLearningModel {
  version: 1
  /** contextKey -> "category:value" -> stat. See contextKeysFor for the key shape. */
  contexts: Record<string, Record<string, TagStat>>
}

export type PackFeedbackKind =
  | "prompts_shown" // a batch was generated and shown to the user
  | "prompt_copied" // the user copied ONE specific generated prompt
  | "value_removed" // the user removed a chip from an axis pool
  | "value_added" // the user manually added a chip to an axis pool

export interface PackFeedbackEvent {
  kind: PackFeedbackKind
  /**
   * Context hierarchy to apply this event to, most specific first (see
   * contextKeysFor) — e.g. ["danbooru:mona", "danbooru", "global"]. The
   * event is applied to EVERY level, not just the most specific one: only
   * writing to [0] left the provider/global levels permanently empty
   * whenever a base card had a character tag, so shrinkage always fell
   * back to NEUTRAL_PRIOR through empty parents instead of the accumulated
   * cross-character signal §7.4 designed the hierarchy to enable. A single
   * string is still accepted for callers (and the existing test suite)
   * that only ever cared about one bucket.
   */
  contextKey: string | string[]
  values: Array<{ category: TagCategory; value: string }>
}

/** Empty model, same shape createEmptyModel always returns — the safe
 *  fallback for a missing, corrupted, or version-mismatched stored model. */
export function createEmptyModel(): PackLearningModel {
  return { version: 1, contexts: {} }
}

// ────────────────────────────────────────────────────────────────────────────
// Internal key + decay helpers
// ────────────────────────────────────────────────────────────────────────────

/** Composite key for one (category, value) pair within a context bucket. */
function statKey(category: TagCategory, value: string): string {
  return `${category}:${value}`
}

/** Half-life for decaying picks/shows toward zero as they age — ~3 weeks, so
 *  tastes from months ago don't outweigh this week's without an explicit
 *  pruning pass (see §7.3). Applied lazily on READ, not via a background job. */
export const HALF_LIFE_MS = 21 * 24 * 60 * 60 * 1000

/** Decay a raw counter by elapsed time since it was last updated. Guards
 *  against a clock going backwards (negative elapsed) by treating it as 0
 *  elapsed rather than amplifying the value. */
function decay(raw: number, updatedAt: number, now: number): number {
  const elapsed = Math.max(0, now - updatedAt)
  return raw * Math.pow(0.5, elapsed / HALF_LIFE_MS)
}

/** Read a stat with decay already applied, or the zero-stat when absent. */
function decayedStat(stat: TagStat | undefined, now: number): { picks: number; shows: number } {
  if (!stat) return { picks: 0, shows: 0 }
  return { picks: decay(stat.picks, stat.updatedAt, now), shows: decay(stat.shows, stat.updatedAt, now) }
}

// ────────────────────────────────────────────────────────────────────────────
// applyFeedback — the only mutation entry point (returns a new model, never
// mutates the input — same immutable-update convention the rest of this
// codebase's hooks use for React state).
// ────────────────────────────────────────────────────────────────────────────

/** Extra weight credited to a manually-added value's picks+shows (§7.2) —
 *  pushes p_hat toward 1 without pinning it there outright. */
export const ADD_BONUS = 2
/** Extra `shows` weight (no `picks`) credited when a value is removed (§7.2)
 *  — a moderate penalty, not a hard veto, since removal can just mean "too
 *  many chips", not "I dislike this value". */
export const REMOVE_PENALTY = 5

/**
 * Apply one feedback event to the model, decaying every touched stat to
 * `now` first so consecutive updates compose correctly regardless of how
 * much time passed between them. Returns a NEW model (immutable update).
 *
 * When `event.contextKey` is an array, the SAME event is applied
 * independently to every listed context bucket (each decayed/updated on its
 * own terms) — this is what lets provider- and global-level buckets
 * accumulate real data instead of staying empty whenever a more specific
 * context (e.g. a character) is also being credited.
 */
export function applyFeedback(
  model: PackLearningModel,
  event: PackFeedbackEvent,
  now: number = Date.now()
): PackLearningModel {
  if (event.values.length === 0) return model

  const contextKeys = Array.isArray(event.contextKey) ? event.contextKey : [event.contextKey]
  if (contextKeys.length === 0) return model

  let contexts = model.contexts
  for (const contextKey of contextKeys) {
    const bucket = { ...(contexts[contextKey] ?? {}) }

    for (const { category, value } of event.values) {
      const key = statKey(category, value)
      const current = decayedStat(bucket[key], now)
      let { picks, shows } = current

      switch (event.kind) {
        case "prompts_shown":
          shows += 1
          break
        case "prompt_copied":
          picks += 1
          // A copied prompt was necessarily shown as part of the same batch —
          // prompts_shown for that batch already recorded the +1 `shows`, so
          // this branch only adds the pick, never double-counts shows.
          break
        case "value_removed":
          shows += REMOVE_PENALTY
          break
        case "value_added":
          picks += ADD_BONUS
          shows += ADD_BONUS
          break
      }

      bucket[key] = { picks, shows, updatedAt: now }
    }

    contexts = { ...contexts, [contextKey]: bucket }
  }

  return { ...model, contexts }
}

// ────────────────────────────────────────────────────────────────────────────
// Context hierarchy (§7.4)
// ────────────────────────────────────────────────────────────────────────────

/** Context key for the model's most general, always-present level. Never
 *  shared between users — see the module docstring's scope reminder. */
export const GLOBAL_CONTEXT_KEY = "global"

/**
 * Hierarchy of context keys, most specific first, always ending in
 * GLOBAL_CONTEXT_KEY. `characterTags` may be empty (custom/clothing packs
 * with no clear character) or have several (multi-character posts) — every
 * tag gets its own specific level, all falling back to the same
 * `${provider}` level before global, so learning from one character never
 * leaks into another EXCEPT through the shared, low-weight parent levels.
 */
export function contextKeysFor(provider: string, characterTags: string[]): string[] {
  const keys: string[] = []
  for (const tag of characterTags) {
    if (tag) keys.push(`${provider}:${tag}`)
  }
  keys.push(provider)
  keys.push(GLOBAL_CONTEXT_KEY)
  return keys
}

/** Pseudo-observation count for the shrinkage prior (§7.4) — how strongly a
 *  sparse context is pulled toward its parent's estimate. */
const SHRINKAGE_M = 8
/** Neutral prior for the top of the hierarchy (no parent data at all). */
const NEUTRAL_PRIOR = 0.5

/**
 * Empirical-Bayes shrinkage estimate of p_hat = picks/shows for one
 * (category, value), walking DOWN the context hierarchy from most general to
 * most specific so each level's estimate feeds the next as its prior:
 *   p_hat(level) = (picks + m * p_hat(parent)) / (shows + m)
 * A context with shows=0 inherits its parent's estimate almost entirely (the
 * m pseudo-observations dominate); a context with many observations lets its
 * own picks/shows dominate instead. Returns both the shrunk p_hat and the
 * raw (decayed) `shows` at the MOST SPECIFIC level with any data, which
 * buildSamplingWeights uses to decide how much weight this value's learned
 * signal should carry relative to booru frequency.
 */
function shrunkPHat(
  model: PackLearningModel,
  contextKeys: string[],
  category: TagCategory,
  value: string,
  now: number
): { pHat: number; specificShows: number } {
  const key = statKey(category, value)
  // Walk from the LAST entry (most general) to the FIRST (most specific) so
  // each level's shrinkage target is the level above it, per the formula.
  let pHat = NEUTRAL_PRIOR
  let specificShows = 0
  for (let i = contextKeys.length - 1; i >= 0; i--) {
    const { picks, shows } = decayedStat(model.contexts[contextKeys[i]]?.[key], now)
    pHat = (picks + SHRINKAGE_M * pHat) / (shows + SHRINKAGE_M)
    if (i === 0) specificShows = shows
  }
  return { pHat, specificShows }
}

// ────────────────────────────────────────────────────────────────────────────
// buildSamplingWeights (§7.5) — the only function pack-generator.ts's
// axisWeights actually needs.
// ────────────────────────────────────────────────────────────────────────────

/** Floor under the learned p_hat term so a value with a badly poor track
 *  record still keeps SOME weight from its booru frequency — the learned
 *  signal can shrink a value's contribution, never zero it out on its own
 *  (that job belongs to EPSILON below, applied at the whole-distribution
 *  level, not per-value). */
const DEFAULT_LEARNED_FLOOR = 0.05
/** Exponent on booru frequency in the weight formula (A in §7.5). */
const DEFAULT_FREQUENCY_EXPONENT = 1
/** Exponent on the learned p_hat term (B in §7.5). */
const DEFAULT_LEARNED_EXPONENT = 1
/** Minimum fraction of total probability mass spread uniformly across the
 *  WHOLE pool, regardless of score (EPSILON in §7.5) — the structural
 *  defense against diversity collapse (plan §9.1). Not configurable per-call
 *  on purpose: it is a safety floor, not a tuning knob exposed to callers. */
const EPSILON = 0.15

export interface BuildSamplingWeightsOptions {
  /** Temperature applied to the combined weight before the EPSILON floor
   *  (same semantics as pack-generator.ts's weightTemperature: 1 = as-is,
   *  >1 flattens toward uniform, <1 sharpens). Exposed to the user via the
   *  Explore/Exploit control (§7.8) — NOT a fixed constant. */
  temperature?: number
  /** Floor under the learned p_hat term (default DEFAULT_LEARNED_FLOOR). */
  learnedFloor?: number
  /** Exponent on the learned p_hat term (default DEFAULT_LEARNED_EXPONENT). */
  learnedExponent?: number
  /** Exponent on booru frequency (default DEFAULT_FREQUENCY_EXPONENT). */
  frequencyExponent?: number
}

/**
 * Per-value sampling weight combining booru cross-post frequency with what
 * this model has learned, for ONE axis category. Returns an array aligned
 * index-for-index with `values`, already normalized to sum to 1 and with the
 * EPSILON exploration floor applied — safe to feed straight into
 * pack-generator.ts's `axisWeights[category]` (as a value->weight map) after
 * zipping back with `values`.
 *
 * `contextKeys` should be `contextKeysFor(provider, characterTags)`, most
 * specific first. `now` defaults to Date.now(); tests pass a fixed value for
 * determinism.
 */
export function buildSamplingWeights(
  model: PackLearningModel,
  contextKeys: string[],
  category: TagCategory,
  values: Array<{ value: string; count: number }>,
  opts: BuildSamplingWeightsOptions = {},
  now: number = Date.now()
): number[] {
  if (values.length === 0) return []

  const {
    temperature = 1,
    learnedFloor = DEFAULT_LEARNED_FLOOR,
    learnedExponent = DEFAULT_LEARNED_EXPONENT,
    frequencyExponent = DEFAULT_FREQUENCY_EXPONENT,
  } = opts

  const maxCount = Math.max(1, ...values.map((v) => v.count))

  const raw = values.map(({ value, count }) => {
    // Normalize frequency to (0, 1] so it combines with p_hat (already in
    // that range) on a comparable scale, instead of raw counts (which can be
    // in the hundreds) dwarfing the learned term entirely.
    const freqNorm = Math.max(count, 1) / maxCount
    const { pHat } = shrunkPHat(model, contextKeys, category, value, now)
    const learnedTerm = Math.max(pHat, learnedFloor)
    return Math.pow(freqNorm, frequencyExponent) * Math.pow(learnedTerm, learnedExponent)
  })

  // Temperature: w^(1/T). Guard against non-finite/non-positive raw weights
  // the same way pack-generator.ts's applyTemperature does, so a single bad
  // input can't zero out or NaN the whole distribution.
  const safeTemperature = Number.isFinite(temperature) && temperature > 0 ? temperature : 1
  const exponent = safeTemperature === 1 ? 1 : 1 / safeTemperature
  const tempered = raw.map((w) => {
    const safe = Number.isFinite(w) && w > 0 ? w : 1e-9
    return exponent === 1 ? safe : Math.pow(safe, exponent)
  })

  const total = tempered.reduce((sum, w) => sum + w, 0)
  const n = values.length
  if (total <= 0) return values.map(() => 1 / n)

  // EPSILON floor: (1-E) * normalized_learned_weight + E * uniform. This is
  // the hard guarantee that NO value in the pool can ever reach probability
  // zero, no matter how poorly the model has scored it (plan §9.1) — the
  // learned signal can only redistribute (1-EPSILON) of the mass.
  return tempered.map((w) => (1 - EPSILON) * (w / total) + EPSILON * (1 / n))
}

// ────────────────────────────────────────────────────────────────────────────
// pruneModel (§7.6) — storage-budget maintenance, called by the hook before
// persisting, mirroring lib/storage.ts's fitHistoryToStorageBudget.
// ────────────────────────────────────────────────────────────────────────────

export interface PruneModelOptions {
  /** Max stat entries kept per context (default 2000, per §7.6). */
  maxEntriesPerContext?: number
  /** Max number of context buckets kept (default 50, per §7.6). */
  maxContexts?: number
  /**
   * Serialized-size ceiling in bytes (default MAX_MODEL_BYTES). The
   * maxEntriesPerContext/maxContexts caps bound entry COUNT, but at ~70
   * bytes/entry the worst case (2000 entries * 50 contexts) is 6-7MB —
   * comparable to localStorage's whole-domain 5-10MB quota, which this
   * model shares with History, Favorites and every other persisted key
   * (see lib/storage.ts). A count-only cap can push a single storage.set()
   * over quota and silently break the NEXT write to any of those keys, not
   * just this one. This pass runs AFTER the count-based caps above and, if
   * still over budget, drops entries (globally, lowest decayed-shows first,
   * same tie-break) until the model's JSON fits — mirroring
   * fitHistoryToStorageBudget's byte-budget approach in lib/storage.ts.
   */
  maxBytes?: number
}

/** Default byte budget for the persisted model — well under localStorage's
 *  typical 5-10MB domain quota, leaving headroom for History, Favorites and
 *  every other key this domain shares the quota with. */
export const MAX_MODEL_BYTES = 500_000

/**
 * Trim the model down to the configured budget. Within an over-budget
 * context, entries with the lowest DECAYED `shows` are dropped first (the
 * least-evidenced, so least useful, entries) — ties broken by oldest
 * `updatedAt`. Across contexts, the smallest (fewest total decayed shows)
 * contexts are dropped first once maxContexts is exceeded — GLOBAL_CONTEXT_KEY
 * is never dropped even if it would otherwise be the smallest, since every
 * other context's shrinkage prior depends on it.
 */
export function pruneModel(
  model: PackLearningModel,
  opts: PruneModelOptions = {},
  now: number = Date.now()
): PackLearningModel {
  const { maxEntriesPerContext = 2000, maxContexts = 50, maxBytes = MAX_MODEL_BYTES } = opts

  let contextKeys = Object.keys(model.contexts)
  if (contextKeys.length > maxContexts) {
    const totalShows = (key: string) =>
      Object.values(model.contexts[key]).reduce((sum, stat) => sum + decay(stat.shows, stat.updatedAt, now), 0)
    const sorted = contextKeys
      .filter((k) => k !== GLOBAL_CONTEXT_KEY)
      .sort((a, b) => totalShows(b) - totalShows(a))
    const kept = new Set([GLOBAL_CONTEXT_KEY, ...sorted.slice(0, Math.max(0, maxContexts - 1))])
    contextKeys = contextKeys.filter((k) => kept.has(k))
  }

  const contexts: Record<string, Record<string, TagStat>> = {}
  for (const key of contextKeys) {
    const bucket = model.contexts[key]
    const entries = Object.entries(bucket)
    if (entries.length <= maxEntriesPerContext) {
      contexts[key] = bucket
      continue
    }
    const ranked = entries
      .map(([statKey, stat]) => ({ statKey, stat, decayedShows: decay(stat.shows, stat.updatedAt, now) }))
      .sort((a, b) => {
        const diff = b.decayedShows - a.decayedShows
        if (diff !== 0) return diff
        return b.stat.updatedAt - a.stat.updatedAt
      })
      .slice(0, maxEntriesPerContext)
    contexts[key] = Object.fromEntries(ranked.map((r) => [r.statKey, r.stat]))
  }

  let result: PackLearningModel = { ...model, contexts }

  // Byte-budget pass — the count-based caps above bound entries per-context
  // and context count independently, but their WORST-CASE product can still
  // exceed maxBytes (see maxBytes's docstring). Drop entries globally across
  // every remaining context, lowest decayed-shows first (least-evidenced,
  // so least useful — same criterion the per-context prune above uses),
  // until the serialized model fits. GLOBAL_CONTEXT_KEY's entries are
  // eligible here same as any other context's — only the CONTEXT bucket
  // itself is protected from removal above, not its individual entries.
  if (JSON.stringify(result).length > maxBytes) {
    const allEntries: Array<{ contextKey: string; statKey: string; stat: TagStat; decayedShows: number }> = []
    for (const [contextKey, bucket] of Object.entries(result.contexts)) {
      for (const [statKey, stat] of Object.entries(bucket)) {
        allEntries.push({ contextKey, statKey, stat, decayedShows: decay(stat.shows, stat.updatedAt, now) })
      }
    }
    allEntries.sort((a, b) => {
      const diff = a.decayedShows - b.decayedShows
      if (diff !== 0) return diff
      return a.stat.updatedAt - b.stat.updatedAt
    })

    const trimmedContexts: Record<string, Record<string, TagStat>> = {}
    for (const contextKey of Object.keys(result.contexts)) trimmedContexts[contextKey] = {}
    for (const entry of allEntries) {
      trimmedContexts[entry.contextKey][entry.statKey] = entry.stat
    }

    // Drop the globally lowest-shows entries one at a time until the
    // serialized result fits. allEntries is already sorted ascending by
    // decayedShows, so index 0 is the next one to drop.
    let dropIndex = 0
    let candidate: PackLearningModel = { ...result, contexts: trimmedContexts }
    while (JSON.stringify(candidate).length > maxBytes && dropIndex < allEntries.length) {
      const { contextKey, statKey } = allEntries[dropIndex]
      delete candidate.contexts[contextKey][statKey]
      dropIndex++
      candidate = { ...candidate, contexts: { ...candidate.contexts } }
    }
    result = candidate
  }

  return result
}
