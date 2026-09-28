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
 * View-related UI state for the gallery: the persisted card scale and the
 * slider value that mirrors it.
 *
 * `cardScale` (persisted) is the SINGLE SOURCE OF TRUTH. `scaleValue` is a pure
 * projection of it, not independent state, so the two can never disagree.
 *
 * Don't turn `scaleValue` back into its own state synced by effects: two
 * effects syncing in opposite directions leapfrog forever and hit React's
 * update-depth limit (#185).
 */
export function useGalleryViewState() {
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
    cardScale,
    setCardScale,
    scaleValue,
    setScaleValue,
  }
}
