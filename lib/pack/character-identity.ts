/**
 * Pack Mode: who a character is, so a pack can keep them while everything
 * else varies.
 *
 * A character's identity is what most of their posts agree on: hair, eyes,
 * the accessories they always wear (Sonico's headphones) and body traits, plus
 * what they carry far more often than anyone else even when taggers leave it
 * out of many posts (Sui-Feng's "short hair with long locks"). It
 * comes from the posts that show them alone (typicalLook) or, when those are
 * too few, from their static trait profile (profileIdentity). One card can be
 * an odd one (another artist's take, an alternate outfit); the posts together
 * are the character.
 */
import type { BooruPost, BooruProvider } from '../booru/types'
import { getProviderTagLimit } from '../booru/tag-limits'
import { getTagSlotFromOverrides, type TagCategory } from '../tag-taxonomy'
import { classifyPostForPack, normalizeTagForPack } from './pack-generator'
import { TRAIT_SHARE, isGroupCountTag, postCharacters } from './character-focus'
import { loadedTagBaseline, type TagBaseline } from './pack-vocabulary'

/** Most identity tags a character contributes, strongest first. */
export const MAX_IDENTITY_TAGS = 8

/** Posts showing the character alone needed before their typical look is trusted. */
export const MIN_TYPICAL_POSTS = 5

/**
 * A trait on fewer than half of a character's posts still counts when it is on
 * this share of them and DISTINCT_LIFT times as common as on pictures of one
 * person in general: taggers skip details, so a defining one can sit at 35%.
 */
export const DISTINCT_SHARE = 0.25
export const DISTINCT_LIFT = 3
/** Posts a distinctive trait must be on, when the sample size is known: two posts can be one artist. */
const MIN_DISTINCT_POSTS = 3
/** Most hair tags in an identity, so eyes and body always fit under MAX_IDENTITY_TAGS. */
const MAX_HAIR_TAGS = 5

/** Where a card base's look comes from: what most of the character's posts show, or the card itself. */
export type CharacterLook = 'typical' | 'card'

// What counts as someone's identity, in prompt order: hair, eyes, what they always
// wear on them (Sonico's headphones), then body. Head counts and demographics are left out.
const IDENTITY_ORDER = ['hair', 'eyes', 'signature', 'anatomy'] as const
const SIGNATURE_SLOTS = new Set(['accents', 'headwear', 'eyewear'])
/** A hair or eye colour this share of posts agree on leads, even under half: taggers split one colour ("aqua", "blue"). */
const LEAD_COLOR_SHARE = 0.25
const HAIR_COLOR_RE = /^(aqua|black|blonde|blue|brown|green|grey|orange|pink|purple|red|silver|white) hair$/
// On a booru's explicit posts most bodies are bare: these say what the picture shows, not who she is.
// "breasts" alone is on most pictures of any woman; a size ("small breasts") can be hers.
const UNDRESSED_RE = /^(breasts|nipples|areolae?|pussy|vagina|clitoris|anus|ass|penis|testicles|navel|cleavage|thighs|nude|completely nude|collarbone|armpits|barefoot)$/
const SIZED_BREASTS_RE = /^(small|medium|large|huge|gigantic) breasts$/

const isSignatureSlot = (tag: string, overrides: Record<string, string>) => {
  const slot = getTagSlotFromOverrides(tag, overrides)
  return slot?.category === 'clothing' && !!slot.subcategory && SIGNATURE_SLOTS.has(slot.subcategory)
}

export interface IdentityOptions {
  /** How common each tag is on pictures of one person; defaults to the loaded vocabulary's. Null: no distinctive traits. */
  baseline?: TagBaseline | null
  /** Posts the shares were measured on, when known. */
  posts?: number
}

/**
 * Who a character is, from how often each tag appears on them. Traits need half
 * their posts, or a quarter when they are distinctive (DISTINCT_LIFT times as
 * common as on anyone): Sui-Feng's "blunt bangs" are on 41% of her posts and 6%
 * of everyone's. The leading hair and eye colour count under half too: Miku's
 * eyes are "aqua" on 38% of her posts and "blue" on 27%, yet they are one colour.
 * One breast size at most. Hair and eyes come first so the cap never cuts them
 * for body tags.
 */
