import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { BooruPost, BooruProvider } from '@/lib/booru/types'
import { TagCategory } from '@/lib/tag-classifier'
import { splitCommaSeparatedTags, splitTags } from '@/lib/utils/tag-utils'
import {
  PACK_AXES,
  MAX_PACK_PROMPTS,
  MAX_PACK_OVERGENERATE,
  classifyPostForPack,
  filterAppearanceForPrimaryCharacter,
  extractAxisValuesWithCounts,
  extractAllAxisValuesWithCounts,
  generatePackPrompts,
  withAxisFallback,
  normalizeTagForPack,
  type PackPrompt,
} from '@/lib/pack/pack-generator'
import { cleanSyntheticPrompt, type BulkSendCleanOptions } from '@/lib/pack/bulk-send'
import { NearDuplicateFilter, DEFAULT_SIMILARITY_THRESHOLD } from '@/lib/pack/prompt-similarity'
import { userPreferences, type PackModeConfig } from '@/lib/storage'
import { usePackLearning } from '@/hooks/use-pack-learning'
import { contextKeysFor } from '@/lib/pack/pack-learning'

/** Preconfigured pack "kinds": which categories are locked (constant) vs varied. */
export type PackKind = 'character' | 'clothing' | 'custom'

const DEFAULT_LOCKED_CATEGORIES: Record<'character' | 'clothing', TagCategory[]> = {
  // Character pack: lock who they are (appearance carries character identity
  // here since classifyPostForPack folds tag_string_character into it), vary
  // clothing/pose/scenery.
  character: ['appearance'],
  // Clothing pack: lock the outfit, vary who wears it (appearance) plus pose/scenery.
  clothing: ['clothing'],
}

const DEFAULT_PROMPT_COUNT = 10

/** Fallback shape for a packKind with no saved config yet. */
function emptyPackModeConfig(kind: PackKind): PackModeConfig {
  return {
    lockedCategories: kind === 'clothing' ? DEFAULT_LOCKED_CATEGORIES.clothing : DEFAULT_LOCKED_CATEGORIES.character,
    axisMinCounts: {},
    promptCount: DEFAULT_PROMPT_COUNT,
    manualAxisValues: {},
  }
}

export interface UsePackModeResult {
  isPackMode: boolean
  togglePackMode: () => void
  enablePackMode: () => void
  disablePackMode: () => void

  baseCard: BooruPost | null
  setBaseCard: (post: BooruPost | null) => void

  packKind: PackKind
  setPackKind: (kind: PackKind) => void

  lockedCategories: Set<TagCategory>
  toggleLockedCategory: (category: TagCategory) => void

  /** Classified tags of the base card (5 buckets), normalized for display. */
  baseClassified: Record<TagCategory, string[]>
  /**
   * True when the base card's tag_string_character lists more than one
   * character. Lets the UI warn before/while a multi-character post is used
   * as a 'character' pack's base — lockedTags already mitigates the worst
   * case (only the first character tag is locked, see its own docstring in
   * the hook body), but the user should still know their base card has
   * other characters on it that got excluded.
   */
  hasMultipleCharacters: boolean
  /** Flattened tags belonging to the locked categories — the constant part of every prompt. */
  lockedTags: string[]
  /** Categories that vary (PACK_AXES minus lockedCategories). */
  activeAxisCategories: TagCategory[]

  /**
   * Candidate value pool per axis category: booru-sampled values (seeded from
   * the loaded posts, see reseedAxis/reseedAllAxes) merged with any values
   * the user added by hand (addAxisValue) — sampled values first, manual ones
   * appended after, deduped. Manual values are persisted per packKind (see
   * lib/storage.ts's PackModeConfig); sampled ones never are.
   */
  axisValues: Partial<Record<TagCategory, string[]>>
  addAxisValue: (category: TagCategory, value: string) => void
  removeAxisValue: (category: TagCategory, value: string) => void
  reseedAxis: (category: TagCategory, posts: BooruPost[], tagOverrides?: Record<string, string>, fallbackValues?: string[]) => void
  reseedAllAxes: (posts: BooruPost[], tagOverrides?: Record<string, string>, fallbacks?: Partial<Record<TagCategory, string[]>>) => void

