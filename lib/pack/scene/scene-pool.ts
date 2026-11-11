/**
 * Scene pool: the posts of a search turned into scenes that are good enough to
 * transplant onto the pack's character, grouped by what the person in them is doing.
 */
import type { BooruPost } from '../../booru/types'
import { classifyPostForPack, normalizeTagForPack } from '../pack-generator'
import { collapseNearDuplicates } from '../near-duplicates'
import { splitTags } from '../../utils/tag-utils'
import { getTagSlotFromOverrides } from '../../tag-taxonomy'
import { postIsBlocked } from './blocked'
import { isPhotoPost } from './medium'
import { COUNT_TAG_RE } from './permanence'
import { extractScene, sceneTags, stateTagCount, MIN_TYPICAL_SUPPORT, type Scene, type SceneContext } from './scene'

/** Scenes with fewer state tags than this are too poor to be worth a prompt. */
export const DEFAULT_MIN_STATE_TAGS = 6
/** Most situations made from tags; whatever is left goes to "other". */
export const MAX_SITUATIONS = 12
/** A situation must cover at least this share of the scenes of the pool. */
export const MIN_SITUATION_SHARE = 0.04
/** Id and label of the situation that gathers the scenes no tag covers well enough. */
export const OTHER_SITUATION = 'other'
const SKELETON_SLOTS = new Set([
  'pose:posture', 'pose:gesture', 'pose:kinetic', 'pose:combat', 'pose:interaction', 'pose:physiological',
])
const PREVIEWS_PER_SITUATION = 3
/** Pools of fewer different characters / series than this cannot tell a name from a general tag by spread. */
const MIN_SIGNATURES_FOR_SPREAD = 3

/** A group of scenes that do the same thing, so a pack can cover different ones. */
export interface Situation {
  /** Stable name taken from the label; used to switch the situation off. */
  id: string
  /** The tag that defines the situation and its most frequent co-tag. */
  label: string[]
  sceneIds: number[]
  previews: string[]
}

/** How many people (by gender) the scenes of a pack must have. */
export interface PackPeople {
  girls: number
  boys: number
}

/** Posts that each step of the pool build removed. */
export interface ScenePoolStats {
  posts: number
  blocked: number
  /** Photographs of real people (the booru's own medium tags). */
  notIllustration: number
  nearDuplicates: number
  /** No person in the post, or nothing left after taking out names and identity. */
  unextractable: number
  /** No `skeleton`, or fewer state tags than the quality threshold. */
  belowQuality: number
  /** Scenes whose people do not match the composition of the pack (open counts included). */
  incompatible: number
  scenes: number
  situations: number
  /** Composition the scenes were filtered to and where it came from. */
  composition: PackPeople | null
  compositionSource: 'identity' | 'option' | 'pool' | 'none'
  /** Every exact composition among the scenes that passed the quality threshold, most scenes first. */
  compositions: Array<{ people: PackPeople; scenes: number }>
}

export interface ScenePool {
  scenes: Scene[]
  /** Largest first, "other" last. */
  situations: Situation[]
  stats: ScenePoolStats
}

export type ScenePoolContext = Omit<SceneContext, 'poolSupport' | 'poolPlace' | 'poolSources'> & {
  minStateTags?: number
  /** Tags of the character; its people-count tags (`1girl`, `solo`) decide which scenes fit. */
  identity?: readonly string[]
  /** Composition to use when the identity declares no count. Without it, the most frequent one of the pool. */
  people?: PackPeople
}

/**
 * People of a pack from the count tags of its identity: `1girl, solo` is one girl and no
 * boys, `1girl, 1boy` one of each. Null when the identity declares no count, or an open one.
 */
export function compositionOfIdentity(identity: readonly string[]): PackPeople | null {
  let girls = 0
  let boys = 0
  let declared = false
  for (const raw of identity) {
    const match = COUNT_TAG_RE.exec(raw.toLowerCase().replace(/_/g, ' ').trim())
    if (!match) continue
    if (match[2] || match[3].startsWith('other')) return null
    declared = true
    if (match[3].startsWith('girl')) girls += Number(match[1])
    else boys += Number(match[1])
  }
  return declared ? { girls, boys } : null
}

/** Every word suffix of a tag: "bunk bed frame" -> itself, "bed frame", "frame". */
function wordSuffixes(tag: string): string[] {
  const words = tag.split(' ')
  return words.map((_, i) => words.slice(i).join(' '))
}

/** Exact compositions of `scenes` with their scene counts, most scenes first (ties keep first-seen order). */
function compositionsOf(scenes: Scene[]): Array<{ people: PackPeople; scenes: number }> {
  const counts = new Map<string, { people: PackPeople; scenes: number }>()
  for (const scene of scenes) {
    if (!scene.people) continue
    const key = `${scene.people.girls}/${scene.people.boys}`
    const entry = counts.get(key)
    if (entry) entry.scenes++
    else counts.set(key, { people: { girls: scene.people.girls, boys: scene.people.boys }, scenes: 1 })
  }
  return Array.from(counts.values()).sort((a, b) => b.scenes - a.scenes)
}

