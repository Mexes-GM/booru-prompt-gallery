"use client"

import { useCallback, useMemo } from "react"
import { usePersistentState } from "@/hooks/use-persistent-state"
import { usePromptOptions } from "@/hooks/use-prompt-options"
import { useGlobalWeights } from "@/hooks/use-global-weights"
import { useOutfitSettings } from "@/hooks/use-outfit-settings"
import { useDebounce } from "@/hooks/use-debounce"
import { useStableCallback } from "@/hooks/use-stable-callback"
import { toast } from "@/hooks/use-toast"
import { STORAGE_KEYS, userPreferences } from "@/lib/storage"
import { MAX_MAX_LONG_SIDE, clampMaxLongSide } from "@/lib/extension/generation-resolution"
import type { TagAppendRule } from "@/lib/cleanPrompt"
import type { BulkSendCleanOptions } from "@/lib/pack/bulk-send"
import type { OutfitDetail, OutfitStyle } from "@/lib/outfit-swap"

/** Typed text waits this long before the prompts follow it, as on the gallery's cards. */
const TEXT_DELAY_MS = 500

export type PackCleanOptions = Pick<
  BulkSendCleanOptions,
  "excludeInput" | "addInput" | "findInput" | "replaceInput" | "includeCharacters" | "optimizeTags" | "smartTagExclusion" | "experimentalPromptRules"
>

/** The app's prompt settings the pack applies, with their setters (the same settings as the gallery's). */
export interface PackPromptSettings {
  addInput: string
  setAddInput: (value: string) => void
  excludeInput: string
  setExcludeInput: (value: string) => void
  findInput: string
  setFindInput: (value: string) => void
  replaceInput: string
  setReplaceInput: (value: string) => void
  /** Not applied by the pack: kept so its editor never drops them. */
  tagAppendRules: TagAppendRule[]
  setTagAppendRules: (rules: TagAppendRule[]) => void
  includeCharacters: boolean
  setIncludeCharacters: (value: boolean) => void
  smartTagExclusion: boolean
  setSmartTagExclusion: (value: boolean) => void
  experimentalPromptRules: boolean
  setExperimentalPromptRules: (value: boolean) => void
  globalWeights: Record<string, number>
  isGlobalWeightsEnabled: boolean
  setIsGlobalWeightsEnabled: (value: boolean) => void
  globalWeightCount: number
  isGlobalWeightsPaused: boolean
  onGlobalWeightChange: (tag: string, weight: number) => void
  onRemoveGlobalWeight: (tag: string) => void
  onClearGlobalWeights: () => void
  outfitStyles: readonly OutfitStyle[]
  setOutfitStyles: (styles: OutfitStyle[]) => void
  outfitDetail: OutfitDetail
  setOutfitDetail: (detail: OutfitDetail) => void
  /** Longest side of the sizes suggested for each prompt, 512 to 1536. */
  maxLongSide: number
  setMaxLongSide: (value: number) => void
}

export interface UsePackPromptSettingsResult {
  settings: PackPromptSettings
  /** What the engine cleans each prompt with: typed text settles first. */
  cleanOptions: PackCleanOptions
  globalWeights: Record<string, number>
  isGlobalWeightsEnabled: boolean
  outfitOptions: { styles: readonly OutfitStyle[]; detail: OutfitDetail }
}

/**
 * The gallery's prompt settings as the pack builder reads and edits them: the same stored settings
 * through the same hooks, so a change here is a change there (each copy hears the other's writes),
 * and the gallery never passes them in.
 */