  /** Minimum distinct values sampled per axis category on each generated prompt (default 1). */
  axisMinCounts: Partial<Record<TagCategory, number>>
  setAxisMinCount: (category: TagCategory, minCount: number) => void

  /** Free-text base prompt for the 'custom' pack kind — merged into lockedTags. */
  customBaseText: string
  setCustomBaseText: (text: string) => void

  promptCount: number
  setPromptCount: (count: number) => void

  generatedPrompts: PackPrompt[]
  regenerate: () => void

  /**
   * Record that the user copied ONE specific generated prompt — the core
   * positive signal for the local learning model (§7.2). Pass the exact
   * `PackPrompt` object from `generatedPrompts` (its `.values` is what gets
   * credited). Safe to call even when learning has no meaningful context
   * yet; it just writes into whatever the current provider/global context is.
   */
  recordPromptCopied: (prompt: PackPrompt) => void

  /** Explore/Exploit control (§7.8) — 1 = fully as-learned, higher flattens
   *  axis sampling toward uniform. Persisted independently of resetLearning. */
  explorationTemperature: number
  setExplorationTemperature: (temperature: number) => void
  /** Clears all learned data (NOT the exploration temperature preference). */
  resetLearning: () => void

  clearAll: () => void
}

/**
 * Pack Mode state: pick a base card, lock some tag categories as constant,
 * sample/edit candidate values for the remaining categories (the "axes"), and
 * generate N pack prompts (base + one sampled value per axis, conflict-
 * resolved). Mirrors the shape of useMergeMode but for the "batch of prompts
 * sharing a base" workflow instead of cross-post merging.
 *
 * `cleanOptions` is the same prompt-settings bundle every real card already
 * uses (Tags to Exclude, Find & Replace, Optimize Tags, Include Characters,
 * Smart Tag Exclusion) — each raw generated prompt is run through
 * cleanSyntheticPrompt (lib/pack/bulk-send.ts, shared with Bulk Send's
 * "Synthetic" mode) so Pack Mode's output is affected by the exact same
 * settings as every other prompt in the app, instead of a parallel, simpler
 * path that skipped optimizeTags/exclude/find&replace/tagAppendRules.
 */
