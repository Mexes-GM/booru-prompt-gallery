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
import { isCompositionPattern } from './permanence'

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

/**
 * A cast member's role: the user's pick, else what their own solo posts say
 * ("1boy"), else their trait profile. Null only when none of these knows: then
 * the panel asks.
 */
export function castMemberRole(
  picked: CastRole | null | undefined,
  soloSubject: readonly string[] | null | undefined,
  profile: Record<string, number> | undefined
): CastRole | null {
  return picked ?? roleFromSubject(soloSubject ?? []) ?? roleFromProfile(profile)
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

/**
 * For a group of one gender, the count tags of the other one to leave out: most
 * "2girls" posts at an explicit rating also have a boy, so the count alone finds few
 * pictures of just the two girls. Empty for a mixed group and on e621.
 */
function exclusionTags(people: PackPeople, provider: BooruProvider): string[] {
  const vocab = vocabularyOf(provider)
  if (vocab === 'e621') return []
  if (people.boys === 0) return ['-1boy', '-2boys']
  if (people.girls === 0) return [vocab === 'rule34' ? '-1girls' : '-1girl', '-2girls']
  return []
}

/** The pairing tag for these people, when the rating has enough posts with it. */
function pairingTag(people: PackPeople, provider: BooruProvider, safe: boolean): string | null {
  const pairing = PAIRINGS[vocabularyOf(provider)][`${people.girls}g${people.boys}b`]
  // Threesome pairings exist almost only on non-safe posts (a few dozen at a safe rating).
  return pairing && (!safe || !pairing.includes('threesome')) ? pairing : null
}

/** The rarer gender's count tag: the one count that narrows the search most. */
function rarerCount(people: PackPeople, provider: BooruProvider): string {
  const counts = countTags(people, provider)
  return people.boys > 0 && people.boys <= people.girls ? counts[counts.length - 1] : counts[0]
}

/**
 * The search for scenes with these people, best first among those that fit the
 * booru's tag limit with room for the user's theme. Measured on Gelbooru at every
 * rating (share of the top posts with exactly these people, and how many posts):
 *  - a mixed group: the count tags ("1girl 1boy", "2girls 1boy") match as often as
 *    the pairing tags and find several times more posts; threesome tags have only a
 *    few dozen posts at a safe rating;
 *  - one gender: the count alone is poor ("2girls" posts mostly have a boy too at
 *    an explicit rating), the count without the other gender's counts is best
 *    ("2girls -1boy -2boys"), then the pairing ("yuri").
 * The exact head count is checked on the posts afterwards. `extraTags` (the theme)
 * are appended while the limit allows; ratings are left to the source.
 */
export function compositionQuery(
  people: PackPeople,
  provider: BooruProvider,
  extraTags = '',
  rating: 'sfw' | 'questionable' | 'explicit' | 'both' = 'explicit'
): string {
  const limit = getProviderTagLimit(provider)
  const counts = countTags(people, provider)
  const exclusions = exclusionTags(people, provider)
  const pairing = pairingTag(people, provider, rating === 'sfw')
  const extras = splitTags(extraTags.replace(/,/g, ' ')).filter((tag) => !tag.startsWith('rating:'))
  const candidates: string[][] = exclusions.length > 0
    ? [[...counts, ...exclusions], [...counts, exclusions[0]], ...(pairing ? [[pairing]] : []), counts]
    : [counts, [pairing ?? rarerCount(people, provider)]]
  const fits = (lead: string[]) => !Number.isFinite(limit) || lead.length + (extras.length > 0 ? 1 : 0) <= limit
  const lead = candidates.find(fits) ?? [pairing ?? rarerCount(people, provider)]
  const own = new Set(lead)
  const room = Number.isFinite(limit) ? Math.max(0, limit - lead.length) : extras.length
  return [...lead, ...extras.filter((tag) => !own.has(tag)).slice(0, room)].join(', ')
}

/**
 * The theme of a source the user wrote, for the cast's group search: its tags less
 * character names (the cast's, and any `isCharacter` knows), people counts and
 * pairing ("solo", "1girl", "hetero") and ratings. "yor_briar, solo, beach" -> "beach".
 */
export function castTheme(sourceTags: string, castNames: readonly string[], isCharacter: (tag: string) => boolean = () => false): string {
  const names = new Set(castNames.map((name) => name.toLowerCase().replace(/_/g, ' ').trim()))
  return splitTags(sourceTags.replace(/,/g, ' '))
    .filter((raw) => {
      const tag = raw.toLowerCase().replace(/_/g, ' ').trim()
      return !!tag && !tag.startsWith('rating:') && !names.has(tag) && !isCompositionPattern(tag) && !isCharacter(tag)
    })
    .join(', ')
}

export type CastAddition = 'added' | 'duplicate' | 'full'

/** Whether `character` can join a cast that has `members` (pack-normalized names, the base character first). */
export function castAddition(members: readonly string[], character: string): CastAddition {
  if (members.includes(character)) return 'duplicate'
  return members.length >= MAX_CAST ? 'full' : 'added'
}

/**
 * The cast that typing several names makes (pack-normalized, the base character
 * first): each name joins as "Add a character" would take it, so repeats and names
 * past MAX_CAST are left out, and empty ones are skipped.
 */
export function castFromNames(names: readonly string[]): string[] {
  const cast: string[] = []
  for (const name of names) {
    if (name && castAddition(cast, name) === 'added') cast.push(name)
  }
  return cast
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

/** Where a cast member's look comes from. */
export type CastLookSource = 'solo' | 'loading' | 'profile'

/**
 * A cast member's look when too few posts show them alone: their static trait
 * profile, cleaned of what it borrows from the people they're drawn with. A trait
 * another cast member's own look has goes (their partner's hair is theirs), and
 * among traits one person (almost) never has together (two hair colours, two
 * lengths, two eye colours) only the most frequent stays. `look` is the profile's
 * look (profileIdentity); `weightOf` its share of posts; `conflicts` says whether
 * one person can't have both.
 */
export function cleanProfileLook(
  look: readonly string[],
  weightOf: (tag: string) => number,
  othersLooks: ReadonlyArray<readonly string[]>,
  conflicts: (kept: readonly string[], tag: string) => boolean
): string[] {
  const others = new Set(othersLooks.flat())
  const kept: string[] = []
  const ranked = look
    .map((tag, i) => ({ tag, i }))
    .filter(({ tag }) => !others.has(tag))
    .sort((a, b) => weightOf(b.tag) - weightOf(a.tag) || a.i - b.i)
  for (const { tag } of ranked) if (!conflicts(kept, tag)) kept.push(tag)
  // Back in the profile's own order.
  return look.filter((tag) => kept.includes(tag))
}
