/**
 * Classifies a free-text pasted prompt into Pack Mode's tag-category buckets
 * — the "From my prompt" base (see the design spec
 * `docs/superpowers/specs/2026-09-27-pack-mode-simplification-design.md` §3).
 * Produces the exact same shape `classifyPostForPack` does for a base card,
 * so the rest of usePackMode (lockedTags, axis toggles) treats both bases
 * identically.
 */
import type { TagCategory } from '../tag-classifier'
import { classifyTags } from '../tag-classifier'
import { splitCommaSeparatedTags } from '../utils/tag-utils'
import { normalizeTagForPack } from './pack-generator'

export interface ClassifiedBasePrompt {
  classified: Record<TagCategory, string[]>
  /** knownCharacterTags found in the prompt text, in order of appearance. */
  characterTags: string[]
}

export function classifyBasePrompt(
  text: string,
  tagOverrides: Record<string, string>,
  knownCharacterTags: string[]
): ClassifiedBasePrompt {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const raw of splitCommaSeparatedTags(text)) {
    const norm = normalizeTagForPack(raw)
    if (!norm || seen.has(norm)) continue
    seen.add(norm)
    tags.push(norm)
  }

  const classified = classifyTags(tags, tagOverrides, knownCharacterTags)

  const knownSet = new Set(knownCharacterTags.map(normalizeTagForPack))
  const characterTags = tags.filter((t) => knownSet.has(t))

  return { classified, characterTags }
}
