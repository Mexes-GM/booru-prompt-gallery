/**
 * "Changes: only one thing": every prompt of a pack is one base scene, with a single unit
 * (the outfit, the pose, the place or the expression) taken from another scene, the donor.
 * The rules of what a donor may lend live here; the pack itself is built in scene-pack.ts.
 *
 * A donor that contradicts what stays fixed is skipped, never patched: its unit is checked
 * against the rest of the base with the same rules Remix and the last pass use (the conflict
 * resolver either way round, the measured exclusions, plain background against a scene, the
 * people rule, the supports a pose leans on).
 */
import type { ChangesAxis } from '../brief'
import { resolveTagConflicts } from '../../tag-conflicts'
import { getTagSlotFromOverrides } from '../../tag-taxonomy'
import { excludes, type TagRelations } from '../../tag-relations'
import { conflictsWithBackground } from '../background-coherence'
import { isCompanyAct, showsOnePerson } from '../prompt-coherence'
import { isCompositionPattern } from './permanence'
import { placeFits, type LentSource } from './scene-compose'
import { jaccard, unitOfSlot, type Scene, type UnitName } from './scene'

/** An axis of a one-axis pack (every `ChangesAxis` but the whole scene). */
export type OneAxis = Exclude<ChangesAxis, 'scene'>

/**
 * The units each axis moves. The exposure travels with the outfit, as in Remix: what a picture
 * shows of the body goes with the clothes it was shown with.
 */
export const AXIS_UNITS: Readonly<Record<OneAxis, readonly UnitName[]>> = {
  outfit: ['outfit', 'exposure'],
  pose: ['skeleton'],
  place: ['place'],
  expression: ['face'],
}

/** Where the donor is recorded in ScenePrompt.sources. */
export const AXIS_SOURCE: Readonly<Record<OneAxis, LentSource>> = {
  outfit: 'outfit',
  pose: 'pose',
  place: 'place',
  expression: 'face',
}

/** The axis whose units hold a tag of `slot`, or null. */
export function axisOfSlot(slot: string | undefined): OneAxis | null {
  const unit = slot ? unitOfSlot(slot) : null
  if (!unit) return null
  return (Object.keys(AXIS_UNITS) as OneAxis[]).find((axis) => AXIS_UNITS[axis].includes(unit)) ?? null
}

/** The axis a tag belongs to by its slot, or null. */
export function axisOfTag(tag: string, overrides: Record<string, string>): OneAxis | null {
  return axisOfSlot(getTagSlotFromOverrides(tag, overrides)?.slot)
}

/** The tags of `scene` on `axis`, in prompt order. */
export function axisTags(scene: Scene, axis: OneAxis): string[] {
  return AXIS_UNITS[axis].flatMap((unit) => scene.units[unit])
}

/** A comparable key for a set of tags: two prompts with the same key repeat the axis. */
export const axisKey = (tags: readonly string[]): string => Array.from(new Set(tags)).sort().join('|')

const peopleKey = (scene: Scene): string => (scene.people ? `${scene.people.girls}g${scene.people.boys}b` : 'open')

/** Nouns a pose of `scene` leans on ("sitting on bed" leans on "bed"); not indoors / outdoors. */
function poseSupports(scene: Scene): string[] {
  return scene.anchors.filter(
    (anchor) => anchor !== 'indoors' && anchor !== 'outdoors' && scene.units.skeleton.some((tag) => tag.endsWith(` ${anchor}`))
  )
}

const names = (tags: readonly string[], noun: string) => tags.some((tag) => tag === noun || tag.endsWith(` ${noun}`))

/**
 * Whether `donor` can lend its `axis` to `base` by what the two scenes are, before any tag is
 * compared: the same people for a pose or an outfit (Remix lends an outfit only between scenes of
 * the same people; a pose of two is never put on a picture of one), a place that holds the base's
 * pose (placeFits, as Remix), a pose whose supports the base's place (or the imposed one) names.
 */
export function canLend(base: Scene, donor: Scene, axis: OneAxis, where: readonly string[]): boolean {
  switch (axis) {
    case 'outfit':
      return peopleKey(donor) === peopleKey(base)
    case 'pose':
      return peopleKey(donor) === peopleKey(base) && poseSupports(donor).every((noun) => names(where.length > 0 ? where : base.units.place, noun))
    case 'place':
      return placeFits(base, donor)
    case 'expression':
      return true
  }
}

/**
 * True when the tags a donor lends (`lent`) can't go with what stays of the base (`rest`, header
 * and identity included): the conflict resolver either way round, a plain background against a
 * scene, the measured exclusions for a picture of `people`, or an act that needs company in a
 * picture of one person.
 */
