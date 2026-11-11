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
    // Two to one is clear: a man's solo posts still carry some "1girl" (a genderswap, a
    // drawing of someone else filed under him), and the threshold must not miss him.
    const ratio = soloBoy / Math.max(soloGirl, 0.01)
    return ratio >= 2 ? 'boy' : ratio <= 0.5 ? 'girl' : null
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

/** The count tags for these people ("1girl, 1boy", "3girls"); e621 counts with duo / trio. */
function countTags(people: PackPeople, provider: BooruProvider): string[] {
  const vocab = vocabularyOf(provider)
  const total = people.girls + people.boys
  if (vocab === 'e621') return [total === 2 ? 'duo' : total === 3 ? 'trio' : 'solo']
  // Rule34 spells one girl "1girls".
  const girl = people.girls === 1 ? (vocab === 'rule34' ? '1girls' : '1girl') : `${people.girls}girls`
  const boy = people.boys === 1 ? '1boy' : `${people.boys}boys`
  return [...(people.girls > 0 ? [girl] : []), ...(people.boys > 0 ? [boy] : [])]
}

/** One tag for these people when the count tags don't fit: the pairing, or the rarer gender's count. */
function singleTag(people: PackPeople, provider: BooruProvider, explicit: boolean): string {
  const pairing = PAIRINGS[vocabularyOf(provider)][`${people.girls}g${people.boys}b`]
  // Threesome pairings exist almost only on explicit posts: 1 to 12 posts at a safe rating.
  const usable = pairing && (explicit || !pairing.includes('threesome'))
  if (usable) return pairing
  const counts = countTags(people, provider)
  return people.boys > 0 && people.boys <= people.girls ? counts[counts.length - 1] : counts[0]
}

/**
 * The search for scenes with these people. Measured on Gelbooru at a safe and an
 * explicit rating, the count tags ("1girl 1boy", "2girls 1boy") give more posts with
 * exactly these people than the pairing tags ("hetero", "ffm_threesome") for every
 * group (the exact head count is checked on the posts afterwards). So the count
 * tags are used whenever they fit the booru's tag limit with room for the user's
 * theme; otherwise one tag. `extraTags` (the theme) are appended while the limit allows.
 */
export function compositionQuery(
  people: PackPeople,
  provider: BooruProvider,
  extraTags = '',
  rating: 'sfw' | 'questionable' | 'explicit' | 'both' = 'explicit'
): string {
  const limit = getProviderTagLimit(provider)
  const counts = countTags(people, provider)
  const extras = splitTags(extraTags.replace(/,/g, ' ')).filter((tag) => !tag.startsWith('rating:'))
  const room = (n: number) => (Number.isFinite(limit) ? Math.max(0, limit - n) : extras.length)
  const fits = !Number.isFinite(limit) || counts.length + (extras.length > 0 ? 1 : 0) <= limit
  const lead = fits ? counts : [singleTag(people, provider, rating !== 'sfw')]
  const own = new Set(lead)
  return [...lead, ...extras.filter((tag) => !own.has(tag)).slice(0, room(lead.length))].join(', ')
}

export type CastAddition = 'added' | 'duplicate' | 'full'

/** Whether `character` can join a cast that has `members` (pack-normalized names, the base character first). */
export function castAddition(members: readonly string[], character: string): CastAddition {
  if (members.includes(character)) return 'duplicate'
  return members.length >= MAX_CAST ? 'full' : 'added'
}

/**
 * The search the app sets up for a character base: the character's own posts
 * alone (`soloSearch`, e.g. "name, solo"), or, for a cast of two or more, pictures
 * of the same mix of people. Null while a cast member's role is unknown.
 */
export function castDefaultSearch(
  roles: ReadonlyArray<CastRole | null>,
  soloSearch: string,
  provider: BooruProvider,
  rating: 'sfw' | 'questionable' | 'explicit' | 'both' = 'explicit'
): string | null {
  if (roles.length < 2) return soloSearch
  if (roles.some((role) => !role)) return null
  return compositionQuery(castPeople(roles), provider, '', rating)
}

/**
 * A cast member's look comes only from posts that show them alone: the static trait
 * profile counts every post they are in, so a character mostly drawn next to
 * someone else picks up that person's hair and eyes. `soloLook` is typicalLook over
 * their own solo posts, null until those arrive or when there are too few.
 */
export function castMemberLook(character: string, soloLook: readonly string[] | null | undefined): string[] {
  return Array.from(new Set([character, ...(soloLook ?? [])]))
}
