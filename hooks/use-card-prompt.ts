"use client"

import { useCallback, useEffect, useMemo } from "react"
import {
  type BooruPost,
  isAibooruPost,
  getPromptFromPost,
  removeLoRaTags as removeLoRaTagsUtil,
  removeQualityTags as removeQualityTagsUtil,
} from "@/lib/api-client"
import { cleanPrompt, type AppliedWordReplacement } from "@/lib/cleanPrompt"
import { type BackgroundMode, processBackgroundTags } from "@/lib/background-detector"
import { applyWeights } from "@/lib/weight-utils"
import { classifyTags, computeRichnessScore, type ClassifiedTags, type RichnessScore } from "@/lib/tag-classifier"
import { resolveTagConflicts } from "@/lib/tag-conflicts"
import { splitCommaSeparatedTags } from "@/lib/utils/tag-utils"

export interface UseCardPromptArgs {
  post: BooruPost
  tagCounts?: Record<string, number>
  excludeInput: string
  addInput: string
  /** "Find" side of the Find & Replace list (comma-separated, paired by index with replaceInput). */
  findInput?: string
  /** "Replace" side of the Find & Replace list (comma-separated, paired by index with findInput). */
  replaceInput?: string
  includeCharacters: boolean
  optimizeTags: boolean
  smartTagExclusion?: boolean
  /**
   * Prepends the post's first artist tag as "@artist," at the start of the
   * prompt. Only meaningful for the Anima Pencil-XL checkpoint family.
   * No-op when the post has no artist tag (e.g. Aibooru AI-generated posts).
   */
  prependAnimaArtist?: boolean
  removeLoRaTags?: boolean
  removeQualityTags?: boolean
  backgroundMode?: BackgroundMode
  simpleBackgroundReplacementTags?: string
  randomBackgroundPatterns?: boolean
  randomBackgroundIncludeGradients?: boolean
  detailedBackgroundsList?: string[][]
  tagOverrides?: Record<string, string>
  globalWeights?: Record<string, number>
  isGlobalWeightsEnabled?: boolean
  /** Called whenever baseContent changes substantially (new post/filters) so the
   *  caller can reset any local edit state (e.g. InteractivePrompt's modifiedContent). */
  onBaseContentChange?: () => void
}

/**
 * The "prompt settings" subset of UseCardPromptArgs — everything except the
 * per-card/per-render pieces (post, tagCounts, globalWeights,
 * isGlobalWeightsEnabled, onBaseContentChange) that callers typically pass
 * separately. Lets shells (web app, Pocket) build one settings bundle from
 * their own state hooks and spread it into useCardPrompt per card, instead of
 * re-declaring the field list.
 */
export type UseCardPromptOptions = Omit<
  UseCardPromptArgs,
  "post" | "tagCounts" | "globalWeights" | "isGlobalWeightsEnabled" | "onBaseContentChange"
>

/**
 * Derives the full prompt pipeline for a single masonry card: cleanPrompt →
 * background processing → conflict resolution against added tags → global
 * weights → tag classification. Extracted from `masonry-item.tsx` (Fase 6 del
 * refactor de sostenibilidad) to separate prompt derivation from the
 * image/badges/actions view. Pure derivation — no DOM/image state here (that
 * stays in the component, since it's about rendering, not the prompt).
 */
