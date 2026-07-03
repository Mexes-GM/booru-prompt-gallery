"use client"

import { useCallback, useState } from "react"
import { usePersistentState } from "@/hooks/use-persistent-state"
import { userPreferences, STORAGE_KEYS } from "@/lib/storage"
import type { useToast } from "@/hooks/use-toast"

type ToastFn = ReturnType<typeof useToast>["toast"]

/**
 * Global tag weight settings: the weight map itself (synced across tabs/the
 * extension via localStorage), the enabled toggle, the modal open state, and
 * the handlers to change/clear/remove individual weights. `toast` is injected
 * by the caller so this hook doesn't depend on where `useToast` is mounted.
 */
export function useGlobalWeights(toast: ToastFn) {
  const [globalWeights, setGlobalWeights] = usePersistentState<Record<string, number>>(
    {},
    userPreferences.getGlobalWeights,
    userPreferences.setGlobalWeights,
    "globalWeights",
    STORAGE_KEYS.GLOBAL_WEIGHTS
  )

  const [isGlobalWeightsEnabled, setIsGlobalWeightsEnabled] = usePersistentState(
    false,
    userPreferences.getGlobalWeightsEnabled,
    userPreferences.setGlobalWeightsEnabled,
    "globalWeightsEnabled",
    STORAGE_KEYS.GLOBAL_WEIGHTS_ENABLED
  )

  const [isGlobalWeightsModalOpen, setIsGlobalWeightsModalOpen] = useState(false)

  const handleGlobalWeightChange = useCallback((tag: string, weight: number) => {
    setGlobalWeights(prev => {
      const next = { ...prev }
      // We store lowercase keys for consistency
      const key = tag.toLowerCase()
      // We no longer auto-delete at 1.0, so the user can manage the tag in the list
      // Explicit removal is handled by handleRemoveGlobalWeight
      next[key] = weight
      return next
    })
  }, [setGlobalWeights])

  const handleClearGlobalWeights = useCallback(() => {
    setGlobalWeights({})
    setIsGlobalWeightsModalOpen(false)
    toast({ title: "Weights cleared", description: "All global tag weights have been reset." })
  }, [toast, setGlobalWeights])

  const handleRemoveGlobalWeight = useCallback((tag: string) => {
    setGlobalWeights(prev => {
      const next = { ...prev }
      delete next[tag] // tag from modal is already key
      return next
    })
  }, [setGlobalWeights])

  const toggleGlobalWeights = (enabled: boolean) => {
    setIsGlobalWeightsEnabled(enabled)
  }

  return {
    globalWeights,
    setGlobalWeights,
    isGlobalWeightsEnabled,
    setIsGlobalWeightsEnabled,
    isGlobalWeightsModalOpen,
    setIsGlobalWeightsModalOpen,
    handleGlobalWeightChange,
    handleClearGlobalWeights,
    handleRemoveGlobalWeight,
    toggleGlobalWeights,
  }
}
