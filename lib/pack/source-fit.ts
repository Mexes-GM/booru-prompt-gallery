/**
 * Whether a post already loaded for a pack belongs to a search of its plan, so a change of plan
 * keeps the posts that still count instead of fetching them again (hooks/use-pack-sources.ts).
 *
 * A post fits a search when it comes from the plan's site, was fetched at one of the plan's
 * ratings, and carries every tag the search asks for, as the site spells them, and none it
 * excludes ("-tag"). Metatags that only order the results (order:, sort:, random:) and the rating
 * (checked above) ask nothing of the post. Any other term the post's tags can't confirm (a
 * score: or user: filter, a wildcard, an OR) means the post can't be shown to fit, so it doesn't.
 *
 * Pure: no React, no requests.
 */
import type { BooruPost, BooruProvider } from '../booru/types'

/** A post as loaded: its tags, and where and at which rating it was fetched. */
export interface LoadedPost {
  /** Every tag of the post, as the site spells them (underscores), lower case (postTagSet). */
  tags: ReadonlySet<string>
  provider: BooruProvider
  /** The rating filters it was fetched under ("rating:general"). */
  ratings: readonly string[]
}

/** The searches of a plan a post is checked against: where and at which ratings they run. */
export interface FitPlan {
  provider: BooruProvider
  ratings: readonly string[]
}

/** Every tag of a post, lower case, from each of its tag fields. */
export function postTagSet(post: Pick<BooruPost, 'tag_string' | 'tag_string_character' | 'tag_string_copyright' | 'tag_string_artist' | 'tag_string_meta'>): Set<string> {
  const out = new Set<string>()
  for (const field of [post.tag_string, post.tag_string_character, post.tag_string_copyright, post.tag_string_artist, post.tag_string_meta]) {
    if (!field) continue
    for (const tag of field.split(/\s+/)) if (tag) out.add(tag.toLowerCase())
  }
  return out
}

/** Metatags that order the results and filter nothing. */
const ORDERING = /^(order|sort|random):/i

/** True when the post's tags meet the search's tags (booru spelling). */
export function tagsFitSearch(tags: ReadonlySet<string>, searchTags: readonly string[]): boolean {
  for (const raw of searchTags) {
    const term = raw.trim().replace(/\s+/g, '_').toLowerCase()
    if (!term || ORDERING.test(term) || term.startsWith('rating:')) continue
    // Wildcards and OR terms: the post's tags alone can't say.
    if (term.includes('*') || term.startsWith('~') || term.startsWith('{')) return false
    if (term.startsWith('-')) {
      const excluded = term.slice(1)
      if (!excluded || excluded.includes('*') || tags.has(excluded)) return false
      continue
    }
    // A filtering metatag (score:>10, user:name) is no tag of the post: it can't be confirmed.
    if (!tags.has(term)) return false
  }
  return true
}

/** True when `post` belongs to `search` of `plan`: same site, one of its ratings, and every tag the search asks for. */
export function postFitsSearch(post: LoadedPost, search: { tags: readonly string[] }, plan: FitPlan): boolean {
  if (post.provider !== plan.provider) return false
  if (!post.ratings.some((r) => plan.ratings.includes(r))) return false
  return tagsFitSearch(post.tags, search.tags)
}

/** The first of `searches` the post fits (the plan's order is its preference), or -1. */
export function firstFittingSearch(post: LoadedPost, searches: ReadonlyArray<{ tags: readonly string[] }>, plan: FitPlan): number {
  return searches.findIndex((search) => postFitsSearch(post, search, plan))
}
