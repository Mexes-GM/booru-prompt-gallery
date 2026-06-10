import { useCallback, useMemo, memo, useState, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    Copy,
    Check,
    ExternalLink,
    Heart,
    Download,
    ChevronDown,
    Shirt,
    User,
    Mountain,
    Smile,
    GraduationCap,
    AlertCircle,
    Sliders,
    Users,
    Loader2,
    Tag,
    Sparkles
} from "lucide-react"
import Image from "next/image"
import {
    BooruPost,
    isAibooruPost,
    getPromptFromPost,
    removeLoRaTags as removeLoRaTagsUtil,
    removeQualityTags as removeQualityTagsUtil,
    BooruProvider
} from "@/lib/api-client"
import { PROVIDER_POST_URLS } from "@/lib/constants"
import { getDanbooruProxyUrl, getGelbooruProxyUrl } from "@/lib/proxy-url"
import { cleanPrompt } from "@/lib/cleanPrompt"
import { type BackgroundMode, type BackgroundRemoveMode } from "@/lib/background-detector"
import { applyWeights, extractWeights } from "@/lib/weight-utils"
import { classifyTags, TagCategory, ClassifiedTags } from "@/lib/tag-classifier"
import { resolveTagConflicts } from "@/lib/tag-conflicts"
import { InteractivePrompt } from "@/components/prompt-gallery/interactive-prompt"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { SaveFavoriteButton } from "./save-favorite-button"
import { SaveArtistButton } from "./save-artist-button"
import { FavoriteFolder } from "@/hooks/use-booru-favorites"
import { trackExternalLink } from "@/lib/analytics"
import { toast } from "@/hooks/use-toast"
import { SCALE_CONFIG } from "@/components/masonry-grid"

const PARTICLES = Array.from({ length: 12 })

const SuccessOverlay = memo(({ onSkip }: { onSkip?: () => void }) => {
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] rounded-xl cursor-pointer"
            role="button"
            aria-label="Close success overlay"
            tabIndex={0}
            onClick={(e) => {
                e.stopPropagation()
                onSkip?.()
            }}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation()
                    onSkip?.()
                }
            }}
        >
            <div className="relative flex flex-col items-center justify-center pointer-events-none">
                {PARTICLES.map((_, i) => (
                    <motion.div
                        key={i}
                        initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
                        animate={{
                            x: Math.cos(i * (360 / PARTICLES.length) * (Math.PI / 180)) * 60,
                            y: Math.sin(i * (360 / PARTICLES.length) * (Math.PI / 180)) * 60,
                            scale: [0, 1.5, 0],
                            opacity: [1, 1, 0]
                        }}
                        transition={{ duration: 0.6, ease: "easeOut" }}
                        className="absolute w-1.5 h-1.5 bg-green-400 rounded-full shadow-[0_0_8px_rgba(74,222,128,0.8)]"
                    />
                ))}

                <motion.div
                    initial={{ scale: 0, rotate: -45 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                    className="bg-gradient-to-br from-green-400 to-green-600 rounded-full p-4 shadow-[0_0_20px_rgba(74,222,128,0.4)] relative z-10"
                >
                    <Check className="h-8 w-8 text-white stroke-[3px]" />
                </motion.div>

                <motion.span
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="mt-3 text-white font-bold tracking-widest text-sm uppercase drop-shadow-lg"
                >
                    Copied
                </motion.span>
            </div>
        </motion.div>
    )
})
SuccessOverlay.displayName = "SuccessOverlay"

interface MasonryItemProps {
    post: BooruPost
    tagCounts?: Record<string, number>
    width: number
    height: number
    index?: number
    viewMode?: "grid" | "list"
    effectiveScale: "small" | "medium" | "large"
    booruProvider: BooruProvider
    isFavorited: boolean
    folders: FavoriteFolder[]
    currentFolderIds: string[]
    toggleFavorite: (id: number, provider?: string, folderId?: string | null) => void
    createFolder: (name: string) => Promise<FavoriteFolder | null>
    isMergeMode: boolean
    isSelected: boolean
    selectedParts?: Set<TagCategory>
    onTogglePart?: (post: BooruPost, part: TagCategory) => void
    onMergeSelect: (post: BooruPost) => void
    downloadImage: (post: BooruPost) => void
    copyToClipboard: (text: string, id: number, isPrompt: boolean, thumb?: string) => Promise<void>
    excludeInput: string
    addInput: string
    includeCharacters: boolean
    optimizeTags: boolean
    smartTagExclusion?: boolean
    removeLoRaTags: boolean
    removeQualityTags: boolean
    backgroundMode?: BackgroundMode
    simpleBackgroundReplacementTags?: string
    randomBackgroundPatterns?: boolean
    backgroundRemoveMode?: BackgroundRemoveMode
    randomBackgroundIncludeGradients?: boolean
    detailedBackgroundsList?: string[][]
    tagOverrides: Record<string, string>
    copiedId: number | null
    isPreviouslyCopied?: boolean
    setTeachModalData: (data: { open: boolean, tags: ClassifiedTags }) => void
    onSkipAnimation?: () => void
    globalWeights?: Record<string, number>
    isGlobalWeightsEnabled?: boolean
    onGlobalWeightChange?: (tag: string, weight: number) => void
    onSearch?: (tag: string) => void
    onImageError?: () => void
    isNaturalLanguageMode?: boolean
    onSendToConvert?: (tags: string, imageUrl?: string) => void
}

