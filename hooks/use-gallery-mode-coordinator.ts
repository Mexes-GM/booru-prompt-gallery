"use client"

import { useCallback, useMemo } from "react"

/**
 * Single source of truth for "which gallery mode turns off which other mode".
 *
 * This hook is the only place that encodes "turn off everything else": every
 * entry point (toolbar, FAB, mini panel) calls into it instead of hand-rolling
 * the exclusion, so they can't drift apart.
 *
 * The five mutually-exclusive "modes" are: Favorites, History, Merge,
 * Variations (Merge's second flavor) and Pack Mode. AI Convert is also
 * exclusive with all of them but is modeled as its own boolean rather than a
 * MODE union because callers toggle it independently of the enum.
 */

export type GalleryMode = "favorites" | "history" | "merge" | "variations" | "pack"

export interface GalleryModeCoordinatorDeps {
  showFavorites: boolean
  toggleShowFavorites: () => void
  showHistory: boolean
  toggleShowHistory: () => void
  isMergeMode: boolean
  mergeModeType: "merge" | "variations"
  enableMergeMode: () => void
  enableVariationMode: () => void
  disableMergeMode: () => void
  isPackMode: boolean
  enablePackMode: () => void
  disablePackMode: () => void
  isAiConvertMode: boolean
  setIsAiConvertMode: (value: boolean) => void
}

export interface GalleryModeCoordinatorResult {
  /** Turn off every mode except the ones passed in `keep`. Idempotent — modes
   *  already off are left alone (no-op setter calls). */
  disableAllExcept: (...keep: GalleryMode[]) => void
  /** Toggle Favorites, turning off every other mode when opening. */
  toggleFavorites: () => void
  /** Toggle History, turning off every other mode when opening. */
  toggleHistory: () => void
  /** Toggle Merge mode ('merge' flavor): turning off every other mode when
   *  entering, and disabling Merge entirely (not switching flavor) when
   *  already active as 'merge'. */
  toggleMerge: () => void
  /** Toggle Variations (Merge's 'variations' flavor), same contract as
   *  toggleMerge but for the other flavor. */
  toggleVariations: () => void
  /** Toggle Pack Mode, turning off every other mode when opening. */
  togglePack: () => void
  /** Toggle AI Convert, turning off every other mode when opening. */
  toggleAiConvert: () => void
}

export function useGalleryModeCoordinator(deps: GalleryModeCoordinatorDeps): GalleryModeCoordinatorResult {
  const {
    showFavorites,
    toggleShowFavorites,
    showHistory,
    toggleShowHistory,
    isMergeMode,
    mergeModeType,
    enableMergeMode,
    enableVariationMode,
    disableMergeMode,
    isPackMode,
    enablePackMode,
    disablePackMode,
    isAiConvertMode,
    setIsAiConvertMode,
  } = deps

  const disableAllExcept = useCallback((...keep: GalleryMode[]) => {
    const keepSet = new Set(keep)
    if (!keepSet.has("favorites") && showFavorites) toggleShowFavorites()
    if (!keepSet.has("history") && showHistory) toggleShowHistory()
    if (!keepSet.has("merge") && !keepSet.has("variations") && isMergeMode) disableMergeMode()
    if (!keepSet.has("pack") && isPackMode) disablePackMode()
    if (isAiConvertMode) setIsAiConvertMode(false)
  }, [
    showFavorites, toggleShowFavorites,
    showHistory, toggleShowHistory,
    isMergeMode, disableMergeMode,
    isPackMode, disablePackMode,
    isAiConvertMode, setIsAiConvertMode,
  ])

  const toggleFavorites = useCallback(() => {
    if (showFavorites) {
      toggleShowFavorites()
      return
    }
    disableAllExcept("favorites")
    toggleShowFavorites()
  }, [showFavorites, toggleShowFavorites, disableAllExcept])

  const toggleHistory = useCallback(() => {
    if (showHistory) {
      toggleShowHistory()
      return
    }
    disableAllExcept("history")
    toggleShowHistory()
  }, [showHistory, toggleShowHistory, disableAllExcept])

  const toggleMerge = useCallback(() => {
    if (isMergeMode && mergeModeType === "merge") {
      disableMergeMode()
      return
    }
    disableAllExcept("merge")
    enableMergeMode()
  }, [isMergeMode, mergeModeType, disableMergeMode, disableAllExcept, enableMergeMode])

  const toggleVariations = useCallback(() => {
    if (isMergeMode && mergeModeType === "variations") {
      disableMergeMode()
      return
    }
    disableAllExcept("variations")
    enableVariationMode()
  }, [isMergeMode, mergeModeType, disableMergeMode, disableAllExcept, enableVariationMode])

  const togglePack = useCallback(() => {
    if (isPackMode) {
      disablePackMode()
      return
    }
    disableAllExcept("pack")
    enablePackMode()
  }, [isPackMode, disablePackMode, disableAllExcept, enablePackMode])

  const toggleAiConvert = useCallback(() => {
    if (isAiConvertMode) {
      setIsAiConvertMode(false)
      return
    }
    disableAllExcept()
    setIsAiConvertMode(true)
  }, [isAiConvertMode, setIsAiConvertMode, disableAllExcept])

  return useMemo(() => ({
    disableAllExcept,
    toggleFavorites,
    toggleHistory,
    toggleMerge,
    toggleVariations,
    togglePack,
    toggleAiConvert,
  }), [disableAllExcept, toggleFavorites, toggleHistory, toggleMerge, toggleVariations, togglePack, toggleAiConvert])
}
