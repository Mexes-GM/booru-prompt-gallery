import { useState, useCallback, useMemo } from 'react'
import { BooruPost } from '@/lib/booru/types'
import { TagCategory, classifyTags, classifyTag } from '@/lib/tag-classifier'
import { processBackgroundTags, type BackgroundMode } from '@/lib/background-detector'
import { normalize, META_TAGS_SET } from '@/lib/cleanPrompt'

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
    simpleBackgroundReplacementTags: string = "simple background, white background"
) {
    const [isMergeMode, setIsMergeMode] = useState(false)
    const [mergeModeType, setMergeModeType] = useState<MergeModeType>('merge')
    const [selectedPosts, setSelectedPosts] = useState<Map<number, SelectedPostParts>>(new Map())
    const [randomSettings, setRandomSettings] = useState<RandomSettings>({
        postCount: 3,
        allowedCategories: ['appearance', 'clothing', 'pose', 'scenery']
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
                // New selection
                const rawTags = post.tag_string.split(' ').map(t => t.trim()).filter(t => Boolean(t) && !META_TAGS_SET.has(normalize(t)))
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

    const setRandomSelection = useCallback((availablePosts: BooruPost[]) => {
        if (!availablePosts || availablePosts.length === 0) return
        if (randomSettings.allowedCategories.length === 0) return

        const next = new Map<number, SelectedPostParts>()
        const categories = randomSettings.allowedCategories

        // 1. Keep existing selections for categories that are NOT allowed (not randomized)
        selectedPosts.forEach((data, postId) => {
            const keptParts = new Set<TagCategory>()
            data.parts.forEach(p => {
                if (!categories.includes(p)) {
                    keptParts.add(p)
                }
            })
            if (keptParts.size > 0) {
                next.set(postId, { ...data, parts: keptParts })
            }
        })

        // 2. Pick random posts
        const numPostsToPick = Math.min(availablePosts.length, randomSettings.postCount)
        const shuffledPosts = [...availablePosts].sort(() => 0.5 - Math.random())
        const pickedPosts = shuffledPosts.slice(0, numPostsToPick)

        if (mergeModeType === 'merge') {
            pickedPosts.forEach((post, i) => {
                const rawTags = post.tag_string.split(' ').map(t => t.trim()).filter(t => Boolean(t) && !META_TAGS_SET.has(normalize(t)))
                const charTags = post.tag_string_character ? post.tag_string_character.split(' ').map(t => t.trim()).filter(Boolean) : []
                const tags = Array.from(new Set([...charTags, ...rawTags]))
                const classified = classifyTags(tags, tagOverrides, charTags)

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
                const rawTags = post.tag_string.split(' ').map(t => t.trim()).filter(t => Boolean(t) && !META_TAGS_SET.has(normalize(t)))
                const charTags = post.tag_string_character ? post.tag_string_character.split(' ').map(t => t.trim()).filter(Boolean) : []
                const tags = Array.from(new Set([...charTags, ...rawTags]))
                const classified = classifyTags(tags, tagOverrides, charTags)

                const numCatsToPick = Math.floor(Math.random() * categories.length) + 1
                const shuffledCats = [...categories].sort(() => 0.5 - Math.random())
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
    }, [mergeModeType, tagOverrides, randomSettings, selectedPosts])

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
            const processedTextArray = processBackgroundTags(rawTextArray, backgroundMode, simpleBackgroundReplacementTags, tagOverrides);

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
    }, [selectedPosts, excludedTags, globalWeights, isGlobalWeightsEnabled, addedTagsInput, tagOverrides, backgroundMode, simpleBackgroundReplacementTags, mergeModeType])

    const mergedPrompt = useMemo(() => {
        if (mergeModeType === 'merge') {
            return mergedPromptSegments.map(s => s.display).join(', ')
        } else {
            // Variations mode: { [post1 tags] | [post2 tags] }
            
            // First, separate common tags (added tags with no postId)
            const commonTags = mergedPromptSegments.filter(s => !s.postId).map(s => s.display)
            
            // Then group by category, then by post id
            const categories: TagCategory[] = ['appearance', 'clothing', 'pose', 'scenery', 'other']
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
