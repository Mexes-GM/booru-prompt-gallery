/**
 * Where the character trait profiles live (public/natural-traits/). They are
 * split into shards by a hash of the Danbooru character name, so a card with
 * several characters downloads a few small files instead of the whole table.
 *
 *   aliases.json  other boorus' names -> Danbooru name (Rule34 "kasumi (pokemon)" -> "misty (pokemon)")
 *   00.json…ff.json  { "<danbooru name>": { "<tag>": share, … } }
 *
 * Names are normalized as normalizeTag does (lowercase, spaces). The export
 * that writes these files uses traitShard below, so both sides always agree.
 */
export const TRAIT_SHARD_COUNT = 256

export const TRAIT_ALIASES_URL = "/natural-traits/aliases.json"

/** FNV-1a (32-bit) over the name's UTF-16 code units, reduced to a shard index. */
export function traitShard(name: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % TRAIT_SHARD_COUNT
}

export function traitShardFile(shard: number): string {
  return `${shard.toString(16).padStart(2, "0")}.json`
}

export const traitShardUrl = (shard: number) => `/natural-traits/${traitShardFile(shard)}`