// Memoized MasonryItem to prevent unnecessary re-renders
export const MasonryItem = memo(function MasonryItem({
    post,
    tagCounts,
    width,
    height,
    index = 999,
    viewMode = "grid",
    effectiveScale,
    booruProvider,
    isFavorited,
    folders,
    currentFolderIds,
    toggleFavorite,
    createFolder,
    isMergeMode,
    isSelected,
    selectedParts,
    onTogglePart,
    onMergeSelect,
    downloadImage,
    copyToClipboard,
    excludeInput,
    addInput,
    includeCharacters,
    optimizeTags,
    smartTagExclusion = true,
    removeLoRaTags,
    removeQualityTags,
    backgroundMode,
    simpleBackgroundReplacementTags,
    randomBackgroundPatterns = false,
    backgroundRemoveMode,
    randomBackgroundIncludeGradients = true,
    detailedBackgroundsList,
    tagOverrides,
    copiedId,
    isPreviouslyCopied,
    setTeachModalData,
    onSkipAnimation,
    globalWeights = {},
    isGlobalWeightsEnabled = false,
    onGlobalWeightChange,
    onSearch,
    onImageError,
    isNaturalLanguageMode = false,
    onSendToConvert,
}: MasonryItemProps) {
    const excludeList = useMemo(() => excludeInput.split(',').map(t => t.trim()).filter(Boolean), [excludeInput])
    const addList = useMemo(() => addInput.split(',').map(t => t.trim()).filter(Boolean), [addInput])

    // State to hold modified prompt from user interaction
    const [modifiedContent, setModifiedContent] = useState<string | null>(null)

    const [imageError, setImageError] = useState(false)
    const [retryKey, setRetryKey] = useState(0)
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const handleImageError = useCallback(() => {
        setImageError(true)
        onImageError?.()
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
        retryTimerRef.current = setTimeout(() => {
            setImageError(false)
            setRetryKey(k => k + 1)
        }, 10_000)
    }, [onImageError])

    useEffect(() => {
        return () => { if (retryTimerRef.current) clearTimeout(retryTimerRef.current) }
    }, [])

    const itemProvider = post._provider || booruProvider

    const handleToggleFavorite = (folderId: string | null | undefined) => {
        toggleFavorite(post.id, itemProvider, folderId)
    }

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

    // Shared background options for all cleanPrompt calls
    const bgOptions = useMemo(() => ({
        backgroundRemoveMode,
        randomBackgroundIncludeGradients,
        detailedBackgroundsList,
    }), [backgroundRemoveMode, randomBackgroundIncludeGradients, detailedBackgroundsList])

    // Generate pure content WITHOUT added tags for category copying/classification
    const pureContent = useMemo(() => {
        return aiPrompt
            ? cleanPrompt(
                aiPrompt,
                "",
                "",
                "",
                { includeCharacters, includeCopyrights: false, optimizeTags, exclude: excludeList, addedTags: [], tagOverrides, backgroundMode, simpleBackgroundReplacementTags, randomBackgroundPatterns, ...bgOptions, metaTags: post.tag_string_meta },
            )
            : cleanPrompt(
                post.tag_string,
                post.tag_string_artist,
                post.tag_string_character,
                post.tag_string_copyright,
                { includeCharacters, includeCopyrights: false, optimizeTags, exclude: excludeList, addedTags: [], tagOverrides, backgroundMode, simpleBackgroundReplacementTags, randomBackgroundPatterns, ...bgOptions, metaTags: post.tag_string_meta },
            )
    }, [aiPrompt, post.tag_string, post.tag_string_artist, post.tag_string_character, post.tag_string_copyright, post.tag_string_meta, includeCharacters, optimizeTags, excludeList, tagOverrides, backgroundMode, simpleBackgroundReplacementTags, randomBackgroundPatterns, bgOptions])

    const conflictResolution = useMemo(() => {
        if (!pureContent || addList.length === 0 || !smartTagExclusion) return { validTags: addList, conflictingTags: [] };
        const baseTags = pureContent.split(',').map(t => t.trim());
        return resolveTagConflicts(baseTags, addList);
    }, [pureContent, addList, smartTagExclusion])

    // Use AI prompt if available, but still pass through cleanPrompt to remove meta/unwanted tags
    const baseContent = useMemo(() => {
        return aiPrompt
            ? cleanPrompt(
                aiPrompt,
                "",
                "",
                "",
                { includeCharacters, includeCopyrights: false, optimizeTags, exclude: excludeList, addedTags: conflictResolution.validTags, tagOverrides, backgroundMode, simpleBackgroundReplacementTags, randomBackgroundPatterns, ...bgOptions, metaTags: post.tag_string_meta },
            )
            : cleanPrompt(
                post.tag_string,
                post.tag_string_artist,
                post.tag_string_character,
                post.tag_string_copyright,
                { includeCharacters, includeCopyrights: false, optimizeTags, exclude: excludeList, addedTags: conflictResolution.validTags, tagOverrides, backgroundMode, simpleBackgroundReplacementTags, randomBackgroundPatterns, ...bgOptions, metaTags: post.tag_string_meta },
            )
    }, [aiPrompt, post.tag_string, post.tag_string_artist, post.tag_string_character, post.tag_string_copyright, post.tag_string_meta, includeCharacters, optimizeTags, excludeList, conflictResolution.validTags, tagOverrides, backgroundMode, simpleBackgroundReplacementTags, randomBackgroundPatterns, bgOptions])

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

    // Reset modified content when BASE content changes substantially (e.g. new post or new filters)
    // NOT when global weights change/toggle, to preserve local edits
    useEffect(() => {
        setModifiedContent(null)
    }, [baseContent])

    // Create a raw (unoptimized) version for Teach modal classification
    const teachContent = useMemo(() => aiPrompt
        ? cleanPrompt(
            aiPrompt,
            "",
            "",
            "",
            { includeCharacters, includeCopyrights: false, optimizeTags: false, exclude: excludeList, tagOverrides, backgroundMode: 'keep', simpleBackgroundReplacementTags, escapeOutput: false, metaTags: post.tag_string_meta },
        )
        : cleanPrompt(
            post.tag_string,
            post.tag_string_artist,
            post.tag_string_character,
            post.tag_string_copyright,
            { includeCharacters, includeCopyrights: false, optimizeTags: false, exclude: excludeList, tagOverrides, backgroundMode: 'keep', simpleBackgroundReplacementTags, escapeOutput: false, metaTags: post.tag_string_meta },
        ), [aiPrompt, post.tag_string, post.tag_string_artist, post.tag_string_character, post.tag_string_copyright, post.tag_string_meta, includeCharacters, excludeList, tagOverrides, simpleBackgroundReplacementTags])

    // Pre-classify tags for the dropdown counts (USING PUR DISPLAY CONTENT)
    // This ensures that "added tags" don't inflate the category counts
    const tagsForClassification = useMemo(() => pureDisplayContent ? pureDisplayContent.split(',').map(t => t.trim()) : [], [pureDisplayContent])

    const teachTagsForClassification = useMemo(() => teachContent ? teachContent.split(',').map(t => t.trim()) : [], [teachContent])

    const totalTagsCount = useMemo(() => tagsForClassification.filter(t => t.length > 0).length, [tagsForClassification])

    // Prepare character tags
    const characterTagsArray = useMemo(() => (post.tag_string_character ? post.tag_string_character.split(' ') : [])
        .map(t => t.replace(/_/g, ' ').toLowerCase().replace(/\(/g, "\\(").replace(/\)/g, "\\)")), [post.tag_string_character])

    const tagCountIndicator = useMemo(() => {
        if (!tagCounts || characterTagsArray.length === 0) return null;
        
        let maxCount = 0;
        let sumCounts = 0;
        
        // Find the top character's count
        for (const rawTag of characterTagsArray) {
            // Re-normalize tag to match how it might be stored in the dictionary if needed, 
            // but Danbooru tags typically keep underscores. 
            // In characterTagsArray spaces were replaced, we should check both.
            const withSpaces = rawTag.replace(/\\/g, ''); // remove escapes
            const withUnderscores = withSpaces.replace(/\s+/g, '_');
            
            const count = tagCounts[withUnderscores] ?? tagCounts[withSpaces] ?? 0;
            if (count > maxCount) maxCount = count;
            sumCounts += count;
        }
        
        if (maxCount === 0) return null;
        
        return Intl.NumberFormat('en', { notation: 'compact' }).format(maxCount);
    }, [tagCounts, characterTagsArray]);

    const classifiedTags = useMemo(() => {
        // Ensure character tags are included in the classification source
        const allTagsForClassification = Array.from(new Set([...characterTagsArray, ...tagsForClassification]))
        return classifyTags(allTagsForClassification, tagOverrides, characterTagsArray)
    }, [characterTagsArray, tagsForClassification, tagOverrides])

    const classifiedTeachTags = useMemo(() => {
        // Filter out character tags for the Teach modal
        const normalizeForMatch = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/\\(?=[()])/g, "").trim();
        const charTagsSet = new Set(characterTagsArray.map(normalizeForMatch))
        const filteredTags = teachTagsForClassification.filter(t => !charTagsSet.has(normalizeForMatch(t)))

        return classifyTags(filteredTags, tagOverrides, [])
    }, [characterTagsArray, teachTagsForClassification, tagOverrides])

    const copyCategory = async (category: TagCategory) => {
        if (!pureDisplayContent) return
        const subset = classifiedTags[category]

        if (subset.length > 0) {
            await copyToClipboard(subset.join(', '), post.id, false, post.preview_file_url)
        } else {
            toast({
                description: `No ${category} tags found`,
                variant: "destructive",
                duration: 2000
            })
        }
    }

    // Optimization: Use preview image for small cards to save bandwidth/CPU
    // For Gelbooru: use thumbnail when possible (smaller transfer), but ALL URLs
    // must go through the Cloudflare Worker proxy due to hotlink protection.
    // For Danbooru: try direct CDN URL first, fall back to image proxy only on 403/error.
    // This avoids unnecessary Fast Origin Transfer when direct access works.
    const isGelbooru = itemProvider === 'gelbooru'
    const isDanbooru = itemProvider === 'danbooru'
    const usePreview = isGelbooru
        ? !!post.preview_file_url
        : (effectiveScale === 'small' && post.preview_file_url)
    const rawFileUrl = (usePreview ? post.preview_file_url : (post.large_file_url || post.file_url))

    // Gelbooru: ALL images (including thumbnails) must go through the Cloudflare Worker proxy.
    // Gelbooru applies hotlink protection to all URLs — cross-origin requests get
    // 302-redirected to hotlink.php. The Worker sets Referer: gelbooru.com/ which bypasses this.
    const gelbooruNeedsProxy = isGelbooru && !!rawFileUrl
    const isAibooru = itemProvider === 'aibooru'

    // Danbooru: use Cloudflare Worker (free egress within Cloudflare network)
    const fileUrl = gelbooruNeedsProxy
        ? getGelbooruProxyUrl(rawFileUrl!)
        : isDanbooru && rawFileUrl
            ? getDanbooruProxyUrl(rawFileUrl)
            : rawFileUrl

    let postUrl = PROVIDER_POST_URLS.DANBOORU(post.id)

    if (isAiPost || itemProvider === 'aibooru') {
        postUrl = PROVIDER_POST_URLS.AIBOORU(post.id)
    } else if (itemProvider === 'rule34') {
        postUrl = PROVIDER_POST_URLS.RULE34(post.id)
    } else if (itemProvider === 'e621') {
        postUrl = PROVIDER_POST_URLS.E621(post.id)
    } else if (itemProvider === 'gelbooru') {
        postUrl = PROVIDER_POST_URLS.GELBOORU(post.id)
    }

    const getCardContentClass = () => {
        switch (effectiveScale) {
            case "small": return "card-content-small"
            case "medium": return "card-content-medium"
            case "large": return "card-content-large"
            default: return "card-content-medium"
        }
    }

    const getIconClass = () => {
        switch (effectiveScale) {
            case "small": return "icon-small"
            case "medium": return "icon-medium"
            case "large": return "icon-large"
            default: return "icon-medium"
        }
    }

    // Determine if options are active that affect the prompt
    const hasActiveOptions = useMemo(() => {
        // Only show indicator if Smart Tag Exclusion actively blocked tags from being added
        return conflictResolution.conflictingTags.length > 0
    }, [conflictResolution.conflictingTags.length])

    // Grid View
    const renderCard = () => {
    if (viewMode === "grid") {
        const footerHeight = SCALE_CONFIG[effectiveScale].footerHeight
        const imageHeight = height - footerHeight

        return (
            <Card className="w-full h-full overflow-hidden card-hover group flex flex-col relative transition-all duration-300">
                <div className="relative bg-muted overflow-hidden cursor-pointer" style={{ height: imageHeight }}>
                    {isPreviouslyCopied && (
                        <div className="absolute top-2 left-2 z-20 pointer-events-none" aria-label="Previously copied">
                            <motion.div
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                                className="flex items-center justify-center h-6 w-6 rounded-full bg-background/80 backdrop-blur-md border border-green-500/40 shadow-sm"
                            >
                                <motion.div
                                   animate={{ scale: [1, 1.2, 1] }}
                                   transition={{ duration: 2, repeat: Infinity, repeatType: "reverse" }}
                                >
                                    <Check className="w-3.5 h-3.5 text-green-500" strokeWidth={3} />
                                </motion.div>
                            </motion.div>
                        </div>
                    )}
                    {hasActiveOptions && (
                        <div className="absolute top-2 right-2 z-20 pointer-events-none" aria-label="Options affecting prompt">
                            <motion.div
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                                className="flex items-center justify-center h-6 w-6 rounded-full bg-background/80 backdrop-blur-md border border-blue-500/40 shadow-sm"
                            >
                                <motion.div
                                   animate={{ rotate: [0, 10, -10, 0] }}
                                   transition={{ duration: 2.5, repeat: Infinity, repeatType: "reverse", ease: "easeInOut" }}
                                >
                                    <Sliders className="w-3.5 h-3.5 text-blue-500" strokeWidth={3} />
                                </motion.div>
                            </motion.div>
                        </div>
                    )}
                    <AnimatePresence>
                        {isMergeMode && (
                            <motion.div
                                initial={{ opacity: 0, y: 15, scale: 0.95 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                                transition={{
                                    type: "spring",
                                    stiffness: 400,
                                    damping: 30
                                }}
                                className={`absolute inset-0 z-20 flex flex-col justify-end p-2 transition-colors ${isSelected ? 'bg-black/20 backdrop-blur-[1px]' : 'bg-transparent'}`}
                                onClick={(e) => e.stopPropagation()}
                            >
                                {/* Inline Selection Bar */}
                                <motion.div
                                    className="flex items-center justify-between w-full max-w-[220px] mx-auto bg-background/85 backdrop-blur-xl border border-white/10 shadow-2xl rounded-2xl p-1.5 gap-1.5 ring-1 ring-black/5"
                                    initial={{ scale: 0.9, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    transition={{ type: "spring", stiffness: 300, damping: 25 }}
                                >
                                    {(['appearance', 'pose', 'clothing', 'scenery'] as const).map(part => {
                                        const isChecked = selectedParts?.has(part)
                                        const hasTags = classifiedTags[part] && classifiedTags[part].length > 0

                                        // Icons mapping
                                        const Icon = part === 'appearance' ? Smile :
                                            part === 'pose' ? User :
                                                part === 'clothing' ? Shirt :
                                                    Mountain

                                        // Colors mapping
                                        const activeColorClass = part === 'appearance' ? 'bg-blue-500 shadow-blue-500/50' :
                                            part === 'pose' ? 'bg-purple-500 shadow-purple-500/50' :
                                                part === 'clothing' ? 'bg-green-500 shadow-green-500/50' :
                                                    'bg-orange-500 shadow-orange-500/50'

                                        const inactiveColorClass = part === 'appearance' ? 'hover:text-blue-500 hover:bg-blue-500/10' :
                                            part === 'pose' ? 'hover:text-purple-500 hover:bg-purple-500/10' :
                                                part === 'clothing' ? 'hover:text-green-500 hover:bg-green-500/10' :
                                                    'hover:text-orange-500 hover:bg-orange-500/10'

                                        return (
                                            <Tooltip key={part}>
                                                <TooltipTrigger asChild>
                                                    <span tabIndex={!hasTags ? -1 : 0} className="flex-1 flex max-w-[50px]">
                                                        <motion.button
                                                            disabled={!hasTags}
                                                            whileHover={hasTags ? { scale: 1.1, y: -2 } : {}}
                                                            whileTap={hasTags ? { scale: 0.9 } : {}}
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                if (hasTags) onTogglePart?.(post, part)
                                                            }}
                                                            aria-label={isChecked ? `Deselect ${part} tags` : `Select ${part} tags`}
                                                            className={`
                                                              relative flex-1 h-9 flex items-center justify-center rounded-xl transition-all duration-300
                                                              ${!hasTags
                                                                    ? `opacity-40 cursor-not-allowed bg-muted/50 text-muted-foreground`
                                                                    : isChecked
                                                                        ? `${activeColorClass} text-white shadow-lg shadow-${part === 'appearance' ? 'blue' : part === 'pose' ? 'purple' : part === 'clothing' ? 'green' : 'orange'}-500/20`
                                                                        : `text-muted-foreground hover:bg-white/10 hover:text-foreground`
                                                                }
                                                            `}
                                                        >
                                                            {isChecked && (
                                                                <motion.div
                                                                    layoutId={`active-bg-${part}-${post.id}`}
                                                                    className="absolute inset-0 rounded-xl bg-gradient-to-b from-white/20 to-transparent"
                                                                    initial={{ opacity: 0 }}
                                                                    animate={{ opacity: 1 }}
                                                                    exit={{ opacity: 0 }}
                                                                />
                                                            )}
                                                            <Icon className={`w-4 h-4 relative z-10 ${isChecked ? 'stroke-[2.5px]' : 'stroke-2'}`} />
                                                            {isChecked && (
                                                                <motion.div
                                                                    layoutId={`glow-${part}-${post.id}`}
                                                                    className="absolute inset-0 -z-10 bg-inherit blur-md opacity-40"
                                                                    initial={{ opacity: 0 }}
                                                                    animate={{ opacity: 1 }}
                                                                />
                                                            )}
                                                        </motion.button>
                                                    </span>
                                                </TooltipTrigger>
                                                <TooltipContent side="top" className="text-[10px] capitalize font-medium">
                                                    {hasTags ? part : `No ${part} tags`}
                                                </TooltipContent>
                                            </Tooltip>
                                        )
                                    })}
                                </motion.div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                    <Image
                        key={retryKey}
                        src={fileUrl || ''}
                        alt={`${itemProvider} post ${post.id} - ${post.tag_string ? post.tag_string.slice(0, 150) : 'anime art'}`}
                        fill
                        className="object-cover object-top transition-transform duration-300 group-hover:scale-105"
                        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, (max-width: 1280px) 25vw, 20vw"
                        priority={index < 8}
                        fetchPriority={index < 8 ? "high" : "low"}
                        decoding={index < 8 ? "sync" : "async"}
                        unoptimized={!!rawFileUrl}
                        referrerPolicy={isAibooru ? undefined : "no-referrer"}
                        onError={handleImageError}
                        onLoad={() => setImageError(false)}
                    />
                    {imageError && (
                        <div className="absolute inset-0 flex items-center justify-center bg-muted z-10">
                            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                    )}

                    {/* Character Tag Count Indicator */}
                    {tagCountIndicator && includeCharacters && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded-md bg-black/60 text-white/90 text-xs font-medium tracking-wide flex items-center gap-1 backdrop-blur-sm shadow-sm cursor-help z-10">
                                    <Users className="w-3.5 h-3.5 opacity-70" />
                                    {tagCountIndicator}
                                </div>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                                Character Post Count
                            </TooltipContent>
                        </Tooltip>
                    )}

                    {/* Total Tag Count Indicator */}
                    {totalTagsCount > 0 && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-md bg-black/60 text-white/90 text-xs font-medium tracking-wide flex items-center gap-1 backdrop-blur-sm shadow-sm cursor-help z-10">
                                    <Tag className="w-3.5 h-3.5 opacity-70" />
                                    {totalTagsCount}
                                </div>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                                Total Tags
                            </TooltipContent>
                        </Tooltip>
                    )}

                    {/* Overlay actions */}
                    <div className="absolute top-2 right-2 flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                        <SaveFavoriteButton
                            folders={folders}
                            selectedFolderIds={currentFolderIds}
                            isFavorited={isFavorited}
                            onToggleFavorite={handleToggleFavorite}
                            onCreateFolder={createFolder}
                        />
                        <SaveArtistButton
                            post={post}
                            booruProvider={itemProvider}
                            size={effectiveScale === "small" ? "sm" : "md"}
                        />
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    size="icon"
                                    variant="secondary"
                                    className={`glass-effect ${effectiveScale === "small" ? "h-7 w-7" : "h-8 w-8"}`}
                                    onClick={(e) => {
                                        e.preventDefault()
                                        e.stopPropagation()
                                        onSendToConvert?.(modifiedContent ?? displayContent, post.large_file_url)
                                    }}
                                    aria-label="Convert to Natural Language"
                                >
                                    <Sparkles
                                        className={`${effectiveScale === "small" ? "w-3 h-3" : "w-3.5 h-3.5"} text-primary`}
                                        aria-hidden="true"
                                    />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                Convert to Natural Language
                            </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    size="icon"
                                    variant="secondary"
                                    className={`glass-effect ${effectiveScale === "small" ? "h-7 w-7" : "h-8 w-8"}`}
                                    onClick={() => downloadImage(post)}
                                    aria-label="Download image"
                                >
                                    <Download
                                        className={`${effectiveScale === "small" ? "w-3 h-3" : "w-3.5 h-3.5"}`}
                                    />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                Download image (best quality)
                            </TooltipContent>
                        </Tooltip>
                    </div>
                </div>

                <div className={getCardContentClass()} style={{ height: footerHeight }}>
                    <div className="bg-muted/50 rounded-lg overflow-y-auto prompt-container">
                        <InteractivePrompt
                            initialPrompt={displayContent}
                            onUpdate={setModifiedContent}
                            onPromoteToGlobal={isGlobalWeightsEnabled ? onGlobalWeightChange : undefined}
                            globalWeights={isGlobalWeightsEnabled ? globalWeights : {}}
                            onSearch={onSearch}
                              conflictingTags={conflictResolution.conflictingTags}
                        />
                    </div>

                    <div className="flex button-group items-stretch isolate">
                        {isNaturalLanguageMode ? (
                            <Button
                                onClick={() => onSendToConvert?.(modifiedContent ?? displayContent, post.large_file_url)}
                                className="flex-1 focus-ring h-auto rounded-r-none border-r-0"
                                variant="default"
                                disabled={!displayContent}
                                aria-label="Convert tags to Natural Language"
                            >
                                <Sparkles className={`${getIconClass()} mr-1.5 text-primary-foreground`} />
                                Convert
                            </Button>
                        ) : (
                            <Button
                                onClick={() => copyToClipboard(modifiedContent ?? displayContent, post.id, !!aiPrompt, post.preview_file_url)}
                                className="flex-1 focus-ring h-auto rounded-r-none border-r-0"
                                variant={copiedId === post.id ? "default" : "outline"}
                                disabled={!displayContent}
                                aria-label={copiedId === post.id ? "Copied prompt" : "Copy prompt"}
                            >
                                {copiedId === post.id ? (
                                    <>
                                        <Check className={`${getIconClass()} mr-1`} />
                                        {effectiveScale === "small" ? "OK" : "Copied!"}
                                    </>
                                ) : (
                                    <>
                                        <Copy className={`${getIconClass()} mr-1`} />
                                    {effectiveScale === "small" ? "Copy" : (isPreviouslyCopied ? "Copy Again" : "Copy")}
                                    </>
                                )}
                            </Button>
                        )}

                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant={isNaturalLanguageMode ? "outline" : (copiedId === post.id ? "default" : "outline")}
                                    className="px-2 focus-ring h-auto rounded-l-none"
                                    disabled={!displayContent}
                                    aria-label="Copy options"
                                >
                                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuLabel>Copy Options</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => copyCategory('scenery')}>
                                    <Mountain className="mr-2 h-4 w-4" />
                                    <span className="flex-1">Scenery</span>
                                    <span className="ml-2 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full min-w-[1.5rem] text-center">
                                        {classifiedTags.scenery.length}
                                    </span>
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => copyCategory('pose')}>
                                    <User className="mr-2 h-4 w-4" />
                                    <span className="flex-1">Pose</span>
                                    <span className="ml-2 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full min-w-[1.5rem] text-center">
                                        {classifiedTags.pose.length}
                                    </span>
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => copyCategory('clothing')}>
                                    <Shirt className="mr-2 h-4 w-4" />
                                    <span className="flex-1">Clothing</span>
                                    <span className="ml-2 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full min-w-[1.5rem] text-center">
                                        {classifiedTags.clothing.length}
                                    </span>
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => copyCategory('appearance')}>
                                    <Smile className="mr-2 h-4 w-4" />
                                    <span className="flex-1">Appearance</span>
                                    <span className="ml-2 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full min-w-[1.5rem] text-center">
                                        {classifiedTags.appearance.length}
                                    </span>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    onSelect={(e) => {
                                        e.preventDefault()
                                        setTeachModalData({ open: true, tags: classifiedTeachTags })
                                    }}
                                >
                                    <GraduationCap className="mr-2 h-4 w-4" />
                                    Teach
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    asChild
                                    className={`focus-ring bg-transparent h-auto ${effectiveScale === "small" ? "w-7" : ""}`}
                                >
                                    <a
                                        href={postUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={() => trackExternalLink(postUrl, 'post')}
                                        aria-label="View original post"
                                    >
                                        <ExternalLink className={getIconClass()} />
                                    </a>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>View original post</TooltipContent>
                        </Tooltip>
                    </div>
                </div>
                <AnimatePresence>
                    {copiedId === post.id && <SuccessOverlay onSkip={onSkipAnimation} />}
                </AnimatePresence>
            </Card>
        )
    }

    // List View
    return (
        <Card className="overflow-hidden card-hover relative transition-all duration-300">
            <CardContent className="p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row gap-4 sm:gap-6">
                    <div
                        className="image-container-list-2-3 mx-auto sm:mx-0 relative group cursor-pointer"
                        onDoubleClick={() => handleToggleFavorite(null)}
                    >
                        {isPreviouslyCopied && (
                            <div className="absolute top-1.5 right-1.5 z-20 pointer-events-none" aria-label="Previously copied">
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.8 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                                    className="flex items-center justify-center h-6 w-6 rounded-full bg-background/80 backdrop-blur-md border border-green-500/40 shadow-sm"
                                >
                                    <motion.div
                                       animate={{ scale: [1, 1.2, 1] }}
                                       transition={{ duration: 2, repeat: Infinity, repeatType: "reverse" }}
                                    >
                                        <Check className="w-3.5 h-3.5 text-green-500" strokeWidth={3} />
                                    </motion.div>
                                </motion.div>
                            </div>
                        )}
                        {hasActiveOptions && (
                            <div className="absolute top-1.5 left-1.5 z-20 pointer-events-none" aria-label="Options affecting prompt">
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.8 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                                    className="flex items-center justify-center h-6 w-6 rounded-full bg-background/80 backdrop-blur-md border border-blue-500/40 shadow-sm"
                                >
                                    <motion.div
                                       animate={{ rotate: [0, 10, -10, 0] }}
                                       transition={{ duration: 2.5, repeat: Infinity, repeatType: "reverse", ease: "easeInOut" }}
                                    >
                                        <Sliders className="w-3.5 h-3.5 text-blue-500" strokeWidth={3} />
                                    </motion.div>
                                </motion.div>
                            </div>
                        )}
                        <div className="absolute top-1 left-1.5 z-10 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                            <SaveFavoriteButton
                                folders={folders}
                                selectedFolderIds={currentFolderIds}
                                isFavorited={isFavorited}
                                onToggleFavorite={handleToggleFavorite}
                                onCreateFolder={createFolder}
                            />
                            <SaveArtistButton
                                post={post}
                                booruProvider={itemProvider}
                                size="sm"
                            />
                        </div>
                        <Image
                            key={retryKey}
                            src={fileUrl!}
                            alt={`${itemProvider} post ${post.id}`}
                            fill
                            className="object-cover"
                            sizes="128px"
                            loading="lazy"
                            decoding="async"
                            unoptimized={!!rawFileUrl}
                            referrerPolicy={isAibooru ? undefined : "no-referrer"}
                            onError={handleImageError}
                            onLoadingComplete={() => setImageError(false)}
                        />
                        {imageError && (
                            <div className="absolute inset-0 flex items-center justify-center bg-muted z-10">
                                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                            </div>
                        )}

                        {/* Character Tag Count Indicator */}
                        {tagCountIndicator && includeCharacters && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded-md bg-black/60 text-white/90 text-[10px] font-medium tracking-wide flex items-center gap-1 backdrop-blur-sm shadow-sm cursor-help z-10">
                                        <Users className="w-3 h-3 opacity-70" />
                                        {tagCountIndicator}
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs">
                                    Character Post Count
                                </TooltipContent>
                            </Tooltip>
                        )}

                        {/* Total Tag Count Indicator */}
                        {totalTagsCount > 0 && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded-md bg-black/60 text-white/90 text-[10px] font-medium tracking-wide flex items-center gap-1 backdrop-blur-sm shadow-sm cursor-help z-10">
                                        <Tag className="w-3 h-3 opacity-70" />
                                        {totalTagsCount}
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs">
                                    Total Tags
                                </TooltipContent>
                            </Tooltip>
                        )}
                    </div>

                    <div className="flex-1 space-y-3">
                        <div className="flex items-start justify-between">
                            <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="text-xs">ID: {post.id}</Badge>
                                </div>
                            </div>

                            <div className="flex gap-2">
                                <SaveFavoriteButton
                                    folders={folders}
                                    selectedFolderIds={currentFolderIds}
                                    isFavorited={isFavorited}
                                    onToggleFavorite={handleToggleFavorite}
                                    onCreateFolder={createFolder}
                                />
                                <SaveArtistButton
                                    post={post}
                                    booruProvider={itemProvider}
                                    size="md"
                                />
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            onClick={(e) => {
                                                e.preventDefault()
                                                e.stopPropagation()
                                                onSendToConvert?.(modifiedContent ?? displayContent, post.large_file_url)
                                            }}
                                            className="focus-ring h-8 w-8"
                                            aria-label="Convert to Natural Language"
                                        >
                                            <Sparkles className="h-4 w-4 text-primary" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        Convert to Natural Language
                                    </TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            onClick={() => downloadImage(post)}
                                            className="focus-ring h-8 w-8"
                                            aria-label="Download image"
                                        >
                                            <Download className="h-4 w-4" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        Download image (best quality)
                                    </TooltipContent>
                                </Tooltip>
                            </div>
                        </div>

                        <div className="bg-muted/50 p-3 rounded-lg max-h-20 overflow-y-auto">
                            <InteractivePrompt
                                initialPrompt={displayContent}
                                onUpdate={setModifiedContent}
                                onPromoteToGlobal={isGlobalWeightsEnabled ? onGlobalWeightChange : undefined}
                                globalWeights={isGlobalWeightsEnabled ? globalWeights : {}}
                                onSearch={onSearch}
                                conflictingTags={conflictResolution.conflictingTags}
                            />
                        </div>

                        <div className="flex flex-col sm:flex-row gap-2">
                            {isNaturalLanguageMode ? (
                                <Button
                                    onClick={() => onSendToConvert?.(modifiedContent ?? displayContent, post.large_file_url)}
                                    variant="default"
                                    disabled={!displayContent}
                                    className="focus-ring flex-1 sm:flex-none"
                                    aria-label="Convert tags to Natural Language"
                                >
                                    <Sparkles className="w-4 h-4 mr-2 text-primary-foreground" />
                                    Convert
                                </Button>
                            ) : (
                                <Button
                                    onClick={() => copyToClipboard(modifiedContent ?? displayContent, post.id, !!aiPrompt, post.preview_file_url)}
                                    variant={copiedId === post.id ? "default" : "outline"}
                                    disabled={!displayContent}
                                    className="focus-ring flex-1 sm:flex-none"
                                    aria-label={copiedId === post.id ? "Copied prompt" : "Copy prompt"}
                                >
                                    {copiedId === post.id ? (
                                        <>
                                            <Check className="w-4 h-4 mr-2" />
                                            Copied!
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="w-4 h-4 mr-2" />
                                            {isPreviouslyCopied ? "Copy Again" : "Copy Prompt"}
                                        </>
                                    )}
                                </Button>
                            )}

                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="outline"
                                        className="px-3 focus-ring"
                                        disabled={!displayContent}
                                        aria-label="Copy options"
                                    >
                                        <ChevronDown className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuLabel>Copy Options</DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => copyCategory('scenery')}>
                                        <Mountain className="mr-2 h-4 w-4" />
                                        <span className="flex-1">Scenery</span>
                                        <span className="ml-2 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full min-w-[1.5rem] text-center">
                                            {classifiedTags.scenery.length}
                                        </span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => copyCategory('pose')}>
                                        <User className="mr-2 h-4 w-4" />
                                        <span className="flex-1">Pose</span>
                                        <span className="ml-2 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full min-w-[1.5rem] text-center">
                                            {classifiedTags.pose.length}
                                        </span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => copyCategory('clothing')}>
                                        <Shirt className="mr-2 h-4 w-4" />
                                        <span className="flex-1">Clothing</span>
                                        <span className="ml-2 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full min-w-[1.5rem] text-center">
                                            {classifiedTags.clothing.length}
                                        </span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => copyCategory('appearance')}>
                                        <Smile className="mr-2 h-4 w-4" />
                                        <span className="flex-1">Appearance</span>
                                        <span className="ml-2 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full min-w-[1.5rem] text-center">
                                            {classifiedTags.appearance.length}
                                        </span>
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        onSelect={(e) => {
                                            e.preventDefault()
                                            setTeachModalData({ open: true, tags: classifiedTeachTags })
                                        }}
                                    >
                                        <GraduationCap className="mr-2 h-4 w-4" />
                                        Teach
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>

                            <Button variant="outline" asChild className="focus-ring bg-transparent flex-1 sm:flex-none">
                                <a
                                    href={postUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() => trackExternalLink(postUrl, 'post')}
                                    aria-label="View original post on source site"
                                >
                                    <ExternalLink className="w-4 h-4 mr-2" />
                                    View Original
                                </a>
                            </Button>
                        </div>
                    </div>
                </div>
            </CardContent>
            <AnimatePresence>
                {copiedId === post.id && <SuccessOverlay onSkip={onSkipAnimation} />}
            </AnimatePresence>
        </Card>
    )}

    return renderCard()
}, arePropsEqual)

