/**
 * Taxonomy slots looked up on demand for tags the static overrides don't cover, kept by
 * whoever owns the enricher: each builder has its own, so the lookups one builder makes
 * never re-render the other (or the gallery behind them).
 *
 * Pure apart from the injected `fetch`: the hook (hooks/use-tag-slot-enrichment.ts) holds
 * one per owner and turns `onChange` into a render.
 */

/** Fetches the slots of `names`; `onFailed` gets the names whose lookup failed (asked again later). */
export type TagSlotFetch = (names: string[], onFailed: (failed: string[]) => void) => Promise<Record<string, string>>

export interface TagSlotEnricher {
  /** Slots fetched so far (a new object after each lookup that brought something). */
  fetched: () => Record<string, string>
  /**
   * Looks up the tags not covered by `known` nor fetched or asked for already. Resolves
   * true if any slot arrived. A failed lookup leaves its tags free to be asked again.
   */
  enrich: (tags: readonly string[], known: Readonly<Record<string, string>>) => Promise<boolean>
}

export function createTagSlotEnricher(fetch: TagSlotFetch, onChange: (fetched: Record<string, string>) => void): TagSlotEnricher {
  let fetched: Record<string, string> = {}
  const requested = new Set<string>()
  return {
    fetched: () => fetched,
    enrich: async (tags, known) => {
      const missing = tags.filter((t) => !requested.has(t) && !known[t] && !fetched[t])
      if (missing.length === 0) return false
      missing.forEach((t) => requested.add(t))
      try {
        // Tags whose lookup failed are asked for again on the next pass instead of
        // staying without a slot for the rest of the session.
        const found = await fetch(missing, (failed) => {
          failed.forEach((name) => {
            requested.delete(name)
            requested.delete(name.replace(/_/g, ' '))
          })
        })
        if (Object.keys(found).length === 0) return false
        fetched = { ...fetched, ...found }
        onChange(fetched)
        return true
      } catch {
        // Best-effort: heuristics and the snapshot still classify these tags.
        missing.forEach((t) => requested.delete(t))
        return false
      }
    },
  }
}

/** The slots in use: the fetched ones under the static overrides (which win on conflict). */
export function withFetchedSlots(overrides: Record<string, string>, fetched: Record<string, string>): Record<string, string> {
  return Object.keys(fetched).length === 0 ? overrides : { ...fetched, ...overrides }
}
