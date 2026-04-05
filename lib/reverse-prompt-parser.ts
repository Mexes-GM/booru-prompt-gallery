/**
 * Reverse Prompt Parser
 * Cleans and categorizes raw prompts from external sources
 */

import { normalize, toSpace, toUnderscore, parseTagList, QUALITY_TAGS_SET } from "./cleanPrompt"
import { classifyTags, type ClassifiedTags } from "./tag-classifier"

export interface ParsedRawPrompt {
  rawTags: string[]
  cleanedTags: string[]
  classified: ClassifiedTags
  quality: string[]
}

/**
 * Parses a raw prompt string (from Civitai, PNG metadata, etc.)
 * Splits by comma or space and normalizes tags
 * @param rawPrompt Raw prompt string with messy formatting
 * @param tagOverrides Dictionary of tag overrides (usually from Lazy Fetch)
 * @returns Parsed and cleaned tags
 */
export function parseRawPrompt(rawPrompt: string, tagOverrides?: Record<string, string>): ParsedRawPrompt {
  if (!rawPrompt || typeof rawPrompt !== "string") {
    return {
      rawTags: [],
      cleanedTags: [],
      classified: {
        appearance: [],
        clothing: [],
        pose: [],
        scenery: [],
        other: [],
      },
      quality: [],
    }
  }

  let workingPrompt = rawPrompt;

  // Clean raw pasted data from typical A1111/Forge blocks
  // Strip out Negative prompt blocks if present (case-insensitive)
  const negMatch = workingPrompt.match(/negative prompt:/i);
  if (negMatch && negMatch.index !== undefined) {
    workingPrompt = workingPrompt.substring(0, negMatch.index).trim();
  }

  // Strip out generated Steps/Sampler metadata blocks
  const stepsMatch = workingPrompt.match(/\nsteps:/i);
  if (stepsMatch && stepsMatch.index !== undefined) {
    workingPrompt = workingPrompt.substring(0, stepsMatch.index).trim();
  }

  // Determine delimiter: prefer comma if present
  const hasComma = workingPrompt.includes(",")
  const delimiter = hasComma ? "," : " "

  let rawTags: string[] = []
  if (hasComma) {
    rawTags = workingPrompt
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
  } else {
    rawTags = workingPrompt
      .split(/\s+/)
      .filter(Boolean)
  }

  // Normalize: lowercase, underscores->spaces, trim
  const cleanedTags = rawTags
    .map((tag) => normalize(tag))
    .filter((tag) => {
      // Remove empty strings, single characters, and obvious noise
      if (!tag || tag.length <= 1) return false
      // Remove URLs/email-like patterns
      if (tag.includes("http") || tag.includes("@")) return false
      // Remove symbols-only
      if (/^[\W_]+$/.test(tag)) return false
      return true
    })

  // Separate quality tags from content tags
  const qualityTags = cleanedTags.filter((tag) => QUALITY_TAGS_SET.has(tag))
  const contentTags = cleanedTags.filter((tag) => !QUALITY_TAGS_SET.has(tag))

  // Classify the content tags using our overrides
  const classified = classifyTags(contentTags, tagOverrides)

  return {
    rawTags,
    cleanedTags,
    classified,
    quality: qualityTags,
  }
}

/**
 * Reconstructs a prompt from parsed components
 * Allows selective inclusion of categories
 */
export function reconstructPrompt(
  classified: ClassifiedTags,
  quality: string[],
  options?: {
    appearance?: boolean
    clothing?: boolean
    pose?: boolean
    scenery?: boolean
    other?: boolean
    quality?: boolean
    escapeParentheses?: boolean
  }
): string {
  const {
    appearance = true,
    clothing = true,
    pose = true,
    scenery = true,
    other = true,
    quality: includeQuality = true,
    escapeParentheses = false,
  } = options || {}

  const parts: string[] = []

  if (appearance) parts.push(...classified.appearance)
  if (clothing) parts.push(...classified.clothing)
  if (pose) parts.push(...classified.pose)
  if (scenery) parts.push(...classified.scenery)
  if (other) parts.push(...classified.other)
  if (includeQuality) parts.push(...quality)

  const escapeTag = (tag: string) => {
    if (!escapeParentheses) return tag
    return tag.replace(/\(/g, "\\(").replace(/\)/g, "\\)")
  }

  return parts.map(escapeTag).join(", ")
}

/**
 * Get the total count of tags in a classified structure
 */
export function countClassifiedTags(classified: ClassifiedTags, quality: string[]): number {
  return (
    classified.appearance.length +
    classified.clothing.length +
    classified.pose.length +
    classified.scenery.length +
    classified.other.length +
    quality.length
  )
}
