/**
 * How many people a post shows, by gender, read in the vocabulary of the site it comes from.
 *
 * Danbooru-like sites (Danbooru, Gelbooru, Aibooru) count everyone: "1girl, 2boys" says the picture
 * has one girl and two boys, and a gender without a count tag is absent. Rule34 doesn't: its posts
 * often carry the count of one gender only, or none, and say who is there with presence tags ("male",
 * "female", "multiple males") and group tags ("mmf threesome", "group sex"). Read the Danbooru way, a
 * Rule34 post tagged "1girls, male" is a girl alone (wrong) and one tagged "female, male" has no
 * known people (lost). The search side already speaks each site's vocabulary (cast.ts
 * compositionQuery: "1girls" and the threesome tags on Rule34); this is the way back.
 *
 * The rule gives a composition only when the tags pin it down, and otherwise null with what is known
 * for sure (at least so many of each gender) and why. Measured on 1029 Rule34 posts (ENG-9): of the
 * posts whose counts agree with their presence tags, 91 % of those that count a boy carry "male",
 * but 28 % of those that count no boy carry it too (the count is incomplete, not the picture);
 * "mmf threesome" is one girl and two boys in 97 %; "foursome" is four people in 13 of 13;
 * "threesome" next to one gender's count is three people in 95 % (75 of 79), alone only 86 %;
 * "fff threesome" 22 %, "solo" with one presence tag 81 %, "female" alone 85 %: none of those gives a
 * number. Hiding one gender's counts on those posts, the rule recovers 164 of 167 it deduces; the 3
 * others are posts whose own count and "threesome" disagree.
 */
import type { BooruProvider } from '../../booru/types'
import { COUNT_TAG_RE } from './permanence'

export interface PostPeople {
  /** The people of the picture, or null when the tags don't pin them down. */
  people: { girls: number; boys: number } | null
  /** What is certain either way: at least so many girls and boys. */
  atLeast: { girls: number; boys: number }
  reason: PeopleReason
}

export type PeopleReason =
  /** Count tags for every gender present (or the site's own convention says the rest are absent). */
  | 'counts'
  /** A group tag of known make-up ("mmf threesome" on Rule34), the presence tags agreeing. */
  | 'group'
  /** An open count ("multiple boys", "6+girls") with no number. */
  | 'open'
  /** A gender is present by its presence tag but not counted. */
  | 'uncounted'
  /** The tags contradict each other (a count of no boys and "male"; one person and a group tag). */
  | 'contradiction'
  /** A futa count (third kind the composition doesn't hold). */
  | 'futa'
  /** Nothing says how many people there are. */
  | 'none'

/**
 * The way a site writes who is in the picture: Danbooru's counts ("1girl, 2boys"), Rule34's mix of
 * counts and gender tags ("1girls, male"), or e621's gender and body-type tags with no count at all
 * ("female, male, duo"; cast.ts searches it that way). The prompt is written in Danbooru's.
 */
export type PeopleVocabulary = 'danbooru' | 'rule34' | 'e621'

export const peopleVocabulary = (provider: BooruProvider | undefined): PeopleVocabulary =>
  provider === 'rule34' ? 'rule34' : provider === 'e621' || provider === 'e6ai' ? 'e621' : 'danbooru'

const MULTIPLE = /^multiple (girls|boys|others)$/
const OPEN_PLUS = /^\d+\+(girls?|boys?|others?)$/
/** Presence of a gender on Rule34, and the least it says. */
const PRESENCE: Record<string, { gender: 'girls' | 'boys'; least: number }> = {
  female: { gender: 'girls', least: 1 },
  'multiple females': { gender: 'girls', least: 2 },
  male: { gender: 'boys', least: 1 },
  'multiple males': { gender: 'boys', least: 2 },
}
/** Group tags of a known make-up whose measured agreement with the counts is high (Rule34). */
const GROUPS: Record<string, { girls: number; boys: number }> = {
  'mmf threesome': { girls: 1, boys: 2 },
  'mmm threesome': { girls: 0, boys: 3 },
}
/**
 * Tags that say how many people there are in all. "foursome" always (13 of 13 counted Rule34 posts
 * whose counts agree with their presence tags); "threesome" only next to the count of one gender and
 * the presence tag of the other (75 of 79: the rest are mis-tagged groups of four or five); alone it
 * is 86 %, and with presence tags only 89 %: not enough to give a number.
 */
const TOTALS: Record<string, { people: number; needsCount: boolean }> = {
  foursome: { people: 4, needsCount: false },
  threesome: { people: 3, needsCount: true },
}
/** Tags of groups larger than the totals above: next to them, a total is not to be trusted. */
const BIGGER = new Set(['gangbang', 'orgy'])
/** Tags that say the picture has more than one person. */
const CROWD = new Set(['threesome', 'foursome', 'group sex', 'gangbang', 'orgy', 'group', 'duo', 'trio', 'mmf threesome', 'ffm threesome', 'fff threesome', 'mmm threesome'])
/** Tags that say both genders are there. */
const MIXED = new Set(['hetero', 'straight', 'male/female'])
const FUTA_COUNT = /^(\d+futas?|multiple futa)$/

