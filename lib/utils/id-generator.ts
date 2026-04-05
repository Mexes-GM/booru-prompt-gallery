/**
 * Utility functions for generating unique IDs
 * Handles browser and non-browser environments
 */

/**
 * Generates a UUID v4 or fallback ID if crypto is not available
 * @returns A UUID string or timestamp-based ID
 */
export const generateId = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // Fallback for environments without crypto.randomUUID
  return Date.now().toString() + Math.random().toString(36).substring(2)
}

/**
 * Generates multiple IDs in a single call
 * @param count Number of IDs to generate
 * @returns Array of unique IDs
 */
export const generateIds = (count: number): string[] => {
  return Array.from({ length: count }, () => generateId())
}
