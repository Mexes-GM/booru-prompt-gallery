"use client"

import { usePersistentState } from "@/hooks/use-persistent-state"
import { userPreferences, STORAGE_KEYS } from "@/lib/storage"
import { useToast } from "@/hooks/use-toast"

export function useBlacklist() {
  const [blacklist, setBlacklist] = usePersistentState<string[]>(
    ['guro', 'scat'],
    userPreferences.getBlacklist,
    userPreferences.setBlacklist,
    "blacklist",
    STORAGE_KEYS.BLACKLIST
  )
  const { toast } = useToast()

  const addTag = (tag: string) => {
    const cleanTag = tag.trim().toLowerCase().replace(/\s+/g, '_')
    if (!cleanTag) return

    if (blacklist.includes(cleanTag)) {
      toast({
        title: "Tag already in blacklist",
        description: `"${cleanTag}" is already being filtered.`,
      })
      return
    }

    setBlacklist(prev => [...prev, cleanTag])
    toast({
      title: "Tag added to blacklist",
      description: `Filtering content with "${cleanTag}"`,
    })
  }

  const removeTag = (tag: string) => {
    setBlacklist(prev => prev.filter(t => t !== tag))
    toast({
      title: "Tag removed from blacklist",
      description: `No longer filtering "${tag}"`,
    })
  }

  const resetBlacklist = () => {
    const defaults = ['guro', 'scat']
    setBlacklist(defaults)
    toast({
      title: "Blacklist reset",
      description: "Restored default filters (guro, scat)",
    })
  }

  return {
    blacklist,
    addTag,
    removeTag,
    resetBlacklist
  }
}
