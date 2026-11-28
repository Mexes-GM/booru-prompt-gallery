/**
 * Names the booru didn't type. Gelbooru spells many series and characters its
 * own way ("pokemon scarlet and violet" where the tag database knows
 * "pokemon sv"), so neither the post's typed fields nor the taxonomy say what
 * they are, and in a themed pool a popular series repeats enough to pass the
 * pool-support filter. Two signals from data the pool already has:
 *
 *  1. The tag contains a name the pool or the taxonomy does know ("pokemon",
 *     "project moon"), as whole words.
 *  2. Its parenthesised qualifier is not one general tags use ("(symbol)",
 *     "(object)"): a qualifier only names use ("(5th costume)", "(exhibition)",
 *     an artist's name after an original character).
 *
 * A third signal, "every post with the tag shares one series", was measured on
 * real pools and left out: in a pool where one series is common it also caught
 * many general tags.
 *
 * Only for tags with no type and no slot; everything else is decided upstream.
 */
import type { BooruPost } from '../../booru/types'
import { splitTags } from '../../utils/tag-utils'

const NAME_SLOTS = new Set(['other:character', 'other:copyright', 'other:artist'])
/** Series names that are words, not works. */
const NOT_A_WORK = new Set(['original', 'real life'])
/** Shortest single-word name worth matching inside another tag ("pokemon", "touhou"). */
const MIN_SINGLE_WORD_NAME = 6
const QUALIFIER = /\(([^()]+)\)/g
/** Disambiguators boorus use on general tags, on top of those the taxonomy's own tags show. */
const GENERAL_QUALIFIERS = [
  'symbol', 'shape', 'object', 'medium', 'pattern', 'food', 'animal', 'plant', 'flower', 'clothes', 'clothing',
  'gesture', 'sign', 'emblem', 'organ', 'body part', 'instrument', 'weapon', 'vehicle', 'furniture', 'drink',
]

const spaced = (tag: string) => tag.toLowerCase().replace(/_/g, ' ').trim()
/** Words of a tag without parentheses: "faust (exhibition) (project moon)" -> "faust exhibition project moon". */
const plainWords = (tag: string) => tag.replace(/[()]/g, ' ').split(/\s+/).filter(Boolean)

interface Vocabulary {
  /** Known names, as plain words joined by spaces. */
  names: Set<string>
  /** Qualifiers general tags use. */
  generalQualifiers: Set<string>
}

const vocabularyCache = new WeakMap<Record<string, string>, Vocabulary>()

/** Names and general qualifiers of the taxonomy, once per overrides object. */
function taxonomyVocabulary(overrides: Record<string, string>): Vocabulary {
  const cached = vocabularyCache.get(overrides)
  if (cached) return cached
  const names = new Set<string>()
  const generalQualifiers = new Set<string>(GENERAL_QUALIFIERS)
  for (const [raw, slot] of Object.entries(overrides)) {
    const tag = spaced(raw)
    if (NAME_SLOTS.has(slot)) {
      if (slot !== 'other:artist') addName(names, tag)
      continue
    }
    for (const match of tag.matchAll(QUALIFIER)) generalQualifiers.add(match[1])
  }
  const vocabulary = { names, generalQualifiers }
  vocabularyCache.set(overrides, vocabulary)
  return vocabulary
}

function addName(names: Set<string>, tag: string) {
  if (NOT_A_WORK.has(tag)) return
  const words = plainWords(tag)
  if (words.length === 0) return
  if (words.length === 1 && words[0].length < MIN_SINGLE_WORD_NAME) return
  names.add(words.join(' '))
}

export interface NameDetectorInput {
  posts: readonly BooruPost[]
  overrides: Record<string, string>
}

/** True for a tag that is most likely a name: see the module comment. */
export function nameDetector({ posts, overrides }: NameDetectorInput): (tag: string) => boolean {
  const vocabulary = taxonomyVocabulary(overrides)
  const names = new Set(vocabulary.names)
  for (const post of posts) {
    for (const field of [post.tag_string_copyright, post.tag_string_character]) {
      splitTags(field || '').forEach((tag) => addName(names, spaced(tag)))
    }
  }

  const cache = new Map<string, boolean>()
  const compute = (tag: string): boolean => {
    for (const match of tag.matchAll(QUALIFIER)) {
      if (!vocabulary.generalQualifiers.has(match[1])) return true
    }
    const words = plainWords(tag)
    for (let i = 0; i < words.length; i++) {
      for (let j = i + 1; j <= words.length; j++) {
        if (names.has(words.slice(i, j).join(' '))) return true
      }
    }
    return false
  }
  return (raw: string) => {
    const tag = spaced(raw)
    let result = cache.get(tag)
    if (result === undefined) {
      result = compute(tag)
      cache.set(tag, result)
    }
    return result
  }
}
