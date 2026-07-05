"use client"

import { useCallback, useMemo } from "react"
import { usePersistentState } from "@/hooks/use-persistent-state"
import { userPreferences, STORAGE_KEYS } from "@/lib/storage"
import { trackScaleChange } from "@/lib/analytics"

export type CardScale = "small" | "medium" | "large"

const scaleToSlider = (scale: CardScale): number =>
  scale === "small" ? 1 : scale === "large" ? 3 : 2

const sliderToScale = (value: number): CardScale =>
  value <= 1 ? "small" : value >= 3 ? "large" : "medium"

/**
 * View-related UI state for the gallery: grid/list mode, the persisted card
 * scale, and the slider value that mirrors the scale.
 *
 * `cardScale` (persisted) is the SINGLE SOURCE OF TRUTH. `scaleValue` is a pure
 * projection of it, not independent state, so the two can never disagree.
 *
 * History: a previous implementation kept `scaleValue` as its own `useState([2])`
 * and synced it against `cardScale` with TWO effects running in opposite
 * directions (scaleValue -> cardScale in prompt-gallery.tsx, cardScale ->
 * scaleValue here). When the persisted `cardScale` didn't match the hardcoded
 * slider seed `[2]` (i.e. any user whose saved scale was "small" or "large"),
 * the two effects leapfrogged forever — each read the other's stale value and
 * wrote the opposite — producing an infinite render loop that eventually tripped
 * React's update-depth limit (#185) inside an unrelated Radix Popper ref.
 * See docs/SENTRY-FULVOUS-ANCHOR-11-render-loop.md.
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

  // Slider value is derived from cardScale — always consistent, never a
  // separate source of state that could drift out of sync.
  const scaleValue = useMemo<number[]>(() => [scaleToSlider(cardScale)], [cardScale])

  // Slider changes write straight to the source of truth (cardScale). No effect
  // reflects this back onto scaleValue, so no ping-pong is possible.
  const setScaleValue = useCallback(
    (value: number[]) => {
      const next = sliderToScale(value[0])
      if (next !== cardScale) {
        trackScaleChange(next)
        setCardScale(next)
      }
    },
    [cardScale, setCardScale]
  )

  return {
    viewMode,
    setViewMode,
    cardScale,
    setCardScale,
    scaleValue,
    setScaleValue,
  }
}