export function useCardPrompt({
  post,
  tagCounts,
  excludeInput,
  addInput,
  findInput = "",
  replaceInput = "",
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
  tagOverrides,
  globalWeights = {},
  isGlobalWeightsEnabled = false,
  onBaseContentChange,
}: UseCardPromptArgs) {
  const excludeList = useMemo(() => splitCommaSeparatedTags(excludeInput), [excludeInput])
  const addList = useMemo(() => splitCommaSeparatedTags(addInput), [addInput])

  // Find & Replace: "find, find2" / "replace, replace2" paired by index.
  // Extra entries on either side (mismatched list lengths) are dropped rather
  // than guessed at, since a wrong pairing could silently corrupt tags.
  const wordReplacements = useMemo(() => {
    const finds = splitCommaSeparatedTags(findInput)
    const replaces = splitCommaSeparatedTags(replaceInput)
    const pairCount = Math.min(finds.length, replaces.length)
    const rules: { find: string; replace: string }[] = []
    for (let i = 0; i < pairCount; i++) {
      rules.push({ find: finds[i], replace: replaces[i] })
    }
    return rules
  }, [findInput, replaceInput])

  // Check if this is an Aibooru post with prompt
  const isAiPost = isAibooruPost(post)
  let aiPrompt = isAiPost ? getPromptFromPost(post) : null

  // Apply LoRa tag removal if option is enabled (only to original prompt)
  if (aiPrompt && removeLoRaTags) {
    aiPrompt = removeLoRaTagsUtil(aiPrompt)
  }

  // Apply quality tag removal if option is enabled (only to original prompt)
  if (aiPrompt && removeQualityTags) {
    aiPrompt = removeQualityTagsUtil(aiPrompt)
  }

  // ponytail: compute cleanPrompt once with common options, derive variants.
  // pureContent = shared + bg processing. baseContent = shared + addedTags + bg processing.
  // teachContent stays separate (different optimizeTags: false pipeline).
  const sharedCleaned = useMemo(() => {
    const sharedOpts = {
      includeCharacters, includeCopyrights: false, optimizeTags,
      exclude: excludeList, addedTags: [] as string[], tagOverrides,
      backgroundMode: 'keep' as BackgroundMode, simpleBackgroundReplacementTags,
      escapeOutput: false, metaTags: post.tag_string_meta,
      wordReplacements,
    }
    return aiPrompt
      ? cleanPrompt(aiPrompt, "", "", "", sharedOpts)
      : cleanPrompt(post.tag_string, post.tag_string_artist, post.tag_string_character, post.tag_string_copyright, sharedOpts)
  }, [aiPrompt, post.tag_string, post.tag_string_artist, post.tag_string_character, post.tag_string_copyright, post.tag_string_meta, includeCharacters, optimizeTags, excludeList, tagOverrides, simpleBackgroundReplacementTags, wordReplacements])

  // ---- Background processing helper (applied on top of sharedCleaned) ----
  const applyBackground = useCallback((content: string) => {
    if (!content) return content
    if (backgroundMode === 'keep' || backgroundMode === undefined) return content
    const tags = content.split(',').map(t => t.trim())
    const processed = processBackgroundTags(
      tags, backgroundMode, simpleBackgroundReplacementTags, tagOverrides,
      { patternsEnabled: randomBackgroundPatterns, includeGradients: randomBackgroundIncludeGradients },
      detailedBackgroundsList, post.id,
    )
    return processed.join(', ')
  }, [backgroundMode, simpleBackgroundReplacementTags, tagOverrides, randomBackgroundPatterns, randomBackgroundIncludeGradients, detailedBackgroundsList, post.id])

  // ---- Derived outputs ----

  // pureContent: sharedCleaned + background processing, no added tags (for classification/copying)
  const pureContent = useMemo(() => applyBackground(sharedCleaned), [sharedCleaned, applyBackground])

  const conflictResolution = useMemo(() => {
    if (!pureContent || addList.length === 0 || !smartTagExclusion) return { validTags: addList, conflictingTags: [] }
    const baseTags = pureContent.split(',').map(t => t.trim())
    return resolveTagConflicts(baseTags, addList)
  }, [pureContent, addList, smartTagExclusion])

  // First artist tag (Anima "@artist" invocation, see prependAnimaArtist).
  // Only the first artist is used — collabs with multiple artist tags fall
  // back to that first one, same convention as SaveArtistButton. Aibooru
  // posts (AI-generated) have no real booru artist, so tag_string_artist is
  // empty there and this naturally becomes undefined (no-op).
  const firstArtistTag = useMemo(() => {
    if (!prependAnimaArtist) return undefined
    const raw = post.tag_string_artist?.trim().split(/\s+/).filter(Boolean)[0]
    return raw ? raw.replace(/_/g, " ") : undefined
  }, [prependAnimaArtist, post.tag_string_artist])

  // baseContent: full cleanPrompt with conflict-resolved addedTags.
  // Must go through cleanPrompt so addedTags get normalized, exclusion-filtered,
  // and deduplicated against the rest of the output.
  // replacedTags is captured alongside it (same computation) so the "Find &
  // Replace" badge reflects exactly what ended up in the final prompt.
  const { baseContent, replacedTags } = useMemo(() => {
    let captured: AppliedWordReplacement[] = []
    const opts = {
      includeCharacters, includeCopyrights: false, optimizeTags,
      exclude: excludeList, addedTags: conflictResolution.validTags, tagOverrides,
      backgroundMode, simpleBackgroundReplacementTags,
      randomBackgroundPatterns, randomBackgroundIncludeGradients, detailedBackgroundsList,
      backgroundSeed: post.id,
      metaTags: post.tag_string_meta,
      wordReplacements,
      prependArtistTag: firstArtistTag,
      onWordReplacementsApplied: (applied: AppliedWordReplacement[]) => { captured = applied },
    }
    const content = aiPrompt
      ? cleanPrompt(aiPrompt, "", "", "", opts)
      : cleanPrompt(post.tag_string, post.tag_string_artist, post.tag_string_character, post.tag_string_copyright, opts)
    return { baseContent: content, replacedTags: captured }
  }, [aiPrompt, post.tag_string, post.tag_string_artist, post.tag_string_character, post.tag_string_copyright, post.tag_string_meta, post.id, includeCharacters, optimizeTags, excludeList, conflictResolution.validTags, tagOverrides, backgroundMode, simpleBackgroundReplacementTags, randomBackgroundPatterns, randomBackgroundIncludeGradients, detailedBackgroundsList, wordReplacements, firstArtistTag])

  const hasReplacements = replacedTags.length > 0

  const displayContent = useMemo(() => {
    if (isGlobalWeightsEnabled && baseContent) {
      return applyWeights(baseContent, globalWeights)
    }
    return baseContent
  }, [baseContent, isGlobalWeightsEnabled, globalWeights])

  const pureDisplayContent = useMemo(() => {
    if (isGlobalWeightsEnabled && pureContent) {
      return applyWeights(pureContent, globalWeights)
    }
    return pureContent
  }, [pureContent, isGlobalWeightsEnabled, globalWeights])

  // Reset caller's local edit state when BASE content changes substantially
  // (e.g. new post or new filters) — NOT when global weights change/toggle.
  useEffect(() => {
    onBaseContentChange?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseContent])

  // Prepare character tags
  const characterTagsArray = useMemo(() => (post.tag_string_character ? post.tag_string_character.split(' ') : [])
    .map(t => t.replace(/_/g, ' ').toLowerCase().replace(/\(/g, "\\(").replace(/\)/g, "\\)")), [post.tag_string_character])

  // Lazy: only computed when the Teach modal opens (rare).
  // Combines teachContent → teachTagsForClassification → classifiedTeachTags
  // into a single on-demand pipeline instead of 3 eager useMemos.
  const getClassifiedTeachTags = useCallback(() => {
    const raw = aiPrompt
      ? cleanPrompt(aiPrompt, "", "", "", {
        includeCharacters, includeCopyrights: false, optimizeTags: false,
        exclude: excludeList, tagOverrides,
        backgroundMode: 'keep', simpleBackgroundReplacementTags,
        escapeOutput: false, metaTags: post.tag_string_meta,
        wordReplacements,
      })
      : cleanPrompt(post.tag_string, post.tag_string_artist, post.tag_string_character, post.tag_string_copyright, {
        includeCharacters, includeCopyrights: false, optimizeTags: false,
        exclude: excludeList, tagOverrides,
        backgroundMode: 'keep', simpleBackgroundReplacementTags,
        escapeOutput: false, metaTags: post.tag_string_meta,
        wordReplacements,
      })
    const teachTags = raw ? raw.split(',').map(t => t.trim()) : []
    const normalizeForMatch = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/\\(?=[()])/g, "").trim()
    const charTagsSet = new Set(characterTagsArray.map(normalizeForMatch))
    const filteredTags = teachTags.filter(t => !charTagsSet.has(normalizeForMatch(t)))
    return classifyTags(filteredTags, tagOverrides, [])
  }, [aiPrompt, post.tag_string, post.tag_string_artist, post.tag_string_character, post.tag_string_copyright, post.tag_string_meta, includeCharacters, excludeList, tagOverrides, simpleBackgroundReplacementTags, characterTagsArray, wordReplacements])

  // Pre-classify tags for the dropdown counts (USING PURE DISPLAY CONTENT)
  // This ensures that "added tags" don't inflate the category counts
  const tagsForClassification = useMemo(() => pureDisplayContent ? pureDisplayContent.split(',').map(t => t.trim()) : [], [pureDisplayContent])

  const totalTagsCount = useMemo(() => tagsForClassification.filter(t => t.length > 0).length, [tagsForClassification])

  const tagCountIndicator = useMemo(() => {
    if (!tagCounts || characterTagsArray.length === 0) return null

    let maxCount = 0
    let sumCounts = 0

    // Find the top character's count
    for (const rawTag of characterTagsArray) {
      // Re-normalize tag to match how it might be stored in the dictionary if needed,
      // but Danbooru tags typically keep underscores.
      // In characterTagsArray spaces were replaced, we should check both.
      const withSpaces = rawTag.replace(/\\/g, '') // remove escapes
      const withUnderscores = withSpaces.replace(/\s+/g, '_')

      const count = tagCounts[withUnderscores] ?? tagCounts[withSpaces] ?? 0
      if (count > maxCount) maxCount = count
      sumCounts += count
    }

    if (maxCount === 0) return null

    return Intl.NumberFormat('en', { notation: 'compact' }).format(maxCount)
  }, [tagCounts, characterTagsArray])

  const classifiedTags: ClassifiedTags = useMemo(() => {
    // Ensure character tags are included in the classification source
    const allTagsForClassification = Array.from(new Set([...characterTagsArray, ...tagsForClassification]))
    return classifyTags(allTagsForClassification, tagOverrides, characterTagsArray)
  }, [characterTagsArray, tagsForClassification, tagOverrides])

  // Richness score: category coverage (clothing/pose/scenery/appearance) derived
  // from the same classifiedTags already computed above — no extra classification
  // pass. See lib/tag-classifier.ts computeRichnessScore for rationale.
  const richnessScore: RichnessScore = useMemo(() => computeRichnessScore(classifiedTags), [classifiedTags])

  // Determine if options are active that affect the prompt
  const hasActiveOptions = useMemo(() => {
    // Only show indicator if Smart Tag Exclusion actively blocked tags from being added
    return conflictResolution.conflictingTags.length > 0
  }, [conflictResolution.conflictingTags.length])

  return {
    isAiPost,
    aiPrompt,
    pureContent,
    baseContent,
    displayContent,
    pureDisplayContent,
    characterTagsArray,
    getClassifiedTeachTags,
    totalTagsCount,
    tagCountIndicator,
    classifiedTags,
    richnessScore,
    hasActiveOptions,
    conflictingTags: conflictResolution.conflictingTags,
    replacedTags,
    hasReplacements,
  }
}