export function usePackPromptSettings(): UsePackPromptSettingsResult {
  const [addInput, setAddInput] = usePersistentState("", userPreferences.getAddTagsInput, userPreferences.setAddTagsInput, "addTags", STORAGE_KEYS.ADD_TAGS)
  const [excludeInput, setExcludeInput] = usePersistentState("", userPreferences.getExcludeTagsInput, userPreferences.setExcludeTagsInput, "excludeTags", STORAGE_KEYS.EXCLUDE_TAGS)
  const [findInput, setFindInput] = usePersistentState("", userPreferences.getFindReplaceFindInput, userPreferences.setFindReplaceFindInput, "findReplaceFind", STORAGE_KEYS.FIND_REPLACE_FIND)
  const [replaceInput, setReplaceInput] = usePersistentState("", userPreferences.getFindReplaceReplaceInput, userPreferences.setFindReplaceReplaceInput, "findReplaceReplace", STORAGE_KEYS.FIND_REPLACE_REPLACE)
  const [tagAppendRules, setTagAppendRules] = usePersistentState<TagAppendRule[]>([], userPreferences.getTagAppendRules, userPreferences.setTagAppendRules, "tagAppendRules", STORAGE_KEYS.TAG_APPEND_RULES)
  const [storedMaxLongSide, setStoredMaxLongSide] = usePersistentState(
    MAX_MAX_LONG_SIDE, userPreferences.getMatchResolutionMaxLongSide, userPreferences.setMatchResolutionMaxLongSide,
    "matchResolutionMaxLongSide", STORAGE_KEYS.MATCH_RESOLUTION_MAX_LONG_SIDE
  )
  const { promptOptions, setPromptOptions } = usePromptOptions()
  const { includeCharacters, optimizeTags } = promptOptions
  const smartTagExclusion = promptOptions.smartTagExclusion ?? true
  const experimentalPromptRules = promptOptions.experimentalPromptRules ?? false
  const weights = useGlobalWeights(toast)
  const outfit = useOutfitSettings()

  const setIncludeCharacters = useCallback((value: boolean) => setPromptOptions((prev) => ({ ...prev, includeCharacters: value })), [setPromptOptions])
  const setSmartTagExclusion = useCallback((value: boolean) => setPromptOptions((prev) => ({ ...prev, smartTagExclusion: value })), [setPromptOptions])
  const setExperimentalPromptRules = useCallback((value: boolean) => setPromptOptions((prev) => ({ ...prev, experimentalPromptRules: value })), [setPromptOptions])
  const setMaxLongSide = useCallback((value: number) => setStoredMaxLongSide(clampMaxLongSide(value)), [setStoredMaxLongSide])
  const setOutfitStyles = useStableCallback(outfit.setOutfitStyles)
  const { outfitStyles, outfitDetail, setOutfitDetail } = outfit
  // Values saved before the 512–1536 limit (e.g. 2048) read as the nearest allowed one.
  const maxLongSide = clampMaxLongSide(storedMaxLongSide)

  const settings = useMemo<PackPromptSettings>(() => ({
    addInput, setAddInput, excludeInput, setExcludeInput, findInput, setFindInput, replaceInput, setReplaceInput,
    tagAppendRules, setTagAppendRules,
    includeCharacters, setIncludeCharacters, smartTagExclusion, setSmartTagExclusion, experimentalPromptRules, setExperimentalPromptRules,
    globalWeights: weights.globalWeights,
    isGlobalWeightsEnabled: weights.isGlobalWeightsEnabled,
    setIsGlobalWeightsEnabled: weights.setIsGlobalWeightsEnabled,
    globalWeightCount: weights.globalWeightCount,
    isGlobalWeightsPaused: weights.isGlobalWeightsPaused,
    onGlobalWeightChange: weights.handleGlobalWeightChange,
    onRemoveGlobalWeight: weights.handleRemoveGlobalWeight,
    onClearGlobalWeights: weights.handleClearGlobalWeights,
    outfitStyles, setOutfitStyles, outfitDetail, setOutfitDetail,
    maxLongSide, setMaxLongSide,
  }), [
    addInput, setAddInput, excludeInput, setExcludeInput, findInput, setFindInput, replaceInput, setReplaceInput, tagAppendRules, setTagAppendRules,
    includeCharacters, setIncludeCharacters, smartTagExclusion, setSmartTagExclusion, experimentalPromptRules, setExperimentalPromptRules,
    weights.globalWeights, weights.isGlobalWeightsEnabled, weights.setIsGlobalWeightsEnabled, weights.globalWeightCount, weights.isGlobalWeightsPaused,
    weights.handleGlobalWeightChange, weights.handleRemoveGlobalWeight, weights.handleClearGlobalWeights,
    outfitStyles, setOutfitStyles, outfitDetail, setOutfitDetail, maxLongSide, setMaxLongSide,
  ])

  const debouncedAdd = useDebounce(addInput, TEXT_DELAY_MS)
  const debouncedExclude = useDebounce(excludeInput, TEXT_DELAY_MS)
  const debouncedFind = useDebounce(findInput, TEXT_DELAY_MS)
  const debouncedReplace = useDebounce(replaceInput, TEXT_DELAY_MS)
  const cleanOptions = useMemo<PackCleanOptions>(() => ({
    excludeInput: debouncedExclude,
    addInput: debouncedAdd,
    findInput: debouncedFind,
    replaceInput: debouncedReplace,
    includeCharacters,
    optimizeTags,
    smartTagExclusion,
    experimentalPromptRules,
  }), [debouncedExclude, debouncedAdd, debouncedFind, debouncedReplace, includeCharacters, optimizeTags, smartTagExclusion, experimentalPromptRules])
  const outfitOptions = useMemo(() => ({ styles: outfitStyles, detail: outfitDetail }), [outfitStyles, outfitDetail])

  return { settings, cleanOptions, globalWeights: weights.globalWeights, isGlobalWeightsEnabled: weights.isGlobalWeightsEnabled, outfitOptions }
}
