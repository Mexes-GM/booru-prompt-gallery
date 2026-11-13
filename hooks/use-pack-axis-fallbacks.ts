import { useEffect, useMemo, useState } from "react"
import type { TagCategory } from "@/lib/tag-classifier"
import { PACK_AXES, slotsOf } from "@/lib/tag-taxonomy"
import type { PackRatingMode } from "@/hooks/use-pack-seed-search"
import { isExplicitTag } from "@/lib/pack/explicit-tags"
import { loadPackVocabulary, loadedPackVocabulary, type PackVocabulary, type VocabularyEntry } from "@/lib/pack/pack-vocabulary"

export type PackAxisFallbacks = Partial<Record<TagCategory, string[]>>

/** Slots never used to top up an SFW pack, whatever each tag's own flag says. */
const SFW_EXCLUDED_SLOTS = new Set(["clothing:underwear", "pose:physiological"])
/** Fallback candidates offered per category (withAxisFallback adds at most 20 of them). */
const FALLBACKS_PER_CATEGORY = 60

/**
 * Explicit sources get each slot's explicit tags first. The vocabulary's own
 * NSFW flag isn't used for ordering: it's a substring match, so it would put
 * "butterfly" or "cumulonimbus cloud" at the top of an NSFW pool.
 */
function explicitFirst(entries: VocabularyEntry[]): VocabularyEntry[] {
  return [...entries.filter((e) => isExplicitTag(e[0])), ...entries.filter((e) => !isExplicitTag(e[0]))]
}

/**
 * Pack Mode's safety net for sparse pools (a niche search with a handful of
 * posts): the most-used approved tags of each slot, from
 * `/pack-vocabulary.json` (lib/pack/pack-vocabulary.ts). Fetched once, only while Pack Mode
 * is on. Slots are interleaved so a topped-up pool spans subcategories
 * instead of being all hair colours; SFW sources skip flagged tags and the
 * explicit-prone slots, Questionable sources skip explicit tags, Explicit
 * sources get them first.
 */
export function usePackAxisFallbacks(enabled: boolean, ratingMode: PackRatingMode): PackAxisFallbacks {
  const [vocabulary, setVocabulary] = useState<PackVocabulary | null>(loadedPackVocabulary)

  useEffect(() => {
    if (!enabled || vocabulary) return
    let cancelled = false
    void loadPackVocabulary().then((data) => {
      if (!cancelled && data) setVocabulary(data)
    })
    return () => {
      cancelled = true
    }
  }, [enabled, vocabulary])

  return useMemo(() => {
    if (!vocabulary) return {}
    const sfw = ratingMode === "sfw"
    const out: PackAxisFallbacks = {}
    PACK_AXES.forEach((cat) => {
      const lists = slotsOf(cat)
        .filter((slot) => !(sfw && SFW_EXCLUDED_SLOTS.has(slot)))
        .map((slot) => {
          const entries = vocabulary[slot] ?? []
          if (sfw) return entries.filter((entry) => entry[2] !== 1)
          if (ratingMode === "questionable") return entries.filter((entry) => !isExplicitTag(entry[0]))
          return ratingMode === "explicit" ? explicitFirst(entries) : entries
        })
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
