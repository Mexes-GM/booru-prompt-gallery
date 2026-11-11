/**
 * A cast: the one to three named characters of a pack. Each has a role (girl or
 * boy) that says where they go in a scene; the cast's roles say which scenes
 * can hold them, and which search finds those scenes. A two-person scene is
 * almost never found by searching both names together, so the search asks for
 * the mix of people instead ("hetero", "yuri"), and the user adds the theme.
 */
import type { BooruProvider } from '../../booru/types'
import { getProviderTagLimit } from '../../booru/tag-limits'
import { splitTags } from '../../utils/tag-utils'
import type { PackPeople } from './scene-pool'

export type CastRole = 'girl' | 'boy'

/** Most characters a pack names. */
export const MAX_CAST = 3

/** People the cast names, by gender. Unknown roles are not counted. */
export function castPeople(roles: ReadonlyArray<CastRole | null>): PackPeople {
  return {
    girls: roles.filter((role) => role === 'girl').length,
    boys: roles.filter((role) => role === 'boy').length,
  }
}

/** True when a composition has room for everyone the cast names. */
export function holdsCast(people: PackPeople, cast: PackPeople): boolean {
  return people.girls >= cast.girls && people.boys >= cast.boys
}

/**
 * A role from a character's trait profile: how often their solo posts carry 1boy
 * against 1girl (the count tag is then the character), or, without enough solo
 * posts, all their posts with a much clearer ratio (there the count is often the
 * partner). Null when the profile leaves doubt.
 */
export function roleFromProfile(profile: Record<string, number> | undefined): CastRole | null {
  if (!profile) return null
  const soloBoy = profile['solo 1boy'] ?? 0
  const soloGirl = profile['solo 1girl'] ?? 0
  if (soloBoy + soloGirl >= 0.5) {
    const ratio = soloBoy / Math.max(soloGirl, 0.01)
    return ratio >= 5 ? 'boy' : ratio <= 0.2 ? 'girl' : null
  }
  const boy = profile['1boy'] ?? 0
  const girl = profile['1girl'] ?? 0
  if (Math.max(boy, girl) < 0.5) return null
  const ratio = boy / Math.max(girl, 0.01)
  return ratio >= 2 ? 'boy' : ratio <= 0.5 ? 'girl' : null
}

/** A role from subject tags ("1girl", "1boy"); null when they say neither, or both. */
export function roleFromSubject(tags: readonly string[]): CastRole | null {
  const set = new Set(tags.map((tag) => tag.toLowerCase().replace(/_/g, ' ').trim()))
  const girl = set.has('1girl')
  const boy = set.has('1boy')
  return girl === boy ? null : girl ? 'girl' : 'boy'
}

type Vocabulary = 'danbooru' | 'rule34' | 'e621'

function vocabularyOf(provider: BooruProvider): Vocabulary {
  if (provider === 'e621' || provider === 'e6ai') return 'e621'
  if (provider === 'rule34') return 'rule34'
  return 'danbooru'
}

/** Pairing tags per booru, by "<girls>g<boys>b". Tag names as each site spells them. */
const PAIRINGS: Record<Vocabulary, Record<string, string>> = {
  danbooru: { '2g0b': 'yuri', '1g1b': 'hetero', '0g2b': 'yaoi', '3g0b': 'fff_threesome', '2g1b': 'ffm_threesome', '1g2b': 'mmf_threesome' },
  rule34: { '2g0b': 'yuri', '1g1b': 'hetero', '0g2b': 'yaoi', '3g0b': 'fff_threesome', '2g1b': 'ffm_threesome', '1g2b': 'mmf_threesome' },
  e621: { '2g0b': 'female/female', '1g1b': 'male/female', '0g2b': 'male/male' },
}

/** The count tag to search when no pairing tag fits: the rarer gender narrows the search most. */
function countTag(people: PackPeople, provider: BooruProvider): string {
  const vocab = vocabularyOf(provider)
  const total = people.girls + people.boys
  if (vocab === 'e621') return total === 2 ? 'duo' : total === 3 ? 'trio' : 'solo'
  if (people.boys > 0 && (people.girls === 0 || people.boys <= people.girls)) return people.boys === 1 ? '1boy' : `${people.boys}boys`
  // Rule34 spells one girl "1girls".
  return people.girls === 1 ? (vocab === 'rule34' ? '1girls' : '1girl') : `${people.girls}girls`
}

/**
 * The search for scenes with these people: one tag (the pairing, or a count when
 * the booru has no pairing tag for them), so the user's theme fits within the
 * booru's tag limit; `extraTags` are appended while the limit allows. The exact
 * head count is checked on the posts that come back, so one tag is enough.
 */
export function compositionQuery(people: PackPeople, provider: BooruProvider, extraTags = ''): string {
  const pairing = PAIRINGS[vocabularyOf(provider)][`${people.girls}g${people.boys}b`]
  const lead = pairing ?? countTag(people, provider)
  const extras = splitTags(extraTags.replace(/,/g, ' ')).filter((tag) => !tag.startsWith('rating:') && tag !== lead)
  const limit = getProviderTagLimit(provider)
  const room = Number.isFinite(limit) ? Math.max(0, limit - 1) : extras.length
  return [lead, ...extras.slice(0, room)].join(', ')
}
