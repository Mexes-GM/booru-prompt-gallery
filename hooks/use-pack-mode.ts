import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { BooruPost, BooruProvider } from '@/lib/booru/types'
import { TagCategory } from '@/lib/tag-classifier'
import { splitCommaSeparatedTags, splitTags } from '@/lib/utils/tag-utils'
import {
  PACK_AXES,
  MAX_PACK_PROMPTS,
  MAX_PACK_OVERGENERATE,
  MAX_MIN_TAGS_SLIDER,
  MAX_MIN_PACKS_SLIDER,
  classifyPostForPack,
  filterAppearanceForPrimaryCharacter,
  extractAllAxisValuesWithCounts,
  extractAllAxisBundlesWithCounts,
  canonicalizeBundleTags,
  generatePackPrompts,
  filterValuesBySlotState,
  groupValuesBySlot,
  maxValuesPerPrompt,
  withAxisFallback,
  normalizeTagForPack,
  type PackPrompt,
  type AxisTagMode,
  type SlotGroup,
} from '@/lib/pack/pack-generator'
import { cleanSyntheticPrompt, detectCharacterTags, type BulkSendCleanOptions } from '@/lib/pack/bulk-send'
import { NearDuplicateFilter, DEFAULT_SIMILARITY_THRESHOLD } from '@/lib/pack/prompt-similarity'
import { classifyBasePrompt } from '@/lib/pack/base-prompt'
import { pickReplacement } from '@/lib/pack/reroll'
import { finalizePackPrompt, parseAlwaysAddTags } from '@/lib/pack/always-add'
import { userPreferences, type PackModeConfigV2 } from '@/lib/storage'
import { usePackLearning } from '@/hooks/use-pack-learning'
import { contextKeysFor } from '@/lib/pack/pack-learning'
import { migratePackConfig } from '@/lib/pack/pack-config-migration'
import { varietyPreset, DEFAULT_VARIETY_LEVEL, type VarietyLevel, type VarietySetting } from '@/lib/pack/variety-presets'
import { estimateTagsPerPrompt, raiseCountsForMinTotal, type AxisBudget } from '@/lib/pack/min-tags'
import {
  emptyClassifiedTags,
  slotsOf,
  categoryOfSlot,
  getTagSlotFromOverrides,
} from '@/lib/tag-taxonomy'
import { fetchTagOverridesForNames } from '@/lib/supabase/client-queries'

const DEFAULT_PROMPT_COUNT = 10
/** Upper bound for the "Min tags per prompt" control. */
export const MAX_MIN_TOTAL_TAGS = 60
/** Sampled full sets smaller than this are too thin to be worth a pick ("sword" alone isn't a set). */
export const DEFAULT_MIN_SET_TAGS = 3
export const MAX_MIN_SET_TAGS = 8

/** Per-category role in the pack: kept from the base, varied, or left out entirely. */
export type PackCategoryState = 'keep' | 'vary' | 'off'
/** Per-subcategory (slot) role: base tags kept, values varied, or left out entirely. */
export type PackSlotState = 'base' | 'vary' | 'off'

/** Number of comma-separated tags in a prompt string. */
function countPromptTags(prompt: string): number {
  return prompt.split(',').filter((t) => t.trim()).length
}

/** General + character tags of the given posts, display-normalized and deduped. */
function collectPostTags(posts: BooruPost[]): string[] {
  const out = new Set<string>()
  for (const post of posts) {
    for (const raw of [post.tag_string, post.tag_string_character]) {
      if (!raw) continue
      for (const tag of splitTags(raw)) {
        const norm = normalizeTagForPack(tag)
        if (norm) out.add(norm)
      }
    }
  }
  return Array.from(out)
}

type AxisSample = { values: string[]; counts: Record<string, number> }

/** Samples candidate pools for `categories`, classifying each post once per mode group. */
function sampleAxes(
  posts: BooruPost[],
  categories: readonly TagCategory[],
  modes: Partial<Record<TagCategory, AxisTagMode>>,
  overrides: Record<string, string>,
  fallbacks: Partial<Record<TagCategory, string[]>>
): Partial<Record<TagCategory, AxisSample>> {
  const out: Partial<Record<TagCategory, AxisSample>> = {}
  const toCounts = (list: Array<{ value: string; count: number }>) =>
    Object.fromEntries(list.map((v) => [v.value, v.count]))

  const individual = categories.filter((cat) => modes[cat] !== 'bundle')
  if (individual.length > 0) {
    const sampled = extractAllAxisValuesWithCounts(posts, individual, overrides)
    individual.forEach((cat) => {
      const list = sampled[cat] ?? []
      out[cat] = { values: withAxisFallback(list.map((v) => v.value), fallbacks[cat]), counts: toCounts(list) }
    })
  }

  const bundled = categories.filter((cat) => modes[cat] === 'bundle')
  if (bundled.length > 0) {
    const sampled = extractAllAxisBundlesWithCounts(posts, bundled, overrides)
    bundled.forEach((cat) => {
      const list = sampled[cat] ?? []
      out[cat] = { values: list.map((v) => v.value), counts: toCounts(list) }
    })
  }
  return out
}

export interface UsePackModeResult {
  isPackMode: boolean
  togglePackMode: () => void
  enablePackMode: () => void
  disablePackMode: () => void

  baseCard: BooruPost | null
  setBaseCard: (post: BooruPost | null) => void

  /** Free-text "From my prompt" base (§3) — mutually exclusive with baseCard. */
  basePrompt: string
  setBasePrompt: (text: string) => void
  /** True when there's a usable base, either baseCard or a non-empty basePrompt. */
  hasBase: boolean

  /** Variety slider (§5): 1..5 preset level, or 'custom' after a manual Advanced edit. */
  varietyLevel: VarietySetting
  setVarietyLevel: (level: VarietyLevel) => void

  lockedCategories: Set<TagCategory>
  toggleLockedCategory: (category: TagCategory) => void

  /**
   * Slots locked inside a category that is NOT locked whole ("partial" lock):
   * their base-card tags join lockedTags and they stop varying. A category
   * whose every slot is locked is folded into lockedCategories instead.
   */
  lockedSlots: Set<string>
  /** Toggles one slot between locked and varying (switches to 'custom'). */
  toggleLockedSlot: (slot: string) => void
  /** Slots switched off: they neither vary nor contribute base-card tags. */
  mutedSlots: Set<string>
  toggleMutedSlot: (slot: string) => void