export function usePackMode(
  tagOverrides: Record<string, string> = {},
  globalWeights: Record<string, number> = {},
  isGlobalWeightsEnabled: boolean = false,
  cleanOptions: Pick<
    BulkSendCleanOptions,
    'excludeInput' | 'addInput' | 'findInput' | 'replaceInput' | 'includeCharacters' | 'optimizeTags' | 'smartTagExclusion'
  > = { excludeInput: '', addInput: '', includeCharacters: true, optimizeTags: true },
  booruProvider: BooruProvider = 'danbooru'
): UsePackModeResult {
  const [isPackMode, setIsPackMode] = useState(false)
  const [baseCard, setBaseCardRaw] = useState<BooruPost | null>(null)
  const learning = usePackLearning()

  // Lazy-load the persisted per-packKind config ONCE on mount (see
  // PackModeConfig in lib/storage.ts). Read once into a ref instead of on
  // every packKind switch so a config saved under a DIFFERENT session/tab
  // mid-use can't clobber the user's in-progress edits — switching packKind
  // only applies the config that was on disk at mount time.
  const savedConfigsRef = useRef<Record<PackKind, PackModeConfig | undefined>>({
    character: undefined,
    clothing: undefined,
    custom: undefined,
  })
  const [hydrated] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      const stored = userPreferences.getPackModeConfig()
      savedConfigsRef.current = {
        character: stored.character,
        clothing: stored.clothing,
        custom: stored.custom,
      }
      return true
    } catch {
      return false
    }
  })
  // Lazy-hydrate the last-selected packKind ONCE, same timing as
  // savedConfigsRef above — read directly (not through `hydrated`, which is
  // a plain boolean) so this survives even if getPackModeConfig() throws
  // while getPackModeLastKind() doesn't.
  const [initialPackKind] = useState<PackKind>(() => {
    if (typeof window === 'undefined') return 'character'
    try {
      return userPreferences.getPackModeLastKind()
    } catch {
      return 'character'
    }
  })
  const initialConfig = hydrated
    ? savedConfigsRef.current[initialPackKind] ?? emptyPackModeConfig(initialPackKind)
    : emptyPackModeConfig(initialPackKind)

  const [packKind, setPackKind] = useState<PackKind>(initialPackKind)
  const [lockedCategories, setLockedCategories] = useState<Set<TagCategory>>(
    new Set(initialConfig.lockedCategories)
  )
  // Axis pools sampled from the currently loaded search results — NEVER
  // persisted (see PackModeConfig's docstring in lib/storage.ts: they'd be
  // stale, or reference tags from posts no longer in the new session's pool).
  const [axisValues, setAxisValuesRaw] = useState<Partial<Record<TagCategory, string[]>>>({})
  // Cross-post frequency count for each sampled value, index-aligned by value
  // (not position) via a per-category Record — the raw signal
  // buildSamplingWeights combines with what's been learned (see regenerate).
  // Manual values have no meaningful "frequency" (they weren't sampled), so
  // they simply have no entry here; buildSamplingWeights treats a missing
  // count as 1 (extractAxisValuesWithCounts never returns 0 either way).
  const [axisCounts, setAxisCounts] = useState<Partial<Record<TagCategory, Record<string, number>>>>({})
  // Values the user typed in by hand via the axis editor's "Add" input —
  // these ARE persisted per packKind, since they don't come from sampling
  // and represent an explicit, durable preference (e.g. always wanting
  // "beach" in the scenery pool for a given character pack).
  const [manualAxisValues, setManualAxisValues] = useState<Partial<Record<TagCategory, string[]>>>(
    initialConfig.manualAxisValues
  )
  const [axisMinCounts, setAxisMinCounts] = useState<Partial<Record<TagCategory, number>>>(
    initialConfig.axisMinCounts
  )
  const [customBaseText, setCustomBaseText] = useState('')
  const [promptCount, setPromptCount] = useState(initialConfig.promptCount)
  // Generated prompts are NOT derived reactively (no useMemo over
  // axisValues/lockedTags/etc.) — regenerating on every axis edit was
  // re-running a cartesian-product sample through Smart Tag Exclusion on
  // every keystroke/slider-frame, which pegged the CPU. Instead this is
  // plain state, only (re)computed inside `regenerate()`, which the
  // "Generate" button calls explicitly.
  const [generatedPrompts, setGeneratedPrompts] = useState<PackPrompt[]>([])

  const togglePackMode = useCallback(() => setIsPackMode((prev) => !prev), [])
  const enablePackMode = useCallback(() => setIsPackMode(true), [])
  const disablePackMode = useCallback(() => setIsPackMode(false), [])

  const setBaseCard = useCallback((post: BooruPost | null) => {
    setBaseCardRaw(post)
    // New base → sampled axis pools no longer make sense as-is; caller should
    // reseed via reseedAllAxes once they have the current post list. Clear
    // here so stale values from a previous base don't leak in. Manual values
    // (typed in by hand, persisted) are NOT cleared — they're independent of
    // which base card is selected.
    setAxisValuesRaw({})
    setAxisCounts({})
    // Previously generated prompts belong to the old base — clear them so the
    // results list doesn't show stale prompts until the user hits Generate again.
    setGeneratedPrompts([])
  }, [])

  const applyPackKind = useCallback((kind: PackKind) => {
    setPackKind(kind)
    // Restore whatever was saved for this kind at mount time (see
    // savedConfigsRef above) — falls back to the kind's built-in default
    // locked categories when nothing was ever saved for it. 'custom' has no
    // built-in default, so an unsaved 'custom' leaves lockedCategories as-is
    // (matches the pre-persistence behavior of "custom leaves the current
    // selection untouched").
    const saved = savedConfigsRef.current[kind]
    if (kind === 'character') {
      setLockedCategories(new Set(saved?.lockedCategories ?? DEFAULT_LOCKED_CATEGORIES.character))
    } else if (kind === 'clothing') {
      setLockedCategories(new Set(saved?.lockedCategories ?? DEFAULT_LOCKED_CATEGORIES.clothing))
    } else if (saved) {
      setLockedCategories(new Set(saved.lockedCategories))
    }
    setAxisMinCounts(saved?.axisMinCounts ?? {})
    setManualAxisValues(saved?.manualAxisValues ?? {})
    if (saved?.promptCount) setPromptCount(saved.promptCount)
  }, [])

  const toggleLockedCategory = useCallback((category: TagCategory) => {
    setLockedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
    setPackKind('custom')
  }, [])

  const baseClassified = useMemo<Record<TagCategory, string[]>>(() => {
    if (!baseCard) return { clothing: [], pose: [], scenery: [], appearance: [], other: [] }
    return classifyPostForPack(baseCard, tagOverrides)
  }, [baseCard, tagOverrides])

  // Raw character tags on the base card, in on-post order — used both to
  // detect the multi-character case below and by the learning context
  // hierarchy further down. Declared here (moved up from its original spot)
  // so lockedTags can reference it.
  const characterTags = useMemo(
    () => Array.from(new Set(splitTags(baseCard?.tag_string_character || '').map(normalizeTagForPack).filter(Boolean))),
    [baseCard]
  )

  /**
   * True when the base card's own tag_string_character lists more than one
   * character (crossovers, group art, multi-character posts). Exposed so
   * the UI can warn the user BEFORE they lock in a base — without this,
   * classifyPostForPack folds EVERY character tag on the post into
   * `appearance` (by design: it's classifying one post in isolation, not
   * building a pack), and a 'character' pack's default locked category is
   * exactly ['appearance']. Picking a multi-character post as the base
   * silently locked ALL of those character names as constant tags into
   * every generated prompt — e.g. an 8-character crossover post produced
   * packs where 8 unrelated character names were forced into every prompt,
   * which Smart Tag Exclusion then (correctly) rejected almost entirely,
   * leaving a handful of nonsensical 40-tag survivors. See lockedTags below
   * for the actual mitigation (only the first character tag is locked).
   */
  const hasMultipleCharacters = characterTags.length > 1

  const lockedTags = useMemo(() => {
    const tags: string[] = []
    lockedCategories.forEach((cat) => {
      if (cat !== 'appearance' || !hasMultipleCharacters) {
        tags.push(...(baseClassified[cat] || []))
        return
      }
      // Multi-character base card + 'appearance' locked: delegate to the
      // pure, tested filterAppearanceForPrimaryCharacter (pack-generator.ts)
      // rather than re-inlining the same "keep only characterTags[0]" logic
      // here. Nothing is hidden from the user by this filtering — it only
      // shrinks lockedTags (what actually gets fixed into every generated
      // prompt); baseClassified (the raw classification shown in the Pack
      // Setup preview and the builder's base-card chips) stays untouched, so
      // the UI still shows every character tag that was excluded here, and
      // hasMultipleCharacters lets it flag why.
      tags.push(...filterAppearanceForPrimaryCharacter(baseClassified[cat] || [], characterTags))
    })
    // 'custom' pack kind: the user's own free-text base prompt is merged in
    // as additional constant tags, on top of whatever categories are locked
    // (the base card's own tags can still be included if the user also
    // toggled some categories on — customBaseText is additive, not exclusive).
    if (packKind === 'custom' && customBaseText.trim()) {
      tags.push(...splitCommaSeparatedTags(customBaseText).map(normalizeTagForPack))
    }
    return Array.from(new Set(tags.filter(Boolean)))
  }, [baseClassified, lockedCategories, packKind, customBaseText, hasMultipleCharacters, characterTags])

  const activeAxisCategories = useMemo(
    () => PACK_AXES.filter((cat) => !lockedCategories.has(cat)),
    [lockedCategories]
  )

  // Character tags come straight from the base card (Pack Mode always has
  // exactly one fixed base, unlike Bulk Send's multi-seed-post case). Same
  // splitTags(tag_string_character) approach as detectCharacterTags
  // (lib/pack/bulk-send.ts) — whitespace-separated, not comma-separated.
  // Used both by regenerate() (includeCharacters) and by the learning
  // context hierarchy below (contextKeysFor). (Declared earlier, alongside
  // baseClassified/hasMultipleCharacters/lockedTags — kept here only as a
  // pointer since those all depend on it and are defined further up.)

  // Learning context hierarchy (docs/pack-mode-learning-plan.md §7.4):
  // `${provider}:${characterTag}` for each character on the base card, then
  // `${provider}`, then the global bucket. Recomputed only when the provider
  // or the base card's characters change — NOT on every axis edit.
  const learningContextKeys = useMemo(
    () => contextKeysFor(booruProvider, characterTags),
    [booruProvider, characterTags]
  )

  // Exposed `axisValues` = sampled pool (axisValues state) + manual values
  // (persisted), deduped, manual values appended after sampled ones so the
  // chip list order stays "sampled first, then whatever you typed" — same
  // ordering withAxisFallback already uses for its own sampled+fallback merge.
  const mergedAxisValues = useMemo<Partial<Record<TagCategory, string[]>>>(() => {
    const merged: Partial<Record<TagCategory, string[]>> = {}
    PACK_AXES.forEach((cat) => {
      const sampled = axisValues[cat] || []
      const manual = manualAxisValues[cat] || []
      if (sampled.length === 0 && manual.length === 0) return
      const seen = new Set(sampled)
      const extraManual = manual.filter((v) => {
        if (seen.has(v)) return false
        seen.add(v)
        return true
      })
      merged[cat] = [...sampled, ...extraManual]
    })
    return merged
  }, [axisValues, manualAxisValues])

  // value -> category lookup over mergedAxisValues, built once per
  // mergedAxisValues change instead of re-scanning every axis's array with
  // `.includes()` for every single generated value (regenerate's
  // prompts_shown bookkeeping, recordPromptCopied) — that was O(prompts *
  // values * categories) string comparisons per Generate click. A value
  // that (via tagOverrides) ends up sampled into more than one axis keeps
  // whichever category PACK_AXES visits last for it, same effective
  // tie-break the old nested-includes scan had (later category "won" by
  // overwriting shownValues'/withCategory's entry for that value).
  const axisValueCategory = useMemo(() => {
    const map = new Map<string, TagCategory>()
    PACK_AXES.forEach((cat) => {
      (mergedAxisValues[cat] || []).forEach((value) => map.set(value, cat))
    })
    return map
  }, [mergedAxisValues])

  const addAxisValue = useCallback((category: TagCategory, value: string) => {
    const normalized = value.trim().toLowerCase().replace(/_/g, ' ')
    if (!normalized) return
    setManualAxisValues((prev) => {
      const existing = prev[category] || []
      if (existing.includes(normalized)) return prev
      return { ...prev, [category]: [...existing, normalized] }
    })
    // Explicit positive signal (§7.2) — the user chose this value on purpose,
    // independent of whether it ever gets copied in a generated prompt.
    learning.recordFeedback({
      kind: 'value_added',
      contextKey: learningContextKeys,
      values: [{ category, value: normalized }],
    })
  }, [learning, learningContextKeys])

  const removeAxisValue = useCallback((category: TagCategory, value: string) => {
    // A chip can come from either pool (sampled or manual) — remove it from
    // whichever one currently has it. Removing a manual value also drops it
    // from the persisted manualAxisValues so it doesn't reappear next session.
    setAxisValuesRaw((prev) => {
      const existing = prev[category] || []
      if (!existing.includes(value)) return prev
      return { ...prev, [category]: existing.filter((v) => v !== value) }
    })
    setManualAxisValues((prev) => {
      const existing = prev[category] || []
      if (!existing.includes(value)) return prev
      return { ...prev, [category]: existing.filter((v) => v !== value) }
    })
    // Moderate negative signal (§7.2) — NOT a hard veto: removing a chip can
    // just mean "too many chips right now", not "I dislike this value". See
    // REMOVE_PENALTY in lib/pack/pack-learning.ts.
    learning.recordFeedback({
      kind: 'value_removed',
      contextKey: learningContextKeys,
      values: [{ category, value }],
    })
  }, [learning, learningContextKeys])

  /** Minimum distinct values sampled from `category`'s pool per generated
   *  prompt (clamped to [1, pool size] downstream in generatePackPrompts). */
  const setAxisMinCount = useCallback((category: TagCategory, minCount: number) => {
    setAxisMinCounts((prev) => ({ ...prev, [category]: Math.max(1, Math.floor(minCount) || 1) }))
  }, [])

  const reseedAxis = useCallback(
    (
      category: TagCategory,
      posts: BooruPost[],
      overrides: Record<string, string> = tagOverrides,
      fallbackValues: string[] = []
    ) => {
      const sampledWithCounts = extractAxisValuesWithCounts(posts, category, overrides)
      const sampled = sampledWithCounts.map((v) => v.value)
      const topped = withAxisFallback(sampled, fallbackValues)
      setAxisValuesRaw((prev) => ({ ...prev, [category]: topped }))
      setAxisCounts((prev) => ({
        ...prev,
        [category]: Object.fromEntries(sampledWithCounts.map((v) => [v.value, v.count])),
      }))
    },
    [tagOverrides]
  )

  const reseedAllAxes = useCallback(
    (
      posts: BooruPost[],
      overrides: Record<string, string> = tagOverrides,
      fallbacks: Partial<Record<TagCategory, string[]>> = {}
    ) => {
      // Classifies every post ONCE across all PACK_AXES categories at once
      // (extractAllAxisValuesWithCounts) instead of the old per-category loop,
      // which called classifyPostForPack — a full re-split/re-classify of
      // each post's tag string — once per category, i.e. 4x redundant work
      // on every "Load more posts" click and every initial seed.
      const sampledByCategory = extractAllAxisValuesWithCounts(posts, PACK_AXES, overrides)
      const nextValues: Partial<Record<TagCategory, string[]>> = {}
      const nextCounts: Partial<Record<TagCategory, Record<string, number>>> = {}
      PACK_AXES.forEach((cat) => {
        const sampledWithCounts = sampledByCategory[cat] ?? []
        nextValues[cat] = withAxisFallback(sampledWithCounts.map((v) => v.value), fallbacks[cat])
        nextCounts[cat] = Object.fromEntries(sampledWithCounts.map((v) => [v.value, v.count]))
      })
      setAxisValuesRaw(nextValues)
      setAxisCounts(nextCounts)
    },
    [tagOverrides]
  )

  const setPromptCountClamped = useCallback((count: number) => {
    setPromptCount(Math.max(1, Math.min(MAX_PACK_PROMPTS, Math.floor(count) || 1)))
  }, [])

  const regenerate = useCallback(() => {
    // A pack needs SOME constant tags to build prompts around — either a
    // base card, or (the "Full Setup" flow, no base card) the free-text
    // customBaseText merged into lockedTags. Only bail when there's neither:
    // requiring baseCard unconditionally made Full Setup a dead end (it
    // forces packKind='custom' with baseCard=null, so lockedTags is the ONLY
    // source of constant tags in that flow — see handleFullPackSetup in
    // prompt-gallery.tsx).
    if (!baseCard && lockedTags.length === 0) {
      setGeneratedPrompts([])
      return
    }
    const axes: Partial<Record<TagCategory, string[]>> = {}
    activeAxisCategories.forEach((cat) => {
      const vals = mergedAxisValues[cat]
      if (vals && vals.length > 0) axes[cat] = vals
    })

    // Per-axis sampling weights combining booru cross-post frequency with
    // whatever this model has learned for the current character/provider
    // context (docs/pack-mode-learning-plan.md §7.5). Built fresh on every
    // regenerate() call (not memoized) since the model itself is a mutable
    // ref inside usePackLearning, not React state — there's nothing to
    // usefully memoize against.
    const axisWeights: Partial<Record<TagCategory, Record<string, number>>> = {}
    activeAxisCategories.forEach((cat) => {
      const vals = axes[cat]
      if (!vals || vals.length === 0) return
      const countsForCat = axisCounts[cat] || {}
      const valuesWithCounts = vals.map((v) => ({ value: v, count: countsForCat[v] ?? 1 }))
      const weights = learning.weightsFor(learningContextKeys, cat, valuesWithCounts)
      axisWeights[cat] = Object.fromEntries(vals.map((v, i) => [v, weights[i]]))
    })

    // Over-generate raw candidates (same reasoning as useBulkSend.runSynthetic)
    // so the near-duplicate filter below has room to reject prompts that are
    // exact-string-distinct but tag-set-near-identical (e.g. two combinations
    // differing only by one filler tag) and still reach `promptCount`.
    // generatePackPrompts already dedupes EXACT string matches on its own.
    // Capped at MAX_PACK_OVERGENERATE (not MAX_PACK_PROMPTS) — the latter is
    // the USER-facing cap on promptCount itself, and capping the over-
    // generate pass at the same value left zero headroom for the 3x
    // multiplier whenever promptCount was close to MAX_PACK_PROMPTS (see
    // that constant's docstring in pack-generator.ts).
    const overGenerateCount = Math.min(promptCount * 3, MAX_PACK_OVERGENERATE)
    const rawPrompts = generatePackPrompts({
      lockedTags,
      axes,
      axisMinCounts,
      axisWeights,
      count: overGenerateCount,
      maxPrompts: overGenerateCount,
      globalWeights,
      isGlobalWeightsEnabled,
    })

    // Run each raw combination through the exact same cleaner pipeline every
    // real card uses (cleanPrompt + Smart Tag Exclusion + global weights),
    // driven by the app's current prompt settings — see cleanSyntheticPrompt
    // (shared with Bulk Send's "Synthetic" mode) for why this two-post-only
    // step matters: it's what makes optimizeTags/exclude/find&replace/
    // tagAppendRules apply to Pack Mode output instead of being silently
    // skipped by the simpler pack-generator-only path.
    //
    // Near-duplicate filtering (Jaccard over tag sets, same helper
    // useBulkSend already relies on) runs AFTER cleaning — cleaning can
    // itself collapse two raw combinations closer together (optimizeTags,
    // exclude, find&replace), so filtering on the pre-clean prompt could miss
    // duplicates the user would actually see, or filtering on values could
    // miss duplicates the cleaner introduces. Distinct-exact-string dedup via
    // `seen` stays first as a cheap short-circuit before the O(n) Jaccard scan.
    //
    // IMPORTANT (plan §9.2): the RESULT ORDER here is exactly the order
    // generatePackPrompts produced (weighted sampling influences WHICH
    // combinations get generated, never how the final list is displayed).
    // Never sort `cleaned` by any learned score — doing so would turn
    // position bias into a feedback loop on itself (top-scored item sits on
    // top, gets copied for being on top, scores even higher).
    const seen = new Set<string>()
    const dupFilter = new NearDuplicateFilter(DEFAULT_SIMILARITY_THRESHOLD)
    const cleaned: PackPrompt[] = []
    for (const raw of rawPrompts) {
      if (cleaned.length >= promptCount) break
      const tags = raw.prompt.split(',').map((t) => t.trim()).filter(Boolean)
      const prompt = cleanSyntheticPrompt(tags, characterTags, {
        ...cleanOptions,
        tagOverrides,
        globalWeights,
        isGlobalWeightsEnabled,
      })
      if (!prompt || seen.has(prompt)) continue
      if (!dupFilter.tryAccept(prompt)) continue
      seen.add(prompt)
      cleaned.push({ prompt, values: raw.values })
    }
    setGeneratedPrompts(cleaned)

    // Record the "shown" half of the pick/show signal (§7.2) ONCE per
    // generation, for every distinct axis value that ended up in the final
    // (cleaned, deduped) list — not the raw pre-clean candidates, since those
    // can include values the cleaner later dropped (e.g. Smart Tag Exclusion,
    // exclude list) that the user never actually saw on screen.
    if (cleaned.length > 0) {
      const shownValues = new Map<string, { category: TagCategory; value: string }>()
      cleaned.forEach((p) => {
        p.values.forEach((rawValue) => {
          const cat = axisValueCategory.get(rawValue)
          if (cat && (activeAxisCategories as TagCategory[]).includes(cat)) {
            shownValues.set(`${cat}:${rawValue}`, { category: cat, value: rawValue })
          }
        })
      })
      if (shownValues.size > 0) {
        learning.recordFeedback({
          kind: 'prompts_shown',
          contextKey: learningContextKeys,
          values: Array.from(shownValues.values()),
        })
      }
    }
  }, [
    baseCard,
    lockedTags,
    activeAxisCategories,
    mergedAxisValues,
    axisCounts,
    axisMinCounts,
    promptCount,
    globalWeights,
    isGlobalWeightsEnabled,
    tagOverrides,
    cleanOptions,
    characterTags,
    learning,
    learningContextKeys,
    axisValueCategory,
  ])

  const recordPromptCopied = useCallback(
    (prompt: PackPrompt) => {
      if (prompt.values.length === 0) return
      const withCategory: Array<{ category: TagCategory; value: string }> = []
      prompt.values.forEach((value) => {
        const cat = axisValueCategory.get(value)
        if (cat && (activeAxisCategories as TagCategory[]).includes(cat)) {
          withCategory.push({ category: cat, value })
        }
      })
      if (withCategory.length === 0) return
      learning.recordFeedback({
        kind: 'prompt_copied',
        contextKey: learningContextKeys,
        values: withCategory,
      })
    },
    [learning, learningContextKeys, activeAxisCategories, axisValueCategory]
  )

  const clearAll = useCallback(() => {
    setBaseCardRaw(null)
    setAxisValuesRaw({})
    setAxisCounts({})
    setManualAxisValues({})
    setAxisMinCounts({})
    setCustomBaseText('')
    setLockedCategories(new Set(DEFAULT_LOCKED_CATEGORIES.character))
    setPackKind('character')
    setPromptCount(DEFAULT_PROMPT_COUNT)
    setGeneratedPrompts([])
  }, [])

  // Persist the current per-packKind config, debounced (300ms, same idle
  // window as usePersistentState) so rapid edits (slider drags, repeated
  // Add-value clicks) coalesce into one write instead of one per keystroke.
  // Writes into savedConfigsRef's snapshot too, so switching packKind later
  // in the SAME session sees the latest edits rather than only what was on
  // disk at mount (applyPackKind reads from this ref).
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const skipFirstPersistRef = useRef(true)
  useEffect(() => {
    if (typeof window === 'undefined') return
    // Skip the very first run (mount) — it would just re-write the same
    // values this hook hydrated FROM storage a moment ago.
    if (skipFirstPersistRef.current) {
      skipFirstPersistRef.current = false
      return
    }
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    const snapshot: PackModeConfig = {
      lockedCategories: Array.from(lockedCategories),
      axisMinCounts,
      promptCount,
      manualAxisValues,
    }
    persistTimerRef.current = setTimeout(() => {
      savedConfigsRef.current = { ...savedConfigsRef.current, [packKind]: snapshot }
      try {
        const current = userPreferences.getPackModeConfig()
        userPreferences.setPackModeConfig({ ...current, [packKind]: snapshot })
        // Also remember which kind this was, so the next session restores
        // the tab the user actually left off on instead of always
        // restarting on 'character' (see getPackModeLastKind's docstring).
        userPreferences.setPackModeLastKind(packKind)
      } catch {
        // Non-fatal: config persistence is best-effort, same as other
        // localStorage writes in this codebase (see lib/storage.ts's own
        // try/catch around every set()).
      }
    }, 300)
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    }
  }, [packKind, lockedCategories, axisMinCounts, promptCount, manualAxisValues])

  return {
    isPackMode,
    togglePackMode,
    enablePackMode,
    disablePackMode,

    baseCard,
    setBaseCard,

    packKind,
    setPackKind: applyPackKind,

    lockedCategories,
    toggleLockedCategory,

    baseClassified,
    hasMultipleCharacters,
    lockedTags,
    activeAxisCategories,

    axisValues: mergedAxisValues,
    addAxisValue,
    removeAxisValue,
    reseedAxis,
    reseedAllAxes,

    axisMinCounts,
    setAxisMinCount,

    customBaseText,
    setCustomBaseText,

    promptCount,
    setPromptCount: setPromptCountClamped,

    generatedPrompts,
    regenerate,

    recordPromptCopied,
    explorationTemperature: learning.explorationTemperature,
    setExplorationTemperature: learning.setExplorationTemperature,
    resetLearning: learning.resetModel,

    clearAll,
  }
}
