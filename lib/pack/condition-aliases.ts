/**
 * Other names of the tags a pack meets as conditions ("qipao" for "china dress"), from the
 * `aliases` column of `auto_suggest_tags`, the table the gallery's tag search already reads.
 * A booru that resolves an alias when searching returns posts tagged with the other name; the
 * engine counts those as the condition (ScenePackArgs.conditionAliases).
 *
 * One query per new set of names, cached for the session. Never blocks a pack: on any failure the
 * names are taken as having no aliases.
 */
import { createClient } from "@/lib/supabase/client"
import { normalizeTagForPack } from "./pack-generator"

const cache = new Map<string, readonly string[]>()

/** The aliases column as stored: a text array, or one comma- or space-separated string. */
export function parseAliases(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,\s]+/) : []
  return list
    .filter((a): a is string => typeof a === "string")
    .map(normalizeTagForPack)
    .filter(Boolean)
}

/** The aliases already known for these conditions, keyed by condition (brief spelling); conditions without any are left out. */
export function knownAliases(conditions: readonly string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const c of conditions) {
    const found = cache.get(normalizeTagForPack(c))
    if (found && found.length > 0) out[c] = [...found]
  }
  return out
}

/** Looks up the conditions not asked for yet; resolves with every condition's aliases (none on failure). */
export async function loadConditionAliases(conditions: readonly string[]): Promise<Record<string, string[]>> {
  const missing = Array.from(new Set(conditions.map(normalizeTagForPack).filter((c) => c && !cache.has(c))))
  if (missing.length > 0) {
    try {
      const supabase = createClient()
      if (supabase) {
        const names = Array.from(new Set(missing.flatMap((c) => [c, c.replace(/ /g, "_")])))
        const { data, error } = await supabase.from("auto_suggest_tags").select("name, aliases").in("name", names)
        // A failed lookup is not cached: the next change asks again.
        if (error || !data) return knownAliases(conditions)
        for (const row of data as Array<{ name: string; aliases: unknown }>) {
          const key = normalizeTagForPack(row.name)
          cache.set(key, [...(cache.get(key) ?? []), ...parseAliases(row.aliases)])
        }
      }
    } catch {
      // No aliases this time; asked again on the next change.
      return knownAliases(conditions)
    }
    for (const c of missing) if (!cache.has(c)) cache.set(c, [])
  }
  return knownAliases(conditions)
}