  /**
   * Visible pool per axis grouped by slot (taxonomy order, unslotted last) —
   * already filtered by locked/muted slots, manual values included.
   */
  axisSlotGroups: Partial<Record<TagCategory, SlotGroup[]>>
  /** Pool size per slot BEFORE muting, so a muted slot's pill can still show its count. */
  axisSlotCounts: Partial<Record<TagCategory, Record<string, number>>>
  /** Most distinct values one prompt can take from each axis under the slot constraints. */
  axisMaxPerPrompt: Partial<Record<TagCategory, number>>

  /** tagOverrides merged with the per-tag slots fetched for the current pool. */
  effectiveTagOverrides: Record<string, string>

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
   * Mode of tag sampling per category: 'individual' (single tags scrambled) vs
   * 'bundle' (cohesive card outfits/sets kept intact). Defaults to 'individual'.
   */
  axisTagModes: Partial<Record<TagCategory, AxisTagMode>>
  setAxisTagMode: (category: TagCategory, mode: AxisTagMode) => void
  setAllAxisTagModes: (mode: AxisTagMode) => void

  /**
   * Candidate value pool per axis category: booru-sampled values (seeded from
   * the loaded posts, see reseedAxis/reseedAllAxes) merged with any values
   * the user added by hand (addAxisValue) — sampled values first, manual ones
   * appended after, deduped. Manual values are persisted (see
   * lib/storage.ts's PackModeConfigV2); sampled ones never are.
   */
  axisValues: Partial<Record<TagCategory, string[]>>
  addAxisValue: (category: TagCategory, value: string) => void
  removeAxisValue: (category: TagCategory, value: string) => void
  reseedAxis: (category: TagCategory, posts: BooruPost[], fallbackValues?: string[]) => void
  reseedAllAxes: (posts: BooruPost[], fallbacks?: Partial<Record<TagCategory, string[]>>) => void

  /** Minimum distinct values sampled per axis category on each generated prompt (default 1). */
  axisMinCounts: Partial<Record<TagCategory, number>>
  setAxisMinCount: (category: TagCategory, minCount: number) => void

  /** Free-text base prompt for the 'custom' pack kind — merged into lockedTags. */
  customBaseText: string
  setCustomBaseText: (text: string) => void

  /** Base tags the user removed from this base — never kept, whatever the locks say. Reset on a new base. */
  excludedBaseTags: Set<string>
  toggleExcludedBaseTag: (tag: string) => void
  restoreExcludedBaseTags: (category?: TagCategory) => void

  /** Role of each pack category, derived from locks + min counts. */
  categoryStates: Record<TagCategory, PackCategoryState>
  setCategoryState: (category: TagCategory, state: PackCategoryState) => void
  /** Role of one "category:subcategory" slot. */
  slotStateOf: (slot: string) => PackSlotState
  setSlotState: (slot: string, state: PackSlotState) => void

  /** Minimum tags per generated prompt (0 = no minimum); raises per-axis counts to reach it. */
  minTotalTags: number
  setMinTotalTags: (count: number) => void
  /** Expected tags per prompt with the current settings (after the minimum is applied). */
  estimatedTagsPerPrompt: number

  /** Per-category minimum tags for a sampled full set (bundle mode); thinner ones are hidden. */
  minSetTags: Partial<Record<TagCategory, number>>
  setMinSetTags: (category: TagCategory, count: number) => void
  /** Sampled full sets currently hidden for being under the minimum, per category. */
  hiddenThinSets: Partial<Record<TagCategory, number>>

  promptCount: number
  setPromptCount: (count: number) => void

  generatedPrompts: PackPrompt[]
  regenerate: () => void
  /** Replaces one generated prompt (by index) with a fresh variation (§6). Returns false if none was found. */
  rerollPrompt: (index: number) => boolean

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
  // Free-text pasted-prompt base ("From my prompt", §3) — mutually exclusive
  // with baseCard. Character tags for this base can't be known until seed
  // posts arrive (detectCharacterTags needs them), so they're recomputed in
  // reseedAllAxes and kept as their own bit of state (see promptCharacterTags).
  const [basePrompt, setBasePromptRaw] = useState('')
  const [promptCharacterTags, setPromptCharacterTags] = useState<string[]>([])
  const learning = usePackLearning()

  // Lazy-load the persisted builder config ONCE on mount (see
  // PackModeConfigV2 in lib/storage.ts), migrating from the old per-archetype
  // config if no V2 config was ever saved. Read once via a lazy initializer
  // so nothing reads storage during render.
  const [initialConfig] = useState<PackModeConfigV2>(() => {
    if (typeof window === 'undefined') return migratePackConfig(null, {}, 'character')
    try {
      return migratePackConfig(
        userPreferences.getPackModeConfigV2(),
        userPreferences.getPackModeConfig(),
        userPreferences.getPackModeLastKind()
      )
    } catch {
      return migratePackConfig(null, {}, 'character')
    }
  })

  const [lockedCategories, setLockedCategories] = useState<Set<TagCategory>>(
    new Set(initialConfig.lockedCategories)
  )
  const [lockedSlots, setLockedSlots] = useState<Set<string>>(() => new Set(initialConfig.lockedSlots))
  const [mutedSlots, setMutedSlots] = useState<Set<string>>(() => new Set(initialConfig.mutedSlots))
  const [varietyLevel, setVarietyLevelRaw] = useState<VarietySetting>(initialConfig.varietyLevel)

  // Locking a slot of a whole-locked category turns it into a partial lock of
  // all its OTHER slots; locking the last varying slot folds the category back
  // into a whole lock. That keeps one canonical state per category.
  const toggleLockedSlot = useCallback((slot: string) => {
    const cat = categoryOfSlot(slot)
    if (!cat) return
    const all = slotsOf(cat)
    const categoryLocked = lockedCategories.has(cat)

    const nextSlots = new Set(lockedSlots)
    const nextCategories = new Set(lockedCategories)
    if (categoryLocked) {
      nextCategories.delete(cat)
      all.forEach((s) => { if (s !== slot) nextSlots.add(s) })
    } else if (nextSlots.has(slot)) {
      nextSlots.delete(slot)
    } else {
      nextSlots.add(slot)
      if (all.every((s) => nextSlots.has(s))) {
        all.forEach((s) => nextSlots.delete(s))
        nextCategories.add(cat)
      }
    }
    setLockedSlots(nextSlots)
    setLockedCategories(nextCategories)
    setMutedSlots((prev) => {
      if (!prev.has(slot)) return prev
      const next = new Set(prev)
      next.delete(slot)
      return next
    })
  }, [lockedCategories, lockedSlots])

