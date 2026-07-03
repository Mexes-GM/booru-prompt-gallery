"use client"

import { useDeferredValue } from "react"
import { usePersistentState } from "@/hooks/use-persistent-state"
import { useDebounce } from "@/hooks/use-debounce"
import { useDetailedBackgrounds } from "@/hooks/use-detailed-backgrounds"
import { userPreferences, STORAGE_KEYS } from "@/lib/storage"
import { type BackgroundMode } from "@/lib/background-detector"

/**
 * All background-replacement settings for the gallery: the mode (keep / remove /
 * simple random / detailed random / replace), the custom replacement tags, and
 * the random-background toggles. The heavy detailed-backgrounds dataset is only
 * fetched when the "Detailed Random" mode is active. `deferredBackgroundMode`
 * and the debounced replacement tags keep re-derivation of prompts cheap.
 */
export function useBackgroundSettings() {
  const [backgroundMode, setBackgroundMode] = usePersistentState<BackgroundMode>(
    "keep",
    userPreferences.getBackgroundMode,
    userPreferences.setBackgroundMode,
    "backgroundMode",
    STORAGE_KEYS.BACKGROUND_MODE
  )
  const deferredBackgroundMode = useDeferredValue(backgroundMode)

  // Lazy-load the detailed-backgrounds.json scenery dataset only when the user
  // actually selects "Detailed Random" (its only consumer).
  const detailedBackgroundsList = useDetailedBackgrounds(backgroundMode === "detailed_random")

  const [simpleBackgroundReplacementTags, setSimpleBackgroundReplacementTags] = usePersistentState(
    "simple background, white background",
    userPreferences.getSimpleBackgroundReplacementTags,
    userPreferences.setSimpleBackgroundReplacementTags,
    "simpleBackgroundReplacementTags",
    STORAGE_KEYS.SIMPLE_BACKGROUND_REPLACEMENT_TAGS
  )
  const debouncedSimpleBackgroundReplacementTags = useDebounce(simpleBackgroundReplacementTags, 500)

  const [randomBackgroundPatterns, setRandomBackgroundPatterns] = usePersistentState(
    true,
    userPreferences.getRandomBackgroundPatterns,
    userPreferences.setRandomBackgroundPatterns,
    "randomBackgroundPatterns",
    STORAGE_KEYS.RANDOM_BACKGROUND_PATTERNS
  )

  const [randomBackgroundIncludeGradients, setRandomBackgroundIncludeGradients] = usePersistentState(
    true,
    userPreferences.getRandomBackgroundIncludeGradients,
    userPreferences.setRandomBackgroundIncludeGradients,
    "randomBackgroundIncludeGradients",
    STORAGE_KEYS.RANDOM_BACKGROUND_INCLUDE_GRADIENTS
  )

  return {
    backgroundMode,
    setBackgroundMode,
    deferredBackgroundMode,
    detailedBackgroundsList,
    simpleBackgroundReplacementTags,
    setSimpleBackgroundReplacementTags,
    debouncedSimpleBackgroundReplacementTags,
    randomBackgroundPatterns,
    setRandomBackgroundPatterns,
    randomBackgroundIncludeGradients,
    setRandomBackgroundIncludeGradients,
  }
}
