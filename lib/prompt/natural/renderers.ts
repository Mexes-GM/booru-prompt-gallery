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
 *   Krea 2 also wants full sentences and reads up to 512 tokens: same format.
 * - moss: the same prose with a longer budget. MOSS-Image was trained on VLM
 *   captions (long ones average ~235 tokens) and its prompt-enhancer skill asks
 *   for cohesive prose without quality tags; Danbooru tags and @artist work
 *   poorly there, so names are written out.
 */
import type { Scene, SceneSlot } from "./scene"
import { describeScene, type PhraseDictionary, type SceneProse, type SubjectClause } from "./prose"
import { capitalize, joinList, properNouns } from "./english"

export interface RenderResult {
  text: string
  /** Tags written verbatim because no phrase rule placed them. */
  rawTags: string[]
  /** Phrases and sentences left out to stay within the length budget. */
  omitted: number
}

const RATING_TAGS: Record<string, string> = { g: "safe", s: "sensitive", q: "nsfw", e: "explicit" }

/** ComfyUI/A1111 read bare parentheses as weights and a backslash as an escape ("\m/" stays "\m/"). */
export function escapeTag(tag: string): string {
  return tag.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
}

const ANIMA_TAG_SLOTS: SceneSlot[] = [
  "demographics", "anatomy", "hair", "eyes",
  "outfit", "top", "bottom", "underwear", "legwear", "footwear", "headwear", "eyewear", "accents",
  "weapon", "handheld", "setting", "props", "atmosphere", "animal", "style", "layout",
]

