import { useCallback, useMemo, memo } from "react"
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
import { cleanPrompt } from "@/lib/cleanPrompt"
import { classifyTags, TagCategory } from "@/lib/tag-classifier"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { trackExternalLink } from "@/lib/analytics"
import { toast } from "@/hooks/use-toast"
import { SCALE_CONFIG } from "@/components/masonry-grid"

const SuccessOverlay = () => {
    const particles = Array.from({ length: 12 })
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] rounded-xl"
        >
            <div className="relative flex flex-col items-center justify-center pointer-events-none">
                {particles.map((_, i) => (
                    <motion.div
                        key={i}
                        initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
                        animate={{
                            x: Math.cos(i * (360 / particles.length) * (Math.PI / 180)) * 60,
                            y: Math.sin(i * (360 / particles.length) * (Math.PI / 180)) * 60,
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
}

interface MasonryItemProps {
    post: BooruPost
    width: number
    height: number
    viewMode?: "grid" | "list"
    effectiveScale: "small" | "medium" | "large"
    booruProvider: BooruProvider
    favorites: Set<string>
    toggleFavorite: (id: number, provider?: string) => void
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
    removeLoRaTags: boolean
    removeQualityTags: boolean
    tagOverrides: Record<string, string>
    copiedId: number | null
    setTeachModalData: (data: { open: boolean, tags: any }) => void
}

// Memoized MasonryItem to prevent unnecessary re-renders
export const MasonryItem = memo(function MasonryItem({
    post,
    width,
    height,
    viewMode = "grid",
    effectiveScale,
    booruProvider,
    favorites,
    toggleFavorite,
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
    removeLoRaTags,
    removeQualityTags,
    tagOverrides,
    copiedId,
    setTeachModalData
}: MasonryItemProps) {
    const excludeList = excludeInput.split(',').map(t => t.trim()).filter(Boolean)
    const addList = addInput.split(',').map(t => t.trim()).filter(Boolean)

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

    // Use AI prompt if available, but still pass through cleanPrompt to remove meta/unwanted tags
    const displayContent = useMemo(() => aiPrompt
        ? cleanPrompt(
            aiPrompt,
            "",
            "",
            "",
            { includeCharacters, includeCopyrights: false, optimizeTags, exclude: excludeList, addedTags: addList, tagOverrides },
        )
        : cleanPrompt(
            post.tag_string,
            post.tag_string_artist,
            post.tag_string_character,
            post.tag_string_copyright,
            { includeCharacters, includeCopyrights: false, optimizeTags, exclude: excludeList, addedTags: addList, tagOverrides },
        ), [aiPrompt, post.tag_string, post.tag_string_artist, post.tag_string_character, post.tag_string_copyright, includeCharacters, optimizeTags, excludeInput, addInput, tagOverrides])


    // Create a raw (unoptimized) version for Teach modal classification
    const teachContent = useMemo(() => aiPrompt
        ? cleanPrompt(
            aiPrompt,
            "",
            "",
            "",
            { includeCharacters, includeCopyrights: false, optimizeTags: false, exclude: excludeList, tagOverrides },
        )
        : cleanPrompt(
            post.tag_string,
            post.tag_string_artist,
            post.tag_string_character,
            post.tag_string_copyright,
            { includeCharacters, includeCopyrights: false, optimizeTags: false, exclude: excludeList, tagOverrides },
        ), [aiPrompt, post.tag_string, post.tag_string_artist, post.tag_string_character, post.tag_string_copyright, includeCharacters, excludeInput, tagOverrides])

    // Pre-classify tags for the dropdown counts
    const tagsForClassification = useMemo(() => displayContent ? displayContent.split(',').map(t => t.trim()) : [], [displayContent])
    const teachTagsForClassification = useMemo(() => teachContent ? teachContent.split(',').map(t => t.trim()) : [], [teachContent])

    // Prepare character tags
    const characterTagsArray = useMemo(() => (post.tag_string_character ? post.tag_string_character.split(' ') : [])
        .map(t => t.replace(/_/g, ' ').toLowerCase()), [post.tag_string_character])

    const classifiedTags = useMemo(() => {
        // Ensure character tags are included in the classification source
        const allTagsForClassification = Array.from(new Set([...characterTagsArray, ...tagsForClassification]))
        return classifyTags(allTagsForClassification, tagOverrides, characterTagsArray)
    }, [characterTagsArray, tagsForClassification, tagOverrides])

    const classifiedTeachTags = useMemo(() => {
        const allTeachTagsForClassification = Array.from(new Set([...characterTagsArray, ...teachTagsForClassification]))
        return classifyTags(allTeachTagsForClassification, tagOverrides, characterTagsArray)
    }, [characterTagsArray, teachTagsForClassification, tagOverrides])

    const copyCategory = async (category: TagCategory) => {
        if (!displayContent) return
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

    const rawFileUrl = post.large_file_url || post.file_url
    // Gelbooru has hotlink protection — proxy images through our server
    const fileUrl = (post._provider === 'gelbooru' || booruProvider === 'gelbooru')
        ? `/api/image-proxy?url=${encodeURIComponent(rawFileUrl!)}`
        : rawFileUrl

    const itemProvider = post._provider || booruProvider
    let postUrl = `https://danbooru.donmai.us/posts/${post.id}`

    if (isAiPost || itemProvider === 'aibooru') {
        postUrl = `https://aibooru.online/posts/${post.id}`
    } else if (itemProvider === 'rule34') {
        postUrl = `https://rule34.xxx/index.php?page=post&s=view&id=${post.id}`
    } else if (itemProvider === 'e621') {
        postUrl = `https://e621.net/posts/${post.id}`
    } else if (itemProvider === 'gelbooru') {
        postUrl = `https://gelbooru.com/index.php?page=post&s=view&id=${post.id}`
    }

    const isFavorited = favorites.has(`${itemProvider}:${post.id}`)

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

    // Grid View
    if (viewMode === "grid") {
        const footerHeight = SCALE_CONFIG[effectiveScale].footerHeight
        const imageHeight = height - footerHeight

        return (
            <Card className="w-full h-full overflow-hidden card-hover group flex flex-col relative">
                <div className="relative bg-muted overflow-hidden cursor-pointer" style={{ height: imageHeight }}>
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
                                                    <span tabIndex={!hasTags ? 0 : -1} className="flex-1 flex max-w-[50px]">
                                                        <motion.button
                                                            disabled={!hasTags}
                                                            whileHover={hasTags ? { scale: 1.1, y: -2 } : {}}
                                                            whileTap={hasTags ? { scale: 0.9 } : {}}
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                if (hasTags) onTogglePart?.(post, part)
                                                            }}
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
                        src={fileUrl!}
                        alt={`${itemProvider} post ${post.id} - ${post.tag_string ? post.tag_string.slice(0, 150) : 'anime art'}`}
                        fill
                        className="object-cover object-top transition-transform duration-300 group-hover:scale-105"
                        sizes={`${width}px`}
                        priority={false}
                    />

                    {/* Overlay actions */}
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    size="icon"
                                    variant="secondary"
                                    className={`glass-effect ${effectiveScale === "small" ? "h-7 w-7" : "h-8 w-8"}`}
                                    onClick={() => toggleFavorite(post.id, post._provider)}
                                    aria-label={isFavorited ? "Remove from favorites" : "Add to favorites"}
                                >
                                    <Heart
                                        className={`${effectiveScale === "small" ? "w-3 h-3" : "w-3.5 h-3.5"} ${isFavorited ? "fill-red-500 text-red-500" : ""}`}
                                    />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                {isFavorited ? "Remove from favorites" : "Add to favorites"}
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
                        <p className="text-foreground/80 leading-relaxed">{displayContent || "No content available"}</p>
                    </div>

                    <div className="flex button-group items-stretch isolate">
                        <Button
                            onClick={() => copyToClipboard(displayContent, post.id, !!aiPrompt, post.preview_file_url)}
                            className="flex-1 focus-ring h-auto rounded-r-none border-r-0"
                            variant={copiedId === post.id ? "default" : "outline"}
                            disabled={!displayContent}
                        >
                            {copiedId === post.id ? (
                                <>
                                    <Check className={`${getIconClass()} mr-1`} />
                                    {effectiveScale === "small" ? "OK" : "Copied!"}
                                </>
                            ) : (
                                <>
                                    <Copy className={`${getIconClass()} mr-1`} />
                                    {effectiveScale === "small" ? "Copy" : "Copy"}
                                </>
                            )}
                        </Button>

                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant={copiedId === post.id ? "default" : "outline"}
                                    className="px-2 focus-ring h-auto rounded-l-none"
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
                    {copiedId === post.id && <SuccessOverlay />}
                </AnimatePresence>
            </Card>
        )
    }

    // List View
    return (
        <Card className="overflow-hidden card-hover relative">
            <CardContent className="p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row gap-4 sm:gap-6">
                    <div
                        className="image-container-list-2-3 mx-auto sm:mx-0 relative group cursor-pointer"
                        onDoubleClick={() => toggleFavorite(post.id, itemProvider)}
                    >
                        <div className="absolute top-1 right-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                                size="icon"
                                variant="secondary"
                                className={`h-6 w-6 rounded-full shadow-sm ${isFavorited ? 'text-red-500 bg-white' : 'text-muted-foreground bg-white/80'}`}
                                onClick={(e) => {
                                    e.stopPropagation()
                                    toggleFavorite(post.id, itemProvider)
                                }}
                            >
                                <Heart className={`h-3 w-3 ${isFavorited ? "fill-current" : ""}`} />
                            </Button>
                        </div>
                        <Image
                            src={fileUrl!}
                            alt={`${itemProvider} post ${post.id}`}
                            fill
                            className="object-cover"
                            sizes="128px"
                        />
                    </div>

                    <div className="flex-1 space-y-3">
                        <div className="flex items-start justify-between">
                            <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="text-xs">ID: {post.id}</Badge>
                                </div>
                            </div>

                            <div className="flex gap-2">
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            onClick={() => toggleFavorite(post.id)}
                                            className="focus-ring h-8 w-8"
                                            aria-label={isFavorited ? "Remove from favorites" : "Add to favorites"}
                                        >
                                            <Heart
                                                className={`h-4 w-4 ${isFavorited ? "fill-red-500 text-red-500" : ""}`}
                                            />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {isFavorited ? "Remove from favorites" : "Add to favorites"}
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
                            <p className="text-sm text-foreground/80 leading-relaxed">
                                {displayContent || "No content available"}
                            </p>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-2">
                            <Button
                                onClick={() => copyToClipboard(displayContent, post.id, !!aiPrompt, post.preview_file_url)}
                                variant={copiedId === post.id ? "default" : "outline"}
                                disabled={!displayContent}
                                className="focus-ring flex-1 sm:flex-none"
                            >
                                {copiedId === post.id ? (
                                    <>
                                        <Check className="w-4 h-4 mr-2" />
                                        Copied!
                                    </>
                                ) : (
                                    <>
                                        <Copy className="w-4 h-4 mr-2" />
                                        Copy Prompt
                                    </>
                                )}
                            </Button>

                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="outline"
                                        className="px-3 focus-ring"
                                        disabled={!displayContent}
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
                {copiedId === post.id && <SuccessOverlay />}
            </AnimatePresence>
        </Card>
    )
})
