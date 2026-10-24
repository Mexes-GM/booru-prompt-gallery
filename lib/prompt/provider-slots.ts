/**
 * Taxonomy slots for a booru's own tags (Rule34 for now), looked up in Supabase
 * for the natural-language formats only. Rule34 spells many tags its own way
 * ("big_breasts", "female_only"), so the Danbooru taxonomy alone leaves them
 * unplaced. These slots never reach the app's tag overrides; they are merged
 * per card, under the Danbooru taxonomy.
 */
import { toProviderSpelling } from "@/lib/booru/tag-lookup"

/** Boorus with their own approved slots in `lookup_provider_tag_slots`. */
export const SLOT_PROVIDERS: ReadonlySet<string> = new Set(["rule34"])

/** `lookup_provider_tag_slots` reads at most this many names per call and ignores the rest. */
export const PROVIDER_SLOT_CHUNK = 500

export interface ProviderSlotRow {
  name: string
  category_name: string | null
  subcategory: string | null
}

/** Rows -> overrides, under the provider spelling ("big_breasts") and the spaced one. */
export function slotRowsToOverrides(rows: ProviderSlotRow[]): Record<string, string> {
  const overrides: Record<string, string> = {}
  for (const { name, category_name, subcategory } of rows) {
    if (!name || !category_name) continue
    const value = subcategory ? `${category_name}:${subcategory}` : category_name
    const spelling = toProviderSpelling(name)
    overrides[spelling] = value
    overrides[spelling.replace(/_/g, " ")] = value
  }
  return overrides
}

/** The Danbooru taxonomy wins over a booru's own slots. */
export function withProviderSlots(overrides: Record<string, string>, slots: Record<string, string>): Record<string, string> {
  return Object.keys(slots).length === 0 ? overrides : { ...slots, ...overrides }
}

/**
 * Names to ask for: the card's tags that the overrides have no exact entry for,
 * in the provider's spelling ("hand_on_another's_head"), once each.
 */
export function providerSlotNames(tags: string[], overrides: Record<string, string>): string[] {
  const names = new Set<string>()
  for (const tag of tags) {
    // Card prompts escape parentheses for the generators ("hat \(object\)").
    const spelling = toProviderSpelling(tag.replace(/\\([()])/g, "$1"))
    if (!spelling || overrides[spelling] || overrides[spelling.replace(/_/g, " ")]) continue
    names.add(spelling)
  }
  return [...names]
}

export function chunked<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}
