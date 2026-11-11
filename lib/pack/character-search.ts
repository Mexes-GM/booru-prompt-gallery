/**
 * The character search of Pack Mode (pack-character-search.tsx): the tag search,
 * narrowed to characters and forgiving about separators and punctuation.
 */
import { searchTagsOrThrow, type TagResult } from "../supabase/client-queries"

const CHARACTER_CATEGORY = 4

/** A name without separators or punctuation: "twilight (spy x family)" and "twilight spy x family" compare equal. */
export function looseName(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")
}

/**
 * Character results for a query, ignoring separators and punctuation: the tag search
 * matches with SQL ILIKE, so the words are joined with "%" wildcards and "twilight spy x
 * family" finds "twilight_(spy_x_family)". Results that match the whole name, then the
 * start of it, come first.
 */
export async function searchCharacters(query: string, search: (pattern: string) => Promise<TagResult[]> = searchTagsOrThrow): Promise<TagResult[]> {
  const words = query.trim().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  // The tag table's index needs a run of three letters to narrow a wildcard search; without
  // one ("ma ka"), the query goes as typed, which the index serves quickly.
  const pattern = words.some((word) => word.length >= 3) ? words.join("%") : query.trim()
  if (pattern.length < 2) return []
  const wanted = looseName(query)
  const rank = (t: TagResult) => (looseName(t.name) === wanted ? 0 : looseName(t.name).startsWith(wanted) ? 1 : 2)
  const found = (await search(pattern)).filter((t) => t.category === CHARACTER_CATEGORY)
  return found.map((t, i) => ({ t, i })).sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i).map(({ t }) => t).slice(0, 8)
}