// ── The site's own words for the people ──────────────────────────────────────

/** The genders Rule34 and e621 name people by: the ones the presence tags above read ("female", "male"). */
const GENDER_WORDS = Object.keys(PRESENCE).filter((tag) => !tag.startsWith('multiple '))
/**
 * What kind of being each person is, as Rule34 and e621 tag it next to the gender: after the genders
 * and the futa words, the words those sites use most for a participant in their own relation tags
 * ("anthro penetrating human", "human on feral", "humanoid penetrated", "human female"): measured on
 * 1029 Rule34 posts, human in 28 such tags, anthro 19, feral 15, humanoid 10. Danbooru doesn't tag
 * them alone; it files the being by its features ("animal ears", "furry female"), which the look keeps.
 */
const KIND_WORDS = ['human', 'anthro', 'feral', 'humanoid']
/** How those sites say who is with whom by orientation: "straight" is Rule34's "hetero" (MIXED above). */
const ORIENTATION_WORDS = ['straight', 'gay', 'lesbian', 'bisexual']
/** Head counts by word, the way e621 counts (cast.ts searches it with "duo" / "trio"); "solo" is the prompt's own. */
const HEAD_COUNT_WORDS = ['duo', 'trio', 'group']

const alt = (words: readonly string[]) => words.join('|')
const PERSON = `(?:${alt([...GENDER_WORDS, ...KIND_WORDS])})`
/**
 * Tags made only of those words and the words that tie people together: who is there ("female",
 * "multiple males", "human female", "partial male"), who the picture is about ("female focus",
 * "male only"), who is with whom ("male/female", "anthro on anthro", "male penetrating female",
 * "female penetrated"), the orientation ("straight", "lesbian sex") and the head count by word
 * ("trio", "group"). Words for the third kind ("futa", "intersex") are left alone: the prompt's
 * header has no way to say them.
 */
const SITE_PEOPLE_RE = new RegExp(
  [
    `^(?:multiple |partial )?(?:(?:${alt(KIND_WORDS)}) )?(?:${alt(GENDER_WORDS)})s?$`,
    `^${PERSON}(?: ${PERSON})? (?:focus|only)$`,
    `^${PERSON}(?:/${PERSON})+$`,
    `^${PERSON} on ${PERSON}$`,
    `^${PERSON} penetrat(?:ing|ed)(?: ${PERSON})?$`,
    `^(?:${alt(ORIENTATION_WORDS)})(?: sex)?$`,
    `^(?:${alt(HEAD_COUNT_WORDS)})(?: focus)?$`,
  ].join('|')
)
const KIND_RE = new RegExp(`^(?:${alt(KIND_WORDS)})$`)

/**
 * What a tag is in the people vocabulary of a site that writes them its own way (Rule34, e621):
 *  - `people`: it says who is in the picture or how they pair up. The prompt's header says that
 *    from the scene's people and act ("1girl, 2boys, hetero"), so the tag never travels with a scene.
 *  - `kind`: the kind of being a person is ("human", "anthro"): who they are, not what the picture
 *    shows, like a hair colour. A named character's comes from their look, not from another post.
 * Null for any other tag, and for every tag of a site that writes people Danbooru's way: there the
 * people are its counts, which the scene reads as it always has.
 */
export function sitePeopleRole(tag: string, vocabulary: PeopleVocabulary): 'people' | 'kind' | null {
  if (vocabulary === 'danbooru') return null
  if (KIND_RE.test(tag)) return 'kind'
  return SITE_PEOPLE_RE.test(tag) ? 'people' : null
}

/** The Danbooru reading the scene extraction has always done: counts, open counts, absent means none. */
function danbooruPeople(tags: readonly string[]): PostPeople {
  let girls = 0
  let boys = 0
  let open = false
  const multiple: string[] = []
  for (const tag of tags) {
    const count = COUNT_TAG_RE.exec(tag)
    if (count && !count[2] && !count[3].startsWith('other')) {
      if (count[3].startsWith('girl')) girls += Number(count[1])
      else boys += Number(count[1])
      continue
    }
    if (MULTIPLE.test(tag)) {
      multiple.push(tag)
      continue
    }
    if (count || OPEN_PLUS.test(tag)) open = true
  }
  for (const tag of multiple) {
    const counted = tag.endsWith('girls') ? girls > 1 : tag.endsWith('boys') ? boys > 1 : false
    if (!counted) open = true
  }
  const atLeast = { girls, boys }
  if (open) return { people: null, atLeast, reason: 'open' }
  if (girls + boys === 0) return { people: null, atLeast, reason: 'none' }
  return { people: { girls, boys }, atLeast, reason: 'counts' }
}

