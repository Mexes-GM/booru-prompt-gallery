/**
 * Output profiles. Each one turns a scene into the prompt format a model
 * family was trained on:
 *
 * - anima: tags for identity, body, outfit and background (Danbooru vocabulary
 *   is what Anima anchors on), followed by a short prose block for the
 *   subject, pose, expression and framing, which tags express poorly.
 *   Tag order follows the model card: safety, count, character, series,
 *   @artist, general tags.
 * - flux2: prose only, no quality or artist tags. By default it stays within
 *   BFL's recommended 30-80 words: lists are capped and whole sentences are
 *   dropped by priority (subject, action, outfit, place, body, light, camera,
 *   style). `maxWords: null` turns the limit off and keeps every detail.
 */
import type { Scene, SceneSlot } from "./scene"
import { describeScene, type PhraseDictionary } from "./prose"
import { capitalize, joinList } from "./english"

export interface RenderResult {
  text: string
  /** Tags written verbatim because no phrase rule placed them. */
  rawTags: string[]
  /** Phrases and sentences left out to stay within the length budget. */
  omitted: number
}

const RATING_TAGS: Record<string, string> = { g: "safe", s: "sensitive", q: "nsfw", e: "explicit" }

/** ComfyUI/A1111 read bare parentheses as weights. */
function escapeTag(tag: string): string {
  return tag.replace(/\(/g, "\\(").replace(/\)/g, "\\)")
}

const ANIMA_TAG_SLOTS: SceneSlot[] = [
  "demographics", "anatomy", "hair", "eyes",
  "outfit", "top", "bottom", "underwear", "legwear", "footwear", "headwear", "eyewear", "accents",
  "weapon", "handheld", "setting", "props", "atmosphere", "animal", "style", "layout",
]

export function renderAnima(scene: Scene, options: { qualityTags?: string[]; phrases?: PhraseDictionary } = {}): RenderResult {
  const prose = describeScene(scene, options.phrases, { compact: true })
  const tags = [
    ...(options.qualityTags ?? []),
    ...scene.quality,
    ...(scene.rating && RATING_TAGS[scene.rating] ? [RATING_TAGS[scene.rating]] : []),
    ...scene.subjectTags,
    ...scene.characterTags,
    ...scene.series.map((s) => s.toLowerCase()),
    ...scene.artists.map((a) => `@${a}`),
    ...ANIMA_TAG_SLOTS.flatMap((s) => scene.slots[s] ?? []),
    ...scene.camera.framing,
    ...scene.camera.angle,
    ...scene.unclassified,
  ].map(escapeTag)

  // Prose: who, what they do, how it is framed. Anima wants at least two sentences.
  const sentences = [
    prose.identity ? `${capitalize(prose.identity)}.` : "",
    // Anima's card asks for each character to be described separately.
    ...prose.characters,
    prose.pose,
    prose.camera,
  ].filter(Boolean)
  if (sentences.length < 2 && prose.body) sentences.push(prose.body)
  // Pose tags no rule could phrase stay in the tag block so nothing is lost.
  const inBlock = new Set(tags)
  const poseRaw = prose.raw.filter((t) => !inBlock.has(escapeTag(t)))
  const tagBlock = [...tags, ...poseRaw.map(escapeTag)].join(", ")
  return {
    text: sentences.length ? `${tagBlock}. ${sentences.join(" ")}` : tagBlock,
    rawTags: poseRaw,
    omitted: prose.omitted,
  }
}

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length

/** Splits "A. B. C." into its sentences (a section may hold several). */
function sentencesOf(text: string): string[] {
  return text ? text.split(/(?<=\.)\s+(?=[A-Z])/) : []
}

/** BFL's recommended upper bound for a medium-length FLUX.2 prompt. */
export const FLUX2_DEFAULT_MAX_WORDS = 80

export interface Flux2Options {
  medium?: string
  phrases?: PhraseDictionary
  /**
   * Word budget. Defaults to FLUX2_DEFAULT_MAX_WORDS; `null` turns the limit
   * off and keeps every detail (for long-prompt models or when the user asks).
   */
  maxWords?: number | null
}

export function renderFlux2(scene: Scene, options: Flux2Options = {}): RenderResult {
  const maxWords = options.maxWords === null ? Infinity : options.maxWords ?? FLUX2_DEFAULT_MAX_WORDS
  const medium = options.medium ?? "An anime-style illustration"
  // Full detail when it fits; otherwise cap every list first, then drop sentences.
  const full = describeScene(scene, options.phrases)
  const fullWords = wordCount([full.identity, ...full.characters, full.pose, full.body, full.clothing, full.held, full.setting, full.lighting, full.camera, full.style, full.extras, full.raw.join(" ")].join(" ")) + wordCount(medium) + 2
  const prose = fullWords > maxWords ? describeScene(scene, options.phrases, { compact: true }) : full
  const opening = prose.identity ? `${medium} of ${prose.identity}.` : `${medium}.`

  // Output order reads naturally; `priority` decides what survives the budget.
  const sections = [
    { text: opening, priority: 0 },
    // Who has which trait matters as much as who is there.
    { text: prose.characters.join(" "), priority: 0.5 },
    { text: prose.pose, priority: 1 },
    { text: prose.body, priority: 4 },
    { text: prose.clothing, priority: 2 },
    { text: prose.held, priority: 5 },
    { text: prose.setting, priority: 3 },
    { text: prose.lighting, priority: 6 },
    { text: prose.camera, priority: 7 },
    { text: prose.style, priority: 8 },
    { text: prose.extras, priority: 9 },
    { text: prose.raw.length ? `Additional details: ${joinList(prose.raw)}.` : "", priority: 10 },
  ]
  const sentences = sections.flatMap((section, order) =>
    sentencesOf(section.text).map((text, index) => ({ text, order, index, priority: section.priority, words: wordCount(text) })),
  )
  // Greedy by priority: a sentence that does not fit is skipped, a shorter later one may still fit.
  const kept = new Set<(typeof sentences)[number]>()
  let words = 0
  for (const sentence of [...sentences].sort((a, b) => a.priority - b.priority || a.index - b.index)) {
    if (sentence.priority > 0 && words + sentence.words > maxWords) continue
    kept.add(sentence)
    words += sentence.words
  }
  const text = sentences.filter((s) => kept.has(s)).map((s) => s.text).join(" ")
  return { text, rawTags: prose.raw, omitted: prose.omitted + sentences.length - kept.size }
}
