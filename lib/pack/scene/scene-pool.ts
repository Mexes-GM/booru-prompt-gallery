/**
 * Scene pool: the posts of a search turned into scenes that are good enough to
 * transplant, grouped by what the person in them is doing.
 */
import type { BooruPost } from '../../booru/types'
import { classifyPostForPack, normalizeTagForPack } from '../pack-generator'
import { collapseNearDuplicates } from '../near-duplicates'
import { splitTags } from '../../utils/tag-utils'
import { postIsBlocked } from './blocked'
import { extractScene, jaccard, stateTagCount, type Scene, type SceneContext } from './scene'

/** Scenes with fewer state tags than this are too poor to be worth a prompt. */
export const DEFAULT_MIN_STATE_TAGS = 6
/** Share of `skeleton` tags two scenes need in common to be the same situation. */
export const SITUATION_SIMILARITY = 0.5
const LABEL_TAGS = 3
const PREVIEWS_PER_SITUATION = 3

/** A group of scenes that do the same thing, so a pack can cover different ones. */
export interface Situation {
  /** Stable name taken from the label; used to switch the situation off. */
  id: string
  /** The two or three tags most scenes of the group share. */
  label: string[]
  sceneIds: number[]
  previews: string[]
}

/** Posts that each step of the pool build removed. */
export interface ScenePoolStats {
  posts: number
  blocked: number
  nearDuplicates: number
  /** No person in the post, or nothing left after taking out names and identity. */
  unextractable: number
  /** No `skeleton`, or fewer state tags than the quality threshold. */
  belowQuality: number
  scenes: number
  situations: number
}

export interface ScenePool {
  scenes: Scene[]
  /** Largest first. */
  situations: Situation[]
  stats: ScenePoolStats
}

export type ScenePoolContext = Omit<SceneContext, 'poolSupport' | 'poolPlace' | 'poolSources'> & {
  minStateTags?: number
}

/** Pools of fewer different characters / series than this cannot tell a name from a general tag by spread. */
const MIN_SIGNATURES_FOR_SPREAD = 3

/** Every word suffix of a tag: "bunk bed frame" -> itself, "bed frame", "frame". */
function wordSuffixes(tag: string): string[] {
  const words = tag.split(' ')
  return words.map((_, i) => words.slice(i).join(' '))
}

export function buildScenePool(posts: BooruPost[], ctx: ScenePoolContext): ScenePool {
  const minState = ctx.minStateTags ?? DEFAULT_MIN_STATE_TAGS
  const stats: ScenePoolStats = {
    posts: posts.length, blocked: 0, nearDuplicates: 0, unextractable: 0, belowQuality: 0, scenes: 0, situations: 0,
  }

  const allowed = posts.filter((post) => !postIsBlocked(post))
  stats.blocked = posts.length - allowed.length
  const distinct = collapseNearDuplicates(allowed)
  stats.nearDuplicates = allowed.length - distinct.length

  // How many posts carry each tag, among how many characters / series, and which tags place the character somewhere.
  const support = new Map<string, number>()
  const place = new Set<string>()
  const signatures = new Map<string, Set<string>>()
  const signatureOf = (post: BooruPost) => `${post.tag_string_character || ''}|${post.tag_string_copyright || ''}`
  for (const post of distinct) {
    const signature = signatureOf(post)
    new Set(splitTags(post.tag_string || '').map(normalizeTagForPack)).forEach((tag) => {
      support.set(tag, (support.get(tag) ?? 0) + 1)
      const seen = signatures.get(tag)
      if (seen) seen.add(signature)
      else signatures.set(tag, new Set([signature]))
    })
    classifyPostForPack(post, ctx.overrides).scenery.forEach((tag) => wordSuffixes(tag).forEach((s) => place.add(s)))
  }
  const spread = new Set(distinct.map(signatureOf)).size >= MIN_SIGNATURES_FOR_SPREAD
  const sceneCtx: SceneContext = {
    ...ctx,
    poolSupport: (tag) => support.get(tag) ?? 0,
    poolPlace: place,
    poolSources: spread ? (tag) => signatures.get(tag)?.size ?? 0 : undefined,
  }

  const scenes: Scene[] = []
  for (const post of distinct) {
    const scene = extractScene(post, sceneCtx)
    if (!scene) {
      stats.unextractable++
    } else if (scene.units.skeleton.length === 0 || stateTagCount(scene) < minState) {
      stats.belowQuality++
    } else {
      scenes.push(scene)
    }
  }

  const situations = groupSituations(scenes)
  stats.scenes = scenes.length
  stats.situations = situations.length
  return { scenes, situations, stats }
}

/**
 * Leader clustering on the `skeleton` tags: a scene joins the most similar group whose
 * first scene it resembles (Jaccard >= SITUATION_SIMILARITY), or starts its own.
 * Deterministic: the pool order decides, and ties go to the older group.
 */
export function groupSituations(scenes: Scene[]): Situation[] {
  const groups: Scene[][] = []
  for (const scene of scenes) {
    let best = -1
    let bestSimilarity = SITUATION_SIMILARITY
    groups.forEach((group, i) => {
      const similarity = jaccard(scene.units.skeleton, group[0].units.skeleton)
      if (similarity >= bestSimilarity && (best === -1 || similarity > bestSimilarity)) {
        best = i
        bestSimilarity = similarity
      }
    })
    if (best === -1) groups.push([scene])
    else groups[best].push(scene)
  }

  const usedIds = new Map<string, number>()
  return groups
    .map((group, order) => ({ group, order }))
    .sort((a, b) => b.group.length - a.group.length || a.order - b.order)
    .map(({ group }) => {
      const label = commonSkeletonTags(group)
      const base = label.join(' + ')
      const n = (usedIds.get(base) ?? 0) + 1
      usedIds.set(base, n)
      return {
        id: n === 1 ? base : `${base} #${n}`,
        label,
        sceneIds: group.map((scene) => scene.postId),
        previews: group.flatMap((scene) => (scene.preview ? [scene.preview] : [])).slice(0, PREVIEWS_PER_SITUATION),
      }
    })
}

/** The up-to-three skeleton tags most scenes of the group carry (ties: first seen). */
function commonSkeletonTags(group: Scene[]): string[] {
  const counts = new Map<string, number>()
  for (const scene of group) {
    for (const tag of scene.units.skeleton) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return Array.from(counts.keys())
    .map((tag, order) => ({ tag, order, count: counts.get(tag)! }))
    .sort((a, b) => b.count - a.count || a.order - b.order)
    .slice(0, LABEL_TAGS)
    .map((entry) => entry.tag)
}
