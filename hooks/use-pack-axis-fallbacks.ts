import { useEffect, useRef, useState } from "react"
import type { TagCategory } from "@/lib/tag-classifier"

export type PackAxisFallbacks = Partial<Record<TagCategory, string[]>>

/**
 * Loads the `/pack-axis-fallbacks.json` curated dataset used by Pack Mode to
 * top up an axis's value pool when sampling from the currently loaded booru
 * results is too sparse (e.g. a niche search with only 1-2 posts). Mirrors
 * the lazy-fetch-once pattern from useDetailedBackgrounds: fetched only when
 * `enabled` (Pack Mode is active) and only once per mount.
 */
export function usePackAxisFallbacks(enabled: boolean): PackAxisFallbacks {
  const [fallbacks, setFallbacks] = useState<PackAxisFallbacks>({})
  const loadedRef = useRef(false)

  useEffect(() => {
    if (!enabled || loadedRef.current) return
    loadedRef.current = true

    const controller = new AbortController()
    fetch("/pack-axis-fallbacks.json", { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => {
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          throw new Error("Invalid pack-axis-fallbacks.json format")
        }
        const next: PackAxisFallbacks = {}
        for (const [key, value] of Object.entries(data)) {
          if (Array.isArray(value)) next[key as TagCategory] = value as string[]
        }
        setFallbacks(next)
      })
      .catch((err) => {
        if (err?.name !== "AbortError") {
          loadedRef.current = false // allow retry after a failure
          console.error("Failed to load pack axis fallbacks:", err)
        }
      })

    return () => controller.abort()
  }, [enabled])

  return fallbacks
}
