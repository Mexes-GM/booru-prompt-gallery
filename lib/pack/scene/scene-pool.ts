/**
 * Scene pool: the posts of a search turned into scenes that are good enough to
 * transplant onto the pack's character, grouped by what the person in them is doing.
 */
import type { BooruPost } from '../../booru/types'
import { classifyPostForPack, normalizeTagForPack } from '../pack-generator'
import { collapseNearDuplicates, isNearDuplicateOfAny } from '../near-duplicates'
import { splitTags } from '../../utils/tag-utils'
import { getTagSlotFromOverrides } from '../../tag-taxonomy'
import { postIsBlocked } from './blocked'
import { isPhotoPost } from './medium'
import { COUNT_TAG_RE } from './permanence'
import { nameDetector } from './names'
import { extractScene, sceneTags, stateTagCount, MIN_TYPICAL_SUPPORT, type Scene, type SceneContext } from './scene'
import { isInventedPost } from './invented'

/** Scenes with fewer state tags than this are too poor to be worth a prompt. */
export const DEFAULT_MIN_STATE_TAGS = 6
/** Most situations made from tags; whatever is left goes to "other". */
export const MAX_SITUATIONS = 12
/** Share of the scenes a tag needs to be the source's theme: it tells none of them apart. */
export const SITUATION_THEME_SHARE = 0.8
/** A situation must cover at least this share of the scenes of the pool. */
export const MIN_SITUATION_SHARE = 0.04
/** Id and label of the situation that gathers the scenes no tag covers well enough. */
export const OTHER_SITUATION = 'other'
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

/** Real posts that each step of the pool build removed (invented scenes are counted apart). */
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
  /** Of `scenes`, how many are invented (lib/pack/scene/invented.ts). */
  invented: number
}

export interface ScenePool {
  scenes: Scene[]
  /** Largest first, "other" last. */
  situations: Situation[]
  stats: ScenePoolStats
}