export function renderAnima(scene: Scene, options: { qualityTags?: string[]; phrases?: PhraseDictionary } = {}): RenderResult {
  const prose = describeScene(scene, options.phrases, { compact: true })
  // A tag the card joined ("black elbow grey gloves") stays as the card wrote it.
  const joined = new Set<string>()
  const slotTags = ANIMA_TAG_SLOTS.flatMap((s) => scene.slots[s] ?? []).flatMap((tag) => {
    const card = scene.joinedTags[tag]
    if (!card) return [tag]
    if (joined.has(card)) return []
    joined.add(card)
    return [card]
  })
  const tags = [
    ...(options.qualityTags ?? []),
    ...scene.quality,
    ...(scene.rating && RATING_TAGS[scene.rating] ? [RATING_TAGS[scene.rating]] : []),
    ...scene.subjectTags,
    ...scene.characterTags,
    ...scene.copyrightTags,
    ...scene.artists.map((a) => `@${a}`),
    ...slotTags,
    ...scene.camera.framing,
    ...scene.camera.angle,
    ...scene.unclassified,
  ].map(escapeTag)

  // Prose: who, what they do, how it is framed. Anima wants at least two sentences.
  const sentences = [
    prose.identity ? `${capitalize(prose.identity)}.` : "",
    // Anima's card asks for each character to be described separately.
    ...prose.characters,
    ...prose.people,
    prose.pose,
    prose.camera,
  ].filter(Boolean)
  if (sentences.length < 2 && prose.body) sentences.push(prose.body)
  // Pose tags no rule could phrase stay in the tag block so nothing is lost.
  const inBlock = new Set(tags)
  const poseRaw = prose.raw.filter((t) => !inBlock.has(escapeTag(t)))
  const tagBlock = [...tags, ...poseRaw.map(escapeTag)].join(", ")
  return {
    text: sentences.length ? `${tagBlock}. ${properNouns(sentences.join(" "))}` : tagBlock,
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
/** About the length of MOSS-Image's long training captions (~235 tokens). */
export const MOSS_DEFAULT_MAX_WORDS = 180

export interface ProseOptions {
  /** Opening words ("An anime-style illustration"); defaults to what the style tags say (style.ts). */
  medium?: string
  phrases?: PhraseDictionary
  /**
   * Word budget. Defaults to the profile's own (FLUX2_DEFAULT_MAX_WORDS,
   * MOSS_DEFAULT_MAX_WORDS); `null` turns the limit off and keeps every detail.
   */
  maxWords?: number | null
}

export function renderFlux2(scene: Scene, options: ProseOptions = {}): RenderResult {
  return renderProse(scene, options, FLUX2_DEFAULT_MAX_WORDS)
}

export function renderMoss(scene: Scene, options: ProseOptions = {}): RenderResult {
  return renderProse(scene, options, MOSS_DEFAULT_MAX_WORDS)
}

// Light, camera, style, extras and raw details: worth less than any list item of the sentences above them.
const MINOR_PRIORITY = 6

function renderProse(scene: Scene, options: ProseOptions, defaultMaxWords: number): RenderResult {
  const maxWords = options.maxWords === null ? Infinity : options.maxWords ?? defaultMaxWords
  // Full detail when it fits, or when leaving out minor sentences is enough;
  // otherwise cap every list first, then drop sentences.
  const full = describeScene(scene, options.phrases)
  const medium = options.medium ?? full.medium
  const fullFit = fitBudget(proseSections(full, medium), maxWords)
  const minorOnly = fullFit.sentences.every((s) => (fullFit.kept.has(s) && !s.cut) || s.priority >= MINOR_PRIORITY)
  const prose = minorOnly ? full : describeScene(scene, options.phrases, { compact: true })
  const { sentences, kept } = minorOnly ? fullFit : fitBudget(proseSections(prose, medium), maxWords)
  const text = properNouns(joinSameSubject(sentences.filter((s) => kept.has(s)).map((s) => s.text), prose.clauses).join(" "))
  return { text, rawTags: prose.raw, omitted: prose.omitted + sentences.length - kept.size }
}

// Most clauses, and words, in one joined sentence: past that it reads as a list of lists.
const MAX_JOINED_CLAUSES = 3
const MAX_JOINED_WORDS = 30

/**
 * Adjacent kept sentences about the same subject become one ("She has X,
 * wears Y, and holds Z.") rather than a run of "She ... She ...". It runs after
 * fitBudget on whole sentences, so what is said and what is left out stay the
 * same: two sentences joined have as many words, three have one fewer.
 */
function joinSameSubject(texts: string[], clauses: SubjectClause[]): string[] {
  const byText = new Map<string, SubjectClause>()
  for (const c of clauses) if (!byText.has(c.text)) byText.set(c.text, c)
  const out: string[] = []
  let group: SubjectClause[] = []
  const flush = () => {
    if (group.length) out.push(joinedSentence(group))
    group = []
  }
  for (const text of texts) {
    const c = byText.get(text)
    if (!c) { flush(); out.push(text); continue }
    const last = group[group.length - 1]
    const joins = !!last && last.key === c.key && !last.tail && last.verb !== "shown"
      && group.length < MAX_JOINED_CLAUSES && !group.some((g) => g.verb === c.verb)
      && wordCount(joinedSentence([...group, c])) <= MAX_JOINED_WORDS
    if (!joins) flush()
    group.push(c)
  }
  flush()
  return out
}

/** "She has X, wears Y, and holds Z, with W.": the comma before "and" parts the clauses, as lists inside them have none. */
function joinedSentence(group: SubjectClause[]): string {
  if (group.length === 1) return group[0].text
  const last = group[group.length - 1]
  return `${group[0].subject} ${group.slice(0, -1).map((c) => c.predicate).join(", ")}, and ${last.predicate}${last.tail ? `, with ${last.tail}` : ""}.`
}

function proseSections(prose: SceneProse, medium: string): { text: string; priority: number; short?: string }[] {
  const opening = prose.identity ? `${medium} of ${prose.identity}.` : `${medium}.`
  // Output order reads naturally; `priority` decides what survives the budget.
  // `short` stands in for a section's first sentence when that one does not fit.
  return [
    { text: opening, priority: 0 },
    // Who has which trait matters as much as who is there.
    { text: prose.characters.join(" "), priority: 0.5 },
    // Unnamed people's own details ("The woman has large breasts") matter less than what is happening.
    { text: prose.people.join(" "), priority: 1.5 },
    // A long pose sentence is cut to its first actions rather than lost.
    { text: prose.pose, priority: 1, short: prose.poseShort },
    { text: prose.body, priority: 4 },
    { text: prose.clothing, priority: 2, short: prose.clothingShort },
    { text: prose.held, priority: 5 },
    { text: prose.setting, priority: 3 },
    { text: prose.lighting, priority: 6 },
    { text: prose.camera, priority: 7 },
    { text: prose.style, priority: 8 },
    { text: prose.extras, priority: 9 },
    { text: prose.raw.length ? `Additional details: ${joinList(prose.raw)}.` : "", priority: 10 },
  ]
}

interface BudgetSentence { text: string; order: number; index: number; priority: number; words: number; short?: string; cut?: boolean }

/**
 * Greedy by priority: a sentence that does not fit is skipped (or cut to its
 * short form, marked `cut`); a shorter later one may still fit. `sentences` stay
 * in output order.
 */
function fitBudget(sections: { text: string; priority: number; short?: string }[], maxWords: number): { sentences: BudgetSentence[]; kept: Set<BudgetSentence> } {
  const sentences: BudgetSentence[] = sections.flatMap((section, order) =>
    sentencesOf(section.text).map((text, index) => ({ text, order, index, priority: section.priority, words: wordCount(text), short: index === 0 ? section.short : undefined })),
  )
  const kept = new Set<BudgetSentence>()
  let words = 0
  for (const sentence of [...sentences].sort((a, b) => a.priority - b.priority || a.index - b.index)) {
    if (sentence.priority > 0 && words + sentence.words > maxWords) {
      const shortWords = sentence.short ? wordCount(sentence.short) : Infinity
      if (words + shortWords > maxWords) continue
      sentence.text = sentence.short!
      sentence.words = shortWords
      sentence.cut = true
    }
    kept.add(sentence)
    words += sentence.words
  }
  return { sentences, kept }
}
