/**
 * The content rating of the pack builder: its own state, saved in the preference it shares
 * with the classic builder (the stored source answers). Pure: the caller reads and writes storage.
 */
import type { StoredPackSourceAnswers } from '../storage'

export type PackRating = StoredPackSourceAnswers['ratingMode']

/** The rating a pack starts with: the saved one, else the given one. */
export function storedPackRating(stored: StoredPackSourceAnswers | null, fallback: PackRating): PackRating {
  return stored?.ratingMode ?? fallback
}

/**
 * The stored answers with another rating, the rest as they were; `fallback` stands in for
 * answers never saved. A new object: neither argument is changed.
 */
export function withPackRating(
  stored: StoredPackSourceAnswers | null,
  rating: PackRating,
  fallback: StoredPackSourceAnswers,
): StoredPackSourceAnswers {
  return { ...(stored ?? fallback), ratingMode: rating }
}
