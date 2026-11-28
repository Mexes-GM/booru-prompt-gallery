import { useEffect, useSyncExternalStore } from 'react'
import { loadTagRelations, loadedTagRelations, subscribeTagRelations, type TagRelations } from '@/lib/tag-relations'

/**
 * The measured tag relations (lib/tag-relations.ts), loading them while `enabled`.
 * Returns null until they load; the value changes once, so a memo that depends on
 * it recomputes when the relations arrive. `when: 'idle'` waits for an idle moment,
 * so the load never competes with the first paint.
 */
export function useTagRelations(enabled: boolean, when: 'now' | 'idle' = 'now'): TagRelations | null {
  const relations = useSyncExternalStore(subscribeTagRelations, loadedTagRelations, () => null)
  useEffect(() => {
    if (!enabled || loadedTagRelations()) return
    if (when === 'now') {
      void loadTagRelations()
      return
    }
    const idle = typeof window !== 'undefined' && 'requestIdleCallback' in window
    const handle = idle
      ? window.requestIdleCallback(() => void loadTagRelations(), { timeout: 4000 })
      : window.setTimeout(() => void loadTagRelations(), 1500)
    return () => {
      if (idle) window.cancelIdleCallback(handle)
      else window.clearTimeout(handle)
    }
  }, [enabled, when])
  return relations
}
