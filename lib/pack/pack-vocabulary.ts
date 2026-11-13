/**
 * Pack Mode's tag vocabulary (`/pack-vocabulary.json`, built from the tags
 * database by scripts/generate-pack-vocabulary.ts): the most-used approved
 * tags of each taxonomy slot with their post counts. It tops up sparse pools
 * (usePackAxisFallbacks) and says how common a tag is anywhere, which is what
 * tells a character's own traits from what everyone has (characterTagBaseline).
 *
 * Fetched once and cached, like the tag relations: synchronous code reads it
 * through loadedPackVocabulary() once it's in.
 */

/** [tag, post_count, nsfw flag]. */
export type VocabularyEntry = [string, number, 0 | 1]
/** Slot ("category:subcategory") to its tags, most used first. */
export type PackVocabulary = Record<string, VocabularyEntry[]>

let loaded: PackVocabulary | null = null
let loading: Promise<PackVocabulary | null> | null = null

/** The vocabulary once loaded, else null. */
export function loadedPackVocabulary(): PackVocabulary | null {
  return loaded
}

/** Loads the vocabulary once; resolves null on failure (and a later call tries again). */
export function loadPackVocabulary(url = '/pack-vocabulary.json'): Promise<PackVocabulary | null> {
  if (loaded) return Promise.resolve(loaded)
  if (loading) return loading
  loading = fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`pack-vocabulary.json: HTTP ${res.status}`)
      return res.json()
    })
    .then((data) => {
      if (!data || typeof data.slots !== 'object' || data.slots === null) throw new Error('Invalid pack-vocabulary.json format')
      loaded = data.slots as PackVocabulary
      return loaded
    })
    .catch((err) => {
      console.error('Failed to load pack vocabulary:', err)
      return null
    })
    .finally(() => {
      loading = null
    })
  return loading
}

/** For tests and tools: use this vocabulary as the loaded one (null clears it). */
export function setLoadedPackVocabulary(vocabulary: PackVocabulary | null): void {
  loaded = vocabulary
}

/**
 * How common each tag is on pictures of one person: its post count over the
 * count of `solo`, capped at 1. A character's traits are measured on their solo
 * posts, so this is the rate to hold them against. Tags too rare for the
 * vocabulary are absent: the caller treats them as rare.
 */
export type TagBaseline = ReadonlyMap<string, number>

const baselines = new WeakMap<PackVocabulary, TagBaseline | null>()

export function tagBaselineOf(vocabulary: PackVocabulary | null): TagBaseline | null {
  if (!vocabulary) return null
  if (baselines.has(vocabulary)) return baselines.get(vocabulary)!
  const solo = (vocabulary['appearance:demographics'] ?? []).find(([tag]) => tag === 'solo')?.[1]
  let out: Map<string, number> | null = null
  if (solo && solo > 0) {
    out = new Map()
    for (const entries of Object.values(vocabulary)) {
      for (const [tag, count] of entries) out.set(tag, Math.min(1, count / solo))
    }
  }
  baselines.set(vocabulary, out)
  return out
}

/** The baseline of the loaded vocabulary, or null before it loads. */
export function loadedTagBaseline(): TagBaseline | null {
  return tagBaselineOf(loaded)
}