  const toggleMutedSlot = useCallback((slot: string) => {
    setMutedSlots((prev) => {
      const next = new Set(prev)
      if (next.has(slot)) next.delete(slot)
      else next.add(slot)
      return next
    })
  }, [])

  // Per-tag slots fetched on demand for tags in the current pool/base card
  // that the static overrides snapshot doesn't cover. The ref mirrors the
  // state so async reseeds can read the latest value without a re-render.
  // Global tagOverrides win on conflict (curated source).
  const [poolOverrides, setPoolOverrides] = useState<Record<string, string>>({})
  const poolOverridesRef = useRef<Record<string, string>>({})
  const requestedSlotTagsRef = useRef<Set<string>>(new Set())
  const effectiveOverrides = useMemo(
    () => (Object.keys(poolOverrides).length === 0 ? tagOverrides : { ...poolOverrides, ...tagOverrides }),
    [poolOverrides, tagOverrides]
  )
  const currentOverrides = useCallback(
    () => ({ ...poolOverridesRef.current, ...tagOverrides }),
    [tagOverrides]
  )

  /** Fetches slots for tags not yet covered or requested. Resolves true if anything new arrived. */
  const enrichOverrides = useCallback(async (tags: string[]): Promise<boolean> => {
    const missing = tags.filter(
      (t) => !requestedSlotTagsRef.current.has(t) && !tagOverrides[t] && !poolOverridesRef.current[t]
    )
    if (missing.length === 0) return false
    missing.forEach((t) => requestedSlotTagsRef.current.add(t))
    try {
      const fetched = await fetchTagOverridesForNames(missing)
      if (Object.keys(fetched).length === 0) return false
      poolOverridesRef.current = { ...poolOverridesRef.current, ...fetched }
      setPoolOverrides(poolOverridesRef.current)
      return true
    } catch {
      // Best-effort: heuristics + snapshot still classify these tags.
      missing.forEach((t) => requestedSlotTagsRef.current.delete(t))
      return false
    }
  }, [tagOverrides])

