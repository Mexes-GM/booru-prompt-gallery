/**
 * Scene selection: choose N scenes for coverage, not for frequency. Round-robin over
 * the situations (largest first); inside a situation, the scene farthest from those
 * already chosen. Thirty prompts are thirty different situations, not thirty
 * variations of the most common one.
 */
import type { ScenePool } from './scene-pool'
import { jaccard, type Scene } from './scene'

export interface SelectOptions {
  rng: () => number
  /** Ids of the situations the user switched off. */
  disabledSituations?: readonly string[]
}

/** Tags that tell two scenes apart for selection: what they do and how they are framed. */
const fingerprint = (scene: Scene): string[] => [...scene.units.skeleton, ...scene.units.camera]

export function selectScenes(pool: ScenePool, count: number, options: SelectOptions): Scene[] {
  const { rng } = options
  const disabled = new Set(options.disabledSituations ?? [])
  const byId = new Map(pool.scenes.map((scene) => [scene.postId, scene]))
  const queues = pool.situations
    .filter((situation) => !disabled.has(situation.id))
    .map((situation) => situation.sceneIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])))
    .filter((scenes) => scenes.length > 0)

  const chosen: Scene[] = []
  const chosenPrints: string[][] = []
  while (chosen.length < count && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      if (chosen.length >= count) break
      if (queue.length === 0) continue
      const index = farthestIndex(queue, chosenPrints, rng)
      const [scene] = queue.splice(index, 1)
      chosen.push(scene)
      chosenPrints.push(fingerprint(scene))
    }
  }
  return chosen
}

/** Index of the scene whose nearest chosen scene is the farthest (random among ties). */
function farthestIndex(candidates: Scene[], chosenPrints: string[][], rng: () => number): number {
  if (chosenPrints.length === 0) return Math.floor(rng() * candidates.length)
  let bestDistance = -1
  let best: number[] = []
  candidates.forEach((scene, i) => {
    const print = fingerprint(scene)
    let nearest = 1
    for (const other of chosenPrints) nearest = Math.min(nearest, 1 - jaccard(print, other))
    if (nearest > bestDistance + 1e-9) {
      bestDistance = nearest
      best = [i]
    } else if (Math.abs(nearest - bestDistance) <= 1e-9) {
      best.push(i)
    }
  })
  return best[Math.floor(rng() * best.length)]
}
