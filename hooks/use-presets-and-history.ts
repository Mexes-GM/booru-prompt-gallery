"use client"

import { useEffect, useMemo, useState } from "react"
import { userPreferences, STORAGE_KEYS, type HistoryItem, type TagPreset } from "@/lib/storage"
import { onSettingsChange } from "@/lib/settings-bridge"
import type { useToast } from "@/hooks/use-toast"

type ToastFn = ReturnType<typeof useToast>["toast"]

interface UsePresetsAndHistoryArgs {
  isClient: boolean
  addInput: string
  setAddInput: (value: string) => void
  toast: ToastFn
}

/**
 * "Tags to add" presets and the copy history: loads both from storage once the
 * client has mounted, keeps them in sync across tabs/the extension via
 * `onSettingsChange`, and exposes the save/load/delete preset handlers plus the
 * derived `previouslyCopiedPostIds` set. The preset dialog's open/name state is
 * also owned here since it's only ever used alongside `savePreset`.
 */
export function usePresetsAndHistory({ isClient, addInput, setAddInput, toast }: UsePresetsAndHistoryArgs) {
  const [presets, setPresets] = useState<TagPreset[]>([])
  const [isPresetDialogOpen, setIsPresetDialogOpen] = useState(false)
  const [presetName, setPresetName] = useState("")
  const [history, setHistory] = useState<HistoryItem[]>([])

  const previouslyCopiedPostIds = useMemo(() => {
    return new Set(history.map(item => item.postId).filter((id): id is number => id !== undefined))
  }, [history])

  useEffect(() => {
    if (isClient) {
      setPresets(userPreferences.getAddTagsPresets())
    }
  }, [isClient])

  useEffect(() => {
    if (isClient) {
      setHistory(userPreferences.getHistory())
      // Logic for old storage keys or manual loading removed - now handled by usePersistentState
    }
  }, [isClient])

  // Listen for preset/history changes from extension/other tabs via BroadcastChannel
  useEffect(() => {
    return onSettingsChange((key) => {
      if (key === STORAGE_KEYS.ADD_TAGS_PRESETS) {
        setPresets(userPreferences.getAddTagsPresets())
      } else if (key === STORAGE_KEYS.HISTORY) {
        setHistory(userPreferences.getHistory())
      }
    })
  }, [])

  // --- Preset Handlers ---
  const savePreset = () => {
    if (!presetName.trim() || !addInput.trim()) return
    const newPresets = userPreferences.addAddTagsPreset({ name: presetName, content: addInput })
    setPresets(newPresets)
    setPresetName("")
    setIsPresetDialogOpen(false)
    toast({ title: "Preset saved", description: "Your tags preset has been saved successfully." })
  }

  const loadPreset = (preset: TagPreset) => {
    setAddInput(preset.content)
    toast({ title: "Preset loaded", description: `Loaded preset: ${preset.name}` })
  }

  const deletePreset = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const newPresets = userPreferences.removeAddTagsPreset(id)
    setPresets(newPresets)
    toast({ title: "Preset deleted", description: "Preset removed successfully." })
  }

  // --- History Handlers ---
  const addToHistory = (item: Omit<HistoryItem, 'id' | 'timestamp'>) => {
    userPreferences.addToHistory(item)
    setHistory(userPreferences.getHistory())
  }

  const removeHistoryItem = (id: string) => {
    userPreferences.removeFromHistory(id)
    setHistory(userPreferences.getHistory())
  }

  const clearHistory = () => {
    userPreferences.clearHistory()
    setHistory([])
  }

  return {
    presets,
    setPresets,
    history,
    setHistory,
    previouslyCopiedPostIds,
    isPresetDialogOpen,
    setIsPresetDialogOpen,
    presetName,
    setPresetName,
    savePreset,
    loadPreset,
    deletePreset,
    addToHistory,
    removeHistoryItem,
    clearHistory,
  }
}
