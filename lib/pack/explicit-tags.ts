/**
 * Tags that place a prompt in the "explicit" content rating, as opposed to
 * "questionable". The line is the one lib/background-context.ts already draws:
 * a depicted act (SEXUAL_ACT_TAGS) is explicit, exposure alone (NUDITY_TAGS)
 * is not. Pack Mode uses it both ways — an explicit source keeps every prompt
 * on-rating, a questionable source keeps these tags out.
 *
 * Exact tags come from SEXUAL_ACT_TAGS; the word list below also catches
 * their many variants ("rough sex", "cum on hair") by whole word. Whole words
 * on purpose: the pack vocabulary's own rating flag is a substring match
 * ("butterfly", "sundress"), far too loose for this.
 */
import { SEXUAL_ACT_TAGS } from "../background-context"
import type { PackRatingMode } from "@/hooks/use-pack-seed-search"

const EXPLICIT_WORDS = new Set([
  "sex", "sexual", "hetero", "rape", "raped", "gangbang", "orgy", "threesome", "mating",
  "oral", "vaginal", "anal", "penetration", "insertion", "erection",
  "cum", "cumdrip", "precum", "semen", "ejaculation", "creampie", "bukkake", "lactation",
  "orgasm", "ahegao", "fellatio", "irrumatio", "deepthroat", "cunnilingus", "anilingus",
  "paizuri", "handjob", "footjob", "thighjob", "masturbation", "fingering", "groping",
  "tribadism", "doggystyle", "missionary", "spitroast",
  "dildo", "vibrator", "condom", "lube",
])

/** Explicit as a whole tag, though their words alone aren't ("rub", "crotch"). */
const EXPLICIT_TAGS = new Set(["crotch rub"])

function cleanTag(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/:\s*\d+(\.\d+)?\s*\)*\s*$/, "")
    .replace(/\\?[()[\]{}]/g, " ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** True when `tag` (weights, parentheses and underscores ignored) belongs to the explicit rating. */
export function isExplicitTag(tag: string): boolean {
  const clean = cleanTag(tag)
  if (SEXUAL_ACT_TAGS.has(clean) || EXPLICIT_TAGS.has(clean)) return true
  return clean.split(" ").some((w) => EXPLICIT_WORDS.has(w))
}

/** True when a comma-separated prompt contains at least one explicit tag. */
export function promptHasExplicitTag(prompt: string): boolean {
  return prompt.split(",").some((tag) => isExplicitTag(tag))
}

/** "require": every prompt carries an explicit tag; "forbid": none is sampled; null: no rule. */
export type RatingRule = "require" | "forbid" | null

export interface RatingPass {
  rule: RatingRule
  count: number
}

/**
 * How a pack of `count` prompts is generated for a source rating: one pass
 * for a single rating, two for "both" (explicit half first, rounding up).
 */
export function ratingPasses(rating: PackRatingMode | null, count: number): RatingPass[] {
  if (rating === "explicit") return [{ rule: "require", count }]
  if (rating === "questionable" || rating === "sfw") return [{ rule: "forbid", count }]
  if (rating === "both") {
    const half = Math.ceil(count / 2)
    return [{ rule: "require", count: half }, { rule: "forbid", count: count - half }]
  }
  return [{ rule: null, count }]
}

/** The generatePackPrompts options a rule maps to. */
export function ratingRuleArgs(rule: RatingRule): {
  requiredTag?: (tag: string) => boolean
  forbiddenTag?: (tag: string) => boolean
} {
  if (rule === "require") return { requiredTag: isExplicitTag }
  if (rule === "forbid") return { forbiddenTag: isExplicitTag }
  return {}
}

/** Round-robin merge, so a "both" pack alternates instead of stacking one half on top. */
export function interleave<T>(lists: T[][]): T[] {
  const out: T[] = []
  const longest = Math.max(0, ...lists.map((l) => l.length))
  for (let i = 0; i < longest; i++) {
    for (const list of lists) if (i < list.length) out.push(list[i])
  }
  return out
}