export function buildScenePool(posts: BooruPost[], ctx: ScenePoolContext): ScenePool {
  const minState = ctx.minStateTags ?? DEFAULT_MIN_STATE_TAGS
  const stats: ScenePoolStats = {
    posts: posts.length, blocked: 0, notIllustration: 0, nearDuplicates: 0, unextractable: 0, belowQuality: 0,
    incompatible: 0, scenes: 0, situations: 0, composition: null, compositionSource: 'none', compositions: [],
  }

  const allowed = posts.filter((post) => !postIsBlocked(post))
  stats.blocked = posts.length - allowed.length
  const drawn = allowed.filter((post) => !isPhotoPost(post))
  stats.notIllustration = allowed.length - drawn.length
  const distinct = collapseNearDuplicates(drawn)
  stats.nearDuplicates = drawn.length - distinct.length

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

  const good: Scene[] = []
  for (const post of distinct) {
    const scene = extractScene(post, sceneCtx)
    if (!scene) {
      stats.unextractable++
    } else if (scene.units.skeleton.length === 0 || stateTagCount(scene) < minState) {
      stats.belowQuality++
    } else {
      const tags = sceneTags(scene)
      scene.typicality = tags.length ? tags.filter((tag) => (support.get(tag) ?? 0) >= MIN_TYPICAL_SUPPORT).length / tags.length : 1
      good.push(scene)
    }
  }

  // Only scenes with the people of the pack: no partner for a solo character, no open counts.
  const fromIdentity = ctx.identity ? compositionOfIdentity(ctx.identity) : null
  stats.compositions = compositionsOf(good)
  const composition = fromIdentity ?? ctx.people ?? stats.compositions[0]?.people ?? null
  stats.composition = composition
  stats.compositionSource = fromIdentity ? 'identity' : ctx.people ? 'option' : composition ? 'pool' : 'none'
  const scenes = good.filter(
    (scene) => !!composition && !!scene.people && scene.people.girls === composition.girls && scene.people.boys === composition.boys
  )
  stats.incompatible = good.length - scenes.length

  const situations = groupSituations(scenes, ctx.overrides)
  stats.scenes = scenes.length
  stats.situations = situations.length
  return { scenes, situations, stats }
}

/**
 * Situations by coverage and informativeness. Candidate tags are the `skeleton` tags of the
 * posture, gesture, kinetic, combat, interaction and physiological slots. Each one scores
 * (unassigned scenes that have it) x ln(N / scenes of the pool that have it), so a tag that
 * almost every scene carries defines nothing. The best tag makes a situation with its
 * unassigned scenes; this repeats until no tag covers MIN_SITUATION_SHARE of the pool or
 * MAX_SITUATIONS exist. The rest is "other". Deterministic: ties go to the tag seen first.
 */
export function groupSituations(scenes: Scene[], overrides: Record<string, string> = {}): Situation[] {
  const isCandidate = (tag: string) => {
    const slot = getTagSlotFromOverrides(tag, overrides)?.slot
    return !!slot && SKELETON_SLOTS.has(slot)
  }
  const candidates = new Map<string, Scene[]>()
  for (const scene of scenes) {
    for (const tag of scene.units.skeleton) {
      if (!isCandidate(tag)) continue
      const list = candidates.get(tag)
      if (list) list.push(scene)
      else candidates.set(tag, [scene])
    }
  }

  const order = Array.from(candidates.keys())
  const assigned = new Set<Scene>()
  const groups: Array<{ tag: string; scenes: Scene[] }> = []
  while (groups.length < MAX_SITUATIONS) {
    let bestTag: string | null = null
    let bestScore = 0
    for (const tag of order) {
      const all = candidates.get(tag)!
      const covered = all.filter((scene) => !assigned.has(scene)).length
      if (covered === 0 || covered < MIN_SITUATION_SHARE * scenes.length) continue
      const score = covered * Math.log(scenes.length / all.length)
      if (score > bestScore) {
        bestTag = tag
        bestScore = score
      }
    }
    if (!bestTag) break
    const members = candidates.get(bestTag)!.filter((scene) => !assigned.has(scene))
    members.forEach((scene) => assigned.add(scene))
    groups.push({ tag: bestTag, scenes: members })
  }

  const usedIds = new Map<string, number>()
  const situations: Situation[] = groups.map(({ tag, scenes: members }) => {
    const label = [tag, ...commonCoTag(members, tag)]
    const base = label.join(' + ')
    const n = (usedIds.get(base) ?? 0) + 1
    usedIds.set(base, n)
    return toSituation(n === 1 ? base : `${base} #${n}`, label, members)
  })
  const rest = scenes.filter((scene) => !assigned.has(scene))
  if (rest.length > 0) situations.push(toSituation(OTHER_SITUATION, [OTHER_SITUATION], rest))
  return situations
}

function toSituation(id: string, label: string[], members: Scene[]): Situation {
  return {
    id,
    label,
    sceneIds: members.map((scene) => scene.postId),
    previews: members.flatMap((scene) => (scene.preview ? [scene.preview] : [])).slice(0, PREVIEWS_PER_SITUATION),
  }
}

/** The skeleton tag, other than `tag`, most scenes of the group share (empty when none). */
function commonCoTag(members: Scene[], tag: string): string[] {
  const counts = new Map<string, number>()
  for (const scene of members) {
    for (const other of scene.units.skeleton) {
      if (other !== tag) counts.set(other, (counts.get(other) ?? 0) + 1)
    }
  }
  let best: string | null = null
  let bestCount = 0
  for (const [other, count] of counts) {
    if (count > bestCount) {
      best = other
      bestCount = count
    }
  }
  return best ? [best] : []
}