export function identityTags(
  shares: Iterable<readonly [string, number]>,
  overrides: Record<string, string>,
  { baseline = loadedTagBaseline(), posts }: IdentityOptions = {}
): string[] {
  const groups = new Map<string, [string, number][]>()
  for (const [tag, share] of shares) {
    if (UNDRESSED_RE.test(tag)) continue
    const slot = getTagSlotFromOverrides(tag, overrides)
    const group = slot?.category === 'appearance' ? slot.subcategory
      : isSignatureSlot(tag, overrides) ? 'signature'
      : undefined
    if (!group || !(IDENTITY_ORDER as readonly string[]).includes(group)) continue
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group)!.push([tag, share])
  }
  const lead = (entries: [string, number][]) => {
    const [top] = entries.filter(([, share]) => share >= LEAD_COLOR_SHARE)
    return top ? [top] : []
  }
  // A tag too rare for the vocabulary is rarer than any in it: distinctive.
  const distinct = (tag: string, share: number) =>
    !!baseline && share >= DISTINCT_SHARE && (posts === undefined || share * posts >= MIN_DISTINCT_POSTS - 1e-9) &&
    share >= DISTINCT_LIFT * (baseline.get(tag) ?? 0)
  const picked = IDENTITY_ORDER.flatMap((group) => {
    const entries = [...(groups.get(group) ?? [])].sort((a, b) => b[1] - a[1])
    const common = entries.filter(([tag, share]) => share >= TRAIT_SHARE || distinct(tag, share))
    if (group === 'eyes') return common.length ? common : lead(entries)
    if (group === 'hair') {
      const hair = common.some(([tag]) => HAIR_COLOR_RE.test(tag))
        ? common
        : [...common, ...lead(entries.filter(([tag]) => HAIR_COLOR_RE.test(tag)))]
      return hair.slice(0, MAX_HAIR_TAGS)
    }
    if (group === 'anatomy') {
      const [size] = common.filter(([tag]) => SIZED_BREASTS_RE.test(tag))
      return common.filter(([tag]) => !SIZED_BREASTS_RE.test(tag) || tag === size?.[0])
    }
    return common
  })
  // "black hairband" already says "hairband": keep the more specific of the two.
  const names = picked.map(([tag]) => tag)
  const specific = picked.filter(([tag]) => !names.some((other) => other !== tag && isQualifiedVariant(other, tag)))
  return specific.slice(0, MAX_IDENTITY_TAGS).map(([tag]) => tag)
}

/**
 * True when `tag` is `base` or a qualified form of the same thing: "black
 * hairband" and "hairband", "gold jewelry" and "jewelry". Tags in spaced form.
 */
export function isQualifiedVariant(tag: string, base: string): boolean {
  return tag === base || tag.endsWith(` ${base}`)
}

/** Trait profiles by character name (lowercase, spaces): tag → share of their posts. */
export type TraitProfiles = Record<string, Record<string, number>>

/**
 * A character's identity from their static trait profile: the hair, eyes,
 * signature accessories and body traits most of their posts carry. No
 * profile, no traits: the character tag alone carries the identity.
 */
export function profileIdentity(
  character: string,
  profiles: TraitProfiles,
  overrides: Record<string, string>,
  aliases: Record<string, string> = {},
  baseline: TagBaseline | null = loadedTagBaseline()
): string[] {
  const name = normalizeTagForPack(character)
  const profile = profiles[name] ?? profiles[aliases[name] ?? '']
  if (!profile) return []
  return identityTags(Object.entries(profile).map(([tag, share]) => [normalizeTagForPack(tag), share] as const), overrides, { baseline })
}

const SUBJECT_RE = /^(\d+\+?(girls?|boys?|others?)|multiple (girls|boys|others)|solo|solo focus)$/
// An artist's style written as a tag ("rariatto (ganguri) (style)") is not the character's look.
const STYLE_TAG_RE = /\(style\)$/

