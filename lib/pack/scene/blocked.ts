/**
 * Block list for Pack Mode pools: content involving minors never reaches a prompt.
 *
 * Names are compared whole-word, in both spellings of a tag ("age regression" and
 * "age_regression"), so `young_female` is caught as well as `young female`. A post
 * with ANY blocked tag is discarded entirely, before anything is extracted from it.
 */
import type { BooruPost } from '../../booru/types'

const BLOCK =
  /\b(loli|lolicon|rori|shota|shotacon|toddlercon|toddlersex|child|children|toddler|kindergarten|aged down|young|underage|baby|infant|cub|elementary)\b/

const EXTRA =
  /\b(teens?|teenage|teenaged|teenagers?|preteens?|tweens?|little (girl|boy|sister|brother)s?|younger (girl|boy|female|male|woman|women|man|men|sister|brother)s?|small (girl|boy)s?|tiny (girl|boy)s?|mini ?(girl|boy)s?|school ?(girl|boy)s?|high school students?|middle school(ers?| students?)?|junior high|hogwarts students?|grade ?schoolers?|schoolchild(ren)?|randoseru|diapers?|newborns?|juveniles?|babies|toddlers)\b/

/** Age manipulation: "age regression", "age regressed", "aged down", "age down". */
const AGE_SHIFT = /\b(age regress(ion|ed)|aged? down)\b/

/** Age-gap pairings: "older male and younger female". */
const AGE_GAP = /\bolder (girl|boy|female|male|woman|women|man|men)s? and younger\b/

/** Whole tags (not words) that are blocked. */
const BLOCKED_TAGS = new Set(['kodomo doushi'])

/** Comparable form: lowercase, spaces for underscores and hyphens. */
const spaced = (text: string): string => text.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()

/** True for a tag or phrase that involves minors or age manipulation. */
export function isBlockedTheme(tag: string): boolean {
  const s = spaced(tag)
  if (!s) return false
  return BLOCK.test(s) || EXTRA.test(s) || AGE_SHIFT.test(s) || AGE_GAP.test(s) || BLOCKED_TAGS.has(s)
}

const splitField = (field: string | undefined): string[] => (field ? field.split(/\s+/).filter(Boolean) : [])

/** True when any tag of the post (general or character or series) is blocked. */
export function postIsBlocked(post: BooruPost): boolean {
  const fields = [post.tag_string, post.tag_string_character, post.tag_string_copyright]
  return fields.some((field) => splitField(field).some(isBlockedTheme))
}
