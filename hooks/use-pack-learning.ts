import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TagCategory } from '@/lib/tag-classifier'
import {
  createEmptyModel,
  applyFeedback,
  buildSamplingWeights,
  pruneModel,
  type PackLearningModel,
  type PackFeedbackEvent,
} from '@/lib/pack/pack-learning'
import { userPreferences } from '@/lib/storage'

export interface UsePackLearningResult {
  /** Explore/Exploit control (§7.8) — 1 = fully as-learned, higher flattens
   *  sampling toward uniform. Persisted independently of the model itself so
   *  resetting the model doesn't also reset this preference. */
  explorationTemperature: number
  setExplorationTemperature: (temperature: number) => void

  /**
   * Per-value sampling weights for one axis category, combining booru
   * frequency with whatever this model has learned for `contextKeys` (most
   * specific first — see contextKeysFor in lib/pack/pack-learning.ts).
   * Returns an array aligned with `values`, already normalized and floored —
   * safe to zip back into pack-generator.ts's `axisWeights[category]`.
   */
  weightsFor: (
    contextKeys: string[],
    category: TagCategory,
    values: Array<{ value: string; count: number }>
  ) => number[]

  /** Apply one feedback event to the model (fire-and-forget from the
   *  caller's perspective — persistence is debounced internally). */
  recordFeedback: (event: PackFeedbackEvent) => void

  /** Clear all learned data. Does NOT reset explorationTemperature (that's a
   *  separate, deliberate user preference — see the field's own docstring). */
  resetModel: () => void
}

/** Debounce window for persisting model writes — same value used elsewhere
 *  in this codebase (usePersistentState, use-pack-mode.ts's own config
 *  persistence) so rapid feedback bursts (many prompts_shown/removed events
 *  in a row) coalesce into one write instead of one per event. */
const PERSIST_DEBOUNCE_MS = 300

/**
 * Pack Mode's local learning hook (docs/pack-mode-learning-plan.md §7.7).
 * Owns the model's lifecycle — lazy-loads it once on mount, applies feedback
 * events through the pure lib/pack/pack-learning.ts core, and persists the
 * result debounced. All actual scoring math lives in that pure module; this
 * hook is purely the React/storage glue around it.
 *
 * Strictly local — see docs/pack-mode-learning-plan.md §10. This hook has no
 * network calls anywhere in it.
 */
export function usePackLearning(): UsePackLearningResult {
  const [hydrated] = useState(() => {
    if (typeof window === 'undefined') return createEmptyModel()
    try {
      return userPreferences.getPackLearningModel()
    } catch {
      return createEmptyModel()
    }
  })
  const modelRef = useRef<PackLearningModel>(hydrated)

  const [explorationTemperature, setExplorationTemperatureRaw] = useState<number>(() => {
    if (typeof window === 'undefined') return 1
    try {
      return userPreferences.getPackLearningTemperature()
    } catch {
      return 1
    }
  })

  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const schedulePersist = useCallback(() => {
    if (typeof window === 'undefined') return
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    persistTimerRef.current = setTimeout(() => {
      try {
        // Prune BEFORE persisting, not on every feedback event — pruning on
        // every write would be pure overhead for a model that's nowhere near
        // its budget yet; doing it right before the (already debounced)
        // write keeps the on-disk copy bounded without extra churn in between.
        modelRef.current = pruneModel(modelRef.current)
        userPreferences.setPackLearningModel(modelRef.current)
      } catch {
        // Non-fatal: learning is a nice-to-have, never allowed to break Pack
        // Mode's core generation flow. Same best-effort criterion as every
        // other localStorage write in this codebase.
      }
    }, PERSIST_DEBOUNCE_MS)
  }, [])

  useEffect(() => {
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    }
  }, [])

  const recordFeedback = useCallback(
    (event: PackFeedbackEvent) => {
      modelRef.current = applyFeedback(modelRef.current, event)
      schedulePersist()
    },
    [schedulePersist]
  )

  const weightsFor = useCallback(
    (contextKeys: string[], category: TagCategory, values: Array<{ value: string; count: number }>): number[] =>
      buildSamplingWeights(modelRef.current, contextKeys, category, values, { temperature: explorationTemperature }),
    [explorationTemperature]
  )

  const setExplorationTemperature = useCallback((temperature: number) => {
    const safe = Number.isFinite(temperature) && temperature > 0 ? temperature : 1
    setExplorationTemperatureRaw(safe)
    if (typeof window === 'undefined') return
    try {
      userPreferences.setPackLearningTemperature(safe)
    } catch {
      // Best-effort, same as every other preference write.
    }
  }, [])

  const resetModel = useCallback(() => {
    modelRef.current = createEmptyModel()
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    if (typeof window === 'undefined') return
    try {
      userPreferences.setPackLearningModel(modelRef.current)
    } catch {
      // Best-effort.
    }
  }, [])

  // Memoized so the returned object's IDENTITY only changes when one of its
  // actual fields does — same pattern usePackSeed/usePackSeedSearch already
  // use, for the same reason: use-pack-mode.ts's addAxisValue/removeAxisValue/
  // recordPromptCopied/regenerate all list `learning` in their useCallback
  // deps, and PackBuilderStickyFooter's docstring assumes those callbacks are
  // stable across renders (its per-category AxisEditor is React.memo'd on
  // exactly that assumption). Without this memo, `learning` was a fresh
  // object on every PromptGallery render, defeating that memo entirely.
  return useMemo(
    () => ({
      explorationTemperature,
      setExplorationTemperature,
      weightsFor,
      recordFeedback,
      resetModel,
    }),
    [explorationTemperature, setExplorationTemperature, weightsFor, recordFeedback, resetModel]
  )
}
