/**
 * Pure (no React/hooks) derivation of a card's final displayed prompt.
 *
 * Extracted from hooks/use-card-prompt.ts (`baseContent`/`displayContent` +
 * Smart Tag Exclusion pipeline) so it can be called imperatively in a batch
 * loop — e.g. Bulk Send's "Real posts" mode, which needs to derive one clean
 * prompt per post outside of React's render cycle. `useCardPrompt` calls this
 * same function internally so both call sites can never drift apart.
 */
import {
  type BooruPost,
  isAibooruPost,
  getPromptFromPost,
  removeLoRaTags as removeLoRaTagsUtil,
  removeQualityTags as removeQualityTagsUtil,
} from "@/lib/api-client"
import {
  cleanPrompt,
  normalize,
  META_TAGS_SET,
  type AppliedTagAppend,
  type AppliedWordReplacement,
  type TagAppendRule,
  type WordReplacementRule,
} from "@/lib/cleanPrompt"
import { type BackgroundMode, processBackgroundTags } from "@/lib/background-detector"
import { deriveBackgroundContext, type MatchStrictness } from "@/lib/background-context"
import { applyWeights } from "@/lib/weight-utils"
import { resolveTagConflicts } from "@/lib/tag-conflicts"
import { splitCommaSeparatedTags } from "@/lib/utils/tag-utils"

export interface DerivePostPromptOptions {
  excludeInput: string
  addInput: string
  /**
   * Search query entered in the search bar (e.g. "spirit blossom syndra, 1girl, solo").
   * Any searched prompt tag that is not present in the post's cleaned prompt will
   * automatically be appended after the user's "Tags to add" (addInput).
   */
  searchTags?: string
  findInput?: string
  replaceInput?: string
  tagAppendRules?: TagAppendRule[]
  includeCharacters: boolean
  optimizeTags: boolean
  smartTagExclusion?: boolean
  prependAnimaArtist?: boolean
  removeLoRaTags?: boolean
  removeQualityTags?: boolean
  backgroundMode?: BackgroundMode
  simpleBackgroundReplacementTags?: string
  randomBackgroundPatterns?: boolean
  randomBackgroundIncludeGradients?: boolean
  detailedBackgroundsList?: string[][]
  /** How strictly Detailed Random gates its pick against the post's scene. */
  backgroundMatchStrictness?: MatchStrictness
  tagOverrides?: Record<string, string>
  globalWeights?: Record<string, number>
  isGlobalWeightsEnabled?: boolean
}

export interface DerivePostPromptResult {
  /** Final prompt string (post cleanPrompt + Smart Tag Exclusion + global weights). */
  displayContent: string
  /** Same pipeline but without the "added tags" (addInput) — used for classification/copy. */
  pureDisplayContent: string
  /** displayContent before global weights are applied. */
  baseContent: string
  /** pureDisplayContent before global weights are applied. */
  pureContent: string
  replacedTags: AppliedWordReplacement[]
  hasReplacements: boolean
  appendedTags: AppliedTagAppend[]
  hasAppends: boolean
  conflictingTags: { tag: string; reason: string }[]
}

function buildWordReplacements(findInput: string, replaceInput: string): WordReplacementRule[] {
  const finds = splitCommaSeparatedTags(findInput)
  const replaces = splitCommaSeparatedTags(replaceInput)
  const pairCount = Math.min(finds.length, replaces.length)
  const rules: WordReplacementRule[] = []
  for (let i = 0; i < pairCount; i++) {
    rules.push({ find: finds[i], replace: replaces[i] })
  }
  return rules
}

/**
 * Extracts prompt-relevant tags from a search query string:
 * - Splits by comma
 * - Filters out negative tags (-tag), booru operators/metatags with colons (rating:, order:, score:, etc.)
 * - Filters out general meta tags (highres, absurdres, commentary, etc.)
 * - Normalizes tags and removes duplicates
 */
