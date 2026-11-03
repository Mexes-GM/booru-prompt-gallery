"use client"

import { useCallback, useEffect, useState } from "react"
import { usePersistentState } from "@/hooks/use-persistent-state"
import { userPreferences, STORAGE_KEYS } from "@/lib/storage"
import { ToastAction } from "@/components/ui/toast"
import type { useToast } from "@/hooks/use-toast"

type ToastFn = ReturnType<typeof useToast>["toast"]

/**
 * Global tag weights: the weight map itself (synced across tabs/the extension
 * via localStorage), whether they're applied, the modal open state, and the
 * handlers to change/clear/remove individual weights. `toast` is injected by
 * the caller so this hook doesn't depend on where `useToast` is mounted.
 *
 * Weights apply whenever they exist. "Enabled" only means "not paused": the
 * stored flag defaults to true, and an explicit false (left by the old master
 * switch, or set from the weights modal) keeps saved weights inert until the
 * user resumes them. A pause with no weights left is meaningless, so it's
 * dropped — the next weight the user creates applies right away.
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
    true,
    userPreferences.getGlobalWeightsEnabled,
    userPreferences.setGlobalWeightsEnabled,
    "globalWeightsEnabled",
    STORAGE_KEYS.GLOBAL_WEIGHTS_ENABLED
  )

  const globalWeightCount = Object.keys(globalWeights).length
  const isGlobalWeightsPaused = !isGlobalWeightsEnabled && globalWeightCount > 0

  useEffect(() => {
    if (!isGlobalWeightsEnabled && globalWeightCount === 0) setIsGlobalWeightsEnabled(true)
  }, [isGlobalWeightsEnabled, globalWeightCount, setIsGlobalWeightsEnabled])

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

  // Undoable from the toast: the list can hold many hand-tuned weights.
  const handleClearGlobalWeights = useCallback(() => {
    const snapshot = { weights: globalWeights, enabled: isGlobalWeightsEnabled }
    setGlobalWeights({})
    toast({
      title: "Tag weights cleared",
      action: (
        <ToastAction
          altText="Undo clearing tag weights"
          onClick={() => {
            setGlobalWeights(snapshot.weights)
            setIsGlobalWeightsEnabled(snapshot.enabled)
          }}
        >
          Undo
        </ToastAction>
      ),
    })
  }, [toast, globalWeights, isGlobalWeightsEnabled, setGlobalWeights, setIsGlobalWeightsEnabled])

  const handleRemoveGlobalWeight = useCallback((tag: string) => {
    setGlobalWeights(prev => {
      const next = { ...prev }
      delete next[tag] // tag from modal is already key
      return next
    })
  }, [setGlobalWeights])

  const toggleGlobalWeights = useCallback((enabled: boolean) => {
    setIsGlobalWeightsEnabled(enabled)
  }, [setIsGlobalWeightsEnabled])

  return {
    globalWeights,
    setGlobalWeights,
    globalWeightCount,
    isGlobalWeightsEnabled,
    setIsGlobalWeightsEnabled,
    isGlobalWeightsPaused,
    isGlobalWeightsModalOpen,
    setIsGlobalWeightsModalOpen,
    handleGlobalWeightChange,
    handleClearGlobalWeights,
    handleRemoveGlobalWeight,
    toggleGlobalWeights,
  }
}
