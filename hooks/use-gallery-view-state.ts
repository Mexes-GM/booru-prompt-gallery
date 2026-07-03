"use client"

import { useState, useEffect } from "react"
import { usePersistentState } from "@/hooks/use-persistent-state"
import { userPreferences, STORAGE_KEYS } from "@/lib/storage"

export type CardScale = "small" | "medium" | "large"

/**
 * View-related UI state for the gallery: grid/list mode, the persisted card
 * scale, and the slider value that mirrors the scale. Keeps the slider in sync
 * whenever the persisted scale changes (e.g. loaded from storage).
 */
export function useGalleryViewState() {
  const [viewMode, setViewMode] = usePersistentState<"grid" | "list">(
    "grid",
    userPreferences.getViewMode,
    userPreferences.setViewMode,
    "viewMode",
    STORAGE_KEYS.VIEW_MODE
  )

  const [cardScale, setCardScale] = usePersistentState<CardScale>(
    "medium",
    userPreferences.getCardScale,
    userPreferences.setCardScale,
    "cardScale",
    STORAGE_KEYS.CARD_SCALE
  )

  // Slider state needs to stay in sync with persisted cardScale
  const [scaleValue, setScaleValue] = useState([2])

  // Sync slider when cardScale changes (e.g. loaded from storage)
  useEffect(() => {
    if (cardScale === "small") setScaleValue([1])
    else if (cardScale === "medium") setScaleValue([2])
    else if (cardScale === "large") setScaleValue([3])
  }, [cardScale])

  return {
    viewMode,
    setViewMode,
    cardScale,
    setCardScale,
    scaleValue,
    setScaleValue,
  }
}