/**
 * Whether a tag describes a character's look: not a name in `names`, a head
 * count ("1girl", "solo"), an artist's style or a demographic tag.
 */
export function isLookTag(tag: string, names: ReadonlySet<string>, overrides: Record<string, string>): boolean {
  if (names.has(tag) || SUBJECT_RE.test(tag) || STYLE_TAG_RE.test(tag)) return false
  return getTagSlotFromOverrides(tag, overrides)?.subcategory !== 'demographics'
}

/**
 * An identity list split in two: the look (Character) and the signature
 * accessories (Clothing, where they belong; see pinnedTagsFor).
 */
export function splitSignature(tags: readonly string[], overrides: Record<string, string>): { look: string[]; signature: string[] } {
  return {
    look: tags.filter((t) => !isSignatureSlot(t, overrides)),
    signature: tags.filter((t) => isSignatureSlot(t, overrides)),
  }
}

const PERSON_COUNT_RE = /^1(girl|boy|other)$/

/** Whether the post's tags put more than one person in the picture ("2girls", "multiple boys", "1girl" with "1boy"). */
function showsSeveralPeople(post: BooruPost): boolean {
  const tags = (post.tag_string || '').split(/\s+/).filter(Boolean).map(normalizeTagForPack)
  return tags.some(isGroupCountTag) || new Set(tags.filter((t) => PERSON_COUNT_RE.test(t))).size > 1
}

/** The posts that show `name` (pack-normalized) and nobody else: no other named character, no unnamed company. */
function postsAlone(posts: readonly BooruPost[], name: string): BooruPost[] {
  return posts.filter((p) => {
    const people = postCharacters(p)
    return people.length === 1 && people[0] === name && !showsSeveralPeople(p)
  })
}

/**
 * A character's typical look: the hair, eyes, signature accessories and body
 * traits their solo posts agree on (identityTags). Null when there are too
 * few posts of them alone to tell.
 */
export function typicalLook(
  posts: readonly BooruPost[],
  character: string,
  overrides: Record<string, string>,
  baseline: TagBaseline | null = loadedTagBaseline()
): string[] | null {
  const name = normalizeTagForPack(character)
  const alone = postsAlone(posts, name)
  if (alone.length < MIN_TYPICAL_POSTS) return null
  const seen = new Map<string, number>()
  for (const post of alone) {
    const names = new Set([name, ...postCharacters(post)])
    const { appearance, clothing } = classifyPostForPack(post, overrides)
    const look = tidyCardLook([...appearance, ...clothing].filter((t) => isLookTag(t, names, overrides)))
    look.forEach((t) => seen.set(t, (seen.get(t) ?? 0) + 1))
  }
  return identityTags([...seen].map(([tag, n]) => [tag, n / alone.length] as const), overrides, { baseline, posts: alone.length })
}

/**
 * The tags of an appearance list that say who is in the picture rather than
 * how they look ("1girl", "female"): not a name in `names`, not a look tag,
 * not an artist's style. The look leaves these out; the prompt still needs them.
 */
export function subjectTags(tags: readonly string[], names: ReadonlySet<string>, overrides: Record<string, string>): string[] {
  return tags.filter((t) => !names.has(t) && !STYLE_TAG_RE.test(t) && !isLookTag(t, names, overrides))
}

const SOLO_RE = /^(solo|solo focus)$/
/**
 * Share of a pool's posts tagged `solo` from which its prompts say "solo". High on
 * purpose: a pool that mixes solo pictures with people together would otherwise
 * lose every pose that involves someone else.
 */
export const SOLO_POOL_SHARE = 0.8

/** Share of `posts` tagged `solo`; null for no posts. */
export function poolSoloShare(posts: readonly BooruPost[]): number | null {
  if (posts.length === 0) return null
  const solo = posts.filter((p) => (p.tag_string || '').split(/\s+/).includes('solo')).length
  return solo / posts.length
}

/**
 * A character's subject tags for a pack built from a pool: "1girl" is who they
 * are, but "solo" says what the picture is, so it comes from the pool, not from
 * the character's own posts (searched with "solo"). It stays when nearly all the
 * pool's posts are solo and goes when the pool shows people together, where it
 * would keep out every pose that involves someone else.
 */
