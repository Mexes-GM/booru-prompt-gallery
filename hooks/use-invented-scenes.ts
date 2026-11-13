import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { BooruPost } from '@/lib/booru/types'
import type { PackRatingMode } from '@/hooks/use-pack-seed-search'
import { normalizeTagForPack } from '@/lib/pack/pack-generator'
import { sceneRatingsFor } from '@/lib/pack/scene-pack'
import type { PackPeople } from '@/lib/pack/scene/scene-pool'
import { inventedPost, inventedSceneCount, inventedSceneSpec, ratingPlan, seriesOf, type InventedSceneSpec } from '@/lib/pack/scene/invented'
import { generateScenes, loadSceneModel, sceneModelState, subscribeSceneModel, type SceneModelState } from '@/lib/scene-model/client'
import { splitTags } from '@/lib/utils/tag-utils'

/** Waits this long after the last change of the conditions before asking the model. */
const SETTLE_MS = 400
/** How long new scenes wait for their tags' slots before they join the pool anyway. */
const SLOT_LOOKUP_TIMEOUT_MS = 5000
const NO_POSTS: BooruPost[] = []
const IDLE: SceneModelState = { status: 'idle' }

export type InventedScenesPhase = 'off' | 'loading' | 'generating' | 'ready' | 'unavailable' | 'failed'

export interface InventedScenesStatus {
  phase: InventedScenesPhase
  /** While loading: share of the model downloaded (0–1), when known. */
  progress: number | null
  /** Invented scenes in the pool now (before the pool's own filters). */
  count: number
  /** Milliseconds per scene of the last batch (median). */
  msPerScene: number | null
}

export interface UseInventedScenesArgs {
  /** The option is on and the scenes engine is in use. Off: nothing is loaded. */
  enabled: boolean
  /** The pool's real posts of the pack's rating. */
  posts: BooruPost[]
  contentRating: PackRatingMode | null
  /** Who is in the picture; null until it is known (nothing is generated before). */
  people: PackPeople | null
  /** The characters' identity tags (body traits are read from them). */
  identity: readonly string[]
  /** The characters the pack names. */
  characters: readonly string[]
  /** The base card's copyright field. */
  copyrights?: string
  /** Tags every invented scene starts from: the pinned chips and the picked scene's own tags. */
  fixed: readonly string[]
  /** Tags no invented scene may have. */
  never: readonly string[]
  /** Fetches the taxonomy slots of tags the pool hasn't seen (spaces, as normalizeTagForPack writes them). */
  enrichTags?: (tags: string[]) => Promise<unknown>
}

export interface UseInventedScenesResult {
  /** The invented scenes as posts, for the pool; empty while off or until the first batch for these conditions. */
  posts: BooruPost[]
  status: InventedScenesStatus
  /** Asks for a fresh batch (new seeds); the current one stays until it arrives. */
  refresh: () => void
}

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * Scenes the scene model writes for the pack (lib/pack/scene/invented.ts), in a
 * worker, in the background: the pool uses the latest batch for the current
 * conditions and never waits for one. Off, it downloads nothing.
 */
export function useInventedScenes(args: UseInventedScenesArgs): UseInventedScenesResult {
  const { enabled, posts, contentRating, people, identity, characters, copyrights, fixed, never, enrichTags } = args
  const model = useSyncExternalStore(subscribeSceneModel, sceneModelState, () => IDLE)

  useEffect(() => {
    if (enabled) loadSceneModel()
  }, [enabled])

  // One spec per scene; the key says when the conditions changed.
  const nextPlan = useMemo(() => {
    if (!enabled || !people) return null
    const count = inventedSceneCount(posts.length)
    const ratings = ratingPlan(posts.map((post) => post.rating), sceneRatingsFor(contentRating), count)
    const series = seriesOf(copyrights, posts, characters)
    const specs = new Map<string, InventedSceneSpec>()
    const scenes = ratings.map((rating) => {
      let spec = specs.get(rating)
      if (!spec) {
        spec = inventedSceneSpec({ rating, people, identity, characters, series })
        specs.set(rating, spec)
      }
      return spec
    })
    const fixedTags = Array.from(new Set(fixed.map(normalizeTagForPack).filter(Boolean)))
    const neverTags = Array.from(new Set(never.map(normalizeTagForPack).filter(Boolean)))
    const key = JSON.stringify({ scenes: scenes.map((s) => s.conditions), fixedTags, neverTags })
    return { key, scenes, fixedTags, neverTags }
  }, [enabled, people, posts, contentRating, copyrights, characters, identity, fixed, never])
  // The same conditions keep the same plan object, so posts arriving don't restart the model.
  const [plan, setPlan] = useState(nextPlan)
  if (nextPlan?.key !== plan?.key) setPlan(nextPlan)

  const [batch, setBatch] = useState<{ key: string; posts: BooruPost[]; ms: number[] } | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const ready = model.status === 'ready'

  useEffect(() => {
    if (!ready || !plan) return
    let active = true
    const timer = setTimeout(() => {
      setRunning(plan.key)
      generateScenes(plan.scenes.map((spec) => ({
        conditions: spec.conditions,
        fixed: plan.fixedTags,
        exclude: plan.neverTags,
        seed: Math.floor(Math.random() * 2 ** 31),
      })))
        .then(async (result) => {
          if (!active) return
          const made = result.scenes.map((scene, i) => inventedPost(plan.scenes[i], scene.tags))
          // The pool classifies tags by slot: fetch the ones it doesn't know first, as for real posts.
          if (enrichTags) {
            const tags = new Set<string>()
            made.forEach((post) => splitTags(post.tag_string).forEach((tag) => tags.add(normalizeTagForPack(tag))))
            await Promise.race([
              enrichTags(Array.from(tags).filter(Boolean)).catch(() => undefined),
              new Promise((resolve) => setTimeout(resolve, SLOT_LOOKUP_TIMEOUT_MS)),
            ])
          }
          if (!active) return
          setBatch({ key: plan.key, posts: made, ms: result.ms })
          setRunning(null)
        })
        .catch((err: Error) => {
          if (!active || err.message === 'cancelled') return
          console.warn('Invented scenes failed:', err)
          setRunning(null)
        })
    }, SETTLE_MS)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [ready, plan, nonce, enrichTags])

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  const current = enabled && plan && batch?.key === plan.key ? batch : null
  const phase: InventedScenesPhase = !enabled
    ? 'off'
    : model.status === 'unavailable'
      ? 'unavailable'
      : model.status === 'failed'
        ? 'failed'
        : model.status !== 'ready'
          ? 'loading'
          : !current || running === plan?.key
            ? 'generating'
            : 'ready'
  const progress = model.status === 'loading' && model.step === 'model' && model.total ? Math.min(1, model.loaded / model.total) : null
  const status = useMemo<InventedScenesStatus>(
    () => ({ phase, progress, count: current?.posts.length ?? 0, msPerScene: median(current?.ms ?? []) }),
    [phase, progress, current]
  )
  return { posts: current?.posts ?? NO_POSTS, status, refresh }
}
