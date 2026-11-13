/**
 * Invented scenes: scenes the scene model (lib/scene-model/) writes for the
 * pack's character, added to the pool next to the real posts.
 *
 * Each one becomes a post-shaped donor (negative id, `_invented`, no image)
 * whose tag_string is the generated scene, so it goes through exactly what a
 * real post goes through: extraction by slot, permanence, the block list,
 * the conflict resolver and the cleaner. What the pool learns from its posts
 * (how many carry a tag, which tags are names) comes from real posts only.
 */
import type { BooruPost } from '../../booru/types'
import { normalizeTagForPack } from '../pack-generator'
import type { SceneConditions } from '../../scene-model/sampler'
import { normalizeRating, type SceneRating } from './scene'
import type { PackPeople } from './scene-pool'

/** Share of the pool's real posts that invented scenes add, and the bounds of that number. */
export const INVENTED_SCENES_SHARE = 0.25
export const MIN_INVENTED_SCENES = 8
export const MAX_INVENTED_SCENES = 30

/** How many invented scenes a pool of `realPosts` posts gets. */
export function inventedSceneCount(realPosts: number): number {
  return Math.min(MAX_INVENTED_SCENES, Math.max(MIN_INVENTED_SCENES, Math.round(INVENTED_SCENES_SHARE * realPosts)))
}

export const isInventedPost = (post: Pick<BooruPost, '_invented'>): boolean => post._invented === true

/**
 * The rating of each of `count` scenes: the pack's ratings shared out as the
 * real posts are (largest remainder), or the lowest allowed rating when no
 * post has one of them.
 */
export function ratingPlan(postRatings: readonly string[], allowed: readonly SceneRating[], count: number): SceneRating[] {
  if (count <= 0 || allowed.length === 0) return []
  const counts = new Map<SceneRating, number>(allowed.map((r) => [r, 0]))
  for (const raw of postRatings) {
    const rating = normalizeRating(raw)
    if (counts.has(rating)) counts.set(rating, counts.get(rating)! + 1)
  }
  const total = Array.from(counts.values()).reduce((a, b) => a + b, 0)
  if (total === 0) return Array.from({ length: count }, () => allowed[0])
  const shares = allowed.map((rating) => ({ rating, exact: (counts.get(rating)! / total) * count }))
  const plan = shares.map((s) => ({ rating: s.rating, n: Math.floor(s.exact), rest: s.exact - Math.floor(s.exact) }))
  let left = count - plan.reduce((sum, p) => sum + p.n, 0)
  for (const p of [...plan].sort((a, b) => b.rest - a.rest)) {
    if (left <= 0) break
    p.n++
    left--
  }
  return plan.flatMap((p) => Array.from({ length: p.n }, () => p.rating))
}

/** The people-count tags of a composition, as the booru writes them: 1 girl → "1girl", "solo". */
export function peopleTags(people: PackPeople): string[] {
  const count = (n: number, word: 'girl' | 'boy') => (n <= 0 ? [] : [n >= 6 ? `6+${word}s` : n === 1 ? `1${word}` : `${n}${word}s`])
  const tags = [...count(people.girls, 'girl'), ...count(people.boys, 'boy')]
  if (people.girls + people.boys === 1) tags.push('solo')
  if (people.girls >= 2) tags.push('multiple_girls')
  if (people.boys >= 2) tags.push('multiple_boys')
  return tags
}

const FAKE = /^fake /
/** The model's body conditions, read off the character's identity tags. */
const BODY_RULES: ReadonlyArray<[string, (tag: string) => boolean]> = [
  ['futanari', (tag) => tag === 'futanari'],
  ['furry', (tag) => tag === 'furry' || tag === 'furry female' || tag === 'furry male'],
  ['tail', (tag) => (tag === 'tail' || tag.endsWith(' tail')) && !FAKE.test(tag)],
  ['animal_ears', (tag) => (tag === 'animal ears' || tag.endsWith(' ears')) && !FAKE.test(tag) && !tag.includes('pointy')],
  ['horns', (tag) => (tag === 'horns' || tag.endsWith(' horns') || tag.endsWith(' horn')) && !FAKE.test(tag)],
  ['wings', (tag) => (tag === 'wings' || tag.endsWith(' wings')) && !FAKE.test(tag) && tag !== 'hair wings'],
]

/** Body traits of the model ("animal_ears", "tail"…) the identity tags show, at most four. */
export function bodyTraits(identity: readonly string[]): string[] {
  const tags = identity.map(normalizeTagForPack)
  return BODY_RULES.filter(([, test]) => tags.some(test)).map(([name]) => name).slice(0, 4)
}

/**
 * The series of the pack's characters: the base card's copyright field when there is
 * one, else the series most of the pool's posts with one of the characters list
 * (at least half of them).
 */
export function seriesOf(cardCopyrights: string | undefined, posts: readonly BooruPost[], characters: readonly string[]): string[] {
  const own = (cardCopyrights ?? '').split(/\s+/).filter(Boolean)
  if (own.length > 0) return own.slice(0, 3)
  if (characters.length === 0) return []
  const names = new Set(characters.map(normalizeTagForPack))
  const counts = new Map<string, number>()
  let withCharacter = 0
  for (const post of posts) {
    const listed = (post.tag_string_character || '').split(/\s+/).filter(Boolean).map(normalizeTagForPack)
    if (!listed.some((name) => names.has(name))) continue
    withCharacter++
    new Set((post.tag_string_copyright || '').split(/\s+/).filter(Boolean)).forEach((series) => counts.set(series, (counts.get(series) ?? 0) + 1))
  }
  const best = Array.from(counts).sort((a, b) => b[1] - a[1])[0]
  return best && best[1] * 2 >= withCharacter ? [best[0]] : []
}

/** Booru spelling: spaces become underscores. */
const fieldTag = (tag: string) => tag.trim().replace(/\s+/g, '_')

export interface InventedSceneSpec {
  conditions: SceneConditions
  /** The composition's count tags: the model doesn't write them, the post must have them. */
  people: string[]
}

/**
 * The model's conditions for one scene of the pack. `characters` and `series` are
 * the pack's (booru names); none means an original character.
 */
export function inventedSceneSpec(input: {
  rating: SceneRating
  people: PackPeople
  identity: readonly string[]
  characters: readonly string[]
  series: readonly string[]
}): InventedSceneSpec {
  const people = peopleTags(input.people)
  const characters = input.characters.map(fieldTag).filter(Boolean)
  return {
    people,
    conditions: {
      rating: input.rating,
      people,
      body: bodyTraits(input.identity),
      characters,
      noCharacter: characters.length === 0,
      series: input.series.map(fieldTag).filter(Boolean),
    },
  }
}

let nextInventedId = -1

/**
 * An invented scene as a post: negative id (never a real post's), no image or
 * link, the count tags first, then the scene. The characters and series it was
 * written for fill the typed fields, as a real post of them would.
 */
export function inventedPost(spec: InventedSceneSpec, tags: readonly string[]): BooruPost {
  const id = nextInventedId--
  const conditions = spec.conditions
  return {
    id,
    _invented: true,
    file_url: '',
    large_file_url: '',
    preview_file_url: '',
    tag_string: Array.from(new Set([...spec.people, ...tags].map(fieldTag))).join(' '),
    tag_string_artist: '',
    tag_string_character: (conditions.characters ?? []).join(' '),
    tag_string_copyright: (conditions.series ?? []).join(' '),
    tag_string_meta: '',
    rating: conditions.rating,
    score: 0,
  }
}
