import { useState, useCallback, useMemo } from 'react'
import { BooruPost } from '@/lib/booru/types'
import { TagCategory, classifyTags } from '@/lib/tag-classifier'
import { cleanPrompt } from '@/lib/cleanPrompt'

export interface SelectedPostParts {
    post: BooruPost
    parts: Set<TagCategory>
    previewTags: Record<TagCategory, string[]>
}

export function useMergeMode() {
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

                const classified = classifyTags(tags, undefined, charTags) // Pass character tags to be forced into appearance

                next.set(post.id, {
                    post,
                    parts: new Set([part]),
                    previewTags: classified
                })
            }
            return next
        })
    }, [])

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

    const mergedPromptSegments = useMemo(() => {
        const segments: { text: string, category: TagCategory }[] = []
        const seenTags = new Set<string>()

        const categories: TagCategory[] = ['appearance', 'clothing', 'pose', 'scenery', 'other']

        categories.forEach(cat => {
            selectedPosts.forEach((data) => {
                if (data.parts.has(cat)) {
                    const tags = data.previewTags[cat] || []
                    tags.forEach(t => {
                        const normalized = t.toLowerCase().replace(/_/g, ' ')
                        if (!seenTags.has(normalized) && !excludedTags.has(normalized)) {
                            seenTags.add(normalized)
                            segments.push({ text: normalized, category: cat })
                        }
                    })
                }
            })
        })

        return segments
    }, [selectedPosts, excludedTags])

    const mergedPrompt = useMemo(() => {
        return mergedPromptSegments.map(s => s.text).join(', ')
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
