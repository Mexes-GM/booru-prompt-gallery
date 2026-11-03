/**
 * Multi-character bases: the user picks ONE character to keep, and only that
 * character's identity should reach the prompts.
 *
 * A post with several characters lists every one of them, plus a group count
 * ("3girls", "multiple girls") and the hair, eyes and body of all of them, in
 * one flat tag list. Nothing on the post says which trait belongs to whom, so
 * the base's own tags can't be split per character. What can be checked is
 * how the chosen character usually looks: posts in the collected pool that
 * show that character ALONE. A base trait is kept only when most of those solo
 * posts carry it too; without enough solo posts every ambiguous trait is
 * dropped and the character tag alone carries the identity.
 */
import type { BooruPost } from '../booru/types'
import { splitTags } from '../utils/tag-utils'
import { normalizeTagForPack } from './pack-generator'

/** Solo posts of one character in the collected pool, and how often each general tag appears on them. */
export interface CharacterProfile {
  posts: number
  tagCounts: Record<string, number>
}

/** Solo posts needed before a profile is trusted to vouch for a base trait. */
export const MIN_PROFILE_POSTS = 3
/** Share of the character's solo posts a base trait must appear on to be kept. */
export const TRAIT_SHARE = 0.5
/** Share of solo posts a subject count tag (1girl, 1boy…) needs to stand in for the group count. */
const SUBJECT_SHARE = 0.6
const SUBJECT_TAGS = ['1girl', '1boy', '1other']

/** "2girls", "6+boys", "multiple girls"… — how many people are in the picture, not who they are. */
export function isGroupCountTag(tag: string): boolean {
  return /^(\d+\+?(girls|boys|others)|multiple (girls|boys|others))$/.test(normalizeTagForPack(tag))
}

/** Normalized, deduped character tags of a post, in on-post order. */
export function postCharacters(post: BooruPost): string[] {
  return Array.from(new Set(splitTags(post.tag_string_character || '').map(normalizeTagForPack).filter(Boolean)))
}

/** Profiles for `characters`, built from the posts in `posts` that show exactly one of them alone. */
export function buildSoloCharacterProfiles(posts: BooruPost[], characters: string[]): Record<string, CharacterProfile> {
  const wanted = new Set(characters)
  const out: Record<string, CharacterProfile> = {}
  for (const post of posts) {
    const chars = postCharacters(post)
    if (chars.length !== 1 || !wanted.has(chars[0])) continue
    const profile = (out[chars[0]] ??= { posts: 0, tagCounts: {} })
    profile.posts++
    const tags = new Set(splitTags(post.tag_string || '').map(normalizeTagForPack).filter(Boolean))
    tags.forEach((tag) => {
      profile.tagCounts[tag] = (profile.tagCounts[tag] ?? 0) + 1
    })
  }
  return out
}

/**
 * The base's appearance tags narrowed to `chosen`: the chosen character tag,
 * the base traits its solo posts confirm, and the subject tag (1girl…) those
 * posts agree on in place of the group count. Other characters, group counts
 * and unconfirmed traits are dropped. A no-op for 0 or 1 characters; with no
 * character chosen yet, only the identity-free tags survive.
 */
export function focusAppearanceOnCharacter(
  appearanceTags: string[],
  characterTags: string[],
  chosen: string | null,
  profile?: CharacterProfile
): string[] {
  if (characterTags.length <= 1) return appearanceTags
  const characters = new Set(characterTags)
  const trusted = !!profile && profile.posts >= MIN_PROFILE_POSTS
  const confirmed = (tag: string) => trusted && (profile!.tagCounts[tag] ?? 0) / profile!.posts >= TRAIT_SHARE

  const out = appearanceTags.filter((tag) => {
    if (characters.has(tag)) return tag === chosen
    if (isGroupCountTag(tag)) return false
    return chosen !== null && confirmed(tag)
  })

  if (chosen && trusted && !out.some((tag) => SUBJECT_TAGS.includes(tag))) {
    const subject = SUBJECT_TAGS
      .map((tag) => ({ tag, share: (profile!.tagCounts[tag] ?? 0) / profile!.posts }))
      .sort((a, b) => b.share - a.share)[0]
    if (subject && subject.share >= SUBJECT_SHARE) out.unshift(subject.tag)
  }
  return out
}

/**
 * The base character the current search is about, when exactly one of them
 * appears in it (searching `hatsune_miku` on a Miku + Teto post picks Miku).
 */
export function characterFromSearch(characterTags: string[], searchTags: string): string | null {
  const searched = new Set(
    searchTags
      .split(/[\s,]+/)
      // An excluded tag (-name) is the opposite of what the search is about.
      .filter((t) => !t.startsWith('-'))
      .map((t) => normalizeTagForPack(t.replace(/^~/, '')))
      .filter(Boolean)
  )
  const matches = characterTags.filter((c) => searched.has(c))
  return matches.length === 1 ? matches[0] : null
}

/** For a multi-character post, the character the search is about (null otherwise, or when unclear). */
export function searchedCharacterOf(post: BooruPost, searchTags: string): string | null {
  const characters = postCharacters(post)
  return characters.length > 1 ? characterFromSearch(characters, searchTags) : null
}
