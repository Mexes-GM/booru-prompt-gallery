/**
 * Final touch for Pack Mode prompts: the "Always add" tags (LoRA triggers,
 * quality tags…) go first, exactly as typed. The generator works on
 * display-normalized tags (lowercase, "_" → " "), which would otherwise turn
 * "score_7" into "score 7" and bury the tags behind the base.
 */
import { splitCommaSeparatedTags } from "../utils/tag-utils"

/** Pony/Illustrious-style quality tags whose underscores are part of the tag. */
const UNDERSCORE_TAG_RE = /^(score [0-9]+( up)?|source (anime|furry|pony|cartoon|real|manga)|rating (safe|questionable|explicit|sfw|nsfw|general|sensitive))$/

/** "score 7" → "score_7"; any other tag is returned unchanged. */
export function restoreUnderscoreTag(tag: string): string {
  const t = tag.trim()
  const spaced = t.toLowerCase().replace(/_/g, " ")
  return UNDERSCORE_TAG_RE.test(spaced) ? spaced.replace(/ /g, "_") : t
}

/** The "Always add" text as a tag list, verbatim (trimmed, deduped). */
export function parseAlwaysAddTags(text: string): string[] {
  return Array.from(new Set(splitCommaSeparatedTags(text).map((t) => t.trim()).filter(Boolean)))
}

const matchKey = (tag: string) => tag.trim().toLowerCase().replace(/_/g, " ")

/**
 * Puts `alwaysAdd` at the front of `prompt` as typed, drops the normalized
 * copies the generator carried along, and restores underscores on the
 * quality tags that need them.
 */
export function finalizePackPrompt(prompt: string, alwaysAdd: readonly string[]): string {
  const front = new Set(alwaysAdd.map(matchKey))
  const rest = prompt
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t && !front.has(matchKey(t)))
    .map(restoreUnderscoreTag)
  return [...alwaysAdd, ...rest].join(", ")
}
