import { Fragment, useCallback, useMemo, memo, useState, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useLowMotion } from "@/hooks/use-low-motion"
import { isDanbooruCircuitOpen, openDanbooruCircuit } from "@/lib/booru/danbooru-circuit"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    Copy,
    Check,
    Heart,
    ChevronDown,
    Shirt,
    User,
    Mountain,
    Smile,
    AlertCircle,
    Users,
    Loader2,
    Tag,
    Sparkles,
    Package,
    ImageOff
} from "lucide-react"
import {
    BooruPost,
    BooruProvider
} from "@/lib/api-client"
import { getPostUrl } from "@/lib/constants"
import { getGelbooruProxyUrl, getDanbooruCdnUrl, imageReferrerPolicy } from "@/lib/proxy-url"
import { type BackgroundMode } from "@/lib/background-detector"
import { type MatchStrictness } from "@/lib/background-context"
import { type TagCategory, type ClassifiedTags, type RichnessDepth } from "@/lib/tag-classifier"
import { RICHNESS_AXES, TAG_CATEGORIES } from "@/lib/tag-taxonomy"
import type { ConvertMeta } from "./ai-convert-sticky-footer"
import { useCardPrompt } from "@/hooks/use-card-prompt"

// Richness tooltip depth labels/classes (Palanca 7, docs/prompt-genericness-mitigation-plan.md
// §7.8): maps each category's RichnessDepth to a short prefix + color, replacing the old
// binary check/cross now that depth (none/shallow/deep) carries more signal than presence alone.
const RICHNESS_DEPTH_LABEL: Record<RichnessDepth, string> = {
    none: "✗",
    shallow: "~",
    deep: "✓",
}
const RICHNESS_DEPTH_CLASS: Record<RichnessDepth, string> = {
    none: "text-muted-foreground",
    shallow: "text-warning-text",
    deep: "text-success-text",
}

// Temporary kill-switch (2026-07-16): the richness badge was judged not useful enough
// in its current form to keep showing by default. The underlying computeRichnessScore
// logic and tests stay intact — flip this back to true to re-enable the on-card badge
// without redoing any of the plumbing.
const SHOW_RICHNESS_BADGE = false

// A failed image is retried this many times (10s, then 20s) before the card
// gives up. Unbounded retries turned one deleted/broken file into a request
// every 10s forever, and each failure counted toward the gallery's image-error
// threshold — so a single broken card eventually paused infinite scroll.
const MAX_IMAGE_RETRIES = 2
const IMAGE_RETRY_BASE_MS = 10_000

// Per-category breakdown shown inside the tag-count chip's tooltip.
const CATEGORY_BREAKDOWN = [
    { key: "appearance", label: "Appearance", Icon: Smile, className: "text-cat-appearance-text" },
    { key: "clothing", label: "Outfit", Icon: Shirt, className: "text-cat-clothing-text" },
    { key: "pose", label: "Pose", Icon: User, className: "text-cat-pose-text" },
    { key: "scenery", label: "Scene", Icon: Mountain, className: "text-cat-scenery-text" },
] as const

import { InteractivePrompt } from "@/components/prompt-gallery/interactive-prompt"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { SaveFavoriteButton } from "./save-favorite-button"
import { CardActionsMenu } from "./card-actions-menu"
import { CopyOptionsDropdown } from "./copy-options-dropdown"
import { FavoriteFolder } from "@/hooks/use-booru-favorites"
import { trackExternalLink } from "@/lib/analytics"
import { usePostHog } from 'posthog-js/react'
import { toast } from "@/hooks/use-toast"
import { SCALE_CONFIG } from "@/components/masonry-grid"
import type { TagAppendRule } from "@/lib/cleanPrompt"

const PARTICLES = Array.from({ length: 12 })

