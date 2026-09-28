import { useState, useCallback, useMemo } from 'react'
import { BooruPost } from '@/lib/booru/types'
import { TagCategory, classifyTags, classifyTag } from '@/lib/tag-classifier'
import { PACK_AXES, TAG_CATEGORY_IDS } from '@/lib/tag-taxonomy'
import { processBackgroundTags, type BackgroundMode } from '@/lib/background-detector'
import { deriveBackgroundContext, type MatchStrictness } from '@/lib/background-context'
import { applyWordReplacementsToList, buildPostMetaTagSet, isMetaTag, type WordReplacementRule } from '@/lib/cleanPrompt'

// Helper: filter meta tags from raw tag array. `postMetaTags` is the post's own
// tag_string_meta (see buildPostMetaTagSet) — passing it catches the meta tags
// the curated list never enumerated, without any extra request.
const filterMetaTags = (tags: string[], postMetaTags?: ReadonlySet<string>) =>
  tags.filter(t => Boolean(t) && !isMetaTag(t, postMetaTags))

// Helper: split a space-delimited tag string into trimmed, non-empty tags in a single pass
const splitAndTrimTags = (tagString: string): string[] =>
  tagString.split(' ').reduce<string[]>((acc, t) => {
    const trimmed = t.trim()
    if (trimmed) acc.push(trimmed)
    return acc
  }, [])

// Helper: classify a post's tags into category buckets (raw + character tags, meta-filtered, word-replaced)
const classifyPostTags = (
  post: BooruPost,
  tagOverrides: Record<string, string>,
  wordReplacements: WordReplacementRule[]
) => {
  const rawTags = splitAndTrimTags(post.tag_string)
  const charTags = applyWordReplacementsToList(
    post.tag_string_character ? splitAndTrimTags(post.tag_string_character) : [],
    wordReplacements,
  )
  const postMetaTags = buildPostMetaTagSet(post.tag_string_meta)
  const tags = Array.from(new Set([...charTags, ...applyWordReplacementsToList(filterMetaTags(rawTags, postMetaTags), wordReplacements)]))
  return { charTags, classified: classifyTags(tags, tagOverrides, charTags) }
}

export interface SelectedPostParts {
    post: BooruPost
    parts: Set<TagCategory>
    previewTags: Record<TagCategory, string[]>
}

export type MergeModeType = 'merge' | 'variations'

const escapeParentheses = (s: string) => s.replace(/\(/g, "\\(").replace(/\)/g, "\\)")

export interface RandomSettings {
    postCount: number
    allowedCategories: TagCategory[]
}

