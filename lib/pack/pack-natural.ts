/**
 * What the natural-language converter gets for one Pack Mode prompt: the same
 * NaturalPromptSource a gallery card builds, with the base character's names,
 * a rating that follows the pack's content rating, and the sentences of the
 * library outfit the prompt wears.
 */
import type { NaturalPromptSource } from "@/lib/prompt/natural-format"
import type { PackRatingMode } from "@/hooks/use-pack-seed-search"
import { packOutfitDescription, type Outfit } from "@/lib/outfit-swap"
import { promptHasExplicitTag } from "./explicit-tags"
import { normalizeTagForPack, type PackPrompt } from "./pack-generator"

export interface PackNaturalContext {
  provider?: string
  /** The character the pack keeps (pack-normalized tag), or null. */
  character: string | null
  /** The base card's copyright field (space-separated), when there is a base card. */
  copyrights?: string
  /** The source's content rating; null when it is not known. */
  contentRating: PackRatingMode | null
  /** The base card's own rating, used when the content rating is not known. */
  baseRating?: string
  /** Library outfits by id, with their descriptions (outfit-descriptions.json). */
  outfits?: ReadonlyMap<number, Outfit>
  descriptions?: readonly string[]
}

/**
 * A pack prompt's rating: explicit when it carries an explicit tag, else the
 * rating its pass was drawn from ("both" packs keep explicit tags out of their
 * questionable half). The rating picks the converter's wording ("woman" or "girl").
 */
export function packPromptRating(prompt: string, contentRating: PackRatingMode | null, baseRating?: string): string | undefined {
  if (promptHasExplicitTag(prompt)) return "explicit"
  if (contentRating === "explicit") return "explicit"
  if (contentRating === "questionable" || contentRating === "both") return "questionable"
  if (contentRating === "sfw") return "general"
  return baseRating || undefined
}

/** Booru field spelling of a pack-normalized tag: "kashima (kancolle)" -> "kashima_(kancolle)". */
const fieldTag = (tag: string) => tag.trim().replace(/\s+/g, "_")

/** A prompt tag as pack-normalized text, without a weight or escapes: "(kashima \(kancolle\):1.1)" -> "kashima (kancolle)". */
function bareTag(tag: string): string {
  const trimmed = tag.trim()
  const weighted = /^\((.+):\s*-?\d+(?:\.\d+)?\)$/.exec(trimmed)
  return normalizeTagForPack((weighted ? weighted[1] : trimmed).replace(/\\(?=[()])/g, ""))
}

export function packNaturalSource(prompt: PackPrompt, context: PackNaturalContext): NaturalPromptSource {
  const tags = new Set(prompt.prompt.split(",").map(bareTag).filter(Boolean))
  // The name goes in only while the prompt still has it: "Include characters"
  // off, or an appearance left to vary, takes it out.
  const named = !!context.character && tags.has(bareTag(context.character))
  const outfit = prompt.outfitId !== undefined ? context.outfits?.get(prompt.outfitId) : undefined
  const text = prompt.outfitId !== undefined ? context.descriptions?.[prompt.outfitId] : undefined
  const outfitDescription = outfit && text ? packOutfitDescription(outfit, text, prompt.prompt) : undefined
  return {
    prompt: prompt.prompt,
    ...(named ? { characters: fieldTag(context.character!) } : {}),
    ...(named && context.copyrights ? { copyrights: context.copyrights } : {}),
    rating: packPromptRating(prompt.prompt, context.contentRating, context.baseRating),
    provider: context.provider,
    ...(outfitDescription ? { outfitDescription } : {}),
  }
}
