"use client"

import { useState, useEffect } from "react"
import { userPreferences } from "@/lib/storage"
import { useToast } from "@/hooks/use-toast"

export function useBlacklist() {
  const [blacklist, setBlacklist] = useState<string[]>([])
  const { toast } = useToast()

  // Load from storage on mount
  useEffect(() => {
    setBlacklist(userPreferences.getBlacklist())
  }, [])

  const addTag = (tag: string) => {
    const cleanTag = tag.trim().toLowerCase()
    if (!cleanTag) return

    if (blacklist.includes(cleanTag)) {
      toast({
        title: "Tag already in blacklist",
        description: `"${cleanTag}" is already being filtered.`,
      })
      return
    }

    const updated = userPreferences.addBlacklistTag(cleanTag)
    setBlacklist(updated)
    toast({
      title: "Tag added to blacklist",
      description: `Filtering content with "${cleanTag}"`,
    })
  }

  const removeTag = (tag: string) => {
    const updated = userPreferences.removeBlacklistTag(tag)
    setBlacklist(updated)
    toast({
      title: "Tag removed from blacklist",
      description: `No longer filtering "${tag}"`,
    })
  }

  const resetBlacklist = () => {
    const defaults = ['guro', 'scat']
    userPreferences.setBlacklist(defaults)
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