export function useMergeMode(
    globalWeights: Record<string, number> = {},
    isGlobalWeightsEnabled: boolean = false,
    addedTagsInput: string = "",
    tagOverrides: Record<string, string> = {},
    backgroundMode: BackgroundMode = 'keep',
    simpleBackgroundReplacementTags: string = "simple background, white background",
    wordReplacements: WordReplacementRule[] = [],
    /** Scenery dataset for the 'detailed_random' mode. Without it that mode can
     *  only STRIP the original background — it has nothing to inject, so Merge
     *  Mode silently behaved like "Remove All". */
    detailedBackgroundsList: string[][] = [],
    backgroundMatchStrictness: MatchStrictness = 'balanced'
) {
    const [isMergeMode, setIsMergeMode] = useState(false)
    const [mergeModeType, setMergeModeType] = useState<MergeModeType>('merge')
    const [selectedPosts, setSelectedPosts] = useState<Map<number, SelectedPostParts>>(new Map())
    const [randomSettings, setRandomSettings] = useState<RandomSettings>({
        postCount: 3,
        allowedCategories: [...PACK_AXES]
    })

    const toggleMergeMode = useCallback(() => {
        setIsMergeMode(prev => !prev)
    }, [])

    const toggleVariationsMode = useCallback(() => {
        setMergeModeType(prev => prev === 'merge' ? 'variations' : 'merge')
    }, [])

    const enableVariationMode = useCallback(() => {
        setIsMergeMode(true)
        setMergeModeType('variations')
    }, [])

    const enableMergeMode = useCallback(() => {
        setIsMergeMode(true)
        setMergeModeType('merge')
    }, [])

    const disableMergeMode = useCallback(() => {
        setIsMergeMode(false)
    }, [])

    const togglePostPart = useCallback((post: BooruPost, part: TagCategory) => {
        setSelectedPosts(prev => {
            const next = new Map(prev)
            const existing = next.get(post.id)

            if (existing) {
                // Toggle part
                const newParts = new Set(existing.parts)
                if (newParts.has(part)) {
                    newParts.delete(part)
                } else {
                    newParts.add(part)
                }

                if (newParts.size === 0) {
                    next.delete(post.id)
                } else {
                    next.set(post.id, {
                        ...existing,
                        parts: newParts
                    })
                }
            } else {
                // New selection
                const { classified } = classifyPostTags(post, tagOverrides, wordReplacements)

                next.set(post.id, {
                    post,
                    parts: new Set([part]),
                    previewTags: classified
                })
            }
            return next
        })
    }, [tagOverrides, wordReplacements])

    const removePost = useCallback((postId: number) => {
        setSelectedPosts(prev => {
            const next = new Map(prev)
            next.delete(postId)
            return next
        })
    }, [])

    const setRandomSelection = useCallback((availablePosts: BooruPost[]) => {
        if (!availablePosts || availablePosts.length === 0) return
        if (randomSettings.allowedCategories.length === 0) return

        const next = new Map<number, SelectedPostParts>()
        const categories = randomSettings.allowedCategories
        const categoriesSet = new Set(categories)

        // 1. Keep existing selections for categories that are NOT allowed (not randomized)
        selectedPosts.forEach((data, postId) => {
            const keptParts = new Set<TagCategory>()
            data.parts.forEach(p => {
                if (!categoriesSet.has(p)) {
                    keptParts.add(p)
                }
            })
            if (keptParts.size > 0) {
                next.set(postId, { ...data, parts: keptParts })
            }
        })

        // 2. Pick random posts
        const numPostsToPick = Math.min(availablePosts.length, randomSettings.postCount)
        const shuffledPosts = [...availablePosts]
        for (let i = shuffledPosts.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledPosts[i], shuffledPosts[j]] = [shuffledPosts[j], shuffledPosts[i]];
        }
        const pickedPosts = shuffledPosts.slice(0, numPostsToPick)

        if (mergeModeType === 'merge') {
            pickedPosts.forEach((post, i) => {
                const { classified } = classifyPostTags(post, tagOverrides, wordReplacements)

                // Force coverage: the first `categories.length` posts get assigned `categories[i]`.
                // The rest get a random category.
                let targetCat: TagCategory
                if (i < categories.length) {
                    targetCat = categories[i]
                } else {
                    targetCat = categories[Math.floor(Math.random() * categories.length)]
                }

                if (classified[targetCat] && classified[targetCat].length > 0) {
                    if (next.has(post.id)) {
                        next.get(post.id)!.parts.add(targetCat)
                    } else {
                        next.set(post.id, { post, parts: new Set([targetCat]), previewTags: classified })
                    }
                } else {
                    // Fallback: pick any category that has tags
                    const availableCats = categories.filter(c => classified[c] && classified[c].length > 0)
                    if (availableCats.length > 0) {
                        const fallbackCat = availableCats[Math.floor(Math.random() * availableCats.length)]
                        if (next.has(post.id)) {
                            next.get(post.id)!.parts.add(fallbackCat)
                        } else {
                            next.set(post.id, { post, parts: new Set([fallbackCat]), previewTags: classified })
                        }
                    }
                }
            })
        } else {
            // In variations mode, assign random allowed categories to each picked post
            pickedPosts.forEach(post => {
                const { classified } = classifyPostTags(post, tagOverrides, wordReplacements)

                const numCatsToPick = Math.floor(Math.random() * categories.length) + 1
                const shuffledCats = [...categories]
                for (let i = shuffledCats.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [shuffledCats[i], shuffledCats[j]] = [shuffledCats[j], shuffledCats[i]];
                }
                const pickedCats = shuffledCats.slice(0, numCatsToPick)

                const activeParts = new Set<TagCategory>()
                pickedCats.forEach(cat => {
                    if (classified[cat] && classified[cat].length > 0) {
                        activeParts.add(cat)
                    }
                })

                if (activeParts.size > 0) {
                    if (next.has(post.id)) {
                        const existingParts = next.get(post.id)!.parts
                        activeParts.forEach(p => existingParts.add(p))
                    } else {
                        next.set(post.id, {
                            post,
                            parts: activeParts,
                            previewTags: classified
                        })
                    }
                }
            })
        }

        setSelectedPosts(next)
    }, [mergeModeType, tagOverrides, randomSettings, selectedPosts, wordReplacements])

    const [excludedTags, setExcludedTags] = useState<Set<string>>(new Set())

    const excludeTag = useCallback((tag: string) => {
        setExcludedTags(prev => {
            const next = new Set(prev)
            next.add(tag.toLowerCase())
            return next
        })
    }, [])

    // Helper for escaping parentheses in tags removed (moved to outer scope)

    const mergedPromptSegments = useMemo(() => {
        const segments: { text: string, display: string, category: TagCategory, postId?: number }[] = []
        const seenTags = new Set<string>()

        // Pre-classify added tags
        const rawAddedTags = addedTagsInput.split(',').map(t => t.trim()).filter(Boolean)
        const classifiedAddedTags = classifyTags(rawAddedTags, tagOverrides)

        const categories = TAG_CATEGORY_IDS

        // 1. Process ALL Added Tags First (across all categories) to ensure they are at the top
        categories.forEach(cat => {
            const addedForCat = classifiedAddedTags[cat] || []
            addedForCat.forEach(t => {
                const normalized = t.toLowerCase().replace(/_/g, ' ')
                if (!seenTags.has(normalized) && !excludedTags.has(normalized)) {
                    seenTags.add(normalized)

                    let displayText = escapeParentheses(normalized)
                    if (isGlobalWeightsEnabled) {
                        const w = globalWeights[normalized]
                        if (w !== undefined && w !== 1.0) {
                            displayText = `(${displayText}:${w})`
                        }
                    }

                    segments.push({
                        text: normalized,
                        display: displayText,
                        category: cat
                    })
                }
            })
        })

        // 2. Process ALL Selected Post Tags Second
        categories.forEach(cat => {
            selectedPosts.forEach((data) => {
                if (data.parts.has(cat)) {
                    const tags = data.previewTags[cat] || []
                    tags.forEach(t => {
                        const normalized = t.toLowerCase().replace(/_/g, ' ')
                        // In variations mode, we allow the same tag across different posts because each post is a separate variation block
                        const key = mergeModeType === 'variations' ? `${data.post.id}-${normalized}` : normalized;
                        if (!seenTags.has(key) && !excludedTags.has(normalized)) {
                            seenTags.add(key)

                            let displayText = escapeParentheses(normalized)
                            if (isGlobalWeightsEnabled) {
                                // Simple efficient check instead of full applyWeights overhead in loop
                                const w = globalWeights[normalized]
                                if (w !== undefined && w !== 1.0) {
                                    displayText = `(${displayText}:${w})`
                                }
                            }

                            segments.push({
                                text: normalized,
                                display: displayText,
                                category: cat,
                                postId: data.post.id
                            })
                        }
                    })
                }
            })
        })

        // 3. Apply Background Processing Mode (Only for simple merge mode)
        if (backgroundMode !== 'keep' && mergeModeType === 'merge') {
            const rawTextArray = segments.map(s => s.text);
            // Deterministic seed derived from the selected post ids, sorted so
            // selection ORDER doesn't change the outcome. This memo re-runs on
            // every "Tags to add" keystroke, and processBackgroundTags falls
            // back to Math.random when no seed is given — which would re-roll
            // the whole background on each keystroke.
            const backgroundSeed = Array.from(selectedPosts.keys())
                .sort((a, b) => a - b)
                .reduce((acc, id) => (Math.imul(acc, 31) + id) | 0, 0);
            // Scene context for Detailed Random. Explicitness comes from the
            // FULL tags of every selected post (the union is naturally the most
            // restrictive: one post with act tags gates the whole merge), while
            // location hints come only from the scenery the user actually KEPT
            // in the merge — deselecting a post's scenery is a request for a new
            // location, so honouring hints from discarded tags would fight it.
            const backgroundContext = backgroundMode === 'detailed_random'
                ? {
                    explicitness: deriveBackgroundContext({
                        tags: Array.from(selectedPosts.values()).flatMap(d => splitAndTrimTags(d.post.tag_string)),
                    }).explicitness,
                    locationHints: deriveBackgroundContext({ tags: rawTextArray }).locationHints,
                }
                : undefined;
            const processedTextArray = processBackgroundTags(
                rawTextArray,
                backgroundMode,
                simpleBackgroundReplacementTags,
                tagOverrides,
                undefined,
                detailedBackgroundsList,
                backgroundSeed,
                backgroundContext,
                backgroundMatchStrictness,
            );

            // Rebuild segments based on the processed array
            const finalSegments: typeof segments = [];
            const originalSegmentsMap = new Map(segments.map(s => [s.text, s]));
            
            processedTextArray.forEach(pt => {
                // If it existed before, keep its display and category
                if (originalSegmentsMap.has(pt)) {
                    finalSegments.push(originalSegmentsMap.get(pt)!);
                } else {
                    // It's a newly injected tag (like from force_simple)
                    let displayText = escapeParentheses(pt);
                    if (isGlobalWeightsEnabled) {
                        const w = globalWeights[pt];
                        if (w !== undefined && w !== 1.0) {
                            displayText = `(${displayText}:${w})`;
                        }
                    }
                    finalSegments.push({
                        text: pt,
                        display: displayText,
                        category: classifyTag(pt, tagOverrides) // classify it dynamically
                    });
                }
            });
            return finalSegments;
        }

        return segments
    }, [selectedPosts, excludedTags, globalWeights, isGlobalWeightsEnabled, addedTagsInput, tagOverrides, backgroundMode, simpleBackgroundReplacementTags, mergeModeType, detailedBackgroundsList, backgroundMatchStrictness])

    const mergedPrompt = useMemo(() => {
        if (mergeModeType === 'merge') {
            return mergedPromptSegments.map(s => s.display).join(', ')
        } else {
            // Variations mode: { [post1 tags] | [post2 tags] }
            
            // First, separate common tags (added tags with no postId)
            const commonTags = mergedPromptSegments.filter(s => !s.postId).map(s => s.display)
            
            // Then group by category, then by post id
            const categories = TAG_CATEGORY_IDS
            const dynamicBlocks: string[] = []
            
            categories.forEach(cat => {
                const catSegments = mergedPromptSegments.filter(s => s.postId && s.category === cat)
                if (catSegments.length === 0) return;
                
                // Group by postId
                const postGroups = new Map<number, string[]>()
                catSegments.forEach(s => {
                    if (!postGroups.has(s.postId!)) postGroups.set(s.postId!, [])
                    postGroups.get(s.postId!)!.push(s.display)
                })
                
                if (postGroups.size > 0) {
                    const variations = Array.from(postGroups.values()).map(tags => tags.join(', '))
                    if (variations.length === 1) {
                        dynamicBlocks.push(variations[0])
                    } else {
                        dynamicBlocks.push(`{ ${variations.join(' | ')} }`)
                    }
                }
            })
            
            const finalParts = []
            if (commonTags.length > 0) finalParts.push(commonTags.join(', '))
            if (dynamicBlocks.length > 0) finalParts.push(dynamicBlocks.join(', '))
            
            return finalParts.join(', ')
        }
    }, [mergedPromptSegments, mergeModeType])

    // Reset excluded tags when clearing all
    const clearAll = useCallback(() => {
        setSelectedPosts(new Map())
        setExcludedTags(new Set())
    }, [])

    return {
        isMergeMode,
        toggleMergeMode,
        mergeModeType,
        setMergeModeType,
        toggleVariationsMode,
        enableVariationMode,
        enableMergeMode,
        disableMergeMode,
        selectedPosts,
        togglePostPart,
        removePost,
        clearAll,
        setRandomSelection,
        randomSettings,
        setRandomSettings,
        mergedPrompt,
        mergedPromptSegments,
        excludeTag
    }
}