export type ScenePoolContext = Omit<SceneContext, 'poolSupport' | 'poolPlace' | 'poolSources' | 'poolShare' | 'looksLikeName'> & {
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
  // Invented scenes go through every step, but only real posts are counted and only real
  // posts are evidence of what a tag is (support, names, places): a scene the model
  // wrote must not vouch for a tag.
  const real = (list: readonly BooruPost[]) => list.filter((post) => !isInventedPost(post)).length
  const stats: ScenePoolStats = {
    posts: real(posts), blocked: 0, notIllustration: 0, nearDuplicates: 0, unextractable: 0, belowQuality: 0,
    incompatible: 0, scenes: 0, situations: 0, composition: null, compositionSource: 'none', compositions: [], invented: 0,
  }

  const allowed = posts.filter((post) => !postIsBlocked(post))
  stats.blocked = stats.posts - real(allowed)
  const drawn = allowed.filter((post) => !isPhotoPost(post))
  stats.notIllustration = real(allowed) - real(drawn)
  const evidence = collapseNearDuplicates(drawn.filter((post) => !isInventedPost(post)))
  stats.nearDuplicates = real(drawn) - evidence.length
  // An invented scene that copies a kept post (of any character) or another invented one adds nothing.
  const distinct = [...evidence]
  for (const post of drawn) {
    if (isInventedPost(post) && !isNearDuplicateOfAny(post, distinct)) distinct.push(post)
  }

  // How many posts carry each tag, among how many characters / series, and which tags place the character somewhere.
  const support = new Map<string, number>()
  const place = new Set<string>()
  const signatures = new Map<string, Set<string>>()
  const signatureOf = (post: BooruPost) => `${post.tag_string_character || ''}|${post.tag_string_copyright || ''}`
  for (const post of evidence) {
    const signature = signatureOf(post)
    new Set(splitTags(post.tag_string || '').map(normalizeTagForPack)).forEach((tag) => {
      support.set(tag, (support.get(tag) ?? 0) + 1)
      const seen = signatures.get(tag)
      if (seen) seen.add(signature)
      else signatures.set(tag, new Set([signature]))
    })
    classifyPostForPack(post, ctx.overrides).scenery.forEach((tag) => wordSuffixes(tag).forEach((s) => place.add(s)))
  }
  const spread = new Set(evidence.map(signatureOf)).size >= MIN_SIGNATURES_FOR_SPREAD
  const sceneCtx: SceneContext = {
    ...ctx,
    poolSupport: (tag) => support.get(tag) ?? 0,
    poolShare: (tag) => (evidence.length > 0 ? (support.get(tag) ?? 0) / evidence.length : 0),
    poolPlace: place,
    poolSources: spread ? (tag) => signatures.get(tag)?.size ?? 0 : undefined,
    looksLikeName: nameDetector({ posts: evidence, overrides: ctx.overrides }),
  }

  const good: Scene[] = []
  for (const post of distinct) {
    const scene = extractScene(post, sceneCtx)
    const counted = !isInventedPost(post)
    if (!scene) {
      if (counted) stats.unextractable++
    } else if (scene.units.skeleton.length === 0 || stateTagCount(scene) < minState) {
      if (counted) stats.belowQuality++
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
  stats.incompatible = good.filter((scene) => !scene.invented).length - scenes.filter((scene) => !scene.invented).length
  stats.invented = scenes.filter((scene) => scene.invented).length

  const situations = groupSituations(scenes, ctx.overrides)
  stats.scenes = scenes.length
  stats.situations = situations.length
  return { scenes, situations, stats }
}

/**
 * Situations: groups a person would make by hand (standing, sitting, lying, from behind,
 * close-up, holding an umbrella, an act). Candidate tags say how the body is or what it
 * does (the pose slots), how the picture is framed, or what is held ("holding umbrella").
 * Not candidates: a bare "holding", and the source's theme (a tag at least SITUATION_THEME_SHARE of
 * the scenes carry tells none of them apart). Measured on real pools, leaving the gesture
 * or physiological slots out made "other" much larger and cut posture variety, so they
 * stay candidates; they never name a group (situationName) unless they say what happens. Each candidate scores
 * (unassigned scenes that have it) x ln(N / scenes of the pool that have it). The best tag
 * makes a situation with its unassigned scenes; this repeats until no tag covers
 * MIN_SITUATION_SHARE of the pool or MAX_SITUATIONS exist, first with what happens in the
 * scenes, then with framings for the scenes left. The rest is "other".
 * Deterministic: ties go to the tag seen first.
 */
export function groupSituations(scenes: Scene[], overrides: Record<string, string> = {}): Situation[] {
  const isCandidate = (tag: string) => {
    if (BARE_VERBS.has(tag)) return false
    if (FRAMING_RE.test(tag) || HELD_RE.test(tag)) return true
    const slot = getTagSlotFromOverrides(tag, overrides)?.slot
    return !!slot && KEY_SLOTS.has(slot)
  }
  const candidates = new Map<string, Scene[]>()
  for (const scene of scenes) {
    for (const tag of new Set(situationTags(scene))) {
      if (!isCandidate(tag)) continue
      const list = candidates.get(tag)
      if (list) list.push(scene)
      else candidates.set(tag, [scene])
    }
  }
  const theme = new Set(Array.from(candidates).filter(([, list]) => list.length >= SITUATION_THEME_SHARE * scenes.length).map(([tag]) => tag))
  theme.forEach((tag) => candidates.delete(tag))

  const order = Array.from(candidates.keys())
  const assigned = new Set<Scene>()
  const groups: Array<{ tag: string; scenes: Scene[] }> = []
  // What happens first; the framing only groups scenes nothing else does.
  const phases = [order.filter((tag) => !FRAMING_RE.test(tag)), order.filter((tag) => FRAMING_RE.test(tag))]
  for (const phase of phases) while (groups.length < MAX_SITUATIONS) {
    let bestTag: string | null = null
    let bestScore = 0
    for (const tag of phase) {
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
  const usedLabels = new Set<string>()
  const situations: Situation[] = groups.map(({ tag, scenes: members }) => {
    const label = situationName(members, tag, overrides, usedLabels, theme)
    usedLabels.add(labelKey(label))
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

/** Slots of the tags that make a group: how the body is or what it does. */
const KEY_SLOTS = new Set(['pose:posture', 'pose:kinetic', 'pose:combat', 'pose:interaction', 'pose:physiological', 'pose:gesture'])
/** Slots that can name a group: those, and a hand gesture as the second word. */
const DESCRIPTIVE_SLOTS = new Set(['pose:posture', 'pose:kinetic', 'pose:combat', 'pose:interaction', 'pose:gesture'])
/** Camera tags that are a framing ("from above", "upper body"), not a gaze or an effect. */
const FRAMING_RE = /^(from (above|below|behind|side|the side)|upper body|lower body|full body|cowboy shot|portrait|close-up|wide shot|dutch angle|head out of frame|feet out of frame|pov)$/
/** What a scene's character holds: "holding umbrella" groups, a bare "holding" doesn't. */
const HELD_RE = /^holding .+/
/** Verbs that only mean something with their object. */
const BARE_VERBS = new Set(['holding', 'carrying', 'riding', 'wielding'])

/** Tags of a scene that can make or name its group. */
const situationTags = (scene: Scene): string[] => [
  ...scene.units.skeleton,
  ...scene.units.camera,
  ...scene.units.extras.filter((tag) => HELD_RE.test(tag)),
]

/** A label's identity whatever the order: "lying · spread legs" and "spread legs · lying" are one name. */
const labelKey = (label: readonly string[]) => [...label].sort().join(' + ')

/** True when one tag already says the other: "standing on one leg" and "standing", "holding hands" and "holding". */
function overlaps(a: string, b: string): boolean {
  const wa = ` ${a} `
  const wb = ` ${b} `
  return wa.includes(wb) || wb.includes(wa)
}

/** Tags of the group by how many of its scenes carry them, most first (ties keep first-seen order). */
function byFrequency(members: Scene[], pick: (scene: Scene) => string[]): string[] {
  const counts = new Map<string, number>()
  for (const scene of members) new Set(pick(scene)).forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1))
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([tag]) => tag)
}

/**
 * A situation's readable name: what happens in it (posture, action, interaction,
 * gesture), then its framing, then its location. The tag that grouped the scenes
 * leads when it is one of those; an effect or a symbol ("sweat", "squeans") never
 * names a group. Two tags at most, and not a name an earlier group already has.
 */
function situationName(
  members: Scene[],
  tag: string,
  overrides: Record<string, string>,
  used: ReadonlySet<string>,
  theme: ReadonlySet<string>
): string[] {
  const slotOf = (t: string) => getTagSlotFromOverrides(t, overrides)?.slot
  const usable = (t: string) => !theme.has(t) && !BARE_VERBS.has(t)
  const descriptive = byFrequency(members, (scene) =>
    [...scene.units.skeleton, ...scene.units.extras.filter((t) => HELD_RE.test(t))].filter(
      (t) => usable(t) && (DESCRIPTIVE_SLOTS.has(slotOf(t) ?? '') || HELD_RE.test(t))
    )
  )
  const framing = byFrequency(members, (scene) => scene.units.camera.filter((t) => FRAMING_RE.test(t) && usable(t)))
  const setting = byFrequency(members, (scene) => scene.units.place.filter((t) => slotOf(t) === 'scenery:setting' && usable(t)))
  // The group's own tag leads only when it can name it: an act or an effect makes the group but doesn't name it.
  const leads = DESCRIPTIVE_SLOTS.has(slotOf(tag) ?? '') || FRAMING_RE.test(tag) || HELD_RE.test(tag)
  const candidates = Array.from(new Set([...(leads ? [tag] : []), ...descriptive, ...framing, ...setting].filter(usable)))
  if (candidates.length === 0) return [tag]
  // The group's own tag leads; the second word adds something it doesn't already say.
  const pairs: string[][] = []
  candidates.forEach((a, i) => {
    candidates.slice(i + 1).forEach((b) => {
      if (!overlaps(a, b)) pairs.push([a, b])
    })
  })
  const leading = pairs.filter((pair) => pair[0] === candidates[0])
  return [...leading, ...pairs, [candidates[0]]].find((pair) => !used.has(labelKey(pair))) ?? [candidates[0]]
}