export function extractSearchPromptTags(searchTags?: string): string[] {
  if (!searchTags || !searchTags.trim()) return []
  const raw = splitCommaSeparatedTags(searchTags)
  const result: string[] = []
  const seen = new Set<string>()

  for (const tag of raw) {
    const trimmed = tag.trim()
    if (!trimmed) continue
    // Exclude negative tags (e.g. "-video", "-monochrome")
    if (trimmed.startsWith("-")) continue
    // Exclude booru metatags / search operators (e.g. "rating:general", "order:popular", "score:>=10", "tagcount:>=20", "has:prompt", "is:sfw")
    if (trimmed.includes(":")) continue

    const normalized = normalize(trimmed.replace(/\\/g, ""))
    if (!normalized) continue
    // Exclude general meta tags like "highres", "absurdres", "commentary", etc.
    if (META_TAGS_SET.has(normalized)) continue

    if (!seen.has(normalized)) {
      seen.add(normalized)
      result.push(normalized)
    }
  }

  return result
}

/**
 * Derive the final, cleaned prompt for a single post, applying the exact same
 * pipeline as a card in the gallery: cleanPrompt -> Smart Tag Exclusion (added
 * tags vs. base) -> cleanPrompt again with the conflict-resolved added tags ->
 * optional global weights.
 */
