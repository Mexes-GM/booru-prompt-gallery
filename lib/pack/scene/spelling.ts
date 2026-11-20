/**
 * The Danbooru spelling of another booru's tag, for the scenes: Rule34 writes "vaginal penetration",
 * "cum inside", "female on top" where Danbooru, whose vocabulary image models learn, writes
 * "vaginal", "cum in pussy", "girl on top". The data is Danbooru's own alias table
 * (lib/prompt/natural/tag-relations.ts TAG_ALIASES, read by canonicalTag), with its words'
 * aliases for longer tags ("butt focus" -> "ass focus") when the respelled tag is one the
 * taxonomy knows.
 *
 * An alias is a moderator's decision that two tags are one, and some merge tags that are not quite
 * the same thing ("vagina" -> "pussy", which the taxonomy files as lasting anatomy and as a state of
 * the picture). So the taxonomy decides when it has a say:
 *  - a tag the taxonomy doesn't file under its own name has no reading but its alias: it takes the
 *    alias, and with it the alias's slot and permanence ("voluptuous" becomes "curvy", lasting
 *    anatomy, instead of an unknown tag that travelled with any scene);
 *  - a tag the taxonomy files under its own name takes the alias only when the alias has the same
 *    slot and the same permanence ("big ass" -> "huge ass" does, "cock" -> "penis" does not).
 */
import { getTagSlotFromOverrides } from '../../tag-taxonomy'
import { canonicalTag } from '../../prompt/natural/relations'
import { TAG_ALIASES } from '../../prompt/natural/tag-relations'
import type { Permanence } from './permanence'

/** `tag` (pack form) in Danbooru's spelling, or itself. */
export function canonicalSpelling(tag: string, overrides: Record<string, string>, permanence: (tag: string) => Permanence): string {
  const own = overrides[tag]
  const alias = TAG_ALIASES[tag]
  // A tag the taxonomy knows under its own name is Danbooru's spelling of itself: its words stay as they are.
  const to = alias ?? (own ? tag : canonicalTag(tag, (respelled) => !!overrides[respelled]))
  if (to === tag) return tag
  if (!own) return to
  const slot = (t: string) => getTagSlotFromOverrides(t, overrides)?.slot
  return slot(to) === slot(tag) && permanence(to) === permanence(tag) ? to : tag
}

/**
 * A tag the user asked for, in the spelling the scenes use, for comparing with them (the prompt
 * keeps what the user wrote). The same rule as the scenes; without the permanence lookup, only a
 * tag the taxonomy doesn't file under its own name is respelled (the rule can't tell for the rest).
 */
export function requestSpelling(raw: string, overrides: Record<string, string>, permanence?: (tag: string) => Permanence): string {
  const tag = raw.toLowerCase().replace(/_/g, ' ').trim()
  if (!tag) return tag
  if (!permanence) return overrides[tag] ? tag : canonicalSpelling(tag, overrides, () => 'state')
  return canonicalSpelling(tag, overrides, permanence)
}
