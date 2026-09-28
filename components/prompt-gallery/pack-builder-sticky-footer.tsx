import { memo, useCallback, useMemo, useState } from 'react'
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Trash2, Check, Package, Shuffle, Copy, CopyCheck, X, Dices, Pencil } from "lucide-react"
import { BooruPost } from '@/lib/booru/types'
import { TagCategory } from '@/lib/tag-classifier'
import { MAX_PACK_PROMPTS, type PackPrompt, type AxisTagMode, type SlotGroup } from '@/lib/pack/pack-generator'
import { splitCommaSeparatedTags } from '@/lib/utils/tag-utils'
import { motion, AnimatePresence } from 'framer-motion'
import { useLowMotion } from '@/hooks/use-low-motion'
import { useCopyFeedback } from '@/hooks/use-copy-feedback'
import { toast } from '@/hooks/use-toast'
import { ToastAction } from '@/components/ui/toast'
import Image from 'next/image'
import { getDanbooruProxyUrl } from "@/lib/proxy-url"
import { CATEGORY_TEXT_CLASS } from './category-chip-styles'
import { PackSourcePopover, summarizePackSourceAnswers, type PackSourceAnswers } from './pack-source-popover'
import { PackLockToggles } from './pack-lock-toggles'
import { PackVarietySlider } from './pack-variety-slider'
import { PackAdvancedPanel } from './pack-advanced-panel'
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
    /** Current "source of variations" answers (rating/solo/tags/provider) and
     *  its popover, opened from the chip in the header (design spec §2.2). */
    sourceAnswers: PackSourceAnswers
    onApplySourceAnswers: (answers: PackSourceAnswers) => void
    currentSearchTags: string
    sourcePopoverOpen: boolean
    onSourcePopoverOpenChange: (open: boolean) => void
    lockedCategories: Set<TagCategory>
    toggleLockedCategory: (category: TagCategory) => void
    lockedSlots: Set<string>
    toggleLockedSlot: (slot: string) => void
    mutedSlots: Set<string>
    toggleMutedSlot: (slot: string) => void
    axisSlotGroups: Partial<Record<TagCategory, SlotGroup[]>>
    axisSlotCounts: Partial<Record<TagCategory, Record<string, number>>>
    axisMaxPerPrompt: Partial<Record<TagCategory, number>>
    tagOverrides: Record<string, string>
    baseClassified: Record<TagCategory, string[]>
    lockedTags: string[]
    activeAxisCategories: TagCategory[]
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
    isSeeding?: boolean
    seedProgress?: { current: number; target: number } | null
    loadedPostCount: number
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

const CATEGORIES: TagCategory[] = ['appearance', 'clothing', 'equipment', 'pose', 'scenery', 'creature']

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