export function derivePostPrompt(
  post: BooruPost,
  options: DerivePostPromptOptions
): DerivePostPromptResult {
  const {
    excludeInput,
    addInput,
    searchTags,
    findInput = "",
    replaceInput = "",
    tagAppendRules = [],
    includeCharacters,
    optimizeTags,
    smartTagExclusion = true,
    prependAnimaArtist = false,
    removeLoRaTags,
    removeQualityTags,
    backgroundMode,
    simpleBackgroundReplacementTags,
    randomBackgroundPatterns = false,
    randomBackgroundIncludeGradients = true,
    detailedBackgroundsList,
    backgroundMatchStrictness,
    tagOverrides,
    globalWeights = {},
    isGlobalWeightsEnabled = false,
  } = options

  const excludeList = splitCommaSeparatedTags(excludeInput)
  const addList = splitCommaSeparatedTags(addInput)
  const wordReplacements = buildWordReplacements(findInput, replaceInput)
  const searchPromptTags = extractSearchPromptTags(searchTags)

  const isAiPost = isAibooruPost(post)
  let aiPrompt = isAiPost ? getPromptFromPost(post) : null
  if (aiPrompt && removeLoRaTags) aiPrompt = removeLoRaTagsUtil(aiPrompt)
  if (aiPrompt && removeQualityTags) aiPrompt = removeQualityTagsUtil(aiPrompt)

  // sharedCleaned: base pipeline with 'keep' background, no added tags — used
  // to resolve conflicts against the tags the user wants to add.
  const sharedOpts = {
    includeCharacters, includeCopyrights: false, optimizeTags,
    exclude: excludeList, addedTags: [] as string[], tagOverrides,
    backgroundMode: "keep" as BackgroundMode, simpleBackgroundReplacementTags,
    escapeOutput: false, metaTags: post.tag_string_meta,
    wordReplacements,
    tagAppendRules,
  }
  const sharedCleaned = aiPrompt
    ? cleanPrompt(aiPrompt, "", "", "", sharedOpts)
    : cleanPrompt(post.tag_string, post.tag_string_artist, post.tag_string_character, post.tag_string_copyright, sharedOpts)

  // Scene context for Detailed Random, derived ONCE here and shared by both
  // pipelines below. sharedCleaned is the right source: it still carries the
  // post's original scenery (background mode is 'keep' for it) and is already
  // normalized, meta-filtered and word-replaced. Deriving it separately inside
  // each pipeline would read slightly different tag lists — the display path
  // runs on cleanPrompt's internal classified tags, the pure path on this
  // string — and the two could then pick DIFFERENT backgrounds for one card.
  const backgroundContext = backgroundMode === "detailed_random"
    ? deriveBackgroundContext({
        tags: sharedCleaned ? sharedCleaned.split(",").map((t) => t.trim()).filter(Boolean) : [],
        rating: post.rating,
      })
    : undefined

  const applyBackground = (content: string): string => {
    if (!content) return content
    if (backgroundMode === "keep" || backgroundMode === undefined) return content
    const tags = content.split(",").map((t) => t.trim())
    const processed = processBackgroundTags(
      tags, backgroundMode, simpleBackgroundReplacementTags, tagOverrides,
      { patternsEnabled: randomBackgroundPatterns, includeGradients: randomBackgroundIncludeGradients },
      detailedBackgroundsList, post.id, backgroundContext, backgroundMatchStrictness
    )
    return processed.join(", ")
  }

  const pureContent = applyBackground(sharedCleaned)

  // Verify which searched tags are missing from the prompt, and append them
  // after the user's manual "Tags to add" (addInput).
  const pureContentTags = pureContent
    ? pureContent.split(",").map((t) => normalize(t.replace(/\\/g, ""))).filter(Boolean)
    : []
  const pureContentSet = new Set(pureContentTags)
  const addListSet = new Set(addList.map((t) => normalize(t.replace(/\\/g, ""))).filter(Boolean))
  const excludeListSet = new Set(excludeList.map((t) => normalize(t.replace(/\\/g, ""))).filter(Boolean))

  const missingSearchTags: string[] = []
  for (const searchedTag of searchPromptTags) {
    const norm = normalize(searchedTag.replace(/\\/g, ""))
    if (!norm) continue
    if (excludeListSet.has(norm)) continue
    if (addListSet.has(norm)) continue
    if (pureContentSet.has(norm)) continue
    missingSearchTags.push(searchedTag)
  }

  const effectiveAddedTags = [...addList, ...missingSearchTags]

  const conflictResolution = (!pureContent || effectiveAddedTags.length === 0 || !smartTagExclusion)
    ? { validTags: effectiveAddedTags, conflictingTags: [] }
    : resolveTagConflicts(pureContent.split(",").map((t) => t.trim()), effectiveAddedTags)

  const firstArtistTag = (() => {
    if (!prependAnimaArtist) return undefined
    const raw = post.tag_string_artist?.trim().split(/\s+/).filter(Boolean)[0]
    return raw ? raw.replace(/_/g, " ") : undefined
  })()

  let captured: AppliedWordReplacement[] = []
  let capturedAppends: AppliedTagAppend[] = []
  const opts = {
    includeCharacters, includeCopyrights: false, optimizeTags,
    exclude: excludeList, addedTags: conflictResolution.validTags, tagOverrides,
    backgroundMode, simpleBackgroundReplacementTags,
    randomBackgroundPatterns, randomBackgroundIncludeGradients, detailedBackgroundsList,
    backgroundSeed: post.id,
    backgroundContext,
    backgroundMatchStrictness,
    metaTags: post.tag_string_meta,
    wordReplacements,
    tagAppendRules,
    prependArtistTag: firstArtistTag,
    onWordReplacementsApplied: (applied: AppliedWordReplacement[]) => { captured = applied },
    onTagAppendsApplied: (applied: AppliedTagAppend[]) => { capturedAppends = applied },
  }
  const baseContent = aiPrompt
    ? cleanPrompt(aiPrompt, "", "", "", opts)
    : cleanPrompt(post.tag_string, post.tag_string_artist, post.tag_string_character, post.tag_string_copyright, opts)

  const displayContent = isGlobalWeightsEnabled && baseContent
    ? applyWeights(baseContent, globalWeights)
    : baseContent

  const pureDisplayContent = isGlobalWeightsEnabled && pureContent
    ? applyWeights(pureContent, globalWeights)
    : pureContent

  return {
    displayContent,
    pureDisplayContent,
    baseContent,
    pureContent,
    replacedTags: captured,
    hasReplacements: captured.length > 0,
    appendedTags: capturedAppends,
    hasAppends: capturedAppends.length > 0,
    conflictingTags: conflictResolution.conflictingTags,
  }
}
