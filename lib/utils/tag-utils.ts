/**
 * Utility functions for tag manipulation and parsing
 * Centralizes tag splitting, cleaning, and normalization logic
 */

/**
 * Splits a tag string by whitespace
 * Removes empty strings
 * @param tagString String containing space or regex-separated tags
 * @param separator Regex pattern or string to split on (default: /\s+/)
 * @returns Array of trimmed, non-empty tag strings
 */
export const splitTags = (
  tagString: string,
  separator: RegExp | string = /\s+/
): string[] => {
  if (!tagString) return []
  return tagString.split(separator).filter(Boolean).map(tag => tag.trim())
}

/**
 * Splits comma-separated tags
 * @param tagString Comma-separated tag string
 * @returns Array of trimmed, non-empty tag strings
 */
export const splitCommaSeparatedTags = (tagString: string): string[] => {
  return splitTags(tagString, ',')
}

/**
 * Splits tags by either comma or whitespace
 * Intelligently detects which separator to use
 * @param input Tag string (comma or whitespace separated)
 * @returns Array of trimmed, non-empty tag strings
 */
export const splitTagsIntelligent = (input: string): string[] => {
  if (!input) return []
  // If contains commas, split by comma; otherwise split by whitespace
  if (input.includes(',')) {
    return splitCommaSeparatedTags(input)
  }
  return splitTags(input)
}

/**
 * Joins tags with a separator
 * @param tags Array of tags
 * @param separator String to join with (default: ', ')
 * @returns Joined tag string
 */
export const joinTags = (tags: string[], separator: string = ', '): string => {
  return tags.filter(Boolean).join(separator)
}

/**
 * Normalizes a tag by removing extra whitespace and converting to lowercase
 * @param tag Single tag string
 * @returns Normalized tag
 */
export const normalizeTag = (tag: string): string => {
  return tag.trim().toLowerCase()
}

/**
 * Normalizes multiple tags
 * @param tags Array of tags
 * @returns Array of normalized tags
 */
export const normalizeTags = (tags: string[]): string[] => {
  return tags.map(normalizeTag)
}

/**
 * Extracts tag parts from a compound tag
 * For example: "long_hair" -> ["long", "hair"]
 * @param tag Single tag string
 * @returns Array of tag parts
 */
export const getTagParts = (tag: string): string[] => {
  return tag.split(/[\s_\-()]+/).filter(Boolean)
}

/**
 * Checks if a tag contains a specific keyword (case-insensitive)
 * @param tag The tag to check
 * @param keyword The keyword to search for
 * @returns True if tag contains keyword
 */
export const tagContains = (tag: string, keyword: string): boolean => {
  return tag.toLowerCase().includes(keyword.toLowerCase())
}

/**
 * Filters tags by a keyword
 * @param tags Array of tags to filter
 * @param keyword Keyword to search for
 * @returns Filtered array of matching tags
 */
export const filterTagsByKeyword = (tags: string[], keyword: string): string[] => {
  return tags.filter(tag => tagContains(tag, keyword))
}

/**
 * Removes tags matching a filter list
 * @param tags Array of tags
 * @param filterList Tags to remove
 * @returns Filtered array without matching tags
 */
export const removeTagsInList = (tags: string[], filterList: string[]): string[] => {
  const lowerFilter = normalizeTags(filterList)
  return tags.filter(tag => !lowerFilter.includes(normalizeTag(tag)))
}

/**
 * Deduplicates tags (case-insensitive)
 * @param tags Array of tags
 * @returns Deduplicated array (preserves first occurrence)
 */
export const deduplicateTags = (tags: string[]): string[] => {
  const seen = new Set<string>()
  return tags.filter(tag => {
    const normalized = normalizeTag(tag)
    if (seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}