export function lendingClashes(
  lent: readonly string[],
  rest: readonly string[],
  people: number,
  overrides: Record<string, string>,
  relations: TagRelations | null,
  /**
   * Only what the lent tags bring counts: a conflict the rest already has without them (a real
   * post tagged "cowboy shot" and "full body") isn't the donor's. Off by default.
   */
  ownConflictsAside = false
): boolean {
  if (lent.length === 0) return false
  const header = rest.filter(isCompositionPattern)
  const others = rest.filter((tag) => !isCompositionPattern(tag))
  if (resolveTagConflicts([...rest], [...lent]).conflictingTags.length > 0) return true
  const against = resolveTagConflicts([...header, ...lent], others).conflictingTags
  if (ownConflictsAside) {
    const own = new Set(resolveTagConflicts([...header], others).conflictingTags.map((c) => c.tag))
    if (against.some((c) => !own.has(c.tag))) return true
  } else if (against.length > 0) return true
  if (lent.some((tag) => conflictsWithBackground(tag, rest, overrides))) return true
  if (relations && lent.some((a) => others.some((b) => excludes(relations, a, b, { people })))) return true
  return showsOnePerson(header) && lent.some((tag) => isCompanyAct(tag, overrides, relations))
}

/**
 * An expression the conflict resolver keeps out of a picture that doesn't show the face ("from
 * behind" without "looking back"). Not a part of the face: the resolver lets those in once any tag
 * names the face, and every character's "... eyes" does.
 */
const FACE_PROBE = 'smile'

/**
 * True when a picture with `tags` shows the character's face: the conflict resolver lets a part of
 * the face in. Not "from behind" (unless "looking back", a profile, a mirror...). An expression lent
 * to a picture that hides the face contradicts it, whatever the expression's words are.
 */
export function showsFace(tags: readonly string[]): boolean {
  return resolveTagConflicts([...tags], [FACE_PROBE]).conflictingTags.length === 0
}

/**
 * Donors in the order a pack tries them: the preferred posts first, then the scenes at least as
 * typical of the pool as the median, then the rest; within each group, the donor whose unit is
 * farthest from every unit already in the pack (random among ties), so the first prompts already
 * show different outfits, poses, places or faces.
 */
export class DonorQueue {
  private readonly groups: Scene[][]
  /** Distance of each waiting donor's unit to the nearest unit already in the pack. */
  private readonly nearest = new Map<number, number>()

  constructor(
    donors: readonly Scene[],
    private readonly valueOf: (scene: Scene) => readonly string[],
    taken: ReadonlyArray<readonly string[]>,
    preferred: ReadonlySet<number>,
    private readonly rng: () => number
  ) {
    const first = donors.filter((scene) => preferred.has(scene.postId))
    const rest = donors.filter((scene) => !preferred.has(scene.postId))
    const values = rest.map((scene) => scene.typicality ?? 1).sort((a, b) => a - b)
    const middle = Math.floor(values.length / 2)
    const median = values.length === 0 ? 0 : values.length % 2 === 1 ? values[middle] : (values[middle - 1] + values[middle]) / 2
    this.groups = [
      first,
      rest.filter((scene) => (scene.typicality ?? 1) >= median),
      rest.filter((scene) => (scene.typicality ?? 1) < median),
    ].filter((group) => group.length > 0)
    donors.forEach((scene) => this.nearest.set(scene.postId, 1))
    taken.forEach((value) => this.accept(value))
  }

  /** The next donor to try, or null when none is left. */
  next(): Scene | null {
    const group = this.groups.find((g) => g.length > 0)
    if (!group) return null
    let best: number[] = []
    let bestDistance = -1
    group.forEach((scene, i) => {
      const distance = this.nearest.get(scene.postId) ?? 1
      if (distance > bestDistance + 1e-9) {
        bestDistance = distance
        best = [i]
      } else if (Math.abs(distance - bestDistance) <= 1e-9) {
        best.push(i)
      }
    })
    const [scene] = group.splice(best[Math.floor(this.rng() * best.length)], 1)
    this.nearest.delete(scene.postId)
    return scene
  }

  /** A unit now in the pack: the donors still waiting measure their distance to it too. */
  accept(value: readonly string[]): void {
    this.groups.forEach((group) =>
      group.forEach((scene) => {
        const distance = 1 - jaccard(this.valueOf(scene), value)
        if (distance < (this.nearest.get(scene.postId) ?? 1)) this.nearest.set(scene.postId, distance)
      })
    )
  }
}
