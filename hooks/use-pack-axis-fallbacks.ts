import { useEffect, useMemo, useRef, useState } from "react"
import type { TagCategory } from "@/lib/tag-classifier"
import { PACK_AXES, slotsOf } from "@/lib/tag-taxonomy"
import type { PackRatingMode } from "@/hooks/use-pack-seed-search"

export type PackAxisFallbacks = Partial<Record<TagCategory, string[]>>

/** [tag, post_count, nsfw flag] — see scripts/generate-pack-vocabulary.ts. */
type VocabularyEntry = [string, number, 0 | 1]
type Vocabulary = Record<string, VocabularyEntry[]>

/** Slots never used to top up an SFW pack, whatever each tag's own flag says. */
const SFW_EXCLUDED_SLOTS = new Set(["clothing:underwear", "pose:physiological"])
/** Fallback candidates offered per category (withAxisFallback adds at most 20 of them). */
const FALLBACKS_PER_CATEGORY = 60

/**
 * Pack Mode's safety net for sparse pools (a niche search with a handful of
 * posts): the most-used approved tags of each slot, from
 * `/pack-vocabulary.json` (built from the tags database by
 * scripts/generate-pack-vocabulary.ts). Fetched once, only while Pack Mode
 * is on. Slots are interleaved so a topped-up pool spans subcategories
 * instead of being all hair colours; SFW sources skip flagged tags and the
 * explicit-prone slots.
 */
export function usePackAxisFallbacks(enabled: boolean, ratingMode: PackRatingMode): PackAxisFallbacks {
  const [vocabulary, setVocabulary] = useState<Vocabulary | null>(null)
  const loadedRef = useRef(false)

  useEffect(() => {
    if (!enabled || loadedRef.current) return
    loadedRef.current = true

    const controller = new AbortController()
    fetch("/pack-vocabulary.json", { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => {
        if (!data || typeof data.slots !== "object" || data.slots === null) {
          throw new Error("Invalid pack-vocabulary.json format")
        }
        setVocabulary(data.slots as Vocabulary)
      })
      .catch((err) => {
        if (err?.name !== "AbortError") {
          loadedRef.current = false // allow retry after a failure
          console.error("Failed to load pack vocabulary:", err)
        }
      })

    return () => controller.abort()
  }, [enabled])

  return useMemo(() => {
    if (!vocabulary) return {}
    const sfw = ratingMode === "sfw"
    const out: PackAxisFallbacks = {}
    PACK_AXES.forEach((cat) => {
      const lists = slotsOf(cat)
        .filter((slot) => !(sfw && SFW_EXCLUDED_SLOTS.has(slot)))
        .map((slot) => (vocabulary[slot] ?? []).filter((entry) => !(sfw && entry[2] === 1)))
      const picked: string[] = []
      for (let i = 0; picked.length < FALLBACKS_PER_CATEGORY; i++) {
        let any = false
        for (const list of lists) {
          if (i < list.length) {
            any = true
            picked.push(list[i][0])
          }
        }
        if (!any) break
      }
      if (picked.length > 0) out[cat] = picked.slice(0, FALLBACKS_PER_CATEGORY)
    })
    return out
  }, [vocabulary, ratingMode])
}
