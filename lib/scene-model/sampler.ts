/**
 * The scene model's generation loop, independent of how the logits are computed
 * (the worker runs it over onnxruntime; the tests over fake logits).
 *
 * Same rules as the reference generator the model was evaluated with:
 *  - input: SUMMARY, the condition tokens, then the tags so far;
 *  - tags already present, the tags they imply, and the other colours of a
 *    garment already coloured ("white shirt" rules out "black shirt") can't be drawn;
 *  - each tag's logit is lowered by alpha·ln(frequency) (END is not), then
 *    divided by the temperature; top-p keeps the smallest set that reaches p;
 *  - a specific tag replaces the generic ones it implies ("white shirt" takes
 *    the place of "shirt"); the scene ends on END or at maxLength tags;
 *  - after the first warm-up passes, `perPass` tags are drawn from each pass
 *    without replacement (fewer model runs per scene);
 *  - the implied tags come back at the end, sorted by id.
 */
import { modelTag, type SceneVocab } from './vocab'
import type { SceneRating } from '../pack/scene/scene'

/** The settings the model is used with (chosen by sweeping 1,000 scenes per setting). */
export interface SceneSamplerSettings {
  temperature: number
  /** Frequency correction: logit − alpha·ln(frequency). */
  alpha: number
  /** Nucleus size; 1 keeps every tag. */
  topP: number
  /** Most tags in a scene, fixed ones included. */
  maxLength: number
  /** Tags drawn from each pass after the warm-up. */
  perPass: number
  /** Passes that draw one tag each before `perPass` applies. */
  warmupPasses: number
}

export const SCENE_SAMPLER_SETTINGS: Readonly<SceneSamplerSettings> = {
  temperature: 0.9,
  alpha: 0.1,
  topP: 1,
  maxLength: 60,
  perPass: 2,
  warmupPasses: 3,
}

/** What the scene is about: the model's condition tokens, by name. */
export interface SceneConditions {
  rating: SceneRating
  /** Level of detail (the vocabulary's `detail` names), or none. */
  detail?: string | null
  /** People-count tags ("1girl", "solo"), as the vocabulary names them. */
  people?: readonly string[]
  /** Body traits ("animal_ears", "tail"), as the vocabulary names them. */
  body?: readonly string[]
  /** Character tags; one the model doesn't know reads as "another character". Up to 3. */
  characters?: readonly string[]
  /** No character at all (an original): only when `characters` is empty. */
  noCharacter?: boolean
  /** Series tags, like characters. */
  series?: readonly string[]
  noSeries?: boolean
}

const RATING_INDEX: Record<SceneRating, number> = { g: 0, s: 1, q: 2, e: 3 }

/** The condition tokens of `cond`; names the vocabulary doesn't have are left out. */
export function conditionTokens(vocab: SceneVocab, cond: SceneConditions): number[] {
  const { offsets: O } = vocab
  const block = (offset: number, names: readonly string[], value: string): number[] => {
    const index = names.indexOf(value)
    return index >= 0 ? [offset + index] : []
  }
  const tokens = [O.rating + RATING_INDEX[cond.rating]]
  if (cond.detail != null) tokens.push(...block(O.detail, vocab.detail, String(cond.detail)))
  for (const p of cond.people ?? []) tokens.push(...block(O.people, vocab.people, modelTag(p)))
  for (const b of cond.body ?? []) tokens.push(...block(O.body, vocab.body, modelTag(b)))
  const named = (values: readonly string[] | undefined, ids: ReadonlyMap<string, number>, other: number, none: number, isNone?: boolean) => {
    if (values && values.length > 0) tokens.push(...Array.from(new Set(values.map((v) => ids.get(modelTag(v)) ?? other))).slice(0, 3))
    else if (isNone) tokens.push(none)
  }
  named(cond.characters, vocab.charId, O.char_other, O.char_none, cond.noCharacter)
  named(cond.series, vocab.seriesId, O.series_other, O.series_none, cond.noSeries)
  return tokens
}

/** Seeded generator (mulberry32): the same seed draws the same scene from the same logits. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Logits for an input sequence: V + 1 values (V tags, then END). */
export type SceneLogits = (tokens: number[]) => Promise<ArrayLike<number>> | ArrayLike<number>

export interface GeneratedScene {
  /** The fixed tags that stayed (one a generated tag specialised is gone), model spelling. */
  fixed: string[]
  /** The tags the model added, in the order drawn (specialised generics removed). */
  generated: string[]
  /** fixed + generated, then the tags they imply: the scene as a post would list it. */
  tags: string[]
  /** Fixed tags the vocabulary doesn't have (ignored). */
  unknownFixed: string[]
  /** Model runs it took. */
  passes: number
}

export interface GenerateSceneInput {
  conditions: SceneConditions
  /** Tags the scene must have (spaces or underscores); unknown ones are ignored. */
  fixed?: readonly string[]
  /** Tags the scene must not have, nor any tag implying them: names, or token ids. */
  exclude?: Iterable<string | number>
  seed: number
  settings?: Partial<SceneSamplerSettings>
}

/** `ids` without the tags another of them implies, first occurrence kept. */
function withoutImplied(vocab: SceneVocab, ids: readonly number[]): number[] {
  const implied = new Set<number>()
  for (const i of ids) for (const j of vocab.implies[i]) implied.add(j)
  return Array.from(new Set(ids)).filter((i) => !implied.has(i))
}