/** A single generated prompt row: text + re-roll + a per-item copy button with its own "Copied!" feedback. */
const PromptRow = memo(({
    prompt,
    index,
    onCopy,
    onReroll,
    lockedSet,
    variedCategory,
}: {
    prompt: PackPrompt
    index: number
    onCopy: (prompt: PackPrompt) => void
    onReroll: (index: number) => void
    lockedSet: ReadonlySet<string>
    variedCategory: ReadonlyMap<string, TagCategory>
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
            className="group flex items-start gap-2.5 rounded-lg border border-border/50 bg-background/60 hover:bg-background/90 hover:border-border/80 transition-colors p-2.5"
        >
            <span className="text-[10px] font-mono font-bold text-muted-foreground/80 bg-muted/70 px-1.5 py-0.5 rounded mt-0.5 min-w-[1.75rem] text-center">
                {String(index + 1).padStart(2, '0')}
            </span>
            <p className="flex-1 text-xs leading-relaxed font-mono break-words select-all">
                {tokens.map((token, i) => {
                    const bare = bareTag(token)
                    const cat = lockedSet.has(bare) ? undefined : variedCategory.get(bare)
                    const tone = cat ? `${CATEGORY_TEXT_CLASS[cat]} font-semibold` : 'text-muted-foreground'
                    return (
                        <span key={`${i}-${token}`}>
                            <span className={tone}>{token}</span>
                            {i < tokens.length - 1 && <span className="text-muted-foreground/60">, </span>}
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
    variedCategory,
}: {
    prompts: PackPrompt[]
    onCopyPrompt: (prompt: PackPrompt) => void
    onCopyAll: (text: string) => void
    onReroll: (index: number) => void
    lockedSet: ReadonlySet<string>
    variedCategory: ReadonlyMap<string, TagCategory>
}) => {
    const [isAllCopied, triggerCopyAllFeedback] = useCopyFeedback()

    const handleCopyAll = () => {
        if (prompts.length === 0) return
        onCopyAll(prompts.map((p) => p.prompt).join('\n'))
        triggerCopyAllFeedback()
    }

    return (
        <div id="pack-results-section" className="rounded-xl border border-border/60 bg-card/60 dark:bg-card/40 backdrop-blur-xs p-4 space-y-3 shadow-xs">
            <div className="flex items-center justify-between gap-2 flex-wrap pb-2 border-b border-border/40">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                        Generated Prompts
                    </span>
                    {prompts.length > 0 && (
                        <span className="text-[10px] font-semibold bg-mode-pack-soft text-mode-pack-text border border-mode-pack-border px-2 py-0.5 rounded-full tabular-nums">
                            {prompts.length} {prompts.length === 1 ? 'prompt' : 'prompts'}
                        </span>
                    )}
                    {prompts.length > 0 && (
                        <span className="text-[11px] text-muted-foreground hidden md:inline">
                            <span className="text-muted-foreground">grey</span> = constant · <span className="font-semibold text-foreground">coloured</span> = varied
                        </span>
                    )}
                </div>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCopyAll}
                    disabled={prompts.length === 0}
                    className={`h-7 text-xs transition-colors ${isAllCopied ? 'bg-success-soft text-success-text border-success-border' : ''}`}
                >
                    {isAllCopied ? <CopyCheck className="w-3.5 h-3.5 mr-1.5" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
                    {isAllCopied ? 'Copied all!' : 'Copy all'}
                </Button>
            </div>

            {prompts.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-8 text-center rounded-lg border border-dashed border-border/50 bg-muted/10">
                    <Shuffle className="w-6 h-6 text-muted-foreground/40" />
                    <p className="text-xs text-muted-foreground max-w-sm">
                        No prompts yet — adjust what stays fixed above, then click <span className="font-semibold text-foreground">Generate</span> below.
                    </p>
                </div>
            ) : (
                <div className="flex flex-col gap-2 max-h-[22rem] overflow-y-auto pr-1">
                    <AnimatePresence mode="popLayout">
                        {prompts.map((p, i) => (
                            <PromptRow
                                key={`${i}-${p.prompt}`}
                                prompt={p}
                                index={i}
                                onCopy={onCopyPrompt}
                                onReroll={onReroll}
                                lockedSet={lockedSet}
                                variedCategory={variedCategory}
                            />
                        ))}
                    </AnimatePresence>
                </div>
            )}
        </div>
    )
})
PackResultsList.displayName = "PackResultsList"

const PackBuilderStickyFooterComponent = ({
    isOpen,
    baseCard,
    basePrompt,
    onEditBasePrompt,
    hasSetupAnswers,
    sourceAnswers,
    onApplySourceAnswers,
    currentSearchTags,
    sourcePopoverOpen,
    onSourcePopoverOpenChange,
    lockedCategories,
    toggleLockedCategory,
    lockedSlots,
    toggleLockedSlot,
    mutedSlots,
    toggleMutedSlot,
    axisSlotGroups,
    axisSlotCounts,
    axisMaxPerPrompt,
    tagOverrides,
    baseClassified,
    lockedTags,
    activeAxisCategories,
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
    isSeeding = false,
    seedProgress = null,
    loadedPostCount,
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
                description: "Load more posts or raise Variety to get a fresh option here.",
                action: (
                    <ToastAction altText="Load more posts" onClick={onLoadMorePosts}>
                        Load more
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

    // Result highlighting: base tags muted, varied tags in their axis colour.
    const lockedSet = useMemo(() => new Set(lockedTags.map(bareTag)), [lockedTags])
    const variedCategory = useMemo(() => {
        const map = new Map<string, TagCategory>()
        CATEGORIES.forEach((cat) => {
            axisValues[cat]?.forEach((value) => {
                const parts = value.includes(',') ? splitCommaSeparatedTags(value) : [value]
                parts.forEach((tag) => map.set(bareTag(tag), cat))
            })
        })
        return map
    }, [axisValues])

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
                    className="max-w-4xl w-[96vw] h-[90vh] max-h-[90vh] p-0 gap-0 flex flex-col overflow-hidden"
                    onEscapeKeyDown={onExit}
                >
                    <DialogTitle className="sr-only">Pack Builder</DialogTitle>

                    {/* Header — outside the scroll area so it's always visible. */}
                    <div className="flex items-center justify-between gap-2 flex-wrap p-4 pb-3 pr-12 border-b border-border/50 flex-shrink-0 bg-background/95">
                        <div className="flex items-center gap-2.5 min-w-0">
                            <div className="p-1.5 rounded-lg bg-mode-pack-soft border border-mode-pack-border text-mode-pack-text flex-shrink-0">
                                <Package className="w-4 h-4" />
                            </div>
                            <span className="font-bold text-sm sm:text-base text-foreground flex-shrink-0">Pack Builder</span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap justify-end">
                            <PackSourcePopover
                                answers={sourceAnswers}
                                onApply={onApplySourceAnswers}
                                currentSearchTags={currentSearchTags}
                                postCount={loadedPostCount}
                                open={sourcePopoverOpen}
                                onOpenChange={onSourcePopoverOpenChange}
                            >
                                <button
                                    type="button"
                                    className="h-8 px-2.5 rounded-full border border-border/40 bg-muted/60 hover:bg-muted text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    {summarizePackSourceAnswers(sourceAnswers)} · {loadedPostCount} posts
                                </button>
                            </PackSourcePopover>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={onClearBase}
                                className="h-8 px-2.5 text-xs bg-destructive-soft hover:bg-destructive/20 text-destructive-text hover:text-destructive-text"
                            >
                                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                                <span className="hidden sm:inline">Change</span>
                            </Button>
                            <Button variant="ghost" size="sm" onClick={onExit} className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground">
                                Exit pack mode
                            </Button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto min-h-0 bg-muted/10">
                        <div className="p-4 sm:p-5 flex flex-col gap-4">
                            {hasSetupAnswers && (
                                <>
                                    {/* Base + what stays fixed */}
                                    <div className="rounded-xl border border-mode-pack-border bg-mode-pack-soft/60 dark:bg-mode-pack-soft p-4 space-y-3 shadow-xs">
                                        <div className="flex items-start gap-3">
                                            {baseCard ? (
                                                <div className="relative w-14 h-20 flex-shrink-0 rounded-md overflow-hidden bg-muted border">
                                                    {baseThumb && (
                                                        <Image
                                                            src={baseThumb}
                                                            alt={`Base post ${baseCard.id}`}
                                                            fill
                                                            className="object-cover"
                                                            unoptimized
                                                        />
                                                    )}
                                                </div>
                                            ) : null}
                                            <div className="flex-1 min-w-0 flex items-start justify-between gap-2">
                                                {baseCard ? (
                                                    <span className="text-xs text-muted-foreground pt-1">Base card #{baseCard.id}</span>
                                                ) : (
                                                    <p className="text-xs font-mono text-foreground/90 line-clamp-2 flex-1" title={basePrompt}>
                                                        {basePrompt || <span className="italic text-muted-foreground">No prompt set</span>}
                                                    </p>
                                                )}
                                                <Button type="button" variant="ghost" size="sm" onClick={baseCard ? onClearBase : onEditBasePrompt} className="h-7 px-2 text-[11px] flex-shrink-0">
                                                    <Pencil className="w-3 h-3 mr-1" />
                                                    {baseCard ? "Change" : "Edit"}
                                                </Button>
                                            </div>
                                        </div>

                                        <PackLockToggles
                                            lockedCategories={lockedCategories}
                                            toggleLockedCategory={toggleLockedCategory}
                                            lockedSlots={lockedSlots}
                                            toggleLockedSlot={toggleLockedSlot}
                                            baseClassified={baseClassified}
                                            tagOverrides={tagOverrides}
                                            lockedTags={lockedTags}
                                            customBaseText={customBaseText}
                                            onCustomBaseTextChange={onCustomBaseTextChange}
                                            hasMultipleCharacters={hasMultipleCharacters}
                                            noActiveAxes={activeAxisCategories.length === 0}
                                        />
                                    </div>

                                    <PackAdvancedPanel
                                        activeAxisCategories={activeAxisCategories}
                                        axisValues={axisValues}
                                        axisSlotGroups={axisSlotGroups}
                                        axisSlotCounts={axisSlotCounts}
                                        axisMaxPerPrompt={axisMaxPerPrompt}
                                        axisMinCounts={axisMinCounts}
                                        axisTagModes={axisTagModes}
                                        mutedSlots={mutedSlots}
                                        onAddAxisValue={onAddAxisValue}
                                        onRemoveAxisValue={onRemoveAxisValue}
                                        onReseedAxis={onReseedAxis}
                                        onSetAxisMinCount={onSetAxisMinCount}
                                        onSetAxisTagMode={onSetAxisTagMode}
                                        onSetAllAxisTagModes={onSetAllAxisTagModes}
                                        toggleMutedSlot={toggleMutedSlot}
                                        isSeeding={isSeeding}
                                        seedProgress={seedProgress}
                                        loadedPostCount={loadedPostCount}
                                        canLoadMorePosts={canLoadMorePosts}
                                        onLoadMorePosts={onLoadMorePosts}
                                        onResetLearning={onResetLearning}
                                    />

                                    {children}

                                    <PackResultsList
                                        prompts={prompts}
                                        onCopyPrompt={onCopyPrompt}
                                        onCopyAll={onCopyAll}
                                        onReroll={handleReroll}
                                        lockedSet={lockedSet}
                                        variedCategory={variedCategory}
                                    />
                                </>
                            )}
                        </div>
                    </div>

                    {/* Prompt count + Variety + generate — fixed at the bottom of the modal */}
                    {hasSetupAnswers && (
                        <div className="flex flex-col gap-3 p-3 sm:px-6 border-t border-border/50 bg-background/95 supports-[backdrop-filter]:bg-background/80 backdrop-blur-xl flex-shrink-0">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="flex items-center justify-center gap-3 w-full max-w-sm mx-auto">
                                    <Label htmlFor="pack-prompt-count" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
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
                                    <span className="text-xs font-bold text-mode-pack-text bg-mode-pack-soft px-2.5 py-0.5 rounded-full border border-mode-pack-border min-w-[2.25rem] text-center tabular-nums">
                                        {livePromptCount}
                                    </span>
                                </div>
                                <PackVarietySlider value={varietyLevel} onChange={onVarietyLevelChange} />
                            </div>

                            <div className="flex items-center justify-center">
                                <Button
                                    type="button"
                                    onClick={handleGenerateClick}
                                    className={`font-semibold shadow-sm transition-all duration-200 ${justGenerated ? 'bg-success hover:bg-success/90 text-success-foreground' : 'bg-mode-pack hover:bg-mode-pack/90 text-mode-pack-foreground'} px-8`}
                                >
                                    {justGenerated ? <Check className="w-4 h-4 mr-2" /> : <Shuffle className="w-4 h-4 mr-2" />}
                                    {justGenerated ? 'Generated!' : 'Generate'}
                                </Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </>
    )
}

export const PackBuilderStickyFooter = memo(PackBuilderStickyFooterComponent)