// Custom comparison function for React.memo to prevent deep unnecessary re-renders.
// Specifically targets the expensive tagOverrides and globalWeights objects.
function arePropsEqual(prev: MasonryItemProps, next: MasonryItemProps) {
    if (prev.isNaturalLanguageMode !== next.isNaturalLanguageMode) return false
    if (prev.post.id !== next.post.id) return false
    if (prev.post.tag_string !== next.post.tag_string) return false
    if (prev.width !== next.width) return false
    if (prev.height !== next.height) return false
    if (prev.index !== next.index) return false
    if (prev.viewMode !== next.viewMode) return false
    if (prev.effectiveScale !== next.effectiveScale) return false
    if (prev.booruProvider !== next.booruProvider) return false
    if (prev.isFavorited !== next.isFavorited) return false
    if (prev.isMergeMode !== next.isMergeMode) return false
    if (prev.isSelected !== next.isSelected) return false
    if (prev.excludeInput !== next.excludeInput) return false
    if (prev.addInput !== next.addInput) return false
    if (prev.includeCharacters !== next.includeCharacters) return false
    if (prev.optimizeTags !== next.optimizeTags) return false
    if (prev.smartTagExclusion !== next.smartTagExclusion) return false
    if (prev.removeLoRaTags !== next.removeLoRaTags) return false
    if (prev.removeQualityTags !== next.removeQualityTags) return false
    if (prev.backgroundMode !== next.backgroundMode) return false
    if (prev.simpleBackgroundReplacementTags !== next.simpleBackgroundReplacementTags) return false
    if (prev.randomBackgroundPatterns !== next.randomBackgroundPatterns) return false
    if (prev.backgroundRemoveMode !== next.backgroundRemoveMode) return false
    if (prev.randomBackgroundIncludeGradients !== next.randomBackgroundIncludeGradients) return false
    if (prev.isGlobalWeightsEnabled !== next.isGlobalWeightsEnabled) return false
    if (prev.isPreviouslyCopied !== next.isPreviouslyCopied) return false

    if (prev.folders !== next.folders) return false
    if (prev.currentFolderIds.length !== next.currentFolderIds.length || 
        !prev.currentFolderIds.every((id, i) => id === next.currentFolderIds[i])) return false
    
    if (prev.selectedParts?.size !== next.selectedParts?.size) return false
    if (prev.selectedParts && next.selectedParts) {
        for (const part of prev.selectedParts) {
            if (!next.selectedParts.has(part)) return false
        }
    }

    if (prev.copiedId !== next.copiedId && (prev.copiedId === prev.post.id || next.copiedId === next.post.id)) {
        return false
    }

    const postTags = next.post.tag_string.split(' ')
    for (const tag of postTags) {
        if (prev.tagOverrides[tag] !== next.tagOverrides[tag]) return false
        if (next.isGlobalWeightsEnabled && (prev.globalWeights?.[tag] !== next.globalWeights?.[tag])) return false
    }

    return true
}






