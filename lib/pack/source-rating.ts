/**
 * Pack Mode's content rating lives in two places a user can set: the
 * "Source of variations" rating selector and a `rating:` tag typed into the
 * search. Both end up in the same booru query, so `rating:general` from the
 * selector plus `rating:explicit` from the search matched nothing and the
 * pools were silently filled from the generic vocabulary instead. These
 * helpers make the search's `rating:` tag drive the selector, and summarize
 * which ratings the loaded posts actually have.
 */
import type { BooruPost } from "../booru/types"
import type { PackRatingMode } from "@/hooks/use-pack-seed-search"

type RatingLevel = "sfw" | "questionable" | "explicit"

// `s` is left out on purpose: it means "sensitive" on Danbooru but "safe" on
// e621, and the selector has no "sensitive" option to map it to.
const RATING_VALUES: Record<string, RatingLevel> = {
  g: "sfw",
  general: "sfw",
  safe: "sfw",
  q: "questionable",
  questionable: "questionable",
  e: "explicit",
  explicit: "explicit",
}

const ALL_LEVELS: RatingLevel[] = ["sfw", "questionable", "explicit"]

function modeFromLevels(levels: Set<RatingLevel>): PackRatingMode | null {
  if (levels.size === 1) return [...levels][0]
  if (levels.size === 2 && levels.has("questionable") && levels.has("explicit")) return "both"
  return null
}

export interface RatingFromTags {
  /** Rating the search asks for, or null when it names none (or one the selector can't express). */
  rating: PackRatingMode | null
  /** The search tags without the rating tags that produced `rating`. */
  tags: string
}

/**
 * Reads `rating:x` / `-rating:x` tags out of a comma-separated search. Only
 * strips them when they resolve to a rating the selector can express, so an
 * unrecognized or contradictory rating tag is left for the booru to handle.
 */
export function splitRatingFromTags(searchTags: string): RatingFromTags {
  const parts = searchTags.split(",").map((t) => t.trim()).filter(Boolean)
  const wanted = new Set<RatingLevel>()
  const unwanted = new Set<RatingLevel>()
  const ratingParts = new Set<string>()

  for (const part of parts) {
    const match = /^(-?)rating:(.+)$/i.exec(part.replace(/\s+/g, "_"))
    if (!match) continue
    const level = RATING_VALUES[match[2].toLowerCase()]
    if (!level) continue
    ;(match[1] ? unwanted : wanted).add(level)
    ratingParts.add(part)
  }
  if (ratingParts.size === 0) return { rating: null, tags: searchTags }

  const levels = new Set(wanted.size > 0 ? wanted : ALL_LEVELS)
  unwanted.forEach((level) => levels.delete(level))
  const rating = modeFromLevels(levels)
  if (!rating) return { rating: null, tags: searchTags }

  return { rating, tags: parts.filter((p) => !ratingParts.has(p)).join(", ") }
}

/** Applies a search `rating:` tag to the answers' rating mode, removing it from the tags. */
export function normalizePackSourceRating<T extends { ratingMode: PackRatingMode; searchTags: string }>(answers: T): T {
  const { rating, tags } = splitRatingFromTags(answers.searchTags)
  if (!rating) return answers
  return { ...answers, ratingMode: rating, searchTags: tags }
}

export interface RatingBreakdown {
  total: number
  sfw: number
  questionable: number
  explicit: number
}

/** Posts per rating; anything that isn't questionable or explicit counts as SFW. */
export function countPostRatings(posts: BooruPost[]): RatingBreakdown {
  const out: RatingBreakdown = { total: 0, sfw: 0, questionable: 0, explicit: 0 }
  for (const post of posts) {
    const r = (post.rating || "").toLowerCase()
    out.total++
    if (r === "e" || r === "explicit") out.explicit++
    else if (r === "q" || r === "questionable") out.questionable++
    else out.sfw++
  }
  return out
}

/** "92% explicit · 8% questionable" — largest share first, empty buckets left out. */
export function formatRatingBreakdown(breakdown: RatingBreakdown): string {
  if (breakdown.total === 0) return ""
  const entries: [string, number][] = [
    ["explicit", breakdown.explicit],
    ["questionable", breakdown.questionable],
    ["SFW", breakdown.sfw],
  ]
  return entries
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => `${Math.round((n / breakdown.total) * 100)}% ${label}`)
    .join(" · ")
}
