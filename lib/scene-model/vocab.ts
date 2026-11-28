/**
 * The scene model's vocabulary (vocab_web_v2.json, served next to the model):
 * tag names, which tags imply which, ln(frequency) of each tag, the colour
 * groups (one colour per garment) and the condition blocks (rating, detail,
 * people, body traits, characters, series) with the token id where each starts.
 *
 * Token ids, as the model reads them:
 *   0 .. V-1       tags
 *   V              END (the scene is complete)
 *   offsets.*      SUMMARY and the condition blocks
 */

/** Token ids of the vocabulary's blocks. */
export interface SceneVocabOffsets {
  end: number
  summary: number
  rating: number
  detail: number
  people: number
  body: number
  char_none: number
  char_other: number
  char: number
  series_none: number
  series_other: number
  series: number
}

/** vocab_web_v2.json as served. */
export interface RawSceneVocab {
  version: number
  V: number
  maxlen: number
  offsets: SceneVocabOffsets
  tags: string[]
  lnf: number[]
  /** Tag id (as a string key) -> ids of the tags it implies. */
  implies: Record<string, number[]>
  color_groups: number[][]
  rating: string[]
  detail: string[]
  people: string[]
  body: string[]
  chars: string[]
  series: string[]
}

export interface SceneVocab {
  /** Number of tags; END is token V. */
  V: number
  offsets: SceneVocabOffsets
  names: string[]
  tagId: ReadonlyMap<string, number>
  /** Per tag, the tags it implies (empty when none). */
  implies: ReadonlyArray<readonly number[]>
  /** ln(frequency) per tag. */
  lnf: Float64Array
  /** Per tag, the index of its colour group, or -1. */
  colorOf: Int32Array
  colorGroups: ReadonlyArray<readonly number[]>
  rating: readonly string[]
  detail: readonly string[]
  people: readonly string[]
  body: readonly string[]
  charId: ReadonlyMap<string, number>
  seriesId: ReadonlyMap<string, number>
}

/** A tag in the model's spelling: lowercase, underscores, no escapes ("Yor Briar" -> "yor_briar"). */
export const modelTag = (tag: string): string => tag.replace(/\\/g, '').trim().toLowerCase().replace(/ /g, '_')

const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string')
const isNumberList = (value: unknown): value is number[] => Array.isArray(value) && value.every((v) => typeof v === 'number')

/** The vocabulary ready to use, or an Error naming what is wrong with the file. */
export function prepareSceneVocab(raw: unknown): SceneVocab {
  const r = raw as Partial<RawSceneVocab> | null
  if (!r || typeof r !== 'object') throw new Error('scene vocabulary: not an object')
  const V = r.V
  if (typeof V !== 'number' || !isStringList(r.tags) || r.tags.length !== V) throw new Error('scene vocabulary: bad tags')
  if (!isNumberList(r.lnf) || r.lnf.length !== V) throw new Error('scene vocabulary: bad lnf')
  if (!r.offsets || typeof r.offsets !== 'object' || r.offsets.end !== V) throw new Error('scene vocabulary: bad offsets')
  for (const key of ['rating', 'detail', 'people', 'body', 'chars', 'series'] as const) {
    if (!isStringList(r[key])) throw new Error(`scene vocabulary: bad ${key}`)
  }
  const implies: number[][] = Array.from({ length: V }, () => [])
  for (const [key, list] of Object.entries(r.implies ?? {})) {
    const id = Number(key)
    if (Number.isInteger(id) && id >= 0 && id < V && isNumberList(list)) implies[id] = list.filter((j) => j >= 0 && j < V)
  }
  const colorGroups = (r.color_groups ?? []).filter(isNumberList).map((group) => group.filter((j) => j >= 0 && j < V))
  const colorOf = new Int32Array(V).fill(-1)
  colorGroups.forEach((group, k) => group.forEach((i) => { colorOf[i] = k }))
  const offsets = r.offsets
  return {
    V,
    offsets,
    names: r.tags,
    tagId: new Map(r.tags.map((name, i) => [name, i])),
    implies,
    lnf: Float64Array.from(r.lnf),
    colorOf,
    colorGroups,
    rating: r.rating!,
    detail: r.detail!,
    people: r.people!,
    body: r.body!,
    charId: new Map(r.chars!.map((name, i) => [name, offsets.char + i])),
    seriesId: new Map(r.series!.map((name, i) => [name, offsets.series + i])),
  }
}
