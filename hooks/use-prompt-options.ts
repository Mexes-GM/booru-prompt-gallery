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
    { includeCharacters: true, optimizeTags: true, smartTagExclusion: true, prependAnimaArtist: false },
    userPreferences.getPromptOptions,
    userPreferences.setPromptOptions,
    "promptOptions",
    STORAGE_KEYS.PROMPT_OPTIONS
  )

  const { includeCharacters, optimizeTags, smartTagExclusion = true, prependAnimaArtist = false } = promptOptions

  const setIncludeCharacters = (val: boolean) =>
    setPromptOptions(prev => ({ ...prev, includeCharacters: val }))

  const setOptimizeTags = (val: boolean) =>
    setPromptOptions(prev => ({ ...prev, optimizeTags: val }))

  const setSmartTagExclusion = (val: boolean) =>
    setPromptOptions(prev => ({ ...prev, smartTagExclusion: val }))

  const setPrependAnimaArtist = (val: boolean) =>
    setPromptOptions(prev => ({ ...prev, prependAnimaArtist: val }))

  return {
    promptOptions,
    setPromptOptions,
    includeCharacters,
    optimizeTags,
    smartTagExclusion,
    prependAnimaArtist,
    setIncludeCharacters,
    setOptimizeTags,
    setSmartTagExclusion,
    setPrependAnimaArtist,
  }
}