  // Axis pools sampled from the currently loaded search results — NEVER
  // persisted (see PackModeConfigV2's docstring in lib/storage.ts: they'd be
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
  // these ARE persisted, since they don't come from sampling and represent
  // an explicit, durable preference (e.g. always wanting "beach" in the
  // scenery pool).
  const [manualAxisValues, setManualAxisValues] = useState<Partial<Record<TagCategory, string[]>>>(
    initialConfig.manualAxisValues
  )
  const [axisMinCounts, setAxisMinCounts] = useState<Partial<Record<TagCategory, number>>>(
    initialConfig.axisMinCounts
  )
  const [customBaseText, setCustomBaseText] = useState('')
  // Base tags the user deleted from the current base — per-base, never persisted.
  const [excludedBaseTags, setExcludedBaseTags] = useState<Set<string>>(() => new Set())
  const [minTotalTags, setMinTotalTagsRaw] = useState(initialConfig.minTotalTags ?? 0)
  const [minSetTags, setMinSetTagsRaw] = useState<Partial<Record<TagCategory, number>>>(initialConfig.minSetTags ?? {})
  const [promptCount, setPromptCount] = useState(initialConfig.promptCount)
  const [axisTagModes, setAxisTagModes] = useState<Partial<Record<TagCategory, AxisTagMode>>>(
    initialConfig.axisTagModes ?? {}
  )
  const cachedPostsRef = useRef<BooruPost[]>([])
  const cachedFallbacksRef = useRef<Partial<Record<TagCategory, string[]>>>({})
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
    // A real base card always wins over a pasted prompt base.
    if (post) setBasePromptRaw('')
    // New base → sampled axis pools no longer make sense as-is; caller should
    // reseed via reseedAllAxes once they have the current post list. Clear
    // here so stale values from a previous base don't leak in. Manual values
    // (typed in by hand, persisted) are NOT cleared — they're independent of
    // which base card is selected.
    setAxisValuesRaw({})
    setAxisCounts({})
    setExcludedBaseTags(new Set())
    // Previously generated prompts belong to the old base — clear them so the
    // results list doesn't show stale prompts until the user hits Generate again.
    setGeneratedPrompts([])
  }, [])

  /** Sets the free-text "From my prompt" base, clearing any base card. */
  const setBasePrompt = useCallback((text: string) => {
    setBasePromptRaw(text)
    setBaseCardRaw(null)
    setPromptCharacterTags([])
    setAxisValuesRaw({})
    setAxisCounts({})
    setExcludedBaseTags(new Set())
    setGeneratedPrompts([])
    try {
      userPreferences.setLastPackBasePrompt(text)
    } catch {
      // Non-fatal: best-effort, same as every other localStorage write here.
    }
  }, [])

  // Whole-category toggle: locked -> varying; varying or partial -> locked.
  // Either way the category's partial slot locks are cleared.
  const toggleLockedCategory = useCallback((category: TagCategory) => {
    setLockedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
    setLockedSlots((prev) => {
      const own = slotsOf(category)
      if (!own.some((s) => prev.has(s))) return prev
      const next = new Set(prev)
      own.forEach((s) => next.delete(s))
      return next
    })
  }, [])

  // Normalized, deduped tags of the pasted-prompt base — used both to
  // classify it and (via detectCharacterTags in reseedAllAxes) to find which
  // of them are actually a character.
  const basePromptTags = useMemo(
    () => Array.from(new Set(splitCommaSeparatedTags(basePrompt).map(normalizeTagForPack).filter(Boolean))),
    [basePrompt]
  )

  const baseClassified = useMemo<Record<TagCategory, string[]>>(() => {
    if (baseCard) return classifyPostForPack(baseCard, effectiveOverrides)
    if (basePromptTags.length > 0) {
      return classifyBasePrompt(basePrompt, effectiveOverrides, promptCharacterTags).classified
    }
    return emptyClassifiedTags()
  }, [baseCard, basePrompt, basePromptTags, effectiveOverrides, promptCharacterTags])

  useEffect(() => {
    if (baseCard) {
      void enrichOverrides(collectPostTags([baseCard]))
    } else if (basePromptTags.length > 0) {
      void enrichOverrides(basePromptTags)
    }
  }, [baseCard, basePromptTags, enrichOverrides])

  // Raw character tags of the base, in on-post/on-prompt order — used both to
  // detect the multi-character case below and by the learning context
  // hierarchy further down. Declared here (moved up from its original spot)
  // so lockedTags can reference it. For a base card these come straight from
  // tag_string_character; for a pasted prompt they're detected asynchronously
  // once seed posts arrive (see reseedAllAxes) and kept in promptCharacterTags.
  const characterTags = useMemo(() => {
    if (baseCard) {
      return Array.from(new Set(splitTags(baseCard.tag_string_character || '').map(normalizeTagForPack).filter(Boolean)))
    }
    return promptCharacterTags
  }, [baseCard, promptCharacterTags])

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

  // Base tags minus the ones the user removed — what locks actually draw from.
  const keptBaseClassified = useMemo<Record<TagCategory, string[]>>(() => {
    if (excludedBaseTags.size === 0) return baseClassified
    const out = { ...baseClassified }
    ;(Object.keys(out) as TagCategory[]).forEach((cat) => {
      out[cat] = (out[cat] || []).filter((tag) => !excludedBaseTags.has(tag))
    })
    return out
  }, [baseClassified, excludedBaseTags])

  const toggleExcludedBaseTag = useCallback((tag: string) => {
    setExcludedBaseTags((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }, [])

  const restoreExcludedBaseTags = useCallback((category?: TagCategory) => {
    setExcludedBaseTags((prev) => {
      if (prev.size === 0) return prev
      if (!category) return new Set()
      const own = new Set(baseClassified[category] || [])
      return new Set(Array.from(prev).filter((tag) => !own.has(tag)))
    })
  }, [baseClassified])

  const lockedTags = useMemo(() => {
    const tags: string[] = []
    const baseClassified = keptBaseClassified
    // A pasted prompt's tags outside every pack category (a character the
    // source's posts don't know, quality/style tags…) were typed on purpose:
    // always keep them. A card's "other" bucket is unclassified noise instead.
    if (!baseCard) tags.push(...(baseClassified.other || []))
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
    // Partially locked categories: base tags in locked slots stay constant.
    // Tags with no known slot are kept too — they can't vary there (see
    // filterValuesBySlotState), so dropping them would silently lose them.
    PACK_AXES.forEach((cat) => {
      if (lockedCategories.has(cat)) return
      const own = slotsOf(cat)
      if (!own.some((s) => lockedSlots.has(s))) return
      const catTags = cat === 'appearance' && hasMultipleCharacters
        ? filterAppearanceForPrimaryCharacter(baseClassified[cat] || [], characterTags)
        : baseClassified[cat] || []
      catTags.forEach((tag) => {
        const slot = getTagSlotFromOverrides(tag, effectiveOverrides)?.slot
        if (!slot || lockedSlots.has(slot)) tags.push(tag)
      })
    })
    // Free-text base prompt ("always included"): merged in as additional constant tags,
    // on top of whatever categories are locked.
    if (customBaseText.trim()) {
      tags.push(...splitCommaSeparatedTags(customBaseText).map(normalizeTagForPack))
    }
    return Array.from(new Set(tags.filter(Boolean)))
  }, [keptBaseClassified, baseCard, lockedCategories, lockedSlots, effectiveOverrides, customBaseText, hasMultipleCharacters, characterTags])

  /** "Always add" tags as typed — finalizePackPrompt puts them first, underscores intact. */
  const alwaysAddTags = useMemo(() => parseAlwaysAddTags(customBaseText), [customBaseText])

  /** A real base card OR a non-empty pasted prompt — either way there's a base to vary against. */
  const hasBase = !!baseCard || basePrompt.trim() !== ''

  const activeAxisCategories = useMemo(
    () => PACK_AXES.filter((cat) => (!hasBase ? true : !lockedCategories.has(cat))),
    [hasBase, lockedCategories]
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
  // Sampled values in locked/muted slots are hidden so the chips on screen are
  // exactly what can be sampled. Manual values bypass the filter: the user
  // typed them on purpose, and hiding them would look like Add failed.
  const slotState = useMemo(() => ({ lockedSlots, mutedSlots }), [lockedSlots, mutedSlots])
  // Which categories are in full-set mode, as a stable string. The pools must
  // not depend on axisTagModes' identity: the Variety preset effect rewrites
  // that object whenever axisMaxPerPrompt changes, and axisMaxPerPrompt is
  // derived from the pools — depending on the object would loop forever.
  const bundleCategoriesKey = PACK_AXES.filter((cat) => axisTagModes[cat] === 'bundle').join(',')
  const bundleCategories = useMemo(
    () => new Set(bundleCategoriesKey ? bundleCategoriesKey.split(',') : []),
    [bundleCategoriesKey]
  )
  const buildPools = useCallback(
    (state: { lockedSlots: ReadonlySet<string>; mutedSlots: ReadonlySet<string> }) => {
      const merged: Partial<Record<TagCategory, string[]>> = {}
      PACK_AXES.forEach((cat) => {
        let sampled = filterValuesBySlotState(cat, axisValues[cat] || [], state, effectiveOverrides)
        // Full sets under the category's minimum are dropped (after slot
        // trimming, which can thin a set out too). Typed-in sets are exempt.
        if (bundleCategories.has(cat)) {
          const min = minSetTags[cat] ?? DEFAULT_MIN_SET_TAGS
          sampled = sampled.filter((v) => splitCommaSeparatedTags(v).length >= min)
        }
        const seen = new Set(sampled)
        const extraManual = (manualAxisValues[cat] || []).filter((v) => {
          if (seen.has(v)) return false
          seen.add(v)
          return true
        })
        if (sampled.length === 0 && extraManual.length === 0) return
        merged[cat] = [...sampled, ...extraManual]
      })
      return merged
    },
    [axisValues, manualAxisValues, effectiveOverrides, bundleCategories, minSetTags]
  )
  const mergedAxisValues = useMemo(() => buildPools(slotState), [buildPools, slotState])

  const hiddenThinSets = useMemo(() => {
    const out: Partial<Record<TagCategory, number>> = {}
    PACK_AXES.forEach((cat) => {
      if (!bundleCategories.has(cat)) return
      const min = minSetTags[cat] ?? DEFAULT_MIN_SET_TAGS
      const trimmed = filterValuesBySlotState(cat, axisValues[cat] || [], slotState, effectiveOverrides)
      const hidden = trimmed.filter((v) => splitCommaSeparatedTags(v).length < min).length
      if (hidden > 0) out[cat] = hidden
    })
    return out
  }, [bundleCategories, minSetTags, axisValues, slotState, effectiveOverrides])

  const setMinSetTags = useCallback((category: TagCategory, count: number) => {
    const n = Math.max(1, Math.min(MAX_MIN_SET_TAGS, Math.floor(count) || 1))
    setMinSetTagsRaw((prev) => ({ ...prev, [category]: n }))
  }, [])

  const axisSlotGroups = useMemo(() => {
    const out: Partial<Record<TagCategory, SlotGroup[]>> = {}
    PACK_AXES.forEach((cat) => {
      const vals = mergedAxisValues[cat]
      if (vals) out[cat] = groupValuesBySlot(cat, vals, effectiveOverrides)
    })
    return out
  }, [mergedAxisValues, effectiveOverrides])

  const axisSlotCounts = useMemo(() => {
    const unmuted = buildPools({ lockedSlots, mutedSlots: new Set<string>() })
    const out: Partial<Record<TagCategory, Record<string, number>>> = {}
    PACK_AXES.forEach((cat) => {
      const counts: Record<string, number> = {}
      groupValuesBySlot(cat, unmuted[cat] || [], effectiveOverrides).forEach(({ slot, values }) => {
        if (slot) counts[slot] = values.length
      })
      out[cat] = counts
    })
    return out
  }, [buildPools, lockedSlots, effectiveOverrides])

  const axisMaxPerPrompt = useMemo(() => {
    const out: Partial<Record<TagCategory, number>> = {}
    PACK_AXES.forEach((cat) => {
      out[cat] = maxValuesPerPrompt(axisSlotGroups[cat] || [])
    })
    return out
  }, [axisSlotGroups])

  /** Applies a Variety preset (§5) to the active axes and discards any 'custom' edits. */
  const setVarietyLevel = useCallback(
    (level: VarietyLevel) => {
      const preset = varietyPreset(level, activeAxisCategories, axisMaxPerPrompt)
      setAxisTagModes(preset.axisTagModes)
      setAxisMinCounts(preset.axisMinCounts)
      learning.setExplorationTemperature(preset.temperature)
      setVarietyLevelRaw(level)
    },
    [activeAxisCategories, axisMaxPerPrompt, learning]
  )

  // Re-applies the current preset whenever the set of active axes or their
  // per-prompt ceiling changes (e.g. unlocking a category, or the pool
  // shrinking/growing) — a newly active axis should get the preset's mode,
  // not be silently left without one. No-op while 'custom' (manual edits win).
  /* eslint-disable react-hooks/set-state-in-effect -- axisTagModes/axisMinCounts
     are independent state (a manual Advanced edit can diverge them from any
     preset into 'custom'), not something derivable from activeAxisCategories/
     axisMaxPerPrompt during render; this mirrors those two external-derived
     values back onto that state whenever they change and varietyLevel isn't 'custom'. */
  useEffect(() => {
    if (varietyLevel === 'custom') return
    const preset = varietyPreset(varietyLevel, activeAxisCategories, axisMaxPerPrompt)
    setAxisTagModes(preset.axisTagModes)
    setAxisMinCounts(preset.axisMinCounts)
    learning.setExplorationTemperature(preset.temperature)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [varietyLevel, activeAxisCategories, axisMaxPerPrompt])
  /* eslint-enable react-hooks/set-state-in-effect */

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
    let normalized: string
    if (axisTagModes[category] === 'bundle' || value.includes(',')) {
      normalized = canonicalizeBundleTags(splitCommaSeparatedTags(value))
    } else {
      normalized = value.trim().toLowerCase().replace(/_/g, ' ')
    }
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
  }, [axisTagModes, learning, learningContextKeys])

  const removeAxisValue = useCallback((category: TagCategory, value: string) => {
    // A chip can come from either pool (sampled or manual) — remove it from
    // whichever one currently has it. Removing a manual value also drops it
    // from the persisted manualAxisValues so it doesn't reappear next session.
    // A bundle chip may be the slot-filtered form of a raw sampled bundle,
    // so match on that form too.
    const matches = (v: string) =>
      v === value ||
      (v.includes(',') && filterValuesBySlotState(category, [v], slotState, effectiveOverrides)[0] === value)
    setAxisValuesRaw((prev) => {
      const existing = prev[category] || []
      if (!existing.some(matches)) return prev
      return { ...prev, [category]: existing.filter((v) => !matches(v)) }
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
  }, [learning, learningContextKeys, slotState, effectiveOverrides])

  // Samples right away with what's known, then once more if the on-demand
  // slot lookup for the pool's uncovered tags brings anything new (their
  // category may change from a heuristic guess to the DB's answer). The
  // generation counter drops that second pass if a newer resample started.
  const resampleGenRef = useRef(0)
  const resample = useCallback(
    (
      posts: BooruPost[],
      categories: readonly TagCategory[],
      modes: Partial<Record<TagCategory, AxisTagMode>>,
      fallbacks: Partial<Record<TagCategory, string[]>>,
      replaceAll: boolean
    ) => {
      const gen = ++resampleGenRef.current
      const apply = () => {
        const samples = sampleAxes(posts, categories, modes, currentOverrides(), fallbacks)
        const values: Partial<Record<TagCategory, string[]>> = {}
        const counts: Partial<Record<TagCategory, Record<string, number>>> = {}
        ;(Object.keys(samples) as TagCategory[]).forEach((cat) => {
          values[cat] = samples[cat]!.values
          counts[cat] = samples[cat]!.counts
        })
        setAxisValuesRaw((prev) => (replaceAll ? values : { ...prev, ...values }))
        setAxisCounts((prev) => (replaceAll ? counts : { ...prev, ...counts }))
      }
      apply()
      void enrichOverrides(collectPostTags(posts)).then((changed) => {
        if (changed && gen === resampleGenRef.current) apply()
      })
    },
    [currentOverrides, enrichOverrides]
  )

  /** Minimum distinct values sampled from `category`'s pool per generated
   *  prompt (0 deactivates the category; clamped to pool size downstream in generatePackPrompts). */
  const setAxisMinCount = useCallback((category: TagCategory, minCount: number) => {
    const val = Number.isFinite(minCount) ? Math.floor(minCount) : 1
    const maxCeiling = axisTagModes[category] === 'bundle' ? MAX_MIN_PACKS_SLIDER : MAX_MIN_TAGS_SLIDER
    setAxisMinCounts((prev) => ({ ...prev, [category]: Math.max(0, Math.min(maxCeiling, val)) }))
    setVarietyLevelRaw('custom')
  }, [axisTagModes])

  const setAxisTagMode = useCallback(
    (category: TagCategory, mode: AxisTagMode) => {
      setAxisTagModes((prev) => ({ ...prev, [category]: mode }))
      if (mode === 'bundle') {
        setAxisMinCounts((prev) => {
          if (prev[category] && prev[category]! > MAX_MIN_PACKS_SLIDER) {
            return { ...prev, [category]: MAX_MIN_PACKS_SLIDER }
          }
          return prev
        })
      }
      setVarietyLevelRaw('custom')
      const posts = cachedPostsRef.current
      if (!posts || posts.length === 0) return
      resample(posts, [category], { [category]: mode }, cachedFallbacksRef.current, false)
    },
    [resample]
  )

  const setAllAxisTagModes = useCallback(
    (mode: AxisTagMode) => {
      const nextModes: Partial<Record<TagCategory, AxisTagMode>> = {}
      PACK_AXES.forEach((cat) => {
        nextModes[cat] = mode
      })
      setAxisTagModes(nextModes)
      if (mode === 'bundle') {
        setAxisMinCounts((prev) => {
          let changed = false
          const next = { ...prev }
          PACK_AXES.forEach((cat) => {
            if (next[cat] && next[cat]! > MAX_MIN_PACKS_SLIDER) {
              next[cat] = MAX_MIN_PACKS_SLIDER
              changed = true
            }
          })
          return changed ? next : prev
        })
      }
      setVarietyLevelRaw('custom')

      const posts = cachedPostsRef.current
      if (!posts || posts.length === 0) return
      resample(posts, PACK_AXES, nextModes, cachedFallbacksRef.current, true)
    },
    [resample]
  )

  const reseedAxis = useCallback(
    (category: TagCategory, posts: BooruPost[], fallbackValues: string[] = []) => {
      cachedPostsRef.current = posts
      resample(posts, [category], axisTagModes, { [category]: fallbackValues }, false)
    },
    [resample, axisTagModes]
  )

  const reseedAllAxes = useCallback(
    (posts: BooruPost[], fallbacks: Partial<Record<TagCategory, string[]>> = {}) => {
      cachedPostsRef.current = posts
      cachedFallbacksRef.current = fallbacks
      resample(posts, PACK_AXES, axisTagModes, fallbacks, true)
      // Pasted-prompt base: figure out which of its tags are a character now
      // that seed posts are available (detectCharacterTags needs them).
      if (!baseCard && basePromptTags.length > 0) {
        // Only tags booru itself lists as characters count. detectCharacterTags
        // also accepts anything in a post's appearance bucket (1girl, long hair…),
        // which made the multi-character filter drop every appearance tag but one.
        const booruCharacters = new Set<string>()
        posts.forEach((post) => {
          splitTags(post.tag_string_character || '').forEach((t) => booruCharacters.add(normalizeTagForPack(t)))
        })
        setPromptCharacterTags(
          detectCharacterTags(basePromptTags, posts, currentOverrides()).filter((t) => booruCharacters.has(t))
        )
      }
    },
    [resample, axisTagModes, baseCard, basePromptTags, currentOverrides]
  )

  const setPromptCountClamped = useCallback((count: number) => {
    setPromptCount(Math.max(1, Math.min(MAX_PACK_PROMPTS, Math.floor(count) || 1)))
  }, [])

  const setMinTotalTags = useCallback((count: number) => {
    setMinTotalTagsRaw(Math.max(0, Math.min(MAX_MIN_TOTAL_TAGS, Math.floor(count) || 0)))
  }, [])

  // Category role, derived: a locked category is "keep"; an unlocked one with
  // a min count of 0 is "off" (neither kept nor varied); anything else varies.
  const categoryStates = useMemo(() => {
    const out = {} as Record<TagCategory, PackCategoryState>
    PACK_AXES.forEach((cat) => {
      out[cat] = lockedCategories.has(cat) ? 'keep' : (axisMinCounts[cat] ?? 1) === 0 ? 'off' : 'vary'
    })
    return out
  }, [lockedCategories, axisMinCounts])

  const setCategoryState = useCallback((category: TagCategory, state: PackCategoryState) => {
    if (state === 'keep') {
      if (!lockedCategories.has(category)) toggleLockedCategory(category)
      return
    }
    if (lockedCategories.has(category)) toggleLockedCategory(category)
    // "Off" also drops partial slot locks, so no base tag of this category survives.
    setLockedSlots((prev) => {
      if (state !== 'off') return prev
      const own = slotsOf(category)
      if (!own.some((s) => prev.has(s))) return prev
      const next = new Set(prev)
      own.forEach((s) => next.delete(s))
      return next
    })
    const current = axisMinCounts[category] ?? 1
    if (state === 'off' && current !== 0) setAxisMinCount(category, 0)
    if (state === 'vary' && current === 0) setAxisMinCount(category, 1)
  }, [lockedCategories, toggleLockedCategory, axisMinCounts, setAxisMinCount])

  const slotStateOf = useCallback((slot: string): PackSlotState => {
    const cat = categoryOfSlot(slot)
    if (cat && lockedCategories.has(cat)) return 'base'
    if (lockedSlots.has(slot)) return 'base'
    if (mutedSlots.has(slot)) return 'off'
    return 'vary'
  }, [lockedCategories, lockedSlots, mutedSlots])

  const setSlotState = useCallback((slot: string, state: PackSlotState) => {
    const current = slotStateOf(slot)
    if (current === state) return
    // toggleLockedSlot flips base <-> not-base (and un-mutes the slot).
    if (current === 'base' || state === 'base') toggleLockedSlot(slot)
    if (state === 'off') {
      setMutedSlots((prev) => (prev.has(slot) ? prev : new Set(prev).add(slot)))
    } else if (current === 'off') {
      setMutedSlots((prev) => {
        if (!prev.has(slot)) return prev
        const next = new Set(prev)
        next.delete(slot)
        return next
      })
    }
  }, [slotStateOf, toggleLockedSlot])

  // What each varying axis can contribute to one prompt — shared by the
  // estimate shown in the UI and the min-tags raise in buildGenerationArgs.
  const axisBudgets = useMemo(() => {
    const out: Partial<Record<TagCategory, AxisBudget>> = {}
    activeAxisCategories.forEach((cat) => {
      const vals = mergedAxisValues[cat]
      if (!vals || vals.length === 0) return
      const bundle = axisTagModes[cat] === 'bundle'
      const cap = bundle
        ? Math.min(MAX_MIN_PACKS_SLIDER, vals.length)
        : Math.min(vals.length, axisMaxPerPrompt[cat] || vals.length)
      const tagsPerPick = bundle
        ? vals.reduce((sum, v) => sum + splitCommaSeparatedTags(v).length, 0) / vals.length
        : 1
      out[cat] = { count: axisMinCounts[cat] ?? 1, cap, tagsPerPick }
    })
    return out
  }, [activeAxisCategories, mergedAxisValues, axisTagModes, axisMaxPerPrompt, axisMinCounts])

  const raisedAxisCounts = useMemo(
    () => raiseCountsForMinTotal(minTotalTags, lockedTags.length, axisBudgets),
    [minTotalTags, lockedTags.length, axisBudgets]
  )

  const estimatedTagsPerPrompt = useMemo(() => {
    const raised: Partial<Record<TagCategory, AxisBudget>> = {}
    ;(Object.keys(axisBudgets) as TagCategory[]).forEach((cat) => {
      raised[cat] = { ...axisBudgets[cat]!, count: raisedAxisCounts[cat] ?? axisBudgets[cat]!.count }
    })
    return estimateTagsPerPrompt(lockedTags.length, raised)
  }, [axisBudgets, raisedAxisCounts, lockedTags.length])

  // Shared arg-assembly for both regenerate() and rerollPrompt(): active
  // axes' candidate pools, their learned+frequency sampling weights, and the
  // min-count-per-axis clamped to what the slot constraints actually allow.
  const buildGenerationArgs = useCallback(() => {
    const axes: Partial<Record<TagCategory, string[]>> = {}
    activeAxisCategories.forEach((cat) => {
      const vals = mergedAxisValues[cat]
      if (vals && vals.length > 0) axes[cat] = vals
    })

    // Per-axis sampling weights combining booru cross-post frequency with
    // whatever this model has learned for the current character/provider
    // context (docs/pack-mode-learning-plan.md §7.5). Built fresh on every
    // call (not memoized) since the model itself is a mutable ref inside
    // usePackLearning, not React state — there's nothing to usefully memoize against.
    const axisWeights: Partial<Record<TagCategory, Record<string, number>>> = {}
    activeAxisCategories.forEach((cat) => {
      const vals = axes[cat]
      if (!vals || vals.length === 0) return
      const countsForCat = axisCounts[cat] || {}
      const valuesWithCounts = vals.map((v) => ({ value: v, count: countsForCat[v] ?? 1 }))
      const weights = learning.weightsFor(learningContextKeys, cat, valuesWithCounts)
      axisWeights[cat] = Object.fromEntries(vals.map((v, i) => [v, weights[i]]))
    })

    // Per-axis counts clamped to what the slot constraints allow (a higher
    // count would only have its extra picks dropped), then raised toward the
    // "Min tags per prompt" target — see axisBudgets/raisedAxisCounts.
    const effectiveAxisMinCounts: Partial<Record<TagCategory, number>> = { ...axisMinCounts, ...raisedAxisCounts }

    return { axes, axisWeights, effectiveAxisMinCounts }
  }, [activeAxisCategories, mergedAxisValues, axisCounts, learning, learningContextKeys, axisMinCounts, raisedAxisCounts])

  const regenerate = useCallback(() => {
    // A pack needs SOME constant tags to build prompts around — either a
    // base (card or pasted prompt), or (no base at all) the free-text
    // customBaseText merged into lockedTags. Only bail when there's neither.
    if (!hasBase && lockedTags.length === 0) {
      setGeneratedPrompts([])
      return
    }
    const { axes, axisWeights, effectiveAxisMinCounts } = buildGenerationArgs()

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
      axisMinCounts: effectiveAxisMinCounts,
      axisWeights,
      count: overGenerateCount,
      maxPrompts: overGenerateCount,
      globalWeights,
      isGlobalWeightsEnabled,
      // Slot whitelist is already applied to the pools (mergedAxisValues),
      // where manual values are deliberately exempt — not passed again here.
      tagOverrides: effectiveOverrides,
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
    const dupFilter = new NearDuplicateFilter(DEFAULT_SIMILARITY_THRESHOLD, lockedTags)
    const cleaned: PackPrompt[] = []
    // Prompts the cleaner shrank below "Min tags per prompt" — only used to
    // top the list up (longest first) if not enough full-size ones survive.
    const short: PackPrompt[] = []
    for (const raw of rawPrompts) {
      if (cleaned.length >= promptCount) break
      const tags = raw.prompt.split(',').map((t) => t.trim()).filter(Boolean)
      const cleanedPrompt = cleanSyntheticPrompt(
        tags,
        characterTags,
        {
          ...cleanOptions,
          tagOverrides: effectiveOverrides,
          globalWeights,
          isGlobalWeightsEnabled,
          lockedTags,
        },
        lockedTags
      )
      const prompt = cleanedPrompt && finalizePackPrompt(cleanedPrompt, alwaysAddTags)
      if (!prompt || seen.has(prompt)) continue
      if (minTotalTags > 0 && countPromptTags(prompt) < minTotalTags) {
        short.push({ prompt, values: raw.values, tagSlots: raw.tagSlots })
        continue
      }
      if (!dupFilter.tryAccept(prompt)) continue
      seen.add(prompt)
      cleaned.push({ prompt, values: raw.values, tagSlots: raw.tagSlots })
    }
    if (cleaned.length < promptCount && short.length > 0) {
      short.sort((a, b) => countPromptTags(b.prompt) - countPromptTags(a.prompt))
      for (const p of short) {
        if (cleaned.length >= promptCount) break
        if (seen.has(p.prompt) || !dupFilter.tryAccept(p.prompt)) continue
        seen.add(p.prompt)
        cleaned.push(p)
      }
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
    hasBase,
    lockedTags,
    activeAxisCategories,
    buildGenerationArgs,
    promptCount,
    minTotalTags,
    globalWeights,
    isGlobalWeightsEnabled,
    effectiveOverrides,
    cleanOptions,
    characterTags,
    learning,
    learningContextKeys,
    axisValueCategory,
    alwaysAddTags,
  ])

  /**
   * Replaces ONE generated prompt (by index) with a fresh candidate that
   * isn't an exact or near-duplicate of the others — §6. Doesn't touch the
   * learning model (re-rolling isn't a negative signal, just "try again").
   * Returns false (leaving that row untouched) if no acceptable candidate
   * was found in this small batch.
   */
  const rerollPrompt = useCallback(
    (index: number): boolean => {
      if (index < 0 || index >= generatedPrompts.length) return false
      const { axes, axisWeights, effectiveAxisMinCounts } = buildGenerationArgs()
      const rawCandidates = generatePackPrompts({
        lockedTags,
        axes,
        axisMinCounts: effectiveAxisMinCounts,
        axisWeights,
        count: 12,
        maxPrompts: 12,
        globalWeights,
        isGlobalWeightsEnabled,
        tagOverrides: effectiveOverrides,
      })
      const others = generatedPrompts.filter((_, i) => i !== index).map((p) => p.prompt)
      const clean = (tags: string[]) => {
        const cleaned = cleanSyntheticPrompt(
          tags,
          characterTags,
          { ...cleanOptions, tagOverrides: effectiveOverrides, globalWeights, isGlobalWeightsEnabled, lockedTags },
          lockedTags
        )
        return cleaned && finalizePackPrompt(cleaned, alwaysAddTags)
      }
      const replacement = pickReplacement(rawCandidates, others, clean, lockedTags)
      if (!replacement) return false
      setGeneratedPrompts((prev) => prev.map((p, i) => (i === index ? replacement : p)))
      return true
    },
    [
      generatedPrompts,
      buildGenerationArgs,
      lockedTags,
      globalWeights,
      isGlobalWeightsEnabled,
      effectiveOverrides,
      characterTags,
      cleanOptions,
      alwaysAddTags,
    ]
  )

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
    setBasePromptRaw('')
    setPromptCharacterTags([])
    setAxisValuesRaw({})
    setAxisCounts({})
    setManualAxisValues({})
    setAxisMinCounts({})
    setAxisTagModes({})
    cachedPostsRef.current = []
    setCustomBaseText('')
    setExcludedBaseTags(new Set())
    setMinTotalTagsRaw(0)
    setLockedCategories(new Set<TagCategory>(['appearance']))
    setLockedSlots(new Set())
    setMutedSlots(new Set())
    setVarietyLevelRaw(DEFAULT_VARIETY_LEVEL)
    setPromptCount(DEFAULT_PROMPT_COUNT)
    setGeneratedPrompts([])
  }, [])

  // Persist the current builder config, debounced (300ms, same idle window as
  // usePersistentState) so rapid edits (slider drags, repeated Add-value
  // clicks) coalesce into one write instead of one per keystroke.
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
    const snapshot: PackModeConfigV2 = {
      lockedCategories: Array.from(lockedCategories),
      lockedSlots: Array.from(lockedSlots),
      mutedSlots: Array.from(mutedSlots),
      varietyLevel,
      axisTagModes,
      axisMinCounts,
      promptCount,
      manualAxisValues,
      minTotalTags,
      minSetTags,
    }
    persistTimerRef.current = setTimeout(() => {
      try {
        userPreferences.setPackModeConfigV2(snapshot)
      } catch {
        // Non-fatal: config persistence is best-effort, same as other
        // localStorage writes in this codebase (see lib/storage.ts's own
        // try/catch around every set()).
      }
    }, 300)
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    }
  }, [lockedCategories, lockedSlots, mutedSlots, varietyLevel, axisMinCounts, promptCount, manualAxisValues, axisTagModes, minTotalTags, minSetTags])

  return {
    isPackMode,
    togglePackMode,
    enablePackMode,
    disablePackMode,

    baseCard,
    setBaseCard,

    basePrompt,
    setBasePrompt,
    hasBase,

    varietyLevel,
    setVarietyLevel,

    lockedCategories,
    toggleLockedCategory,

    lockedSlots,
    toggleLockedSlot,
    mutedSlots,
    toggleMutedSlot,
    axisSlotGroups,
    axisSlotCounts,
    axisMaxPerPrompt,
    effectiveTagOverrides: effectiveOverrides,

    baseClassified,
    hasMultipleCharacters,
    lockedTags,
    activeAxisCategories,

    axisTagModes,
    setAxisTagMode,
    setAllAxisTagModes,

    axisValues: mergedAxisValues,
    addAxisValue,
    removeAxisValue,
    reseedAxis,
    reseedAllAxes,

    axisMinCounts,
    setAxisMinCount,

    customBaseText,
    setCustomBaseText,

    excludedBaseTags,
    toggleExcludedBaseTag,
    restoreExcludedBaseTags,

    categoryStates,
    setCategoryState,
    slotStateOf,
    setSlotState,

    minTotalTags,
    setMinTotalTags,
    estimatedTagsPerPrompt,

    minSetTags,
    setMinSetTags,
    hiddenThinSets,

    promptCount,
    setPromptCount: setPromptCountClamped,

    generatedPrompts,
    regenerate,
    rerollPrompt,

    recordPromptCopied,
    explorationTemperature: learning.explorationTemperature,
    setExplorationTemperature: learning.setExplorationTemperature,
    resetLearning: learning.resetModel,

    clearAll,
  }
}
