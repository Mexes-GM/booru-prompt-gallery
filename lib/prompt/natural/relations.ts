/**
 * What booru tags say about each other, read from Danbooru's own data
 * (tag-relations.ts): which tags another one implies ("cat ears" -> "animal
 * ears", "on back" -> "lying"), and the Danbooru spelling of another booru's
 * tag ("tits" -> "breasts"). Booru posts carry the general tag next to the
 * specific one; the prose says each thing once.
 */
import { TAG_ALIASES, TAG_IMPLICATIONS } from "./tag-relations"

// Same rule as the generator: a phrase with a preposition, a verb or a negation is not a compound noun.
const NOT_A_COMPOUND_RE = /\b(on|in|into|onto|over|under|behind|between|around|from|with|without|at|to|of|through|against|above|below|near|by|for|own|and|or|x)\b|'s\b|^no |^(?!holding )\S+ing /

/**
 * A compound noun is a kind of its shorter endings: "black fur-trimmed coat" ->
 * ["fur-trimmed coat", "coat"]. Phrases with a preposition or a verb are not
 * ("hand on own ass" is not a kind of "ass"), except "holding sword" -> "sword".
 */
export function nounParents(tag: string): string[] {
  if (NOT_A_COMPOUND_RE.test(tag) || tag.includes("(")) return []
  const words = tag.split(" ")
  return words.slice(1).map((_, i) => words.slice(i + 1).join(" "))
}

// Rule34 writes skin tones as gendered tags ("light-skinned female"); Danbooru implies the tone only for "dark".
const SKINNED_RE = /^([a-z]+)-skinned (female|male|futanari|futa|girl|boy|woman|man)$/

function directParents(tag: string): string[] {
  const skinned = tag.match(SKINNED_RE)
  // Another booru's spelling implies what the Danbooru tag does: "pierced nipples" -> "piercing",
  // "laying on side" (respelled "lying on side", an alias of "on side") -> "lying".
  const alias = TAG_ALIASES[tag]
  const respelled = tag.includes(" ") ? tag.split(" ").map(canonicalWord).join(" ") : tag
  return [
    ...(alias ? [alias] : []), ...(respelled !== tag ? [respelled] : []),
    ...(TAG_IMPLICATIONS[tag] ?? []), ...nounParents(tag), ...(skinned ? [`${skinned[1]} skin`] : []),
  ]
}

const closures = new Map<string, ReadonlySet<string>>()

/** Every tag a tag implies, directly or through others: "black bikini" -> bikini, swimsuit. */
export function impliedBy(tag: string): ReadonlySet<string> {
  const cached = closures.get(tag)
  if (cached) return cached
  const out = new Set<string>()
  const stack = directParents(tag)
  while (stack.length) {
    const next = stack.pop()!
    if (out.has(next) || next === tag) continue
    out.add(next)
    stack.push(...directParents(next))
  }
  closures.set(tag, out)
  return out
}

/** True when `tag` is a kind of `generic`, by Danbooru's implications or as a compound noun. */
export function isKindOf(tag: string, generic: string): boolean {
  return tag !== generic && impliedBy(tag).has(generic)
}

/**
 * The tags of `tags` that some other tag of `context` implies, in any booru's
 * spelling ("lying down" is Rule34's "lying", which "on back" implies).
 */
export function impliedAmong(tags: readonly string[], context: Iterable<string> = tags): Set<string> {
  const wanted = new Map<string, string[]>()
  for (const tag of tags) for (const key of new Set([tag, TAG_ALIASES[tag] ?? tag])) wanted.set(key, [...(wanted.get(key) ?? []), tag])
  const implied = new Set<string>()
  for (const tag of context) {
    for (const other of impliedBy(tag)) for (const given of wanted.get(other) ?? []) if (given !== tag) implied.add(given)
  }
  return implied
}

// One-word aliases ("butt" -> "ass", "cock" -> "penis") also spell the longer tags they appear in.
const WORD_ALIASES = new Map(Object.entries(TAG_ALIASES).filter(([from, to]) => !from.includes(" ") && !to.includes(" ")))

/** "cock" -> "penis": the Danbooru word for a word another booru uses, for comparing tags. */
export function canonicalWord(word: string): string {
  return WORD_ALIASES.get(word) ?? word
}

/**
 * Another booru's spelling of a tag, read as Danbooru's: an alias ("big butt" ->
 * "huge ass"), else the tag with its words' aliases when that names a tag
 * `isKnown` accepts ("butt focus" -> "ass focus"). Otherwise the tag itself.
 */
export function canonicalTag(tag: string, isKnown: (tag: string) => boolean = () => false): string {
  const alias = TAG_ALIASES[tag]
  if (alias) return alias
  if (!tag.includes(" ")) return tag
  const words = tag.split(" ")
  const respelled = words.map(canonicalWord).join(" ")
  return respelled !== tag && isKnown(respelled) ? TAG_ALIASES[respelled] ?? respelled : tag
}
