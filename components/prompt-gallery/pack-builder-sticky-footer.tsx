import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Check, Package, Shuffle, Copy, CopyCheck, X, Dices, Pencil, Loader2, RefreshCw, AlertTriangle, Database, HelpCircle } from "lucide-react"
import { BooruPost } from '@/lib/booru/types'
import { TagCategory } from '@/lib/tag-classifier'
import { MAX_PACK_PROMPTS, PACK_AXES, type PackPrompt, type AxisTagMode, type SlotGroup } from '@/lib/pack/pack-generator'
import { splitCommaSeparatedTags } from '@/lib/utils/tag-utils'
import { motion, AnimatePresence } from 'framer-motion'
import { useLowMotion } from '@/hooks/use-low-motion'
import { useCopyFeedback } from '@/hooks/use-copy-feedback'
import { toast } from '@/hooks/use-toast'
import { ToastAction } from '@/components/ui/toast'
import Image from 'next/image'
import { getDanbooruProxyUrl } from "@/lib/proxy-url"
import { MAX_MIN_TOTAL_TAGS, type PackCategoryState, type PackSlotState } from '@/hooks/use-pack-mode'
import { summarizePackSourceAnswers, type PackSourceAnswers } from './pack-source-modal'
import { PackVarietySlider } from './pack-variety-slider'
import { PackCategoryList, PackStepper } from './pack-category-list'
import { TagAutocompleteTextarea } from './tag-autocomplete-textarea'
import { PackBuilderTour, findPackTourTargets, PACK_TOUR_STORAGE_KEY } from './pack-builder-tour'
import type { VarietyLevel, VarietySetting } from '@/lib/pack/variety-presets'

export interface PackBuilderStickyFooterProps {
    isOpen: boolean
    baseCard: BooruPost | null
    /** Free-text pasted-prompt base — mutually exclusive with baseCard. */
    basePrompt: string
    /** Reopens the entry modal directly on the prompt-editing view. */
    onEditBasePrompt: () => void
    /** True once a base (card or pasted prompt) exists. Lets the builder
     *  Dialog open, while the hint bar shows until one is picked. */
    hasSetupAnswers: boolean
    /** Current "source of variations" answers (rating/tags/provider), summarized
     *  on the header chip; clicking it reopens the source modal. */
    sourceAnswers: PackSourceAnswers
    onOpenSource: () => void
    categoryStates: Record<TagCategory, PackCategoryState>
    onSetCategoryState: (category: TagCategory, state: PackCategoryState) => void
    slotStateOf: (slot: string) => PackSlotState
    onSetSlotState: (slot: string, state: PackSlotState) => void
    excludedBaseTags: Set<string>
    onToggleExcludedBaseTag: (tag: string) => void
    onRestoreExcludedBaseTags: (category?: TagCategory) => void
    axisSlotGroups: Partial<Record<TagCategory, SlotGroup[]>>
    axisSlotCounts: Partial<Record<TagCategory, Record<string, number>>>
    axisMaxPerPrompt: Partial<Record<TagCategory, number>>
    tagOverrides: Record<string, string>
    baseClassified: Record<TagCategory, string[]>
    lockedTags: string[]
    /** True when the base lists more than one character (only the first stays locked). */
    hasMultipleCharacters: boolean
    axisTagModes?: Partial<Record<TagCategory, AxisTagMode>>
    onSetAxisTagMode?: (category: TagCategory, mode: AxisTagMode) => void
    onSetAllAxisTagModes?: (mode: AxisTagMode) => void
    axisValues: Partial<Record<TagCategory, string[]>>
    onAddAxisValue: (category: TagCategory, value: string) => void
    onRemoveAxisValue: (category: TagCategory, value: string) => void
    onReseedAxis: (category: TagCategory) => void
    axisMinCounts: Partial<Record<TagCategory, number>>
    onSetAxisMinCount: (category: TagCategory, count: number) => void
    customBaseText: string
    onCustomBaseTextChange: (text: string) => void
    /** Variety slider (§5). */
    varietyLevel: VarietySetting
    onVarietyLevelChange: (level: VarietyLevel) => void
    minTotalTags: number
    onMinTotalTagsChange: (count: number) => void
    minSetTags: Partial<Record<TagCategory, number>>
    onSetMinSetTags: (category: TagCategory, count: number) => void
    hiddenThinSets: Partial<Record<TagCategory, number>>
    estimatedTagsPerPrompt: number
    isSeeding?: boolean
    seedProgress?: { current: number; target: number } | null
    loadedPostCount: number
    /** Posts reused from earlier sessions for this source (lib/pack/pool-cache.ts). */
    savedPostCount?: number
    onClearSavedPosts?: () => void
    canLoadMorePosts: boolean
    onLoadMorePosts: () => void
    promptCount: number
    setPromptCount: (count: number) => void
    onRegenerate: () => void
    /** Re-rolls one generated prompt in place (§6). Returns false if no candidate was found. */
    onRerollPrompt: (index: number) => boolean
    onClearBase: () => void
    onExit: () => void
    prompts: PackPrompt[]
    onCopyPrompt: (prompt: PackPrompt) => void
    onCopyAll: (text: string) => void
    onResetLearning?: () => void
    children?: React.ReactNode
}

