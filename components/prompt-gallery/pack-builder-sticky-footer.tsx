import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Check, Package, Shuffle, Copy, CopyCheck, X, Dices, Pencil, Loader2, RefreshCw, AlertTriangle, Database, HelpCircle, ChevronDown, MoreHorizontal, LogOut, Eraser, Brain, Layers, Plus, UserRound } from "lucide-react"
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
import { withResolutionPrefix } from '@/lib/pack/prompt-resolution'
import { userPreferences } from '@/lib/storage'
import { MAX_MIN_TOTAL_TAGS, type PackCategoryState, type PackSlotState } from '@/hooks/use-pack-mode'
import { summarizePackSourceAnswers, type PackSourceAnswers } from './pack-source-modal'
import { PackVarietySelect } from './pack-variety-select'
import { PackCategoryList, PackStepper } from './pack-category-list'
import { TagAutocompleteTextarea } from './tag-autocomplete-textarea'
import { PackBuilderTour, findPackTourTargets, PACK_SOURCE_HINT_STORAGE_KEY, PACK_TOUR_OPEN_PARTS_EVENT, PACK_TOUR_STORAGE_KEY } from './pack-builder-tour'
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
    /** True when the base lists more than one character; the user picks the one to keep. */
    hasMultipleCharacters: boolean
    /** The base's character tags, offered as choices on a multi-character base. */
    baseCharacters: string[]
    focusCharacter: string | null
    onSetFocusCharacter: (character: string | null) => void
    /** Multi-character base with no character picked yet — Generate waits for it. */
    needsCharacterChoice: boolean
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
    /** Variety preset (§5). */
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
    /** `text` is what goes on the clipboard (with the size prefix when that's on). Resolves to whether the copy worked. */
    onCopyPrompt: (prompt: PackPrompt, text: string) => Promise<boolean>
    onCopyAll: (text: string) => Promise<boolean>
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
        .trim()
}

/** Row actions show on hover/focus with a mouse, always (and at full size) on touch. */
const ROW_ACTION_CLASS = "h-8 w-8 pointer-coarse:h-11 pointer-coarse:w-11 flex-shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100 focus-visible:opacity-100"

