/**
 * A character's outfits: the one they usually wear and their official alternate
 * outfits by name ("Bunny", "School uniform"). public/character-outfits/ is
 * sharded like the trait profiles (lib/prompt/natural-traits.ts): the same
 * traitShard function over the Danbooru name, and the same alias map, so a name
 * from any booru reaches its shard.
 *
 *   <shard>.json  { "<danbooru name>": { "d"?: [tags], "o"?: [["Bunny", [tags]], …] } }
 *
 * Tags use spaces. A missing shard, a failed request or a character the data
 * doesn't have all mean the same: no outfits (the option isn't offered).
 */
import { traitShard, traitShardFile } from '../prompt/natural-traits'
import { normalizeTagForPack } from './pack-generator'

export const CHARACTER_OUTFITS_DIR = '/character-outfits'
export const characterOutfitsUrl = (shard: number) => `${CHARACTER_OUTFITS_DIR}/${traitShardFile(shard)}`

export interface CharacterOutfit {
  /** '' for the usual outfit, else the official outfit's name. */
  name: string
  tags: string[]
}

export interface CharacterOutfits {
  /** The outfit they usually wear, or null when the data has none. */
  usual: CharacterOutfit | null
  /** Official alternate outfits, most drawn first. */
  official: CharacterOutfit[]
}

type ShardData = Record<string, { d?: unknown; o?: unknown }>

const tagList = (value: unknown): string[] =>
  Array.isArray(value) ? Array.from(new Set(value.filter((t): t is string => typeof t === 'string').map(normalizeTagForPack).filter(Boolean))) : []

/** One character's entry of a shard, or null when it has no usable outfit. */
export function parseCharacterOutfits(entry: unknown): CharacterOutfits | null {
  if (!entry || typeof entry !== 'object') return null
  const e = entry as { d?: unknown; o?: unknown }
  const usualTags = tagList(e.d)
  const official: CharacterOutfit[] = []
  if (Array.isArray(e.o)) {
    for (const item of e.o) {
      if (!Array.isArray(item) || typeof item[0] !== 'string' || !item[0].trim()) continue
      const tags = tagList(item[1])
      if (tags.length > 0 && !official.some((o) => o.name === item[0])) official.push({ name: item[0].trim(), tags })
    }
  }
  if (usualTags.length === 0 && official.length === 0) return null
  return { usual: usualTags.length > 0 ? { name: '', tags: usualTags } : null, official }
}

/** The tags of the chosen outfit: `name` '' (or one the character doesn't have) is the usual outfit, else the first official one. */
export function outfitTags(outfits: CharacterOutfits | null | undefined, name: string | undefined): string[] {
  if (!outfits) return []
  const chosen = name ? outfits.official.find((o) => o.name === name) : undefined
  return (chosen ?? outfits.usual ?? outfits.official[0])?.tags ?? []
}

/** The Danbooru name the shards use for a pack-normalized character name. */
export const canonicalCharacter = (name: string, aliases: Readonly<Record<string, string>>): string => aliases[name] ?? name

const shardTasks = new Map<number, Promise<ShardData>>()

function loadShard(shard: number, fetcher: typeof fetch): Promise<ShardData> {
  let task = shardTasks.get(shard)
  if (!task) {
    task = fetcher(characterOutfitsUrl(shard))
      .then((res) => {
        if (!res.ok) throw new Error(`${characterOutfitsUrl(shard)}: HTTP ${res.status}`)
        return res.json() as Promise<ShardData>
      })
      .then((data) => (data && typeof data === 'object' ? data : {}))
      .catch(() => {
        // Tried again next time: a failed request isn't "no outfits" for the rest of the page.
        shardTasks.delete(shard)
        return {}
      })
    shardTasks.set(shard, task)
  }
  return task
}

/**
 * The outfits of a character (pack-normalized name), each shard fetched once per page.
 * Null when there are none or the shard can't be read.
 */
export async function loadCharacterOutfits(
  name: string,
  aliases: Readonly<Record<string, string>> = {},
  fetcher: typeof fetch = fetch
): Promise<CharacterOutfits | null> {
  const key = canonicalCharacter(normalizeTagForPack(name), aliases)
  if (!key) return null
  const data = await loadShard(traitShard(key), fetcher)
  return parseCharacterOutfits(data[key])
}
