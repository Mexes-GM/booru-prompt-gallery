/**
 * Pure "re-roll one prompt" core for Pack Mode (§6 of the design spec
 * `docs/superpowers/specs/2026-09-27-pack-mode-simplification-design.md`).
 * Picks the first candidate that isn't an exact or near-duplicate of any of
 * the OTHER currently-shown prompts, so a re-roll never introduces a
 * duplicate row elsewhere in the results list.
 */
import type { PackPrompt } from './pack-generator'
import { NearDuplicateFilter, DEFAULT_SIMILARITY_THRESHOLD } from './prompt-similarity'

/**
 * @param candidates Raw output of generatePackPrompts (pre-clean).
 * @param others The current prompts' text, EXCLUDING the one being replaced.
 * @param clean Wraps cleanSyntheticPrompt: raw tags in, cleaned prompt (or
 *   null if the cleaner rejected it) out.
 * @param lockedTags Ignored when comparing similarity — same reasoning as
 *   regenerate's own NearDuplicateFilter (a large shared base shouldn't drown
 *   out the part that actually varies).
 */
export function pickReplacement(
  candidates: PackPrompt[],
  others: string[],
  clean: (tags: string[]) => string | null,
  lockedTags: string[],
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD
): PackPrompt | null {
  const seenExact = new Set(others)
  const dupFilter = new NearDuplicateFilter(threshold, lockedTags)
  others.forEach((other) => dupFilter.tryAccept(other))

  for (const raw of candidates) {
    const tags = raw.prompt.split(',').map((t) => t.trim()).filter(Boolean)
    const prompt = clean(tags)
    if (!prompt || seenExact.has(prompt)) continue
    if (!dupFilter.tryAccept(prompt)) continue
    return { prompt, values: raw.values, tagSlots: raw.tagSlots }
  }
  return null
}