/** A single generated prompt row: text + re-roll + a per-item copy button with its own "Copied" feedback. */
const PromptRow = memo(({
    prompt,
    index,
    onCopy,
    onReroll,
    lockedSet,
    variedSet,
    showResolution,
}: {
    prompt: PackPrompt
    index: number
    onCopy: (prompt: PackPrompt) => Promise<boolean>
    onReroll: (index: number) => void
    lockedSet: ReadonlySet<string>
    variedSet: ReadonlySet<string>
    showResolution: boolean
}) => {
    const tokens = useMemo(() => prompt.prompt.split(',').map((t) => t.trim()).filter(Boolean), [prompt.prompt])
    const [isCopied, triggerCopyFeedback] = useCopyFeedback()
    const lowMotion = useLowMotion()

    const handleCopy = async () => {
        if (await onCopy(prompt)) triggerCopyFeedback()
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
                <span className="text-xs font-mono font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded w-full text-center">
                    {String(index + 1).padStart(2, '0')}
                </span>
                <span className="text-xs text-faint-foreground tabular-nums" title="Tags in this prompt">{tokens.length}</span>
                {showResolution && prompt.width && prompt.height && (
                    <span
                        className="text-xs text-mode-pack-text tabular-nums whitespace-nowrap"
                        title="Suggested size, from the posts this prompt's pose came from"
                    >
                        {prompt.width}×{prompt.height}
                    </span>
                )}
            </div>
            <p className="flex-1 min-w-0 text-xs lg:text-[13px] leading-relaxed font-mono break-words select-all">
                {tokens.map((token, i) => {
                    const bare = bareTag(token)
                    const tone = lockedSet.has(bare)
                        ? 'text-muted-foreground'
                        : variedSet.has(bare)
                            ? 'text-foreground font-semibold'
                            : 'text-faint-foreground'
                    return (
                        <span key={`${i}-${token}`}>
                            <span className={tone}>{token}</span>
                            {i < tokens.length - 1 && <span className="text-faint-foreground">, </span>}
                        </span>
                    )
                })}
            </p>
            <div className="flex flex-col sm:flex-row pointer-coarse:flex-col gap-0.5">
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => onReroll(index)}
                    className={`${ROW_ACTION_CLASS} text-muted-foreground hover:text-foreground hover:bg-muted`}
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
                    className={`${ROW_ACTION_CLASS} transition-[color,background-color,opacity] ${isCopied ? 'opacity-100 text-success-text bg-success-soft' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                    aria-label={isCopied ? `Prompt ${index + 1} copied` : `Copy prompt ${index + 1}`}
                >
                    {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </Button>
            </div>
        </motion.div>
    )
})
PromptRow.displayName = "PromptRow"

/** Results list: generated prompts with per-item copy/reroll + a "Copy all" split button. */
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
    onCopyPrompt: (prompt: PackPrompt, text: string) => Promise<boolean>
    onCopyAll: (text: string) => Promise<boolean>
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
    // Prefix copied prompts with their suggested [WIDTHxHEIGHT] — the form the
    // extension's Import List reads (lib/extension/prompt-list-parser.ts).
    const [addResolution, setAddResolution] = useState(() => {
        try {
            return userPreferences.getPackAddResolution()
        } catch {
            return false
        }
    })
    const changeAddResolution = (next: boolean) => {
        setAddResolution(next)
        try {
            userPreferences.setPackAddResolution(next)
        } catch {
            // Best-effort, like every other preference write.
        }
    }
    const textOf = useCallback(
        (p: PackPrompt) => (addResolution ? withResolutionPrefix(p.prompt, p) : p.prompt),
        [addResolution]
    )
    const handleCopyPrompt = useCallback((p: PackPrompt) => onCopyPrompt(p, textOf(p)), [onCopyPrompt, textOf])

    const handleCopyAll = async () => {
        if (prompts.length === 0) return
        if (await onCopyAll(prompts.map(textOf).join('\n'))) triggerCopyAllFeedback()
    }

    return (
        <div id="pack-results-section" className="flex flex-col gap-3 lg:min-h-0 lg:flex-1">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-border/40 flex-shrink-0 max-lg:sticky max-lg:top-0 max-lg:z-10 max-lg:bg-background max-lg:pt-1">
                <div className="flex items-center gap-x-2 gap-y-1 flex-wrap min-w-0">
                    <h3 className="text-sm font-semibold text-foreground">Prompts</h3>
                    {prompts.length > 0 && (
                        <>
                            <span className="text-xs font-semibold bg-muted text-foreground px-2 py-0.5 rounded-full tabular-nums">
                                {prompts.length}
                            </span>
                            <span className="text-xs text-muted-foreground">
                                <span className="font-semibold text-foreground">bold</span> = varied
                            </span>
                        </>
                    )}
                </div>
                {prompts.length > 0 && (
                    <div className="inline-flex flex-shrink-0 rounded-md shadow-xs" data-pack-tour="copy-all">
                        <Button
                            type="button"
                            size="sm"
                            onClick={handleCopyAll}
                            className={`h-9 pointer-coarse:h-11 rounded-r-none text-xs transition-colors ${isAllCopied ? 'bg-success hover:bg-success/90 text-success-foreground' : 'bg-mode-pack hover:bg-mode-pack/90 text-mode-pack-foreground'}`}
                        >
                            {isAllCopied ? <CopyCheck className="w-3.5 h-3.5 mr-1.5" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
                            {isAllCopied ? 'Copied all' : addResolution ? 'Copy all with size' : 'Copy all'}
                        </Button>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    type="button"
                                    size="sm"
                                    aria-label="Copy options"
                                    className="h-9 w-8 pointer-coarse:h-11 pointer-coarse:w-11 px-0 rounded-l-none border-l border-mode-pack-foreground/25 bg-mode-pack hover:bg-mode-pack/90 text-mode-pack-foreground"
                                >
                                    <ChevronDown className="w-3.5 h-3.5" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-72">
                                <DropdownMenuCheckboxItem
                                    checked={addResolution}
                                    onCheckedChange={(v) => changeAddResolution(v === true)}
                                    onSelect={(e) => e.preventDefault()}
                                    className="items-start"
                                >
                                    <span className="flex flex-col gap-0.5">
                                        <span>Add size as [WIDTHxHEIGHT]</span>
                                        <span className="text-xs text-muted-foreground">
                                            For the extension&apos;s Import List. Taken from the posts each prompt&apos;s pose came from.
                                        </span>
                                    </span>
                                </DropdownMenuCheckboxItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                )}
            </div>

            {shortCount > 0 && (
                <p className="flex items-start gap-1.5 text-xs text-warning-text flex-shrink-0">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                    {shortCount} of {prompts.length} came out under {minTotalTags} tags after conflicting or excluded tags were cleaned out.
                    Set more categories to Vary, raise their per-prompt count, or collect more posts.
                </p>
            )}

            {prompts.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-10 lg:flex-1 text-center rounded-lg border border-dashed border-border/60">
                    {isCollecting ? (
                        <>
                            <Loader2 className="w-6 h-6 text-faint-foreground animate-spin" />
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
                // One scroll area per screen: the column scrolls on its own on lg+,
                // and below lg the whole Prompts tab scrolls instead (no nesting).
                <div className="flex flex-col gap-2 lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
                    <AnimatePresence mode="popLayout">
                        {prompts.map((p, i) => (
                            <PromptRow
                                key={`${i}-${p.prompt}`}
                                prompt={p}
                                index={i}
                                onCopy={handleCopyPrompt}
                                onReroll={onReroll}
                                lockedSet={lockedSet}
                                variedSet={variedSet}
                                showResolution={addResolution}
                            />
                        ))}
                    </AnimatePresence>
                </div>
            )}
        </div>
    )
})
PackResultsList.displayName = "PackResultsList"

/** Header line: where variations come from (opens the source modal) and how many posts are in. */
function CollectionStatus({
    sourceAnswers,
    onOpenSource,
    isCollecting,
    seedProgress,
    loadedPostCount,
    savedPostCount,
    poolSize,
    showSourceHint,
    onDismissSourceHint,
}: {
    sourceAnswers: PackSourceAnswers
    onOpenSource: () => void
    /** One-time callout under the chip: where the source settings live now. */
    showSourceHint: boolean
    onDismissSourceHint: () => void
    isCollecting: boolean
    seedProgress: { current: number; target: number } | null
    loadedPostCount: number
    savedPostCount: number
    poolSize: number
}) {
    const noPosts = !isCollecting && loadedPostCount === 0
    return (
        <div className="flex items-center gap-2 min-w-0">
            <div className="relative min-w-0 flex">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            type="button"
                            onClick={onOpenSource}
                            data-pack-tour="source"
                            className="h-8 pointer-coarse:h-11 min-w-0 px-2.5 rounded-lg border border-border/60 bg-muted/40 hover:bg-muted text-xs font-medium text-foreground/90 transition-colors inline-flex items-center gap-1.5 max-w-[18rem]"
                        >
                            <Database className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                            <span className="truncate">{summarizePackSourceAnswers(sourceAnswers)}</span>
                            {sourceAnswers.searchTags.trim() && (
                                <span className="hidden sm:inline truncate text-muted-foreground font-mono">· {sourceAnswers.searchTags}</span>
                            )}
                            <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                        </button>
                    </TooltipTrigger>
                    <TooltipContent>Where the varied tags are sampled from. Select to change it.</TooltipContent>
                </Tooltip>
                {showSourceHint && (
                    <div
                        role="note"
                        aria-labelledby="pack-source-hint-title"
                        className="absolute left-0 top-full mt-2 z-30 w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border border-mode-pack-border bg-popover text-popover-foreground shadow-lg p-3"
                    >
                        <span aria-hidden className="absolute -top-1.5 left-5 h-3 w-3 rotate-45 border-l border-t border-mode-pack-border bg-popover" />
                        <p id="pack-source-hint-title" className="text-sm font-semibold">Content rating and source are here now</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                            Select this chip to choose the content rating, the booru, and which posts the variations come from.
                        </p>
                        <div className="mt-2.5 flex justify-end">
                            <Button type="button" size="sm" variant="outline" onClick={onDismissSourceHint} className="h-8 pointer-coarse:h-11 px-3 text-xs">
                                Got it
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            <div className="inline-flex items-center gap-1.5 min-w-0 text-xs tabular-nums whitespace-nowrap" aria-live="polite">
                {isCollecting ? (
                    <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-mode-pack-text flex-shrink-0" />
                        <span className="font-medium text-foreground truncate">
                            {savedPostCount > 0 ? 'Adding posts' : 'Collecting'}
                            {seedProgress ? ` ${seedProgress.current}/${seedProgress.target}` : '…'}
                        </span>
                    </>
                ) : noPosts ? (
                    <>
                        <AlertTriangle className="w-3.5 h-3.5 text-warning-text flex-shrink-0" />
                        <span className="text-warning-text truncate">No posts for this source</span>
                    </>
                ) : (
                    <>
                        <span className="w-2 h-2 rounded-full bg-success flex-shrink-0" aria-hidden />
                        <span className="font-medium text-foreground">{loadedPostCount} posts</span>
                        <span className="hidden sm:inline text-muted-foreground">· {poolSize} tags</span>
                    </>
                )}
            </div>
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
    baseCharacters,
    focusCharacter,
    onSetFocusCharacter,
    needsCharacterChoice,
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

    // Below lg the builder is two tabs (setup / prompts) sharing one scroll area.
    const [mobileTab, setMobileTab] = useState<'setup' | 'prompts'>('setup')
    const scrollRef = useRef<HTMLDivElement>(null)
    const showTab = useCallback((tab: 'setup' | 'prompts') => {
        setMobileTab(tab)
        scrollRef.current?.scrollTo({ top: 0 })
    }, [])
    // A new base starts over on Setup (synced during render, like the slider below).
    const baseKey = baseCard ? `card:${baseCard.id}` : `prompt:${basePrompt}`
    const [prevBaseKey, setPrevBaseKey] = useState(baseKey)
    if (baseKey !== prevBaseKey) {
        setPrevBaseKey(baseKey)
        setMobileTab('setup')
    }

    // Generate gives no visible feedback on its own — confirm on the button
    // itself and bring the results into view (the Prompts tab on small screens).
    const [justGenerated, setJustGenerated] = useState(false)
    const handleGenerateClick = useCallback(() => {
        onRegenerate()
        setJustGenerated(true)
        setTimeout(() => setJustGenerated(false), 1200)
        showTab('prompts')
        document.getElementById('pack-results-section')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, [onRegenerate, showTab])

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

    // "Always add" stays tucked behind a link until it's used.
    const [alwaysAddOpen, setAlwaysAddOpen] = useState(false)
    const showAlwaysAdd = alwaysAddOpen || customBaseText.trim() !== ''

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
    const generateBlocked = nothingVaries || needsCharacterChoice
    const poolsTooSmall = minTotalTags > 0 && estimatedTagsPerPrompt < minTotalTags

    // Guided tour (pack-builder-tour.tsx): auto-starts the first time the builder
    // opens, replayable from the ⋯ menu. null = not running. The anchor row is
    // opened first so the steps about its parts and pool have something to point at.
    const contentRef = useRef<HTMLDivElement>(null)
    const [tourTargets, setTourTargets] = useState<string[] | null>(null)
    const startTour = useCallback(() => {
        window.dispatchEvent(new Event(PACK_TOUR_OPEN_PARTS_EVENT))
        requestAnimationFrame(() => setTourTargets(findPackTourTargets(contentRef.current)))
    }, [])
    const builderOpen = isOpen && hasSetupAnswers

    // One-time hint on the source chip for people who finished the tour before
    // the source settings moved there (they used to be a step of their own).
    const [showSourceHint, setShowSourceHint] = useState(false)
    if (!builderOpen && showSourceHint) setShowSourceHint(false)

    useEffect(() => {
        if (!builderOpen) return
        let tourDone: boolean
        let hintSeen: boolean
        try {
            tourDone = localStorage.getItem(PACK_TOUR_STORAGE_KEY) === '1'
            hintSeen = localStorage.getItem(PACK_SOURCE_HINT_STORAGE_KEY) === '1'
        } catch {
            // Storage blocked: neither could be remembered, so show neither.
            return
        }
        if (!tourDone) {
            // First visit: the tour covers the source chip, so the hint is never needed.
            // Let the dialog and the first pools render so every target exists.
            const timer = setTimeout(() => {
                try {
                    localStorage.setItem(PACK_TOUR_STORAGE_KEY, '1')
                    localStorage.setItem(PACK_SOURCE_HINT_STORAGE_KEY, '1')
                } catch {}
                startTour()
            }, 900)
            return () => clearTimeout(timer)
        }
        if (hintSeen) return
        // Marked as seen the moment it shows, like the release dialog.
        const timer = setTimeout(() => {
            try {
                localStorage.setItem(PACK_SOURCE_HINT_STORAGE_KEY, '1')
            } catch {}
            setShowSourceHint(true)
        }, 600)
        return () => clearTimeout(timer)
    }, [builderOpen, startTour])

    const dismissSourceHint = useCallback(() => setShowSourceHint(false), [])
    const handleOpenSource = useCallback(() => {
        setShowSourceHint(false)
        onOpenSource()
    }, [onOpenSource])

    // Closing the builder — the X, Escape or a click outside — always does the
    // same thing: it drops the base and goes back to the gallery to pick
    // another one. Pack Mode itself stays on; leaving it is in the ⋯ menu.
    const handleDialogOpenChange = useCallback((open: boolean) => {
        if (!open) onClearBase()
    }, [onClearBase])

    const headerButtonClass = "h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11 flex-shrink-0 text-muted-foreground hover:text-foreground"

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
                                Pick a card and press <span className="font-medium text-foreground">Use as base</span> to build a pack.
                            </p>
                        </div>
                        <Button variant="ghost" size="icon" onClick={onExit} className="h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11 rounded-full hover:bg-muted flex-shrink-0" aria-label="Exit Pack Mode">
                            <X className="w-4 h-4" />
                        </Button>
                    </motion.div>
                )}
            </AnimatePresence>

            <Dialog open={isOpen && hasSetupAnswers} onOpenChange={handleDialogOpenChange}>
                <DialogContent
                    ref={contentRef}
                    showCloseButton={false}
                    // Focus the builder itself, not its first control: the source
                    // chip's tooltip would otherwise pop open on every visit.
                    onOpenAutoFocus={(e) => {
                        e.preventDefault()
                        contentRef.current?.focus()
                    }}
                    // Pack Mode is a primary workspace, not a quick popup: take (almost) the whole
                    // viewport — full-bleed on phones, a 1rem margin on larger screens.
                    className="w-screen h-dvh max-w-none sm:w-[calc(100vw-2rem)] sm:h-[calc(100dvh-2rem)] sm:max-w-[1680px] sm:rounded-2xl p-0 gap-0 flex flex-col overflow-hidden"
                >
                    <DialogTitle className="sr-only">Pack Builder</DialogTitle>

                    {/* Header — one line: title, source, collection status, options, close. */}
                    <div className="relative flex items-center gap-2 sm:gap-3 px-3 py-2 sm:px-5 border-b border-border/60 flex-shrink-0 bg-background">
                        <div className="flex items-center gap-2 flex-shrink-0">
                            <Package className="w-5 h-5 text-mode-pack-text" aria-hidden />
                            <span className="hidden sm:inline font-semibold text-base leading-tight text-foreground">Pack Builder</span>
                        </div>
                        <span className="hidden sm:block h-5 w-px bg-border flex-shrink-0" aria-hidden />
                        <div className="flex-1 min-w-0">
                            <CollectionStatus
                                sourceAnswers={sourceAnswers}
                                onOpenSource={handleOpenSource}
                                showSourceHint={showSourceHint && !tourTargets}
                                onDismissSourceHint={dismissSourceHint}
                                isCollecting={isCollecting}
                                seedProgress={seedProgress}
                                loadedPostCount={loadedPostCount}
                                savedPostCount={savedPostCount}
                                poolSize={poolSize}
                            />
                        </div>

                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className={headerButtonClass} aria-label="Pack options">
                                    <MoreHorizontal className="w-4 h-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-60">
                                <DropdownMenuItem onSelect={onLoadMorePosts} disabled={isCollecting || !canLoadMorePosts} className="gap-2">
                                    <RefreshCw className="w-4 h-4 text-muted-foreground" />
                                    Collect more posts
                                </DropdownMenuItem>
                                {onSetAllAxisTagModes && (
                                    <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">All pools</DropdownMenuLabel>
                                        <DropdownMenuItem onSelect={() => onSetAllAxisTagModes('individual')} className="gap-2">
                                            <Shuffle className="w-4 h-4 text-muted-foreground" />
                                            Use loose tags
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onSelect={() => onSetAllAxisTagModes('bundle')} className="gap-2">
                                            <Layers className="w-4 h-4 text-muted-foreground" />
                                            Use full sets
                                        </DropdownMenuItem>
                                    </>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={startTour} className="gap-2">
                                    <HelpCircle className="w-4 h-4 text-muted-foreground" />
                                    How it works
                                </DropdownMenuItem>
                                {(onResetLearning || (savedPostCount > 0 && onClearSavedPosts)) && <DropdownMenuSeparator />}
                                {savedPostCount > 0 && onClearSavedPosts && (
                                    <DropdownMenuItem onSelect={onClearSavedPosts} disabled={isCollecting} className="gap-2">
                                        <Eraser className="w-4 h-4 text-muted-foreground" />
                                        <span className="flex flex-col">
                                            Forget {savedPostCount} saved posts
                                            <span className="text-xs text-muted-foreground">Kept from earlier sessions for this source</span>
                                        </span>
                                    </DropdownMenuItem>
                                )}
                                {onResetLearning && (
                                    <DropdownMenuItem onSelect={onResetLearning} className="gap-2">
                                        <Brain className="w-4 h-4 text-muted-foreground" />
                                        <span className="flex flex-col">
                                            Reset learning
                                            <span className="text-xs text-muted-foreground">Forget which tags you tend to copy</span>
                                        </span>
                                    </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={onExit} className="gap-2">
                                    <LogOut className="w-4 h-4 text-muted-foreground" />
                                    Exit Pack Mode
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <DialogClose asChild>
                                    <Button variant="ghost" size="icon" className={headerButtonClass} aria-label="Close builder and pick another base">
                                        <X className="w-4 h-4" />
                                    </Button>
                                </DialogClose>
                            </TooltipTrigger>
                            <TooltipContent>Close and pick another base (Esc)</TooltipContent>
                        </Tooltip>

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

                    {/* Below lg: Setup | Prompts tabs. */}
                    {hasSetupAnswers && (
                        <div className="lg:hidden flex-shrink-0 px-3 py-2 border-b border-border/60 bg-background">
                            <div className="grid grid-cols-2 rounded-lg bg-muted/60 p-0.5" role="tablist" aria-label="Pack Builder sections">
                                {(['setup', 'prompts'] as const).map((tab) => {
                                    const active = mobileTab === tab
                                    return (
                                        <button
                                            key={tab}
                                            type="button"
                                            role="tab"
                                            id={`pack-tab-${tab}`}
                                            aria-selected={active}
                                            aria-controls={`pack-panel-${tab}`}
                                            onClick={() => showTab(tab)}
                                            className={`h-11 rounded-md text-sm font-medium transition-colors ${active ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'}`}
                                        >
                                            {tab === 'setup' ? 'Setup' : `Prompts${prompts.length > 0 ? ` (${prompts.length})` : ''}`}
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                    )}

                    {/* Body — below lg: the active tab in one scroll area with the generate
                        controls pinned under it. lg+: the scroll wrapper becomes `display: contents`
                        so setup (left, own scroll) and results + controls (right) sit side by side. */}
                    {hasSetupAnswers && (
                        <div className="flex-1 min-h-0 grid grid-rows-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] bg-muted/20">
                            <div ref={scrollRef} className="min-h-0 overflow-y-auto lg:contents">
                                {/* Left: the base, then one row per category */}
                                <div
                                    id="pack-panel-setup"
                                    role="tabpanel"
                                    aria-labelledby="pack-tab-setup"
                                    className={`flex flex-col gap-3 p-3 sm:p-5 lg:row-span-2 lg:min-h-0 lg:overflow-y-auto ${mobileTab === 'setup' ? '' : 'max-lg:hidden'}`}
                                >
                                    <section className="rounded-xl border border-border/70 bg-card/70 p-3 flex gap-3" aria-label="Base" data-pack-tour="base">
                                        {baseCard && (
                                            <div className="relative w-14 h-20 flex-shrink-0 rounded-lg overflow-hidden bg-muted border">
                                                {baseThumb && (
                                                    <Image
                                                        src={baseThumb}
                                                        alt={`Base post ${baseCard.id}`}
                                                        fill
                                                        sizes="56px"
                                                        className="object-cover"
                                                        unoptimized
                                                    />
                                                )}
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0 flex flex-col gap-2">
                                            <div className="flex items-center justify-between gap-2">
                                                <h3 className="text-sm font-semibold truncate">{baseCard ? `Base card #${baseCard.id}` : 'Your prompt'}</h3>
                                                <Button type="button" variant="outline" size="sm" onClick={baseCard ? onClearBase : onEditBasePrompt} className="h-8 pointer-coarse:h-11 px-2.5 text-xs flex-shrink-0">
                                                    <Pencil className="w-3 h-3 mr-1.5" />
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
                                                    <span className="text-xs text-muted-foreground pt-0.5">Always kept:</span>
                                                    {baseClassified.other.map((tag) => {
                                                        const removed = excludedBaseTags.has(tag)
                                                        return (
                                                            <button
                                                                key={tag}
                                                                type="button"
                                                                onClick={() => onToggleExcludedBaseTag(tag)}
                                                                title={removed ? `Put ${tag} back` : `Remove ${tag} from the base`}
                                                                className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-xs ${removed ? 'border-dashed border-border/60 text-muted-foreground line-through' : 'bg-foreground/[0.07] border-border text-foreground'}`}
                                                            >
                                                                {tag}
                                                                {!removed && <X className="w-3 h-3 text-faint-foreground" />}
                                                            </button>
                                                        )
                                                    })}
                                                </div>
                                            )}

                                            {/* A multi-character base keeps one character: which one. */}
                                            {hasMultipleCharacters && (
                                                <div className={`rounded-lg border p-2.5 space-y-2 ${needsCharacterChoice ? 'border-warning-border bg-warning-soft' : 'border-border/60 bg-muted/30'}`}>
                                                    <p id="pack-character-choice" className={`flex items-center gap-1.5 text-xs ${needsCharacterChoice ? 'text-warning-text font-medium' : 'text-muted-foreground'}`}>
                                                        {needsCharacterChoice ? <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> : <UserRound className="w-3.5 h-3.5 flex-shrink-0" />}
                                                        {needsCharacterChoice
                                                            ? `This post has ${baseCharacters.length} characters. Pick the one to keep:`
                                                            : `Keeping 1 of ${baseCharacters.length} characters and the traits that match them:`}
                                                    </p>
                                                    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby="pack-character-choice">
                                                        {baseCharacters.map((character) => {
                                                            const active = focusCharacter === character
                                                            return (
                                                                <button
                                                                    key={character}
                                                                    type="button"
                                                                    role="radio"
                                                                    aria-checked={active}
                                                                    onClick={() => onSetFocusCharacter(character)}
                                                                    className={`inline-flex items-center gap-1 min-h-8 pointer-coarse:min-h-11 rounded-md border px-2 font-mono text-xs transition-colors ${active ? 'bg-mode-pack text-mode-pack-foreground border-transparent' : 'bg-background border-border/70 text-foreground hover:bg-muted'}`}
                                                                >
                                                                    {active && <Check className="w-3 h-3" />}
                                                                    {character}
                                                                </button>
                                                            )
                                                        })}
                                                    </div>
                                                </div>
                                            )}

                                            {showAlwaysAdd ? (
                                                <div className="space-y-1">
                                                    <Label htmlFor="pack-always-add" className="text-xs font-medium text-muted-foreground">
                                                        Always add <span className="font-normal">(LoRA triggers, quality tags…)</span>
                                                    </Label>
                                                    <TagAutocompleteTextarea
                                                        id="pack-always-add"
                                                        value={customBaseText}
                                                        onValueChange={onCustomBaseTextChange}
                                                        placeholder="e.g. masterpiece, best quality, solo"
                                                        className="text-xs font-mono min-h-[2.25rem] h-9 max-h-24 resize-y py-2"
                                                    />
                                                </div>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => setAlwaysAddOpen(true)}
                                                    className="self-start inline-flex items-center gap-1 min-h-7 pointer-coarse:min-h-11 text-xs text-muted-foreground hover:text-foreground"
                                                >
                                                    <Plus className="w-3.5 h-3.5" />
                                                    Always add tags (LoRA triggers, quality tags…)
                                                </button>
                                            )}
                                        </div>
                                    </section>

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
                                <div
                                    id="pack-panel-prompts"
                                    role="tabpanel"
                                    aria-labelledby="pack-tab-prompts"
                                    className={`flex flex-col p-3 sm:p-5 lg:col-start-2 lg:row-start-1 lg:min-h-0 lg:border-l border-border/60 bg-background ${mobileTab === 'prompts' ? 'max-lg:min-h-full' : 'max-lg:hidden'}`}
                                    data-pack-tour="results"
                                >
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
                            <div className="flex flex-col gap-2.5 p-3 sm:px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:col-start-2 lg:row-start-2 border-t lg:border-l border-border/60 bg-background" data-pack-tour="batch">
                                <div className="flex items-center gap-3 w-full">
                                    <Label htmlFor="pack-prompt-count" className="text-xs font-medium text-muted-foreground whitespace-nowrap">
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
                                        className="[&_[role=slider]]:border-mode-pack [&_[role=slider]]:focus-visible:ring-mode-pack/50 [&_.relative>.absolute]:bg-mode-pack pointer-coarse:[&_[role=slider]]:size-7 cursor-grab active:cursor-grabbing flex-1"
                                    />
                                    <span className="text-xs font-semibold text-foreground tabular-nums w-7 text-right">
                                        {livePromptCount}
                                    </span>
                                </div>

                                <div className="flex items-center gap-2 flex-wrap">
                                    <PackVarietySelect value={varietyLevel} onChange={onVarietyLevelChange} />
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <Button type="button" variant="outline" size="sm" className="h-9 pointer-coarse:h-11 px-2.5 text-xs gap-1.5">
                                                More
                                                {minTotalTags > 0 && (
                                                    <span className={`tabular-nums ${poolsTooSmall ? 'text-warning-text' : 'text-mode-pack-text'}`}>· min {minTotalTags}</span>
                                                )}
                                                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent align="start" className="w-72 space-y-2">
                                            <div className="flex items-center justify-between gap-3">
                                                <Label className="text-sm font-medium">Min tags per prompt</Label>
                                                <PackStepper
                                                    value={minTotalTags}
                                                    min={0}
                                                    max={MAX_MIN_TOTAL_TAGS}
                                                    onChange={onMinTotalTagsChange}
                                                    zeroLabel="Any"
                                                    ariaLabel="minimum tags per prompt"
                                                />
                                            </div>
                                            <p className="text-xs text-muted-foreground">
                                                Picks more tags per category until each prompt reaches this. About {estimatedTagsPerPrompt} tags each right now.
                                                {poolsTooSmall && (
                                                    <span className="block mt-1 text-warning-text">The pools are too small for {minTotalTags}. Set more categories to Vary or collect more posts.</span>
                                                )}
                                            </p>
                                        </PopoverContent>
                                    </Popover>
                                    <span className="hidden lg:inline ml-auto text-xs text-muted-foreground tabular-nums">
                                        ≈ {estimatedTagsPerPrompt} tags each
                                    </span>
                                    <Button
                                        type="button"
                                        size="lg"
                                        onClick={handleGenerateClick}
                                        disabled={generateBlocked}
                                        className={`max-lg:flex-1 lg:w-full h-11 font-semibold shadow-sm transition-all duration-200 ${justGenerated ? 'bg-success hover:bg-success/90 text-success-foreground' : 'bg-mode-pack hover:bg-mode-pack/90 text-mode-pack-foreground'}`}
                                    >
                                        {justGenerated ? <Check className="w-4 h-4 mr-2" /> : <Shuffle className="w-4 h-4 mr-2" />}
                                        {justGenerated
                                            ? 'Generated'
                                            : needsCharacterChoice
                                                ? 'Pick a character first'
                                                : nothingVaries
                                                    ? 'Set a category to Vary'
                                                    : `Generate ${livePromptCount} prompts`}
                                    </Button>
                                </div>
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
