"use client"

import { usePersistentState } from "@/hooks/use-persistent-state"
import { userPreferences, STORAGE_KEYS } from "@/lib/storage"

/**
 * Prompt generation options (include characters, smart tag combination, smart
 * tag exclusion), persisted and synced via `userPreferences`. Exposes the raw
 * object plus individual boolean values and per-field setters so callers don't
 * have to spread the object manually.
 */
export function usePromptOptions() {
  const [promptOptions, setPromptOptions] = usePersistentState(
    { includeCharacters: true, optimizeTags: true, smartTagExclusion: true, prependAnimaArtist: false, autoAppendSearchTags: true },
    userPreferences.getPromptOptions,
    userPreferences.setPromptOptions,
    "promptOptions",
    STORAGE_KEYS.PROMPT_OPTIONS
  )

  const { includeCharacters, optimizeTags, smartTagExclusion = true, prependAnimaArtist = false, autoAppendSearchTags = true, experimentalPromptRules = false, fillMissingTags = true } = promptOptions

  const setIncludeCharacters = (val: boolean) =>
    setPromptOptions(prev => ({ ...prev, includeCharacters: val }))

  const setOptimizeTags = (val: boolean) =>
    setPromptOptions(prev => ({ ...prev, optimizeTags: val }))

  const setSmartTagExclusion = (val: boolean) =>
    setPromptOptions(prev => ({ ...prev, smartTagExclusion: val }))

  const setPrependAnimaArtist = (val: boolean) =>
    setPromptOptions(prev => ({ ...prev, prependAnimaArtist: val }))

  const setAutoAppendSearchTags = (val: boolean) =>
    setPromptOptions(prev => ({ ...prev, autoAppendSearchTags: val }))

  const setExperimentalPromptRules = (val: boolean) =>
    setPromptOptions(prev => ({ ...prev, experimentalPromptRules: val }))

  const setFillMissingTags = (val: boolean) =>
    setPromptOptions(prev => ({ ...prev, fillMissingTags: val }))

  return {
    promptOptions,
    setPromptOptions,
    includeCharacters,
    optimizeTags,
    smartTagExclusion,
    prependAnimaArtist,
    autoAppendSearchTags,
    experimentalPromptRules,
    fillMissingTags,
    setIncludeCharacters,
    setOptimizeTags,
    setSmartTagExclusion,
    setPrependAnimaArtist,
    setAutoAppendSearchTags,
    setExperimentalPromptRules,
    setFillMissingTags,
  }
}