/** Marks `i`, the tags it implies and the other colours of its garment. */
function markTag(vocab: SceneVocab, mask: Uint8Array, i: number): void {
  mask[i] = 1
  for (const j of vocab.implies[i]) mask[j] = 1
  const group = vocab.colorOf[i]
  if (group >= 0) for (const j of vocab.colorGroups[group]) mask[j] = 1
}

/**
 * Candidates of one pass, most likely first, with their unnormalised weights
 * (zero for what top-p leaves out). Ties keep id order.
 */
function passWeights(vocab: SceneVocab, logits: ArrayLike<number>, mask: Uint8Array, s: SceneSamplerSettings, weights: Float64Array): number[] {
  const V = vocab.V
  let max = -Infinity
  for (let i = 0; i <= V; i++) {
    if (mask[i]) continue
    const v = logits[i] - (i < V ? s.alpha * vocab.lnf[i] : 0)
    weights[i] = v
    if (v > max) max = v
  }
  let total = 0
  const order: number[] = []
  for (let i = 0; i <= V; i++) {
    if (mask[i]) {
      weights[i] = 0
      continue
    }
    const e = Math.exp((weights[i] - max) / s.temperature)
    weights[i] = e
    total += e
    order.push(i)
  }
  order.sort((a, b) => weights[b] - weights[a])
  if (s.topP < 1) {
    let cumulative = 0
    let below = 0
    for (const k of order) {
      cumulative += weights[k] / total
      if (cumulative < s.topP) below++
      else break
    }
    const keep = Math.min(order.length, below + 1)
    for (let n = keep; n < order.length; n++) weights[order[n]] = 0
    order.length = keep
  }
  return order
}

/** One draw from `order` by weight, or -1 when nothing is left. */
function draw(order: readonly number[], weights: Float64Array, random: () => number): number {
  let total = 0
  let last = -1
  for (const k of order) {
    if (weights[k] > 0) {
      total += weights[k]
      last = k
    }
  }
  if (last < 0) return -1
  let u = random() * total
  for (const k of order) {
    if (weights[k] <= 0) continue
    u -= weights[k]
    if (u <= 0) return k
  }
  return last
}

/** A scene from the model: see the module comment for the rules. */
export async function generateScene(vocab: SceneVocab, logitsOf: SceneLogits, input: GenerateSceneInput): Promise<GeneratedScene> {
  const s: SceneSamplerSettings = { ...SCENE_SAMPLER_SETTINGS, ...input.settings }
  const V = vocab.V
  const random = seededRandom(input.seed)
  const cond = conditionTokens(vocab, input.conditions)

  const fixedNames = (input.fixed ?? []).map(modelTag).filter(Boolean)
  const unknownFixed = Array.from(new Set(fixedNames.filter((name) => !vocab.tagId.has(name))))
  let current = withoutImplied(vocab, fixedNames.flatMap((name) => (vocab.tagId.has(name) ? [vocab.tagId.get(name)!] : [])))
  const fixedSet = new Set(current)

  const excluded = new Uint8Array(V + 1)
  for (const item of input.exclude ?? []) {
    const id = typeof item === 'number' ? item : vocab.tagId.get(modelTag(item))
    if (id !== undefined && id >= 0 && id < V && !fixedSet.has(id)) excluded[id] = 1
  }
  // A tag that implies an excluded one would bring it back ("holding cup" brings "cup").
  for (let i = 0; i < V; i++) {
    if (!excluded[i] && !fixedSet.has(i) && vocab.implies[i].some((j) => excluded[j])) excluded[i] = 1
  }

  const mask = new Uint8Array(V + 1)
  const weights = new Float64Array(V + 1)
  let passes = 0
  let ended = false
  while (!ended && current.length < s.maxLength) {
    const logits = await logitsOf([vocab.offsets.summary, ...cond, ...current])
    passes++
    mask.set(excluded)
    for (const i of current) markTag(vocab, mask, i)
    const order = passWeights(vocab, logits, mask, s, weights)
    const draws = passes <= s.warmupPasses ? 1 : Math.max(1, s.perPass)
    for (let t = 0; t < draws; t++) {
      if (t > 0 && current.length >= s.maxLength) break
      const j = draw(order, weights, random)
      if (j < 0) {
        ended = true
        break
      }
      if (j === V) {
        ended = true
        break
      }
      const generic = new Set(vocab.implies[j])
      current = current.filter((i) => !generic.has(i))
      current.push(j)
      if (t < draws - 1) {
        // Without replacement: the tag, what it implies and its colour group leave this pass.
        const taken = new Uint8Array(V + 1)
        markTag(vocab, taken, j)
        for (const k of order) if (taken[k]) weights[k] = 0
      }
    }
  }

  const names = current.map((i) => vocab.names[i])
  const seen = new Set(names)
  const extra = new Set<number>()
  for (const i of current) for (const j of vocab.implies[i]) extra.add(j)
  const tags = [...names]
  for (const j of Array.from(extra).sort((a, b) => a - b)) {
    if (!seen.has(vocab.names[j])) {
      seen.add(vocab.names[j])
      tags.push(vocab.names[j])
    }
  }
  return {
    fixed: current.filter((i) => fixedSet.has(i)).map((i) => vocab.names[i]),
    generated: current.filter((i) => !fixedSet.has(i)).map((i) => vocab.names[i]),
    tags,
    unknownFixed,
    passes,
  }
}
