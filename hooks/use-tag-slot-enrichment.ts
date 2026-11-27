import { useCallback, useMemo, useState } from 'react'
import { fetchTagOverridesForNames } from '@/lib/supabase/client-queries'
import { createTagSlotEnricher, withFetchedSlots, type TagSlotEnricher } from '@/lib/pack/tag-slot-enricher'

export interface TagSlotEnrichment {
  /** The static overrides plus the slots looked up so far (the static ones win on conflict). */
  overrides: Record<string, string>
  /** The same, read at call time: for async work that must not wait for a render. */
  current: () => Record<string, string>
  /** Looks up the slots of tags no one has asked for yet. True if any arrived. */
  enrich: (tags: string[]) => Promise<boolean>
}

/**
 * Taxonomy slots looked up on demand, owned by the component that calls this: its lookups
 * re-render it and nothing else (lib/pack/tag-slot-enricher.ts).
 */
export function useTagSlotEnrichment(tagOverrides: Record<string, string>): TagSlotEnrichment {
  const [fetched, setFetched] = useState<Record<string, string>>({})
  const [enricher] = useState<TagSlotEnricher>(() => createTagSlotEnricher(fetchTagOverridesForNames, setFetched))

  const overrides = useMemo(() => withFetchedSlots(tagOverrides, fetched), [tagOverrides, fetched])
  const current = useCallback(() => ({ ...enricher.fetched(), ...tagOverrides }), [enricher, tagOverrides])
  const enrich = useCallback((tags: string[]) => enricher.enrich(tags, tagOverrides), [enricher, tagOverrides])
  return useMemo(() => ({ overrides, current, enrich }), [overrides, current, enrich])
}