const SuccessOverlay = memo(({ onSkip }: { onSkip?: () => void }) => {
    const lowMotion = useLowMotion()
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            // Touch: let taps pass through to the card underneath — replays showed
            // mobile users repeatedly tapping this overlay to reach "Copy options".
            className="absolute inset-0 z-50 flex items-center justify-center bg-overlay/60 backdrop-blur-[2px] rounded-xl cursor-pointer pointer-coarse:pointer-events-none"
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
                {!lowMotion && PARTICLES.map((_, i) => (
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
                        className="absolute w-1.5 h-1.5 bg-success rounded-full shadow-[0_0_8px_var(--success)]"
                    />
                ))}

                <motion.div
                    initial={lowMotion ? { scale: 1, rotate: 0 } : { scale: 0.95, rotate: -45, opacity: 0 }}
                    animate={{ scale: 1, rotate: 0, opacity: 1 }}
                    transition={lowMotion ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 20 }}
                    className="bg-success rounded-full p-4 shadow-[0_0_20px_color-mix(in_oklab,var(--success)_40%,transparent)] relative z-10"
                >
                    <Check className="h-8 w-8 text-success-foreground stroke-[3px]" />
                </motion.div>

                <motion.span
                    initial={lowMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={lowMotion ? { duration: 0 } : { delay: 0.1 }}
                    className="mt-3 text-overlay-foreground font-bold tracking-widest text-sm uppercase drop-shadow-lg"
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
    effectiveScale: "small" | "medium" | "large"
    booruProvider: BooruProvider
    isFavorited: boolean
    folders: FavoriteFolder[]
    currentFolderIds: string[]
    toggleFavorite: (id: number, provider?: string, folderId?: string | null, post?: BooruPost) => void
    createFolder: (name: string) => Promise<FavoriteFolder | null>
    isMergeMode: boolean
    isSelected: boolean
    selectedParts?: Set<TagCategory>
    onTogglePart?: (post: BooruPost, part: TagCategory) => void
    onMergeSelect: (post: BooruPost) => void
    /** Whether Pack Mode is currently active — shows the "Use as base" action. */
    isPackMode?: boolean
    /** Whether this card is the currently selected Pack Mode base card. */
    isPackBase?: boolean
    /** Set this post as the Pack Mode base card. */
    onSetAsPackBase?: (post: BooruPost) => void
    /** Outside Pack Mode only — activates it with this post as the base, no entry modal. */
    onMakePack?: (post: BooruPost) => void
    downloadImage: (post: BooruPost) => void
    copyToClipboard: (text: string, id: number, isPrompt: boolean, thumb?: string) => Promise<void>
    excludeInput: string
    addInput: string
    searchTags?: string
    /** Whether missing search-bar tags get auto-appended (see searchTags). Defaults to true. */
    autoAppendSearchTags?: boolean
    /** "Find" side of the Find & Replace list (comma-separated, paired by index with replaceInput). */
    findInput?: string
    /** "Replace" side of the Find & Replace list (comma-separated, paired by index with findInput). */
    replaceInput?: string
    /** Find & Append rules (applied after Find & Replace). */
    tagAppendRules?: TagAppendRule[]
    includeCharacters: boolean
    optimizeTags: boolean
    smartTagExclusion?: boolean
    prependAnimaArtist?: boolean
    removeLoRaTags: boolean
    removeQualityTags: boolean
    backgroundMode?: BackgroundMode
    simpleBackgroundReplacementTags?: string
    randomBackgroundPatterns?: boolean

    randomBackgroundIncludeGradients?: boolean
    detailedBackgroundsList?: string[][]
    /** How strictly Detailed Random gates its pick against the post's scene. */
    backgroundMatchStrictness?: MatchStrictness
    tagOverrides: Record<string, string>
    copiedId: number | null
    isPreviouslyCopied?: boolean
    onSkipAnimation?: () => void
    globalWeights?: Record<string, number>
    isGlobalWeightsEnabled?: boolean
    onGlobalWeightChange?: (tag: string, weight: number) => void
    onSearch?: (tag: string) => void
    onImageError?: () => void
    isNaturalLanguageMode?: boolean
    onSendToConvert?: (tags: string, imageUrl?: string, meta?: ConvertMeta) => void
    showCategoryTagBadges?: boolean
    /** Whether this card is currently expanded in place (reveals the full prompt
     *  inline, overlaying neighbours). */
    isExpanded?: boolean
    /** Toggle the in-place expansion for this post. */
    onToggleExpand?: (postId: number) => void
}


// Memoized MasonryItem to prevent unnecessary re-renders
export const MasonryItem = memo(function MasonryItem({
    post,
    tagCounts,
    width,
    height,
    index = 999,
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
    isPackMode = false,
    isPackBase = false,
    onSetAsPackBase,
    onMakePack,
    downloadImage,
    copyToClipboard,
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
    copiedId,
    isPreviouslyCopied,
    onSkipAnimation,
    globalWeights = {},
    isGlobalWeightsEnabled = false,
    onGlobalWeightChange,
    onSearch,
    onImageError,
    isNaturalLanguageMode = false,
    onSendToConvert,
    showCategoryTagBadges = true,
    isExpanded = false,
    onToggleExpand,
}: MasonryItemProps) {
    const lowMotion = useLowMotion()
    const posthog = usePostHog()

    // State to hold modified prompt from user interaction
    const [modifiedContent, setModifiedContent] = useState<string | null>(null)

    const [imageError, setImageError] = useState(false)
    const [retryKey, setRetryKey] = useState(0)
    const [useFallbackUrl, setUseFallbackUrl] = useState(false)
    const [imageGaveUp, setImageGaveUp] = useState(false)
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const retryCountRef = useRef(0)

    useEffect(() => {
        return () => { if (retryTimerRef.current) clearTimeout(retryTimerRef.current) }
    }, [])

    // While this card is expanded in place, allow Escape to collapse it.
    useEffect(() => {
        if (!isExpanded) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onToggleExpand?.(post.id)
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [isExpanded, onToggleExpand, post.id])

    const itemProvider = post._provider || booruProvider

    const handleToggleFavorite = (folderId: string | null | undefined) => {
        toggleFavorite(post.id, itemProvider, folderId, post)
    }

    const {
        isAiPost,
        aiPrompt,
        baseContent,
        displayContent,
        pureDisplayContent,
        characterTagsArray,
        totalTagsCount,
        tagCountIndicator,
        classifiedTags,
        richnessScore,
        hasActiveOptions,
        conflictingTags,
        hasReplacements,
        replacedTags,
    } = useCardPrompt({
        post,
        tagCounts,
        excludeInput,
        addInput,
        searchTags,
        autoAppendSearchTags,
        findInput,
        replaceInput,
        tagAppendRules,
        includeCharacters,
        optimizeTags,
        smartTagExclusion,
        prependAnimaArtist,
        removeLoRaTags,
        removeQualityTags,
        backgroundMode,
        simpleBackgroundReplacementTags,
        randomBackgroundPatterns,
        randomBackgroundIncludeGradients,
        detailedBackgroundsList,
        backgroundMatchStrictness,
        tagOverrides,
        globalWeights,
        isGlobalWeightsEnabled,
        onBaseContentChange: () => setModifiedContent(null),
    })

    // Authoritative identity metadata for the AI converter, taken straight from
    // the booru API (not guessed from the flattened prompt). Gated by
    // includeCharacters so an intentionally anonymized prompt doesn't get the
    // real character name re-injected on the LLM side.
    const buildConvertMeta = (): ConvertMeta | undefined => {
        if (!includeCharacters) return undefined
        const toList = (s?: string) =>
            (s || '').split(/\s+/).reduce<string[]>((acc, t) => {
                if (t) acc.push(t.replace(/_/g, ' '))
                return acc
            }, []).join(', ')
        const characters = toList(post.tag_string_character)
        const series = toList(post.tag_string_copyright)
        if (!characters && !series) return undefined
        return {
            characters: characters || undefined,
            series: series || undefined,
        }
    }

    const copyCategory = async (category: TagCategory) => {
        if (!pureDisplayContent) return
        const subset = classifiedTags[category]

        if (subset.length > 0) {
            posthog.capture('category_tags_copied', {
                category_name: category
            })
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

    // Danbooru image routing:
    // - CloudFront (getDanbooruCdnUrl) is the PRIMARY path when NEXT_PUBLIC_CDN_PROXY_URL
    //   is set. Direct cross-origin loads are blocked by donmai's WAF/CORP for ALL
    //   browsers, so there is no useful "direct" path once CloudFront is configured.
    // - When CloudFront is NOT set, fall back to the legacy direct-first strategy: try
    //   the raw CDN URL and, on 403, open a session circuit breaker that routes the rest
    //   of the session through the same-origin /api/download proxy.
    const isDanbooruImg = rawFileUrl && (rawFileUrl.includes('donmai.us') || rawFileUrl.includes('cdn.donmai.us'))
    const danbooruCdnUrl = isDanbooruImg ? getDanbooruCdnUrl(rawFileUrl!) : null

    const fileUrl = gelbooruNeedsProxy
        ? getGelbooruProxyUrl(rawFileUrl!)
        : (danbooruCdnUrl ?? rawFileUrl)

    // Circuit breaker only applies to the legacy direct-first path (no CloudFront).
    const danbooruCircuitOpen = isDanbooruImg && !danbooruCdnUrl && isDanbooruCircuitOpen()
    const proxyFileUrl = isDanbooruImg
      ? `/api/download?url=${encodeURIComponent(rawFileUrl!)}&inline=1`
      : undefined
    const displayFileUrl = danbooruCircuitOpen ? proxyFileUrl! : (useFallbackUrl && proxyFileUrl ? proxyFileUrl : fileUrl)

    const handleImageError = useCallback(() => {
        // Image failed → switch to the /api/download fallback once. On the legacy
        // direct-first path (no CloudFront) also open the session circuit so the rest
        // of the session skips the doomed direct attempt.
        if (isDanbooruImg && !danbooruCircuitOpen && !useFallbackUrl) {
            if (!danbooruCdnUrl) openDanbooruCircuit()
            setUseFallbackUrl(true)
            setImageError(false)
            return
        }
        setImageError(true)
        onImageError?.()
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
        if (retryCountRef.current >= MAX_IMAGE_RETRIES) {
            setImageGaveUp(true)
            return
        }
        const delay = IMAGE_RETRY_BASE_MS * 2 ** retryCountRef.current
        retryCountRef.current++
        retryTimerRef.current = setTimeout(() => {
            setImageError(false)
            setRetryKey(k => k + 1)
        }, delay)
    }, [onImageError, isDanbooruImg, danbooruCdnUrl, danbooruCircuitOpen, useFallbackUrl])

    // Provider is the source of truth for the link — content heuristics like
    // `isAiPost` (ai_metadata presence) must NOT override it. Aibooru posts
    // can carry ai_metadata, but so can posts on other boorus (e.g. Gelbooru
    // tagging AI-generated images), and previously `isAiPost` was checked
    // FIRST, unconditionally sending those posts to aibooru.com/<id> — a post
    // that only exists on Gelbooru/Rule34/etc. `isAiPost` is now only used as
    // a fallback for the truly ambiguous case (no explicit provider at all).
    const postUrl = getPostUrl(itemProvider, post.id, isAiPost)

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

    // hasActiveOptions now comes from useCardPrompt()

    // Grid is now the only card layout — list view was removed.
    const renderCard = () => {
        const footerHeight = SCALE_CONFIG[effectiveScale].footerHeight
        const imageHeight = height - footerHeight

        return (
            <div
                // Below `sm` the expanded card keeps its column width: widening by
                // 40px pushed left-column cards past the screen edge on phones.
                className={`group flex flex-col relative card-hover bg-card text-card-foreground border-0 rounded-xl ${isExpanded ? "overflow-visible shadow-2xl ring-2 ring-primary/40 z-30 max-sm:w-full! max-sm:ml-0!" : "overflow-hidden shadow-none"}`}
                style={{ width: isExpanded ? width + 40 : width, marginLeft: isExpanded ? -20 : 0 }}
            >
                <div
                    className="relative bg-muted overflow-hidden cursor-pointer"
                    style={{ height: imageHeight }}
                    onClick={() => { if (!isMergeMode) onToggleExpand?.(post.id) }}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    aria-label={isExpanded ? "Collapse prompt" : "Expand to see full prompt"}
                    onKeyDown={(e) => {
                        if ((e.key === "Enter" || e.key === " ") && !isMergeMode) {
                            e.preventDefault()
                            onToggleExpand?.(post.id)
                        }
                    }}
                >
                    {isPreviouslyCopied && (
                        <div className="absolute top-2 left-2 z-20 pointer-events-none" aria-label="Previously copied">
                            <motion.div
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                                className="flex items-center justify-center h-6 w-6 rounded-full bg-background/80 border border-success-border shadow-sm"
                            >
                                <Check className="w-3.5 h-3.5 text-success-text" strokeWidth={3} />
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
                                className={`absolute inset-0 z-20 flex flex-col justify-end p-2 transition-colors ${isSelected ? 'bg-overlay/20' : 'bg-transparent'}`}
                                onClick={(e) => e.stopPropagation()}
                            >
                                {/* Inline Selection Bar */}
                                <motion.div
                                    className="flex items-center justify-between w-full max-w-[220px] mx-auto bg-background/85 border border-border/40 shadow-2xl rounded-2xl p-1.5 gap-1.5 ring-1 ring-foreground/5"
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
                                        const activeColorClass = part === 'appearance' ? 'bg-cat-appearance text-cat-appearance-foreground shadow-cat-appearance/30' :
                                            part === 'pose' ? 'bg-cat-pose text-cat-pose-foreground shadow-cat-pose/30' :
                                                part === 'clothing' ? 'bg-cat-clothing text-cat-clothing-foreground shadow-cat-clothing/30' :
                                                    'bg-cat-scenery text-cat-scenery-foreground shadow-cat-scenery/30'

                                        const inactiveColorClass = part === 'appearance' ? 'hover:text-cat-appearance-text hover:bg-cat-appearance-soft' :
                                            part === 'pose' ? 'hover:text-cat-pose-text hover:bg-cat-pose-soft' :
                                                part === 'clothing' ? 'hover:text-cat-clothing-text hover:bg-cat-clothing-soft' :
                                                    'hover:text-cat-scenery-text hover:bg-cat-scenery-soft'

                                        return (
                                            <Tooltip key={part}>
                                                <TooltipTrigger asChild>
                                                    <span tabIndex={!hasTags ? -1 : 0} className="flex-1 flex max-w-[50px]">
                                                        <motion.button
                                                            disabled={!hasTags}
                                                            whileHover={hasTags && !lowMotion ? { scale: 1.1, y: -2 } : {}}
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
                                                                        ? `${activeColorClass} shadow-lg`
                                                                        : `text-muted-foreground hover:bg-foreground/10 hover:text-foreground`
                                                                }
                                                            `}
                                                        >
                                                            {isChecked && (
                                                                <motion.div
                                                                    layoutId={`active-bg-${part}-${post.id}`}
                                                                    className="absolute inset-0 rounded-xl bg-gradient-to-b from-overlay-foreground/20 to-transparent"
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
                    {/* ponytail: plain <img> — images.unoptimized is true globally, no Next.js optimization to lose.
                        Upgrade path: if server-side image resizing becomes needed, wrap in a custom component. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        key={retryKey}
                        src={displayFileUrl || ''}
                        alt={`${itemProvider} post ${post.id} - ${post.tag_string ? post.tag_string.slice(0, 150) : 'anime art'}`}
                        className="absolute inset-0 w-full h-full object-cover object-top"
                        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, (max-width: 1280px) 25vw, 20vw"
                        loading={index < 8 ? "eager" : "lazy"}
                        fetchPriority={index < 8 ? "high" : "low"}
                        decoding={index < 8 ? "sync" : "async"}
                        referrerPolicy={imageReferrerPolicy(itemProvider)}
                        onError={handleImageError}
                        onLoad={() => {
                            setImageError(false)
                            setImageGaveUp(false)
                            retryCountRef.current = 0
                        }}
                    />
                    {imageError && (
                        <div className="absolute inset-0 flex items-center justify-center bg-muted z-10">
                            {imageGaveUp ? (
                                <ImageOff className="w-6 h-6 text-muted-foreground" aria-label="Image unavailable" />
                            ) : (
                                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                            )}
                        </div>
                    )}

                    {/* Bottom-left: one static "prompt adjusted" dot. Smart Tag Exclusion
                        and Find & Replace used to be two separately animated badges; the
                        tooltip now carries the detail so the image stays clean. */}
                    {(hasActiveOptions || hasReplacements || SHOW_RICHNESS_BADGE) && (
                        <div className="absolute bottom-2 left-2 z-20 flex flex-col items-start gap-1">
                            {(hasActiveOptions || hasReplacements) && (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <span
                                            tabIndex={0}
                                            className="flex h-5 w-5 items-center justify-center rounded-full bg-overlay/60 shadow-sm cursor-help focus-ring"
                                            aria-label={[
                                                "Prompt adjusted",
                                                hasActiveOptions ? "Smart Tag Exclusion" : null,
                                                hasReplacements ? `Find & Replace: ${replacedTags.map(r => `${r.from} → ${r.to}`).join(', ')}` : null,
                                            ].filter(Boolean).join(". ")}
                                        >
                                            <span className="h-2 w-2 rounded-full bg-info" aria-hidden="true" />
                                        </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="text-xs">
                                        <div className="flex flex-col gap-0.5">
                                            <span className="font-medium">Prompt adjusted</span>
                                            {hasActiveOptions && <span className="text-muted-foreground">Smart Tag Exclusion</span>}
                                            {hasReplacements && replacedTags.map(r => (
                                                <span key={`${r.from}-${r.to}`} className="text-muted-foreground">
                                                    {r.from} → {r.to}
                                                </span>
                                            ))}
                                        </div>
                                    </TooltipContent>
                                </Tooltip>
                            )}
                            {/* Richness Score Indicator: category coverage (clothing/pose/scenery/appearance) */}
                            {SHOW_RICHNESS_BADGE && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div
                                        className={`px-1.5 py-0.5 dark rounded-md bg-overlay/60 text-xs font-medium tracking-wide flex items-center gap-1 shadow-sm cursor-help pointer-events-auto ${richnessScore.score >= 8
                                            ? "text-success-text"
                                            : richnessScore.score <= 3
                                                ? "text-destructive-text"
                                                : "text-warning-text"
                                            }`}
                                        aria-label={`Richness score: ${richnessScore.score.toFixed(1)} of ${richnessScore.maxScore}`}
                                    >
                                        <Sparkles className="w-3.5 h-3.5" />
                                        {richnessScore.score.toFixed(1)}/{richnessScore.maxScore}
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs">
                                    <div className="flex flex-col gap-0.5">
                                        <span className="font-medium mb-0.5">Richness: {richnessScore.score.toFixed(1)}/{richnessScore.maxScore}</span>
                                        {RICHNESS_AXES.map((axis) => (
                                            <span key={axis} className={RICHNESS_DEPTH_CLASS[richnessScore.breakdown[axis]]}>
                                                {RICHNESS_DEPTH_LABEL[richnessScore.breakdown[axis]]} {TAG_CATEGORIES[axis].label}
                                            </span>
                                        ))}
                                    </div>
                                </TooltipContent>
                            </Tooltip>
                            )}
                        </div>
                    )}

                    {/* Bottom-right: a single tag-count chip. The per-category counts and the
                        character post count live in its tooltip instead of four colored chips
                        plus a separate "1K" chip competing with the artwork. */}
                    {totalTagsCount > 0 && (
                        // Hidden on phones while expanded: the centered "Collapse"
                        // pill overlaps it on a narrow card.
                        <div className={`absolute bottom-2 right-2 z-10 ${isExpanded ? "max-sm:hidden" : ""}`}>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <span
                                        tabIndex={0}
                                        className="px-1.5 py-0.5 rounded-md bg-overlay/60 text-overlay-foreground/90 text-xs font-medium tabular-nums flex items-center gap-1 shadow-sm cursor-help focus-ring"
                                        aria-label={`${totalTagsCount} tags`}
                                    >
                                        <Tag className="w-3.5 h-3.5 opacity-70" aria-hidden="true" />
                                        {totalTagsCount}
                                    </span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs">
                                    <div className="flex flex-col gap-1 min-w-[8.5rem]">
                                        <span className="font-medium">{totalTagsCount} tags</span>
                                        {showCategoryTagBadges && (
                                            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-1.5 gap-y-0.5">
                                                {CATEGORY_BREAKDOWN.map(({ key, label, Icon, className }) => (
                                                    <Fragment key={key}>
                                                        <Icon className={`w-3 h-3 ${className}`} aria-hidden="true" />
                                                        <span className="text-muted-foreground">{label}</span>
                                                        <span className="tabular-nums text-right">{classifiedTags[key].length}</span>
                                                    </Fragment>
                                                ))}
                                            </div>
                                        )}
                                        {tagCountIndicator && includeCharacters && (
                                            <span className="flex items-center gap-1.5 border-t border-border pt-1 text-muted-foreground">
                                                <Users className="w-3 h-3" aria-hidden="true" />
                                                Character posts: <span className="text-popover-foreground tabular-nums">{tagCountIndicator}</span>
                                            </span>
                                        )}
                                    </div>
                                </TooltipContent>
                            </Tooltip>
                        </div>
                    )}

                    {/* Overlay actions: favorite stays one tap away; everything else lives
                        behind "⋯". Stays visible while either popover/menu is open. */}
                    <div
                        className="absolute top-2 right-2 flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 group-focus-within:opacity-100 sm:has-[[data-state=open]]:opacity-100 transition-opacity"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <SaveFavoriteButton
                            folders={folders}
                            selectedFolderIds={currentFolderIds}
                            isFavorited={isFavorited}
                            onToggleFavorite={handleToggleFavorite}
                            onCreateFolder={createFolder}
                        />
                        <CardActionsMenu
                            post={post}
                            booruProvider={itemProvider}
                            postUrl={postUrl}
                            size={effectiveScale === "small" ? "sm" : "md"}
                            onConvert={() => onSendToConvert?.(modifiedContent ?? displayContent, post.large_file_url, buildConvertMeta())}
                            onDownload={() => downloadImage(post)}
                            onOpenOriginal={() => trackExternalLink(postUrl, 'post')}
                            onMakePack={!isPackMode && onMakePack ? () => onMakePack(post) : undefined}
                        />
                    </div>

                    {/* Expand / collapse affordance — makes the click-to-expand
                        discoverable. Pointer-events-none so the click falls through
                        to the image container's toggle handler. */}
                    {!isMergeMode && (
                        <div className="absolute inset-x-0 bottom-2 flex justify-center pointer-events-none z-10">
                            <div className={`flex items-center gap-1 rounded-full bg-overlay/65 text-overlay-foreground/95 px-2 py-0.5 text-[10px] font-medium shadow-sm backdrop-blur-sm transition-opacity duration-200 ${isExpanded ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}`}>
                                <ChevronDown className={`w-3 h-3 transition-transform duration-300 ${isExpanded ? "rotate-180" : ""}`} />
                                {isExpanded ? "Collapse" : "Full prompt"}
                            </div>
                        </div>
                    )}
                </div>

                <motion.div
                    className={`${getCardContentClass()} flex flex-col overflow-hidden`}
                    initial={false}
                    animate={{ height: isExpanded ? "auto" : footerHeight }}
                    transition={lowMotion ? { duration: 0 } : { type: "tween", duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
                >
                    {/* Touch screens get no inner scroll at all: session replays showed
                        users trying to scroll the page and moving this box instead.
                        Collapsed it clips with a fade (tap the image for the full
                        prompt); expanded it grows to its full height so the page
                        scroll does the work. */}
                    <div
                        className={`bg-muted/50 rounded-lg overflow-y-auto pointer-coarse:overflow-hidden prompt-container min-h-0 ${isExpanded
                            // `!` so it beats the inline 65vh cap below.
                            ? "pointer-coarse:max-h-none!"
                            // Collapsed: a scrollbar in a 3-line box is just noise. Still
                            // wheel-scrollable; "Full prompt" is the real way to read it all.
                            : "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden pointer-coarse:[mask-image:linear-gradient(to_bottom,black_65%,transparent)]"}`}
                        style={isExpanded ? { maxHeight: "65vh" } : undefined}
                    >
                        <InteractivePrompt
                            initialPrompt={displayContent}
                            onUpdate={setModifiedContent}
                            onPromoteToGlobal={isGlobalWeightsEnabled ? onGlobalWeightChange : undefined}
                            globalWeights={isGlobalWeightsEnabled ? globalWeights : {}}
                            onSearch={onSearch}
                              conflictingTags={conflictingTags}
                        />
                    </div>

                    <div className="flex button-group items-stretch isolate shrink-0" {...(index === 0 ? { 'data-tour': 'copy-options' } : {})}>
                        {isPackMode ? (
                            <Button
                                onClick={() => onSetAsPackBase?.(post)}
                                className={`flex-1 focus-ring h-auto rounded-r-none border-r-0 border-mode-pack text-mode-pack-text ${isPackBase ? "" : "hover:bg-mode-pack-soft"}`}
                                variant={isPackBase ? "secondary" : "outline"}
                                aria-label={isPackBase ? "Pack Mode base card" : "Use as base for Pack Mode"}
                            >
                                <Package className={`${getIconClass()} mr-1.5`} />
                                {isPackBase ? "Base ✓" : "Use as Base"}
                            </Button>
                        ) : isNaturalLanguageMode ? (
                            <Button
                                onClick={() => onSendToConvert?.(modifiedContent ?? displayContent, post.large_file_url, buildConvertMeta())}
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
                                variant={copiedId === post.id ? "default" : "secondary"}
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

                        <CopyOptionsDropdown
                            classifiedTags={classifiedTags}
                            onCopyCategory={copyCategory}
                            disabled={!displayContent}
                            contentClassName="z-[10005]"
                            trigger={
                                <Button
                                    // Matches the primary half of the split button so both read as one control.
                                    variant={isPackMode ? "outline" : (isNaturalLanguageMode || copiedId === post.id ? "default" : "secondary")}
                                    className={`px-2 pointer-coarse:min-w-11 focus-ring h-auto rounded-l-none ${isPackMode ? "" : "border-l border-foreground/10"}`}
                                    disabled={!displayContent}
                                    aria-label="Copy options"
                                >
                                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                                </Button>
                            }
                        />
                    </div>
                </motion.div>
                <AnimatePresence>
                    {copiedId === post.id && <SuccessOverlay onSkip={onSkipAnimation} />}
                </AnimatePresence>
            </div>
        )
    }

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
    if (prev.effectiveScale !== next.effectiveScale) return false
    if (prev.booruProvider !== next.booruProvider) return false
    if (prev.isFavorited !== next.isFavorited) return false
    if (prev.isMergeMode !== next.isMergeMode) return false
    if (prev.isSelected !== next.isSelected) return false
    if (prev.isPackMode !== next.isPackMode) return false
    if (prev.isPackBase !== next.isPackBase) return false
    if (prev.excludeInput !== next.excludeInput) return false
    if (prev.addInput !== next.addInput) return false
    if (prev.searchTags !== next.searchTags) return false
    if (prev.autoAppendSearchTags !== next.autoAppendSearchTags) return false
    if (prev.findInput !== next.findInput) return false
    if (prev.replaceInput !== next.replaceInput) return false
    if (prev.tagAppendRules !== next.tagAppendRules) return false
    if (prev.includeCharacters !== next.includeCharacters) return false
    if (prev.optimizeTags !== next.optimizeTags) return false
    if (prev.smartTagExclusion !== next.smartTagExclusion) return false
    if (prev.prependAnimaArtist !== next.prependAnimaArtist) return false
    if (prev.removeLoRaTags !== next.removeLoRaTags) return false
    if (prev.removeQualityTags !== next.removeQualityTags) return false
    if (prev.backgroundMode !== next.backgroundMode) return false
    if (prev.simpleBackgroundReplacementTags !== next.simpleBackgroundReplacementTags) return false
    if (prev.randomBackgroundPatterns !== next.randomBackgroundPatterns) return false
    if (prev.randomBackgroundIncludeGradients !== next.randomBackgroundIncludeGradients) return false
    if (prev.detailedBackgroundsList !== next.detailedBackgroundsList) return false
    if (prev.backgroundMatchStrictness !== next.backgroundMatchStrictness) return false
    if (prev.isGlobalWeightsEnabled !== next.isGlobalWeightsEnabled) return false
    if (prev.isPreviouslyCopied !== next.isPreviouslyCopied) return false
    if (prev.showCategoryTagBadges !== next.showCategoryTagBadges) return false
    if (prev.isExpanded !== next.isExpanded) return false

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

    // tagCounts gets a new reference whenever a page loads, but the card only
    // reads the counts of its own character tags (tag count indicator), so
    // compare just those instead of re-rendering every card on each page load.
    if (prev.tagCounts !== next.tagCounts && next.post.tag_string_character) {
        for (const rawTag of next.post.tag_string_character.split(' ')) {
            if (!rawTag) continue
            // Same keys useCardPrompt's tagCountIndicator looks up
            const tag = rawTag.toLowerCase()
            const spaced = tag.replace(/_/g, ' ')
            if (prev.tagCounts?.[tag] !== next.tagCounts?.[tag]) return false
            if (prev.tagCounts?.[spaced] !== next.tagCounts?.[spaced]) return false
        }
    }

    const postTags = next.post.tag_string.split(' ')
    for (const tag of postTags) {
        if (prev.tagOverrides[tag] !== next.tagOverrides[tag]) return false
        if (next.isGlobalWeightsEnabled && (prev.globalWeights?.[tag] !== next.globalWeights?.[tag])) return false
    }

    return true
}