export function subjectForPool(subject: readonly string[], soloShare: number | null): string[] {
  const own = subject.filter((t) => !SOLO_RE.test(t))
  return soloShare !== null && soloShare >= SOLO_POOL_SHARE ? [...own, 'solo'] : own
}

/**
 * The subject tags most of a character's solo posts carry ("1girl"), most
 * common first. Null when there are too few posts of them alone to tell.
 */
export function typicalSubject(posts: readonly BooruPost[], character: string, overrides: Record<string, string>): string[] | null {
  const name = normalizeTagForPack(character)
  const alone = postsAlone(posts, name)
  if (alone.length < MIN_TYPICAL_POSTS) return null
  const seen = new Map<string, number>()
  for (const post of alone) {
    const names = new Set([name, ...postCharacters(post)])
    const own = subjectTags(classifyPostForPack(post, overrides).appearance, names, overrides)
    new Set(own).forEach((t) => seen.set(t, (seen.get(t) ?? 0) + 1))
  }
  return [...seen]
    .filter(([, n]) => n / alone.length >= TRAIT_SHARE)
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag)
}

// Other boorus' spellings of one Danbooru tag (Rule34 tags "breasts", "boobs"
// and "tits" on the same post). Kept short on purpose: the prose converter has
// the full alias table, but it is too large for the code every page loads.
const LOOK_SYNONYMS: Record<string, string> = {
  boobs: 'breasts', tits: 'breasts', titties: 'breasts', 'big boobs': 'large breasts', 'big breasts': 'large breasts',
  'big tits': 'large breasts', 'huge boobs': 'huge breasts', 'huge tits': 'huge breasts', butt: 'ass', 'big butt': 'huge ass',
  'big ass': 'huge ass', 'pink nipples': 'nipples', 'exposed nipples': 'nipples', 'nipples outside': 'nipples',
}
// Details a card shows that don't make the character ("red nails", "toes",
// "chest"), and labels that only repeat the head count ("female", "girl").
const MINOR_LOOK_RE = /(^|\s)(nails|nail polish|fingernails|toenails|toenail polish)$|^(toes|feet|soles|chest|female|girl|woman|light skin|light-skinned female|fair skin)$/

/** A look tag that says nothing about who the character is: a minor detail, or another booru's spelling of a common tag. */
export function isNoiseLookTag(tag: string): boolean {
  return MINOR_LOOK_RE.test(tag) || tag in LOOK_SYNONYMS
}

/** A card's look without other boorus' synonyms or minor details, each tag once. */
export function tidyCardLook(tags: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of tags) {
    const tag = LOOK_SYNONYMS[raw] ?? raw
    if (MINOR_LOOK_RE.test(tag) || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
  }
  return out
}

/**
 * Tags that stay while their category varies: a character's signature
 * accessories, so Sonico keeps her headphones in any outfit. Off takes them
 * out, like muting their part or removing the tag.
 */
export function pinnedTagsFor(
  tags: readonly string[],
  category: TagCategory,
  state: {
    lockedCategories: ReadonlySet<TagCategory>
    excludedBaseTags: ReadonlySet<string>
    mutedSlots: ReadonlySet<string>
    axisMinCounts: Partial<Record<TagCategory, number>>
  },
  overrides: Record<string, string>
): string[] {
  if (!state.lockedCategories.has(category) && state.axisMinCounts[category] === 0) return []
  return tags.filter((tag) => {
    const slot = getTagSlotFromOverrides(tag, overrides)?.slot
    return !state.excludedBaseTags.has(tag) && !(slot && state.mutedSlots.has(slot))
  })
}

/**
 * The search for a character's own posts: their tag, plus `solo` when the
 * booru's tag limit leaves room for it, so the look and the pools found are
 * theirs and no one else's.
 */
export function characterSearchTags(character: string, provider: BooruProvider): string {
  const tag = character.trim().replace(/\s+/g, '_')
  return getProviderTagLimit(provider) >= 2 ? `${tag}, solo` : tag
}
