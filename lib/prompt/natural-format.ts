/**
 * Turns a card's cleaned tag prompt into one of the natural-language formats.
 * Loaded on demand (see natural-prompt-loader.ts) together with the phrase
 * dictionary, so nothing here ships with the tag format.
 *
 * The input is the prompt the card already shows, after the user's options
 * (added and removed tags, find & replace, backgrounds, "@artist"), so every
 * format keeps those edits. Names come from the post's own fields when it has
 * them; flat-tag boorus get them split out through the taxonomy.
 */
import {
  buildScene,
  normalizeTag,
  renderAnima,
  renderFlux2,
  renderMoss,
  splitPromptTags,
  type CharacterTraits,
  type NaturalPromptInput,
  type PhraseDictionary,
} from "@/lib/prompt/natural"
import type { NaturalPromptFormat } from "@/lib/prompt/prompt-format"
import { getTagSlotFromOverrides } from "@/lib/tag-taxonomy"

export interface NaturalPromptSource {
  /** The card's cleaned prompt: comma-separated tags, weights and escapes allowed. */
  prompt: string
  /** Space-separated booru fields; leave out when the card hides names. */
  characters?: string
  copyrights?: string
  rating?: string
  provider?: string
  /** A prompt someone typed (AI-generated posts): names may lack their series qualifier. */
  handWritten?: boolean
}

export interface FormattedPrompt {
  text: string
  words: number
  /** Phrases and sentences left out to stay within the word budget. */
  omitted: number
}

const RATING_WORDS: Record<string, string> = { general: "g", safe: "g", sensitive: "s", questionable: "q", explicit: "e" }

/** Danbooru's rating letter. Gelbooru and Rule34 spell ratings out; e621's "s" means safe. */
export function ratingLetter(rating?: string, provider?: string): string | undefined {
  const value = rating?.trim().toLowerCase()
  if (!value) return undefined
  if (RATING_WORDS[value]) return RATING_WORDS[value]
  if (provider === "e621" && value === "s") return "g"
  return /^[gsqe]$/.test(value) ? value : undefined
}

const fieldTags = (field?: string) => (field ?? "").split(/\s+/).filter(Boolean)

/** Same tag written two ways ("kashima_(kancolle)", "kashima \(kancolle\)") counts once. */
function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>()
  return tags.filter((tag) => {
    const key = normalizeTag(tag)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function naturalPromptInput(source: NaturalPromptSource, overrides: Record<string, string>): NaturalPromptInput {
  const split = splitPromptTags(source.prompt, overrides, { guessNames: !!source.handWritten })
  const characters = uniqueTags([...fieldTags(source.characters), ...(split.characters ?? [])])
  const copyrights = uniqueTags([...fieldTags(source.copyrights), ...(split.copyrights ?? [])])
  // The card's prompt also lists the names the post fields carry.
  const names = new Set([...characters, ...copyrights].map(normalizeTag))
  return {
    general: split.general.filter((tag) => !names.has(normalizeTag(tag))),
    characters,
    copyrights,
    artists: split.artists,
    rating: ratingLetter(source.rating, source.provider),
  }
}

/**
 * General tags the taxonomy cannot place: no exact entry, and no known suffix
 * either ("frilled red dress" is placed through "dress"). Worth looking up
 * before rendering, since they would otherwise end up as raw text.
 */
export function unclassifiedTags(input: NaturalPromptInput, overrides: Record<string, string>): string[] {
  const tags = new Set<string>()
  for (const raw of input.general) {
    const tag = normalizeTag(raw)
    if (!tag || overrides[tag] || overrides[tag.replace(/ /g, "_")]) continue
    // A suffix match on a name or meta tag is a guess the scene ignores.
    const bySuffix = getTagSlotFromOverrides(tag, overrides)
    if (!bySuffix || bySuffix.category === "other") tags.add(tag)
  }
  return [...tags]
}

/**
 * The card's character names whose trait profiles are worth loading:
 * attribution only starts with two or more characters.
 */
export function traitNames(input: NaturalPromptInput): string[] {
  const names = [...new Set((input.characters ?? []).map(normalizeTag))]
  return names.length >= 2 ? names : []
}

/**
 * Profiles for the card's names, keyed by the card's own tags. A name from
 * another booru is looked up under the Danbooru name it maps to.
 */
export function cardTraits(names: string[], aliases: Record<string, string>, profiles: CharacterTraits): CharacterTraits {
  const traits: CharacterTraits = {}
  for (const name of names) {
    const profile = profiles[aliases[name] ?? name]
    if (profile) traits[name] = profile
  }
  return traits
}

const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length

export interface FormatPromptOptions {
  phrases?: PhraseDictionary
  fullDetail?: boolean
  /** Per-character profiles (see cardTraits): hair, eyes and outfit go to whoever owns them. */
  traits?: CharacterTraits
  /** Other boorus' names -> Danbooru name, so one person tagged twice counts once. */
  characterAliases?: Record<string, string>
}

/**
 * `fullDetail` lifts the word budget of the prose formats (FLUX.2 and Krea 2,
 * MOSS-Image). Anima keeps every tag either way and has no budget.
 */
export function formatPrompt(
  format: NaturalPromptFormat,
  input: NaturalPromptInput,
  overrides: Record<string, string>,
  options: FormatPromptOptions = {},
): FormattedPrompt {
  const scene = buildScene(input, overrides, { traits: options.traits, characterAliases: options.characterAliases })
  const { phrases } = options
  const maxWords = options.fullDetail ? null : undefined
  const result = format === "anima"
    ? renderAnima(scene, { phrases })
    : format === "flux2"
      ? renderFlux2(scene, { phrases, maxWords })
      : renderMoss(scene, { phrases, maxWords })
  return { text: result.text, words: countWords(result.text), omitted: format === "anima" ? 0 : result.omitted }
}
