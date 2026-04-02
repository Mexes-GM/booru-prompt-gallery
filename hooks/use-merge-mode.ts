import { useState, useCallback, useMemo } from 'react'
import { BooruPost } from '@/lib/booru/types'
import { TagCategory, classifyTags, classifyTag } from '@/lib/tag-classifier'
import { applyWeights } from '@/lib/weight-utils'
import { processBackgroundTags, type BackgroundMode } from '@/lib/background-detector'

export interface SelectedPostParts {
    post: BooruPost
    parts: Set<TagCategory>
    previewTags: Record<TagCategory, string[]>
}

const escapeParentheses = (s: string) => s.replace(/\(/g, "\\(").replace(/\)/g, "\\)")

export function useMergeMode(
    globalWeights: Record<string, number> = {},
    isGlobalWeightsEnabled: boolean = false,
    addedTagsInput: string = "",
    tagOverrides: Record<string, string> = {},
    backgroundMode: BackgroundMode = 'keep',
    simpleBackgroundReplacementTags: string = "simple background, white background"
) {
    const [isMergeMode, setIsMergeMode] = useState(false)
    const [selectedPosts, setSelectedPosts] = useState<Map<number, SelectedPostParts>>(new Map())

    const toggleMergeMode = useCallback(() => {
        setIsMergeMode(prev => !prev)
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
                // New selection
                const rawTags = post.tag_string.split(' ').map(t => t.trim()).filter(Boolean)
                const charTags = post.tag_string_character ? post.tag_string_character.split(' ').map(t => t.trim()).filter(Boolean) : []

                // Prioritize character tags
                const tags = Array.from(new Set([...charTags, ...rawTags]))

                const classified = classifyTags(tags, tagOverrides, charTags) // Pass character tags to be forced into appearance

                next.set(post.id, {
                    post,
                    parts: new Set([part]),
                    previewTags: classified
                })
            }
            return next
        })
    }, [tagOverrides])

    const removePost = useCallback((postId: number) => {
        setSelectedPosts(prev => {
            const next = new Map(prev)
            next.delete(postId)
            return next
        })
    }, [])

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
        const segments: { text: string, display: string, category: TagCategory }[] = []
        const seenTags = new Set<string>()

        // Pre-classify added tags
        const rawAddedTags = addedTagsInput.split(',').map(t => t.trim()).filter(Boolean)
        const classifiedAddedTags = classifyTags(rawAddedTags, tagOverrides)

        const categories: TagCategory[] = ['appearance', 'clothing', 'pose', 'scenery', 'other']

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
                        if (!seenTags.has(normalized) && !excludedTags.has(normalized)) {
                            seenTags.add(normalized)

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
                                category: cat
                            })
                        }
                    })
                }
            })
        })

        // 3. Apply Background Processing Mode
        if (backgroundMode !== 'keep') {
            const rawTextArray = segments.map(s => s.text);
            const processedTextArray = processBackgroundTags(rawTextArray, backgroundMode, simpleBackgroundReplacementTags);
            
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
    }, [selectedPosts, excludedTags, globalWeights, isGlobalWeightsEnabled, addedTagsInput, tagOverrides, backgroundMode, simpleBackgroundReplacementTags])

    const mergedPrompt = useMemo(() => {
        return mergedPromptSegments.map(s => s.display).join(', ')
    }, [mergedPromptSegments])

    // Reset excluded tags when clearing all
    const clearAll = useCallback(() => {
        setSelectedPosts(new Map())
        setExcludedTags(new Set())
    }, [])

    return {
        isMergeMode,
        toggleMergeMode,
        selectedPosts,
        togglePostPart,
        removePost,
        clearAll,
        mergedPrompt,
        mergedPromptSegments,
        excludeTag
    }
}
