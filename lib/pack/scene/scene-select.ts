/**
 * Scene selection: choose N scenes for coverage, not for frequency. Round-robin over
 * the situations (largest first); inside a situation, the scene farthest from those
 * already chosen. Thirty prompts are thirty different situations, not thirty
 * variations of the most common one.
 *
 * "Farthest" alone picks oddities when a situation is large, and their rare tags are
 * hard to back up. So inside a situation the scenes that are at least as typical of the
 * pool as the situation's median go first; the rest only once those run out.
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

const typicalityOf = (scene: Scene): number => scene.typicality ?? 1

/** Scenes of a situation split in those at least as typical as its median and the others. */
function splitByTypicality(scenes: Scene[]): { typical: Scene[]; rest: Scene[] } {
  const values = scenes.map(typicalityOf).sort((a, b) => a - b)
  const middle = Math.floor(values.length / 2)
  const median = values.length % 2 === 1 ? values[middle] : (values[middle - 1] + values[middle]) / 2
  return {
    typical: scenes.filter((scene) => typicalityOf(scene) >= median),
    rest: scenes.filter((scene) => typicalityOf(scene) < median),
  }
}

export function selectScenes(pool: ScenePool, count: number, options: SelectOptions): Scene[] {
  const { rng } = options
  const disabled = new Set(options.disabledSituations ?? [])
  const byId = new Map(pool.scenes.map((scene) => [scene.postId, scene]))
  const queues = pool.situations
    .filter((situation) => !disabled.has(situation.id))
    .map((situation) => splitByTypicality(situation.sceneIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))))
    .filter((queue) => queue.typical.length + queue.rest.length > 0)

  const chosen: Scene[] = []
  const chosenPrints: string[][] = []
  while (chosen.length < count && queues.some((queue) => queue.typical.length + queue.rest.length > 0)) {
    for (const queue of queues) {
      if (chosen.length >= count) break
      const source = queue.typical.length > 0 ? queue.typical : queue.rest
      if (source.length === 0) continue
      const [scene] = source.splice(farthestIndex(source, chosenPrints, rng), 1)
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