/** Rule34: counts where they are, the presence tags for what they leave out, and the reliable group tags. */
function rule34People(tags: readonly string[]): PostPeople {
  const set = new Set(tags)
  const counted = { girls: null as number | null, boys: null as number | null }
  const least = { girls: 0, boys: 0 }
  let open = false
  for (const tag of tags) {
    const count = COUNT_TAG_RE.exec(tag)
    if (count && !count[2] && !count[3].startsWith('other')) {
      const gender = count[3].startsWith('girl') ? 'girls' : 'boys'
      // Rule34 tags every count up to the real one ("1girls, 2girls, 3girls" on three girls): the largest says it.
      counted[gender] = Math.max(counted[gender] ?? 0, Number(count[1]))
      continue
    }
    if (count || OPEN_PLUS.test(tag)) open = true
    const multiple = MULTIPLE.exec(tag)
    if (multiple && multiple[1] !== 'others') least[multiple[1] as 'girls' | 'boys'] = Math.max(least[multiple[1] as 'girls' | 'boys'], 2)
    const presence = PRESENCE[tag]
    if (presence) least[presence.gender] = Math.max(least[presence.gender], presence.least)
  }
  const atLeast = { girls: Math.max(least.girls, counted.girls ?? 0), boys: Math.max(least.boys, counted.boys ?? 0) }
  if (tags.some((tag) => FUTA_COUNT.test(tag))) return { people: null, atLeast, reason: 'futa' }
  // A count below what the presence tags say is incomplete: the picture has more.
  if ((counted.girls !== null && counted.girls < least.girls) || (counted.boys !== null && counted.boys < least.boys)) {
    return { people: null, atLeast, reason: 'contradiction' }
  }
  let girls = counted.girls ?? (least.girls > 0 ? null : 0)
  let boys = counted.boys ?? (least.boys > 0 ? null : 0)
  let reason: PeopleReason = 'counts'
  // A group tag of known make-up fills what the counts leave out, if nothing says otherwise.
  const groups = Object.keys(GROUPS).filter((tag) => set.has(tag))
  if ((girls === null || boys === null) && groups.length === 1 && !tags.some((tag) => BIGGER.has(tag))) {
    const group = GROUPS[groups[0]]
    const fits = (known: number | null, value: number, at: number) => (known === null ? value >= at : known === value)
    if (fits(girls, group.girls, least.girls) && fits(boys, group.boys, least.boys)) {
      girls = group.girls
      boys = group.boys
      reason = 'group'
    }
  }
  // A total and the count of one gender give the other: "1girls, male, threesome" is one girl, two boys.
  if ((girls === null) !== (boys === null)) {
    const totals = Object.keys(TOTALS).filter((tag) => set.has(tag))
    // A tag of a bigger group next to it ("gangbang", "orgy") says the total is a guess.
    const bigger = tags.some((tag) => BIGGER.has(tag))
    if (totals.length === 1 && !bigger) {
      const total = TOTALS[totals[0]]
      const known = girls ?? boys!
      const countedKnown = girls !== null ? counted.girls !== null : counted.boys !== null
      const rest = total.people - known
      const restLeast = girls === null ? least.girls : least.boys
      if ((!total.needsCount || countedKnown) && restLeast >= 1 && rest >= restLeast) {
        if (girls === null) girls = rest
        else boys = rest
        reason = 'group'
      }
    }
  }
  if (girls === null || boys === null) return { people: null, atLeast, reason: open ? 'open' : 'uncounted' }
  if (open) return { people: null, atLeast, reason: 'open' }
  const total = girls + boys
  if (total === 0) return { people: null, atLeast, reason: 'none' }
  // A group of known make-up or a total that says otherwise: the tags disagree ("3boys" next to "mmf threesome").
  const make = Object.keys(GROUPS).filter((tag) => set.has(tag)).map((tag) => GROUPS[tag])
  const totalTags = Object.keys(TOTALS).filter((tag) => set.has(tag)).map((tag) => TOTALS[tag].people)
  if (make.some((m) => m.girls !== girls || m.boys !== boys) || totalTags.some((n) => n !== total)) {
    return { people: null, atLeast, reason: 'contradiction' }
  }
  // One person next to a group tag, or one gender next to a tag that says both: the tags disagree.
  if ((total === 1 && tags.some((tag) => CROWD.has(tag))) || (tags.some((tag) => MIXED.has(tag)) && (girls === 0 || boys === 0))) {
    return { people: null, atLeast, reason: 'contradiction' }
  }
  return { people: { girls, boys }, atLeast, reason }
}

/**
 * The people of a post with these tags (pack form: spaces, lower case), read in the vocabulary of
 * `provider`. Without a provider, for a Danbooru-like site, and for e621 (whose posts carry no count
 * to read; nothing measured yet for a reading of its own), the Danbooru reading.
 */
export function postPeople(tags: readonly string[], provider?: BooruProvider): PostPeople {
  return peopleVocabulary(provider) === 'rule34' ? rule34People(tags) : danbooruPeople(tags)
}
