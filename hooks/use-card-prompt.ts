"use client"

import { useCallback, useEffect, useMemo } from "react"
import {
  type BooruPost,
  isAibooruPost,
  getPromptFromPost,
} from "@/lib/api-client"
import { cleanPrompt, type TagAppendRule } from "@/lib/cleanPrompt"
import { type BackgroundMode } from "@/lib/background-detector"
import { type MatchStrictness } from "@/lib/background-context"
import { classifyTags, computeRichnessScore, type ClassifiedTags, type RichnessScore } from "@/lib/tag-classifier"
import { splitCommaSeparatedTags } from "@/lib/utils/tag-utils"
import { derivePostPrompt } from "@/lib/prompt/derive-post-prompt"

export interface UseCardPromptArgs {
  post: BooruPost
  tagCounts?: Record<string, number>
  excludeInput: string
  addInput: string
  /** Search query entered in the search bar. Missing searched tags are appended after addInput. */
  searchTags?: string
  /** Whether missing search-bar tags get auto-appended (see `searchTags`). Defaults to true. */
  autoAppendSearchTags?: boolean
  /** "Find" side of the Find & Replace list (comma-separated, paired by index with replaceInput). */
  findInput?: string
  /** "Replace" side of the Find & Replace list (comma-separated, paired by index with findInput). */
  replaceInput?: string
  /** Grouped exact-match rules that append tags without replacing the source tag. */
  tagAppendRules?: TagAppendRule[]
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
  /** How strictly Detailed Random gates its pick against the post's scene. */
  backgroundMatchStrictness?: MatchStrictness
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
  searchTags,
  autoAppendSearchTags = true,
  findInput = "",
  replaceInput = "",
  tagAppendRules,
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
  onBaseContentChange,
}: UseCardPromptArgs) {
  const excludeList = useMemo(() => splitCommaSeparatedTags(excludeInput), [excludeInput])

  // Prompt derivation itself (cleanPrompt -> Smart Tag Exclusion -> cleanPrompt
  // with resolved added tags -> global weights) is delegated to the pure,
  // hook-free derivePostPrompt (lib/prompt/derive-post-prompt.ts) so the exact
  // same pipeline can be called imperatively in a batch loop (Bulk Send's
  // "Real posts" mode) without risking the two paths drifting apart.
  const derived = useMemo(() => derivePostPrompt(post, {
    excludeInput, addInput, searchTags, autoAppendSearchTags, findInput, replaceInput, tagAppendRules,
    includeCharacters, optimizeTags, smartTagExclusion, prependAnimaArtist,
    removeLoRaTags, removeQualityTags,
    backgroundMode, simpleBackgroundReplacementTags,
    randomBackgroundPatterns, randomBackgroundIncludeGradients, detailedBackgroundsList,
    backgroundMatchStrictness,
    tagOverrides, globalWeights, isGlobalWeightsEnabled,
  }), [
    post, excludeInput, addInput, searchTags, autoAppendSearchTags, findInput, replaceInput, tagAppendRules,
    includeCharacters, optimizeTags, smartTagExclusion, prependAnimaArtist,
    removeLoRaTags, removeQualityTags,
    backgroundMode, simpleBackgroundReplacementTags,
    randomBackgroundPatterns, randomBackgroundIncludeGradients, detailedBackgroundsList,
    backgroundMatchStrictness,
    tagOverrides, globalWeights, isGlobalWeightsEnabled,
  ])

  const {
    displayContent,
    pureDisplayContent,
    baseContent,
    pureContent,
    replacedTags,
    hasReplacements,
    appendedTags,
    hasAppends,
    conflictingTags: conflictResolutionConflictingTags,
  } = derived

  // Check if this is an Aibooru post with prompt (still needed below for the
  // lazy Teach-modal pipeline, which uses a different optimizeTags:false pass).
  const isAiPost = isAibooruPost(post)
  const aiPromptForTeach = isAiPost ? getPromptFromPost(post) : null

  // Find & Replace rules, recomputed here only for the Teach-modal pipeline
  // below (derivePostPrompt computes its own copy internally).
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

  // Reset caller's local edit state when BASE content changes substantially
  // (e.g. new post or new filters) — NOT when global weights change/toggle.
  useEffect(() => {
    onBaseContentChange?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayContent])

  // Prepare character tags. Danbooru's own escaping convention: a literal backslash
  // must be escaped first (so it isn't later misread as part of an escaped paren),
  // then literal parens are escaped as \( \) — mirrors how Danbooru itself renders
  // tags like "hakurei_reimu_(cosplay)" as "hakurei reimu \(cosplay\)".
  const characterTagsArray = useMemo(() => (post.tag_string_character ? post.tag_string_character.split(' ') : [])
    .map(t => t.replace(/_/g, ' ').toLowerCase().replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")), [post.tag_string_character])

  // Lazy: only computed when the Teach modal opens (rare).
  // Combines teachContent → teachTagsForClassification → classifiedTeachTags
  // into a single on-demand pipeline instead of 3 eager useMemos.
  const getClassifiedTeachTags = useCallback(() => {
    const raw = aiPromptForTeach
      ? cleanPrompt(aiPromptForTeach, "", "", "", {
        includeCharacters, includeCopyrights: false, optimizeTags: false,
        exclude: excludeList, tagOverrides,
        backgroundMode: 'keep', simpleBackgroundReplacementTags,
        escapeOutput: false, metaTags: post.tag_string_meta,
        wordReplacements,
        tagAppendRules,
      })
      : cleanPrompt(post.tag_string, post.tag_string_artist, post.tag_string_character, post.tag_string_copyright, {
        includeCharacters, includeCopyrights: false, optimizeTags: false,
        exclude: excludeList, tagOverrides,
        backgroundMode: 'keep', simpleBackgroundReplacementTags,
        escapeOutput: false, metaTags: post.tag_string_meta,
        wordReplacements,
        tagAppendRules,
      })
    const teachTags = raw ? raw.split(',').map(t => t.trim()) : []
    const normalizeForMatch = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/\\(?=[()\\])/g, "").trim()
    const charTagsSet = new Set(characterTagsArray.map(normalizeForMatch))
    const filteredTags = teachTags.filter(t => !charTagsSet.has(normalizeForMatch(t)))
    return classifyTags(filteredTags, tagOverrides, [])
  }, [aiPromptForTeach, post.tag_string, post.tag_string_artist, post.tag_string_character, post.tag_string_copyright, post.tag_string_meta, includeCharacters, excludeList, tagOverrides, simpleBackgroundReplacementTags, characterTagsArray, wordReplacements, tagAppendRules])

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
    return conflictResolutionConflictingTags.length > 0
  }, [conflictResolutionConflictingTags])

  return {
    isAiPost,
    aiPrompt: aiPromptForTeach,
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
    conflictingTags: conflictResolutionConflictingTags,
    replacedTags,
    hasReplacements,
    appendedTags,
    hasAppends,
  }
}