/** Bare lowercase tag text of one prompt token (weights/brackets stripped). */
function bareTag(token: string): string {
    return token
        .trim()
        .replace(/^[([{<]+/, '')
        .replace(/[)\]}>]+$/, '')
        .replace(/:\s*-?\d+(\.\d+)?$/, '')
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/_/g, ' ')
        .trim()
}

/** A single generated prompt row: text + re-roll + a per-item copy button with its own "Copied!" feedback. */
const PromptRow = memo(({
    prompt,
    index,
    onCopy,
    onReroll,
    lockedSet,
    variedSet,
}: {
    prompt: PackPrompt
    index: number
    onCopy: (prompt: PackPrompt) => void
    onReroll: (index: number) => void
    lockedSet: ReadonlySet<string>
    variedSet: ReadonlySet<string>
}) => {
    const tokens = useMemo(() => prompt.prompt.split(',').map((t) => t.trim()).filter(Boolean), [prompt.prompt])
    const [isCopied, triggerCopyFeedback] = useCopyFeedback()
    const lowMotion = useLowMotion()

    const handleCopy = () => {
        onCopy(prompt)
        triggerCopyFeedback()
    }

    return (
        <motion.div
            layout={!lowMotion}
            initial={lowMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={lowMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={lowMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={lowMotion ? { duration: 0.15 } : { type: "spring", stiffness: 400, damping: 30 }}
            className="group flex items-start gap-2.5 rounded-lg border border-border/50 bg-background hover:border-border transition-colors p-2.5"
        >
            <div className="flex flex-col items-center gap-1 mt-0.5 min-w-[1.75rem]">
                <span className="text-[10px] font-mono font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded w-full text-center">
                    {String(index + 1).padStart(2, '0')}
                </span>
                <span className="text-[9px] text-muted-foreground/70 tabular-nums" title="Tags in this prompt">{tokens.length}</span>
            </div>
            <p className="flex-1 text-xs lg:text-[13px] leading-relaxed font-mono break-words select-all">
                {tokens.map((token, i) => {
                    const bare = bareTag(token)
                    const tone = lockedSet.has(bare)
                        ? 'text-muted-foreground'
                        : variedSet.has(bare)
                            ? 'text-foreground font-semibold'
                            : 'text-muted-foreground/70'
                    return (
                        <span key={`${i}-${token}`}>
                            <span className={tone}>{token}</span>
                            {i < tokens.length - 1 && <span className="text-muted-foreground/50">, </span>}
                        </span>
                    )
                })}
            </p>
            <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onReroll(index)}
                className="h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted"
                aria-label={`Re-roll prompt ${index + 1}`}
                title="Re-roll this prompt"
            >
                <Dices className="w-3.5 h-3.5" />
            </Button>
            <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleCopy}
                className={`h-7 w-7 flex-shrink-0 transition-colors ${isCopied ? 'text-success-text bg-success-soft' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                aria-label={`Copy prompt ${index + 1}`}
            >
                {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </Button>
        </motion.div>
    )
})
PromptRow.displayName = "PromptRow"

/** Results list: generated prompts with per-item copy/reroll + a "Copy all" action. */
const PackResultsList = memo(({
    prompts,
    onCopyPrompt,
    onCopyAll,
    onReroll,
    lockedSet,
    variedSet,
    isCollecting,
    minTotalTags,
}: {
    prompts: PackPrompt[]
    onCopyPrompt: (prompt: PackPrompt) => void
    onCopyAll: (text: string) => void
    onReroll: (index: number) => void
    lockedSet: ReadonlySet<string>
    variedSet: ReadonlySet<string>
    isCollecting: boolean
    minTotalTags: number
}) => {
    const shortCount = minTotalTags > 0
        ? prompts.filter((p) => p.prompt.split(',').filter((t) => t.trim()).length < minTotalTags).length
        : 0
    const [isAllCopied, triggerCopyAllFeedback] = useCopyFeedback()

    const handleCopyAll = () => {
        if (prompts.length === 0) return
        onCopyAll(prompts.map((p) => p.prompt).join('\n'))
        triggerCopyAllFeedback()
    }

    return (
        <div id="pack-results-section" className="flex flex-col gap-3 min-h-0 lg:flex-1">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-border/40 flex-shrink-0">
                <div className="flex items-center gap-x-2 gap-y-1 flex-wrap min-w-0">
                    <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                        Prompts
                    </span>
                    {prompts.length > 0 && (
                        <span className="text-[10px] font-semibold bg-muted text-foreground px-2 py-0.5 rounded-full tabular-nums">
                            {prompts.length}
                        </span>
                    )}
                    {prompts.length > 0 && (
                        <span className="text-[11px] text-muted-foreground">
                            <span className="font-semibold text-foreground">bold</span> = varied · grey = from base
                        </span>
                    )}
                </div>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCopyAll}
                    disabled={prompts.length === 0}
                    className={`h-7 text-xs flex-shrink-0 transition-colors ${isAllCopied ? 'bg-success-soft text-success-text border-success-border' : ''}`}
                >
                    {isAllCopied ? <CopyCheck className="w-3.5 h-3.5 mr-1.5" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
                    {isAllCopied ? 'Copied all!' : 'Copy all'}
                </Button>
            </div>

            {shortCount > 0 && (
                <p className="flex items-start gap-1.5 text-[11px] text-warning-text flex-shrink-0">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                    {shortCount} of {prompts.length} came out under {minTotalTags} tags — conflicting or excluded tags were cleaned out.
                    Set more categories to Vary, raise their per-prompt count, or collect more posts.
                </p>
            )}

            {prompts.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-10 lg:flex-1 text-center rounded-lg border border-dashed border-border/60">
                    {isCollecting ? (
                        <>
                            <Loader2 className="w-6 h-6 text-muted-foreground/60 animate-spin" />
                            <p className="text-xs text-muted-foreground max-w-xs">
                                Collecting posts to sample from. You can set up the categories meanwhile, or generate now with what&apos;s already in.
                            </p>
                        </>
                    ) : (
                        <>
                            <Shuffle className="w-6 h-6 text-muted-foreground/40" />
                            <p className="text-xs text-muted-foreground max-w-xs">
                                Choose what to keep and what to vary, then press <span className="font-semibold text-foreground">Generate</span>.
                            </p>
                        </>
                    )}
                </div>
            ) : (
                <div className="flex flex-col gap-2 max-h-[28rem] lg:max-h-none lg:flex-1 lg:min-h-0 overflow-y-auto pr-1">
                    <AnimatePresence mode="popLayout">
                        {prompts.map((p, i) => (
                            <PromptRow
                                key={`${i}-${p.prompt}`}
                                prompt={p}
                                index={i}
                                onCopy={onCopyPrompt}
                                onReroll={onReroll}
                                lockedSet={lockedSet}
                                variedSet={variedSet}
                            />
                        ))}
                    </AnimatePresence>
                </div>
            )}
        </div>
    )
})
PackResultsList.displayName = "PackResultsList"

/** Header block showing where variations come from and whether posts are still arriving. */
function CollectionStatus({
    sourceAnswers,
    onOpenSource,
    isCollecting,
    seedProgress,
    loadedPostCount,
    savedPostCount,
    onClearSavedPosts,
    poolSize,
    canLoadMorePosts,
    onLoadMorePosts,
}: {
    sourceAnswers: PackSourceAnswers
    onOpenSource: () => void
    isCollecting: boolean
    seedProgress: { current: number; target: number } | null
    loadedPostCount: number
    savedPostCount: number
    onClearSavedPosts?: () => void
    poolSize: number
    canLoadMorePosts: boolean
    onLoadMorePosts: () => void
}) {
    const noPosts = !isCollecting && loadedPostCount === 0
    return (
        <div className="flex items-center gap-2 flex-wrap min-w-0" data-pack-tour="source">
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        onClick={onOpenSource}
                        className="h-8 px-2.5 rounded-lg border border-border/60 bg-muted/40 hover:bg-muted text-xs font-medium text-foreground/90 transition-colors inline-flex items-center gap-1.5 max-w-[16rem]"
                    >
                        <Database className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="truncate">{summarizePackSourceAnswers(sourceAnswers)}</span>
                        {sourceAnswers.searchTags.trim() && (
                            <span className="truncate text-muted-foreground font-mono">· {sourceAnswers.searchTags}</span>
                        )}
                    </button>
                </TooltipTrigger>
                <TooltipContent>Where the varied tags are sampled from — click to change</TooltipContent>
            </Tooltip>

            <div className="inline-flex items-center gap-2 h-8 px-2.5 rounded-lg text-xs tabular-nums" aria-live="polite">
                {isCollecting ? (
                    <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-mode-pack-text" />
                        <span className="font-medium text-foreground">
                            {savedPostCount > 0 ? 'Adding new posts' : 'Collecting posts'}
                            {seedProgress ? ` ${seedProgress.current} / ${seedProgress.target}` : '…'}
                        </span>
                        {loadedPostCount > 0 && <span className="text-muted-foreground">· {loadedPostCount} in pool · {poolSize} tags</span>}
                    </>
                ) : noPosts ? (
                    <>
                        <AlertTriangle className="w-3.5 h-3.5 text-warning-text" />
                        <span className="text-warning-text">No posts found for this source</span>
                    </>
                ) : (
                    <>
                        <span className="w-2 h-2 rounded-full bg-success" />
                        <span className="font-medium text-foreground">{loadedPostCount} posts</span>
                        <span className="text-muted-foreground">· {poolSize} tags to vary</span>
                    </>
                )}
                {savedPostCount > 0 && !noPosts && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground cursor-default">
                                <Database className="w-3 h-3" />
                                {savedPostCount} saved
                            </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                            Posts kept from earlier sessions for this source, so Pack Mode opens instantly. Each session adds a few new ones.
                        </TooltipContent>
                    </Tooltip>
                )}
            </div>

            {!isCollecting && canLoadMorePosts && loadedPostCount > 0 && (
                <Button type="button" variant="ghost" size="sm" onClick={onLoadMorePosts} className="h-8 px-2 text-xs text-mode-pack-text hover:bg-mode-pack-soft">
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                    Collect more
                </Button>
            )}
            {!isCollecting && savedPostCount > 0 && onClearSavedPosts && (
                <Button type="button" variant="ghost" size="sm" onClick={onClearSavedPosts} className="h-8 px-2 text-xs text-muted-foreground">
                    Forget saved
                </Button>
            )}
        </div>
    )
}

const PackBuilderStickyFooterComponent = ({
    isOpen,
    baseCard,
    basePrompt,
    onEditBasePrompt,
    hasSetupAnswers,
    sourceAnswers,
    onOpenSource,
    categoryStates,
    onSetCategoryState,
    slotStateOf,
    onSetSlotState,
    excludedBaseTags,
    onToggleExcludedBaseTag,
    onRestoreExcludedBaseTags,
    axisSlotGroups,
    axisSlotCounts,
    axisMaxPerPrompt,
    tagOverrides,
    baseClassified,
    lockedTags,
    hasMultipleCharacters,
    axisTagModes = {},
    onSetAxisTagMode,
    onSetAllAxisTagModes,
    axisValues,
    onAddAxisValue,
    onRemoveAxisValue,
    onReseedAxis,
    axisMinCounts,
    onSetAxisMinCount,
    customBaseText,
    onCustomBaseTextChange,
    varietyLevel,
    onVarietyLevelChange,
    minTotalTags,
    onMinTotalTagsChange,
    estimatedTagsPerPrompt,
    minSetTags,
    onSetMinSetTags,
    hiddenThinSets,
    isSeeding = false,
    seedProgress = null,
    loadedPostCount,
    savedPostCount = 0,
    onClearSavedPosts,
    canLoadMorePosts,
    onLoadMorePosts,
    promptCount,
    setPromptCount,
    onRegenerate,
    onRerollPrompt,
    onClearBase,
    onExit,
    prompts,
    onCopyPrompt,
    onCopyAll,
    onResetLearning,
    children,
}: PackBuilderStickyFooterProps) => {

    const lowMotion = useLowMotion()

    // Generate gives no visible feedback on its own — confirm on the button
    // itself and scroll the results into view so the change is unmistakable.
    const [justGenerated, setJustGenerated] = useState(false)
    const handleGenerateClick = useCallback(() => {
        onRegenerate()
        setJustGenerated(true)
        setTimeout(() => setJustGenerated(false), 1200)
        document.getElementById('pack-results-section')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, [onRegenerate])

    const handleReroll = useCallback((index: number) => {
        const ok = onRerollPrompt(index)
        if (!ok) {
            toast({
                title: "No new variations",
                description: "Collect more posts or raise Variety to get a fresh option here.",
                action: (
                    <ToastAction altText="Collect more posts" onClick={onLoadMorePosts}>
                        Collect more
                    </ToastAction>
                ),
            })
        }
    }, [onRerollPrompt, onLoadMorePosts])

    // Live display value while dragging the "Prompts" count slider, decoupled
    // from the committed promptCount prop — onValueChange fires every
    // pointer-move frame during a drag, and wiring that straight to
    // setPromptCount re-triggers Pack Mode's generatedPrompts recompute
    // dozens of times a second. Commit only on release. Synced during render
    // (not via useEffect), same pattern used elsewhere in this file.
    const [livePromptCount, setLivePromptCount] = useState(promptCount)
    const [prevPromptCount, setPrevPromptCount] = useState(promptCount)
    if (promptCount !== prevPromptCount) {
        setPrevPromptCount(promptCount)
        setLivePromptCount(promptCount)
    }

    const baseThumb = baseCard ? (() => {
        const rawUrl = baseCard.preview_file_url || baseCard.file_url
        const provider = baseCard._provider || 'danbooru'
        if (provider === 'danbooru' && rawUrl) return getDanbooruProxyUrl(rawUrl)
        return rawUrl
    })() : null

    // Result highlighting: base tags muted, varied tags bold.
    const lockedSet = useMemo(() => new Set(lockedTags.map(bareTag)), [lockedTags])
    const variedSet = useMemo(() => {
        const set = new Set<string>()
        PACK_AXES.forEach((cat) => {
            axisValues[cat]?.forEach((value) => {
                const parts = value.includes(',') ? splitCommaSeparatedTags(value) : [value]
                parts.forEach((tag) => set.add(bareTag(tag)))
            })
        })
        return set
    }, [axisValues])

    const poolSize = useMemo(
        () => PACK_AXES.reduce((sum, cat) => sum + (categoryStates[cat] === 'vary' ? axisValues[cat]?.length ?? 0 : 0), 0),
        [axisValues, categoryStates]
    )

    // Still connecting (nothing reported yet) counts as collecting too — the
    // first page can take a moment and the builder shouldn't look idle meanwhile.
    const isCollecting = isSeeding || (loadedPostCount === 0 && canLoadMorePosts)
    const progress = seedProgress ? Math.min(1, seedProgress.current / Math.max(1, seedProgress.target)) : null
    const nothingVaries = PACK_AXES.every((cat) => categoryStates[cat] !== 'vary')

    // Guided tour (pack-builder-tour.tsx): auto-starts the first time the builder
    // opens, replayable from "How it works". null = not running.
    const contentRef = useRef<HTMLDivElement>(null)
    const [tourTargets, setTourTargets] = useState<string[] | null>(null)
    const startTour = useCallback(() => setTourTargets(findPackTourTargets(contentRef.current)), [])
    const builderOpen = isOpen && hasSetupAnswers
    useEffect(() => {
        if (!builderOpen) return
        try {
            if (localStorage.getItem(PACK_TOUR_STORAGE_KEY) === '1') return
        } catch {
            return
        }
        // Let the dialog and the first pools render so every target exists.
        const timer = setTimeout(() => {
            try {
                localStorage.setItem(PACK_TOUR_STORAGE_KEY, '1')
            } catch {}
            startTour()
        }, 900)
        return () => clearTimeout(timer)
    }, [builderOpen, startTour])

    // Closing the dialog (X, Escape, or backdrop click) clears the base —
    // Pack Mode itself stays active so "Use as base" is still available.
    const handleDialogOpenChange = useCallback((open: boolean) => {
        if (!open) onClearBase()
    }, [onClearBase])

    return (
        <>
            {/* Instructional hint while Pack Mode is on but no base is picked yet — the
                builder dialog below opens once a base (card or pasted prompt) exists. */}
            <AnimatePresence>
                {isOpen && !hasSetupAnswers && (
                    <motion.div
                        key="pack-hint"
                        initial={lowMotion ? { opacity: 0 } : { y: 80, opacity: 0 }}
                        animate={lowMotion ? { opacity: 1 } : { y: 0, opacity: 1 }}
                        exit={lowMotion ? { opacity: 0 } : { y: 80, opacity: 0 }}
                        transition={lowMotion ? { duration: 0.15 } : { type: "spring", stiffness: 220, damping: 26 }}
                        className="fixed bottom-6 left-0 right-0 mx-auto z-50 w-[95%] max-w-lg rounded-2xl border shadow-2xl bg-background/95 backdrop-blur-xl p-4 flex items-center gap-3"
                    >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <Package className="w-5 h-5 text-mode-pack-text flex-shrink-0" />
                            <p className="text-sm text-muted-foreground min-w-0">
                                Hover a card and click <span className="font-medium text-foreground">&quot;Use as base&quot;</span> to build a pack.
                            </p>
                        </div>
                        <Button variant="ghost" size="icon" onClick={onExit} className="h-8 w-8 rounded-full hover:bg-muted flex-shrink-0" aria-label="Exit pack mode">
                            <X className="w-4 h-4" />
                        </Button>
                    </motion.div>
                )}
            </AnimatePresence>

            <Dialog open={isOpen && hasSetupAnswers} onOpenChange={handleDialogOpenChange}>
                <DialogContent
                    ref={contentRef}
                    // Pack Mode is a primary workspace, not a quick popup: take (almost) the whole
                    // viewport — full-bleed on phones, a 1rem margin on larger screens.
                    className="w-screen h-dvh max-w-none sm:w-[calc(100vw-2rem)] sm:h-[calc(100dvh-2rem)] sm:max-w-[1680px] sm:rounded-2xl p-0 gap-0 flex flex-col overflow-hidden"
                    onEscapeKeyDown={onExit}
                >
                    <DialogTitle className="sr-only">Pack Builder</DialogTitle>

                    {/* Header — title, where variations come from, live collection status. */}
                    <div className="relative flex items-center justify-between gap-x-4 gap-y-2 flex-wrap px-4 py-3 sm:px-6 pr-12 sm:pr-14 border-b border-border/60 flex-shrink-0 bg-background">
                        <div className="flex items-center gap-3 min-w-0 flex-wrap">
                            <div className="flex items-center gap-2">
                                <Package className="w-5 h-5 text-mode-pack-text" />
                                <span className="font-bold text-base sm:text-lg leading-tight text-foreground">Pack Builder</span>
                            </div>
                            <span className="hidden sm:block h-5 w-px bg-border" />
                            <CollectionStatus
                                sourceAnswers={sourceAnswers}
                                onOpenSource={onOpenSource}
                                isCollecting={isCollecting}
                                seedProgress={seedProgress}
                                loadedPostCount={loadedPostCount}
                                savedPostCount={savedPostCount}
                                onClearSavedPosts={onClearSavedPosts}
                                poolSize={poolSize}
                                canLoadMorePosts={canLoadMorePosts}
                                onLoadMorePosts={onLoadMorePosts}
                            />
                        </div>
                        <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" onClick={startTour} className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground">
                                <HelpCircle className="w-3.5 h-3.5 mr-1.5" />
                                How it works
                            </Button>
                            <Button variant="ghost" size="sm" onClick={onExit} className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground">
                                Exit pack mode
                            </Button>
                        </div>

                        {/* Collection progress — determinate while chasing a target, sweeping while connecting. */}
                        <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden" aria-hidden>
                            <AnimatePresence>
                                {isCollecting && (
                                    <motion.div
                                        key="bar"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0, transition: { duration: 0.6 } }}
                                        className="absolute inset-0 bg-mode-pack/15"
                                    >
                                        {progress !== null ? (
                                            <motion.div
                                                className="h-full w-full origin-left bg-mode-pack"
                                                initial={false}
                                                animate={{ scaleX: Math.max(0.04, progress) }}
                                                transition={{ type: 'tween', duration: 0.3 }}
                                            />
                                        ) : (
                                            <motion.div
                                                className="h-full w-1/3 bg-mode-pack"
                                                animate={lowMotion ? { opacity: [0.4, 1, 0.4] } : { x: ['-100%', '300%'] }}
                                                transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
                                            />
                                        )}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>

                    {/* Body — below lg: one scroll area (setup, then results) with the generate
                        controls pinned under it. lg+: the scroll wrapper becomes `display: contents`
                        so setup (left, own scroll) and results + controls (right) sit side by side. */}
                    {hasSetupAnswers && (
                        <div className="flex-1 min-h-0 grid grid-rows-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] bg-muted/20">
                            <div className="min-h-0 overflow-y-auto lg:contents">
                                {/* Left: the base, then one row per category */}
                                <div className="flex flex-col gap-4 p-4 sm:p-6 lg:row-span-2 lg:min-h-0 lg:overflow-y-auto">
                                    <section className="rounded-xl border border-border/70 bg-card/70 p-4 flex gap-4" aria-label="Base" data-pack-tour="base">
                                        {baseCard && (
                                            <div className="relative w-20 h-28 sm:w-24 sm:h-32 flex-shrink-0 rounded-lg overflow-hidden bg-muted border">
                                                {baseThumb && (
                                                    <Image
                                                        src={baseThumb}
                                                        alt={`Base post ${baseCard.id}`}
                                                        fill
                                                        sizes="96px"
                                                        className="object-cover"
                                                        unoptimized
                                                    />
                                                )}
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0 flex flex-col gap-2.5">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <div className="text-sm font-semibold">{baseCard ? `Base card #${baseCard.id}` : 'Your prompt'}</div>
                                                    <p className="text-[11px] text-muted-foreground">
                                                        Its tags are listed under each category below — remove any you don&apos;t want.
                                                    </p>
                                                </div>
                                                <Button type="button" variant="outline" size="sm" onClick={baseCard ? onClearBase : onEditBasePrompt} className="h-7 px-2 text-[11px] flex-shrink-0">
                                                    <Pencil className="w-3 h-3 mr-1" />
                                                    {baseCard ? "Change base" : "Edit prompt"}
                                                </Button>
                                            </div>
                                            {!baseCard && (
                                                <p className="text-xs font-mono text-foreground/80 line-clamp-2 break-words" title={basePrompt}>
                                                    {basePrompt}
                                                </p>
                                            )}
                                            {!baseCard && (baseClassified.other?.length ?? 0) > 0 && (
                                                <div className="flex items-start gap-2 flex-wrap">
                                                    <span className="text-[11px] text-muted-foreground pt-0.5">Always kept:</span>
                                                    {baseClassified.other.map((tag) => {
                                                        const removed = excludedBaseTags.has(tag)
                                                        return (
                                                            <button
                                                                key={tag}
                                                                type="button"
                                                                onClick={() => onToggleExcludedBaseTag(tag)}
                                                                title={removed ? `Put ${tag} back` : `Remove ${tag} from the base`}
                                                                className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px] ${removed ? 'border-dashed border-border/60 text-muted-foreground line-through' : 'bg-foreground/[0.07] border-border text-foreground'}`}
                                                            >
                                                                {tag}
                                                                {!removed && <X className="w-3 h-3 text-muted-foreground/60" />}
                                                            </button>
                                                        )
                                                    })}
                                                </div>
                                            )}
                                            <div className="space-y-1">
                                                <Label className="text-[11px] font-medium text-muted-foreground">
                                                    Always add <span className="font-normal">(LoRA triggers, quality tags…)</span>
                                                </Label>
                                                <TagAutocompleteTextarea
                                                    value={customBaseText}
                                                    onValueChange={onCustomBaseTextChange}
                                                    placeholder="e.g. masterpiece, best quality, solo"
                                                    className="text-xs font-mono min-h-[2.25rem] h-9 max-h-24 resize-y py-2"
                                                />
                                            </div>
                                        </div>
                                    </section>

                                    <div className="flex items-end justify-between gap-3 flex-wrap">
                                        <div>
                                            <h3 className="text-sm font-semibold">Categories</h3>
                                            <p className="text-[11px] text-muted-foreground">
                                                <span className="font-medium text-foreground">Keep</span> the base&apos;s tags,{' '}
                                                <span className="font-medium text-foreground">Vary</span> them with tags from the collected posts, or turn a category{' '}
                                                <span className="font-medium text-foreground">Off</span>.
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {onSetAllAxisTagModes && (
                                                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                                    <span className="hidden sm:inline">All pools:</span>
                                                    <button type="button" onClick={() => onSetAllAxisTagModes('individual')} className="px-1.5 py-0.5 rounded hover:bg-muted hover:text-foreground">Loose tags</button>
                                                    <button type="button" onClick={() => onSetAllAxisTagModes('bundle')} className="px-1.5 py-0.5 rounded hover:bg-muted hover:text-foreground">Full sets</button>
                                                </div>
                                            )}
                                            {onResetLearning && (
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <Button type="button" variant="ghost" size="sm" onClick={onResetLearning} className="h-7 px-2 text-[11px] text-muted-foreground">
                                                            Reset learning
                                                        </Button>
                                                    </TooltipTrigger>
                                                    <TooltipContent>Forget which tags you tend to copy (it biases sampling toward them)</TooltipContent>
                                                </Tooltip>
                                            )}
                                        </div>
                                    </div>

                                    <PackCategoryList
                                        categories={PACK_AXES}
                                        categoryStates={categoryStates}
                                        onSetCategoryState={onSetCategoryState}
                                        baseClassified={baseClassified}
                                        lockedTags={lockedTags}
                                        excludedBaseTags={excludedBaseTags}
                                        onToggleExcludedBaseTag={onToggleExcludedBaseTag}
                                        onRestoreExcluded={onRestoreExcludedBaseTags}
                                        slotStateOf={slotStateOf}
                                        onSetSlotState={onSetSlotState}
                                        tagOverrides={tagOverrides}
                                        axisValues={axisValues}
                                        axisSlotGroups={axisSlotGroups}
                                        axisSlotCounts={axisSlotCounts}
                                        axisMaxPerPrompt={axisMaxPerPrompt}
                                        axisMinCounts={axisMinCounts}
                                        axisTagModes={axisTagModes}
                                        onSetAxisMinCount={onSetAxisMinCount}
                                        onSetAxisTagMode={onSetAxisTagMode}
                                        onAddAxisValue={onAddAxisValue}
                                        onRemoveAxisValue={onRemoveAxisValue}
                                        onReseedAxis={onReseedAxis}
                                        isCollecting={isCollecting}
                                        hasMultipleCharacters={hasMultipleCharacters}
                                        minSetTags={minSetTags}
                                        onSetMinSetTags={onSetMinSetTags}
                                        hiddenThinSets={hiddenThinSets}
                                    />

                                    {children}
                                </div>

                                {/* Right: generated prompts */}
                                <div className="flex flex-col p-4 sm:p-6 lg:col-start-2 lg:row-start-1 lg:min-h-0 border-t lg:border-t-0 lg:border-l border-border/60 bg-background" data-pack-tour="results">
                                    <PackResultsList
                                        prompts={prompts}
                                        onCopyPrompt={onCopyPrompt}
                                        onCopyAll={onCopyAll}
                                        onReroll={handleReroll}
                                        lockedSet={lockedSet}
                                        variedSet={variedSet}
                                        isCollecting={isCollecting}
                                        minTotalTags={minTotalTags}
                                    />
                                </div>
                            </div>

                            {/* Batch settings + Generate — always visible (under the results on lg+) */}
                            <div className="flex flex-col gap-3 p-4 sm:px-6 lg:col-start-2 lg:row-start-2 border-t lg:border-l border-border/60 bg-background" data-pack-tour="batch">
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2 gap-x-6 gap-y-3">
                                    <div className="flex items-center gap-3 w-full">
                                        <Label htmlFor="pack-prompt-count" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap w-16">
                                            Prompts
                                        </Label>
                                        <Slider
                                            id="pack-prompt-count"
                                            min={1}
                                            max={MAX_PACK_PROMPTS}
                                            step={1}
                                            value={[livePromptCount]}
                                            onValueChange={([val]) => setLivePromptCount(val)}
                                            onValueCommit={([val]) => setPromptCount(val)}
                                            className="[&_[role=slider]]:border-mode-pack [&_[role=slider]]:focus-visible:ring-mode-pack/50 [&_.relative>.absolute]:bg-mode-pack cursor-grab active:cursor-grabbing flex-1"
                                        />
                                        <span className="text-xs font-bold text-foreground bg-muted px-2.5 py-0.5 rounded-full min-w-[5.5rem] text-center tabular-nums">
                                            {livePromptCount}
                                        </span>
                                    </div>
                                    <PackVarietySlider value={varietyLevel} onChange={onVarietyLevelChange} />
                                </div>

                                <div className="flex items-center justify-between gap-3 flex-wrap">
                                    <div className="flex items-center gap-2">
                                        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                                            Min tags
                                        </Label>
                                        <PackStepper
                                            value={minTotalTags}
                                            min={0}
                                            max={MAX_MIN_TOTAL_TAGS}
                                            onChange={onMinTotalTagsChange}
                                            zeroLabel="Any"
                                            ariaLabel="minimum tags per prompt"
                                        />
                                        <span className="text-[11px] text-muted-foreground">per prompt</span>
                                    </div>
                                    <span className="text-[11px] text-muted-foreground tabular-nums">
                                        ≈ {estimatedTagsPerPrompt} tags each
                                        {minTotalTags > 0 && estimatedTagsPerPrompt < minTotalTags && (
                                            <span className="text-warning-text"> · pools too small for {minTotalTags}</span>
                                        )}
                                    </span>
                                </div>

                                <Button
                                    type="button"
                                    size="lg"
                                    onClick={handleGenerateClick}
                                    disabled={nothingVaries}
                                    className={`w-full font-semibold shadow-sm transition-all duration-200 ${justGenerated ? 'bg-success hover:bg-success/90 text-success-foreground' : 'bg-mode-pack hover:bg-mode-pack/90 text-mode-pack-foreground'}`}
                                >
                                    {justGenerated ? <Check className="w-4 h-4 mr-2" /> : <Shuffle className="w-4 h-4 mr-2" />}
                                    {justGenerated ? 'Generated!' : nothingVaries ? 'Set a category to Vary' : `Generate ${livePromptCount} prompts`}
                                </Button>
                            </div>
                        </div>
                    )}

                    {tourTargets && (
                        <PackBuilderTour containerRef={contentRef} availableTargets={tourTargets} onClose={() => setTourTargets(null)} />
                    )}
                </DialogContent>
            </Dialog>
        </>
    )
}

export const PackBuilderStickyFooter = memo(PackBuilderStickyFooterComponent)
