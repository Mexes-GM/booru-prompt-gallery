import { useState, memo, useCallback, useMemo } from 'react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Trash2, Check, RefreshCw, Plus, Shirt, User, Mountain, Smile, Package, Shuffle, Copy, CopyCheck, X, Sparkles, RotateCcw } from "lucide-react"
import { BooruPost } from '@/lib/booru/types'
import { TagCategory } from '@/lib/tag-classifier'
import type { PackKind } from '@/hooks/use-pack-mode'
import { MAX_PACK_PROMPTS, type PackPrompt } from '@/lib/pack/pack-generator'
import { TAG_CATEGORY_ICONS } from '@/components/tag-category-icon'
import { motion, AnimatePresence } from 'framer-motion'
import Image from 'next/image'
import { getDanbooruProxyUrl } from "@/lib/proxy-url"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { TagAutocompleteTextarea } from "./tag-autocomplete-textarea"

export interface PackBuilderStickyFooterProps {
    isOpen: boolean
    baseCard: BooruPost | null
    /** True once the Pack Setup questionnaire has been confirmed — including
     *  a "Full Setup" run with no base card. Lets the builder Dialog open
     *  without requiring baseCard, while the hint still shows until either
     *  a base is picked or Full Setup is confirmed. */
    hasSetupAnswers: boolean
    packKind: PackKind
    setPackKind: (kind: PackKind) => void
    lockedCategories: Set<TagCategory>
    toggleLockedCategory: (category: TagCategory) => void
    /** Classified tags of the base card (5 buckets) — used to color each
     *  locked tag chip by its real category, since lockedTags itself is a
     *  flat array with the category info already stripped out. */
    baseClassified: Record<TagCategory, string[]>
    /** The actual tags pulled from the base card for whatever categories are
     *  currently locked (+ the custom base text, if any) — what's REALLY
     *  being fixed into every generated prompt, updated live as categories
     *  are toggled. Not just which categories are on. */
    lockedTags: string[]
    activeAxisCategories: TagCategory[]
    axisValues: Partial<Record<TagCategory, string[]>>
    onAddAxisValue: (category: TagCategory, value: string) => void
    onRemoveAxisValue: (category: TagCategory, value: string) => void
    onReseedAxis: (category: TagCategory) => void
    /** Minimum distinct values sampled per axis category on each generated prompt. */
    axisMinCounts: Partial<Record<TagCategory, number>>
    onSetAxisMinCount: (category: TagCategory, minCount: number) => void
    /** Free-text base prompt for the 'custom' pack kind. */
    customBaseText: string
    onCustomBaseTextChange: (text: string) => void
    /** True while extra pages are being fetched in the background to enrich axis pools. */
    isSeeding?: boolean
    /** Live seeding progress (posts loaded / target), for the progress bar. Null when idle. */
    seedProgress?: { current: number; target: number } | null
    /** Total posts currently loaded in the search results — the pool Pack Mode samples from. */
    loadedPostCount: number
    /** False once the search has hit noMoreResults or the session's page cap. */
    canLoadMorePosts: boolean
    /** Manually fetch more pages (same seedPages/rate-limit pipeline as the automatic seed). */
    onLoadMorePosts: () => void
    promptCount: number
    setPromptCount: (count: number) => void
    onRegenerate: () => void
    onClearBase: () => void
    onExit: () => void
    /** Opens the Pack Setup questionnaire without picking a base card first —
     *  lets the user configure a pack from scratch (custom/empty tags) instead
     *  of requiring "Use as base" on a search result. */
    onFullSetup: () => void
    /** Generated pack prompts (Task 5 results list). */
    prompts: PackPrompt[]
    /** Copy a single prompt to the clipboard. Receives the full PackPrompt
     *  (not just its text) so the caller can also credit the local learning
     *  model's positive signal for the values that produced it (§7.2). */
    onCopyPrompt: (prompt: PackPrompt) => void
    /** Copy every generated prompt, one per line, to the clipboard. */
    onCopyAll: (text: string) => void
    /**
     * Explore/Exploit control (docs/pack-mode-learning-plan.md §7.8) — 1 =
     * fully as-learned (favors what's been copied before), higher values
     * flatten axis sampling back toward uniform. Non-negotiable per the plan:
     * the user must be able to see and dial back the learning at any time.
     */
    explorationTemperature: number
    onExplorationTemperatureChange: (temperature: number) => void
    /** Clears all learned data (picks/shows), independent of explorationTemperature. */
    onResetLearning: () => void
    /** Rendered below the controls — extra content slot, if needed. */
    children?: React.ReactNode
}

const PACK_KIND_LABELS: Record<PackKind, string> = {
    character: 'Character',
    clothing: 'Clothing/Outfit',
    custom: 'Custom',
}

// Icons come from lib/tag-taxonomy.ts. Note this file previously used `User` for
// pose while quick-teach-modal used `PersonStanding` for the same category; the
// taxonomy settles on one so both surfaces match.
const CATEGORY_ICON: Record<TagCategory, typeof Smile> = TAG_CATEGORY_ICONS

const CATEGORY_ACTIVE_CLASS: Record<TagCategory, string> = {
    appearance: 'bg-blue-500/15 border-blue-500/30 text-blue-600 dark:text-blue-400 shadow-sm',
    pose: 'bg-purple-500/15 border-purple-500/30 text-purple-600 dark:text-purple-400 shadow-sm',
    clothing: 'bg-green-500/15 border-green-500/30 text-green-600 dark:text-green-400 shadow-sm',
    scenery: 'bg-orange-500/15 border-orange-500/30 text-orange-600 dark:text-orange-400 shadow-sm',
    other: 'bg-muted border-muted-foreground/30 text-foreground shadow-sm',
}

const CATEGORY_CHIP_CLASS: Record<TagCategory, string> = {
    appearance: 'text-blue-500 bg-blue-500/10 border-blue-500/20',
    pose: 'text-purple-500 bg-purple-500/10 border-purple-500/20',
    clothing: 'text-green-500 bg-green-500/10 border-green-500/20',
    scenery: 'text-orange-500 bg-orange-500/10 border-orange-500/20',
    other: 'text-muted-foreground bg-muted border-transparent',
}

const CATEGORY_SLIDER_CLASS: Record<TagCategory, string> = {
    appearance: '[&_[role=slider]]:border-blue-500 [&_[role=slider]]:focus-visible:ring-blue-500/50 [&_.relative>.absolute]:bg-blue-500',
    pose: '[&_[role=slider]]:border-purple-500 [&_[role=slider]]:focus-visible:ring-purple-500/50 [&_.relative>.absolute]:bg-purple-500',
    clothing: '[&_[role=slider]]:border-green-500 [&_[role=slider]]:focus-visible:ring-green-500/50 [&_.relative>.absolute]:bg-green-500',
    scenery: '[&_[role=slider]]:border-orange-500 [&_[role=slider]]:focus-visible:ring-orange-500/50 [&_.relative>.absolute]:bg-orange-500',
    other: '[&_[role=slider]]:border-muted-foreground [&_.relative>.absolute]:bg-muted-foreground',
}

const CATEGORIES: TagCategory[] = ['appearance', 'clothing', 'pose', 'scenery']

/** Hard ceiling for the "Min tags" slider — independent of the axis pool
 *  size (which can now hold up to 200 candidate values, see
 *  extractAxisValues in lib/pack/pack-generator.ts). Wanting 200 clothing
 *  tags crammed into a single prompt isn't useful variety, it's noise; 30 is
 *  already a dense, unusual pick for one category. */
const MAX_MIN_TAGS_SLIDER = 30

/** Single axis editor: label, re-sample button, chip list with remove + add-value input,
 *  and a "minimum tags from this category" slider (how many distinct values from the
 *  pool get sampled into every generated prompt, instead of always exactly one).
 *  onAdd/onRemove/onReseed/onMinCountChange are the STABLE, category-agnostic
 *  callbacks from usePackMode (each already a useCallback with an empty/stable
 *  dep array there) — category is bound locally via useCallback so the parent
 *  never has to mint a new per-category closure on every render. Binding it in
 *  the parent (factory(cat) => fn) defeats this component's memo() on every
 *  parent re-render, which was causing ALL axis editors' chip lists to
 *  re-animate (Framer Motion's layout/AnimatePresence popLayout) whenever ANY
 *  single category was re-sampled, not just the one that changed. */
const AxisEditor = memo(({
    category,
    values,
    minCount,
    onAdd,
    onRemove,
    onReseed,
    onMinCountChange,
}: {
    category: TagCategory
    values: string[]
    minCount: number
    onAdd: (category: TagCategory, value: string) => void
    onRemove: (category: TagCategory, value: string) => void
    onReseed: (category: TagCategory) => void
    onMinCountChange: (category: TagCategory, minCount: number) => void
}) => {
    const [draft, setDraft] = useState('')
    const Icon = CATEGORY_ICON[category]
    // Clamped to the pool size AND to MAX_MIN_TAGS_SLIDER — the pool itself
    // can hold up to 200 candidates now, but asking for anywhere near that
    // many distinct values in a single generated prompt isn't realistic
    // variety, it's just noise. The pool stays fully sampleable as chips;
    // only how many of them land in one prompt is capped here.
    const maxMinCount = Math.max(1, Math.min(values.length, MAX_MIN_TAGS_SLIDER))
    const clampedMinCount = Math.min(minCount, maxMinCount)

    // Re-sampling swaps the ENTIRE values array at once (unlike Add/Remove,
    // which change it by one entry) — animating that with layout + popLayout
    // tries to reflow/reposition every old chip exiting and every new chip
    // entering simultaneously, which visibly overshoots the chip list's
    // max-h-40 + overflow-y-auto container for a frame before it settles.
    // Bumping this key on every re-sample forces AnimatePresence to remount
    // the whole chip list (a clean fade, no layout reflow) instead of
    // reconciling it — the same list identity is preserved for normal
    // Add/Remove edits, which still get the nicer per-chip layout animation.
    const [resampleEpoch, setResampleEpoch] = useState(0)
    const handleReseedClick = useCallback(() => {
        setResampleEpoch((e) => e + 1)
        onReseed(category)
    }, [onReseed, category])
    const handleRemoveClick = useCallback((value: string) => onRemove(category, value), [onRemove, category])
    const handleMinCountCommit = useCallback((val: number) => onMinCountChange(category, val), [onMinCountChange, category])

    // Live display value while dragging, decoupled from the committed
    // minCount prop. Radix fires onValueChange on every pointer-move frame
    // during a drag — wiring that straight to onMinCountChange re-triggers
    // Pack Mode's generatedPrompts recompute (a cartesian product run through
    // Smart Tag Exclusion for every combination) dozens of times per second,
    // which is what was pegging the CPU and freezing the tab. Only the local
    // display updates during the drag; the real (expensive) update fires once
    // on release via onValueCommit.
    //
    // Synced to the committed prop during render (not via useEffect) using
    // the "adjust state during render" pattern React recommends for this
    // exact case — an effect here would itself violate the set-state-in-effect
    // rule and cost an extra render on every external change.
    const [liveMinCount, setLiveMinCount] = useState(clampedMinCount)
    const [prevClampedMinCount, setPrevClampedMinCount] = useState(clampedMinCount)
    if (clampedMinCount !== prevClampedMinCount) {
        setPrevClampedMinCount(clampedMinCount)
        setLiveMinCount(clampedMinCount)
    }

    const handleAdd = () => {
        const trimmed = draft.trim()
        if (!trimmed) return
        onAdd(category, trimmed)
        setDraft('')
    }

    return (
        <div className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-2 flex flex-col min-h-0">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                    <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold capitalize">{category}</span>
                    <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                        {values.length}
                    </span>
                </div>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={handleReseedClick}
                            className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                        >
                            <RefreshCw className="w-3 h-3 mr-1" />
                            Re-sample
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Re-sample values from the current results</TooltipContent>
                </Tooltip>
            </div>

            <div className="relative isolate flex flex-wrap gap-1.5 min-h-[1.75rem] content-start overflow-y-auto overflow-x-hidden max-h-40 pr-1">
                <AnimatePresence mode="popLayout" key={resampleEpoch}>
                    {values.map((value) => (
                        <motion.button
                            key={value}
                            type="button"
                            layout
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                            transition={{ type: "spring", stiffness: 500, damping: 30 }}
                            onClick={() => handleRemoveClick(value)}
                            className={`group px-2 py-1 rounded border text-xs font-mono cursor-pointer select-none flex items-center gap-1 max-w-full min-w-0 ${CATEGORY_CHIP_CLASS[category]}`}
                        >
                            <span className="truncate max-w-[140px]">{value}</span>
                            <X className="w-3 h-3 opacity-50 group-hover:opacity-100 flex-shrink-0" />
                        </motion.button>
                    ))}
                </AnimatePresence>
                {values.length === 0 && (
                    <span className="text-[11px] text-muted-foreground italic py-1">
                        No values yet — add one or re-sample from results.
                    </span>
                )}
            </div>

            <div className="flex items-center gap-1.5">
                <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd() } }}
                    placeholder={`Add a ${category} value...`}
                    className="h-7 text-xs"
                />
                <Button type="button" variant="secondary" size="sm" onClick={handleAdd} className="h-7 px-2">
                    <Plus className="w-3.5 h-3.5" />
                </Button>
            </div>

            {/* Min tags from this category per generated prompt — disabled with a
                single value in the pool, since there's nothing else to combine with. */}
            <div className="flex items-center gap-2 pt-1">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                    Min tags
                </span>
                <Slider
                    min={1}
                    max={maxMinCount}
                    step={1}
                    value={[liveMinCount]}
                    onValueChange={([val]) => setLiveMinCount(val)}
                    onValueCommit={([val]) => handleMinCountCommit(val)}
                    disabled={maxMinCount <= 1}
                    className={`flex-1 ${CATEGORY_SLIDER_CLASS[category]}`}
                />
                <span className="text-[10px] font-bold text-muted-foreground min-w-[1.25rem] text-center">
                    {liveMinCount}
                </span>
            </div>
        </div>
    )
})
AxisEditor.displayName = "AxisEditor"

/** A single generated prompt row: text + a per-item copy button with its own "Copied!" feedback. */
const PromptRow = memo(({ prompt, index, onCopy }: { prompt: PackPrompt; index: number; onCopy: (prompt: PackPrompt) => void }) => {
    const [isCopied, setIsCopied] = useState(false)

    const handleCopy = () => {
        onCopy(prompt)
        setIsCopied(true)
        setTimeout(() => setIsCopied(false), 2000)
    }

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="flex items-start gap-2 rounded-lg border border-border/50 bg-muted/30 p-2.5"
        >
            <span className="text-[10px] font-mono text-muted-foreground/70 mt-1 min-w-[1.5rem]">
                {String(index + 1).padStart(2, '0')}
            </span>
            <p className="flex-1 text-xs leading-relaxed font-mono break-words">{prompt.prompt}</p>
            <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleCopy}
                className={`h-7 w-7 flex-shrink-0 transition-colors ${isCopied ? 'text-green-600' : 'text-muted-foreground hover:text-foreground'}`}
                aria-label={`Copy prompt ${index + 1}`}
            >
                {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </Button>
        </motion.div>
    )
})
PromptRow.displayName = "PromptRow"

/** Results list: generated prompts with per-item copy + a "Copy all" action. */
const PackResultsList = memo(({
    prompts,
    onCopyPrompt,
    onCopyAll,
}: {
    prompts: PackPrompt[]
    onCopyPrompt: (prompt: PackPrompt) => void
    onCopyAll: (text: string) => void
}) => {
    const [isAllCopied, setIsAllCopied] = useState(false)

    const handleCopyAll = () => {
        if (prompts.length === 0) return
        onCopyAll(prompts.map((p) => p.prompt).join('\n'))
        setIsAllCopied(true)
        setTimeout(() => setIsAllCopied(false), 2000)
    }

    return (
        <div id="pack-results-section" className="space-y-2">
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Generated prompts {prompts.length > 0 && `(${prompts.length})`}
                </span>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCopyAll}
                    disabled={prompts.length === 0}
                    className={`h-7 text-xs transition-colors ${isAllCopied ? 'bg-green-500/10 text-green-600 border-green-500/30' : ''}`}
                >
                    {isAllCopied ? <CopyCheck className="w-3.5 h-3.5 mr-1.5" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
                    {isAllCopied ? 'Copied all!' : 'Copy all'}
                </Button>
            </div>

            {prompts.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-1.5 py-6 text-center rounded-lg border border-dashed border-border/50">
                    <p className="text-xs text-muted-foreground max-w-xs">
                        No prompts yet — add or re-sample some variation axis values above, then hit
                        {' '}<span className="font-medium">Generate</span>.
                    </p>
                </div>
            ) : (
                <div className="flex flex-col gap-1.5">
                    <AnimatePresence mode="popLayout">
                        {prompts.map((p, i) => (
                            <PromptRow key={`${i}-${p.prompt}`} prompt={p} index={i} onCopy={onCopyPrompt} />
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
    hasSetupAnswers,
    packKind,
    setPackKind,
    lockedCategories,
    toggleLockedCategory,
    baseClassified,
    lockedTags,
    activeAxisCategories,
    axisValues,
    onAddAxisValue,
    onRemoveAxisValue,
    onReseedAxis,
    axisMinCounts,
    onSetAxisMinCount,
    customBaseText,
    onCustomBaseTextChange,
    isSeeding = false,
    seedProgress = null,
    loadedPostCount,
    canLoadMorePosts,
    onLoadMorePosts,
    promptCount,
    setPromptCount,
    onRegenerate,
    onClearBase,
    onExit,
    onFullSetup,
    prompts,
    onCopyPrompt,
    onCopyAll,
    explorationTemperature,
    onExplorationTemperatureChange,
    onResetLearning,
    children,
}: PackBuilderStickyFooterProps) => {

    // Generate gives no visible feedback on its own — confirm on the button
    // itself and scroll the results into view so the change is unmistakable.
    const [justGenerated, setJustGenerated] = useState(false)
    const handleGenerateClick = useCallback(() => {
        onRegenerate()
        setJustGenerated(true)
        setTimeout(() => setJustGenerated(false), 1200)
        document.getElementById('pack-results-section')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, [onRegenerate])

    // Live display value while dragging the "Prompts" count slider, decoupled
    // from the committed promptCount prop — same reasoning as AxisEditor's
    // liveMinCount: onValueChange fires every pointer-move frame during a
    // drag, and wiring that straight to setPromptCount re-triggers Pack
    // Mode's generatedPrompts recompute (which can enumerate a large
    // cartesian product through Smart Tag Exclusion) dozens of times a
    // second — the CPU spike / freeze on slider drag. Commit only on release.
    // Synced during render (not via useEffect), same pattern as AxisEditor.
    const [livePromptCount, setLivePromptCount] = useState(promptCount)
    const [prevPromptCount, setPrevPromptCount] = useState(promptCount)
    if (promptCount !== prevPromptCount) {
        setPrevPromptCount(promptCount)
        setLivePromptCount(promptCount)
    }

    // Same live-drag decoupling pattern as livePromptCount above — the
    // Explore/Exploit slider only commits (and re-triggers weight
    // recomputation on the NEXT Generate) on release, not on every drag frame.
    const [liveExplorationTemperature, setLiveExplorationTemperature] = useState(explorationTemperature)
    const [prevExplorationTemperature, setPrevExplorationTemperature] = useState(explorationTemperature)
    if (explorationTemperature !== prevExplorationTemperature) {
        setPrevExplorationTemperature(explorationTemperature)
        setLiveExplorationTemperature(explorationTemperature)
    }

    const [justResetLearning, setJustResetLearning] = useState(false)
    const handleResetLearningClick = useCallback(() => {
        onResetLearning()
        setJustResetLearning(true)
        setTimeout(() => setJustResetLearning(false), 1200)
    }, [onResetLearning])

    const baseThumb = baseCard ? (() => {
        const rawUrl = baseCard.preview_file_url || baseCard.file_url
        const provider = baseCard._provider || 'danbooru'
        if (provider === 'danbooru' && rawUrl) return getDanbooruProxyUrl(rawUrl)
        return rawUrl
    })() : null

    // Maps each locked tag back to its category (for chip coloring) — tags
    // from the base card's classified buckets get their real category color;
    // anything else (the custom base prompt's free-text tags) falls back to
    // the neutral "other" style, since they don't belong to any bucket.
    const lockedTagCategory = useMemo(() => {
        const map = new Map<string, TagCategory>()
        ;(Object.keys(baseClassified) as TagCategory[]).forEach((cat) => {
            baseClassified[cat]?.forEach((tag) => map.set(tag, cat))
        })
        return map
    }, [baseClassified])

    // Closing the dialog (X, Escape, or backdrop click) clears the base and
    // any confirmed setup answers (via onClearBase) — Pack Mode itself stays
    // active so "Use as base" / "Full Setup" are still available.
    const handleDialogOpenChange = useCallback((open: boolean) => {
        if (!open) onClearBase()
    }, [onClearBase])

    return (
        <>
            {/* Instructional hint while Pack Mode is on but no base is picked yet and no
                setup has been confirmed — the builder dialog below opens once either a
                base card is selected ("Use as base") or "Full Setup" is confirmed. */}
            <AnimatePresence>
                {isOpen && !baseCard && !hasSetupAnswers && (
                    <motion.div
                        key="pack-hint"
                        initial={{ y: 80, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 80, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 220, damping: 26 }}
                        className="fixed bottom-6 left-0 right-0 mx-auto z-50 w-[95%] max-w-lg rounded-2xl border shadow-2xl bg-background/95 backdrop-blur-xl p-4 flex items-center gap-3"
                    >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <Package className="w-5 h-5 text-teal-600 dark:text-teal-400 flex-shrink-0" />
                            <p className="text-sm text-muted-foreground min-w-0">
                                Hover a card and click <span className="font-medium text-foreground">&quot;Use as base&quot;</span> to build a pack.
                            </p>
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onFullSetup}
                            className="flex-shrink-0 border-teal-500/30 text-teal-600 dark:text-teal-400 hover:bg-teal-500/10 hover:text-teal-700 dark:hover:text-teal-300"
                        >
                            Full Setup
                        </Button>
                        <Button variant="ghost" size="icon" onClick={onExit} className="h-8 w-8 rounded-full hover:bg-muted flex-shrink-0" aria-label="Exit pack mode">
                            <X className="w-4 h-4" />
                        </Button>
                    </motion.div>
                )}
            </AnimatePresence>

            <Dialog open={isOpen && (!!baseCard || hasSetupAnswers)} onOpenChange={handleDialogOpenChange}>
                <DialogContent
                    className="max-w-4xl w-[95vw] h-[90vh] max-h-[90vh] p-0 gap-0 flex flex-col overflow-hidden"
                    onEscapeKeyDown={onExit}
                >
                    <DialogTitle className="sr-only">Pack Builder</DialogTitle>

                    {/* Header — outside the scroll area so it's always visible. The native
                        Dialog close (X, top-right) clears the base and returns to the hint
                        state; "Exit pack mode" here fully leaves Pack Mode. */}
                    <div className="flex items-center justify-between gap-2 flex-wrap p-4 pb-3 pr-12 border-b border-border/50 flex-shrink-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <Package className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                            <span className="font-bold text-sm sm:text-base">Pack Builder</span>
                            {baseCard && (
                                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                                    base #{baseCard.id}
                                </span>
                            )}
                            {/* Post pool counter + manual "Load more" — sampling is drawn from
                                whatever's loaded in the search results right now; more posts
                                means richer/more varied axis pools. Same seedPages pipeline
                                (search.loadMore(), rate-limit-respecting) as the automatic seed
                                on base selection, just chasing a higher target on demand. */}
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full tabular-nums">
                                        {loadedPostCount} posts loaded
                                    </span>
                                </TooltipTrigger>
                                <TooltipContent>Sampling pool for variation axes — more posts loaded means richer, more varied values.</TooltipContent>
                            </Tooltip>
                            {!isSeeding && (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={onLoadMorePosts}
                                            disabled={!canLoadMorePosts}
                                            className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                                        >
                                            <RefreshCw className="w-3 h-3 mr-1" />
                                            Load more posts
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {canLoadMorePosts
                                            ? "Fetch more posts to sample from (metadata only, no images — same rate limits as normal browsing)"
                                            : "No more posts available for this search, or the session's page limit was reached"}
                                    </TooltipContent>
                                </Tooltip>
                            )}
                            {isSeeding && (
                                <span className="flex items-center gap-1 text-[10px] text-teal-600 dark:text-teal-400 bg-teal-500/10 px-2 py-0.5 rounded-full tabular-nums">
                                    <RefreshCw className="w-3 h-3 animate-spin" />
                                    {seedProgress ? `Loading posts… (${seedProgress.current}/${seedProgress.target})` : 'Loading more posts…'}
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={onClearBase}
                                className="bg-red-500/10 hover:bg-red-500/20 text-red-600 hover:text-red-700"
                            >
                                <Trash2 className="w-4 h-4 mr-2" />
                                <span className="hidden sm:inline">Clear</span>
                            </Button>
                            <Button variant="ghost" size="sm" onClick={onExit} className="text-muted-foreground hover:text-foreground">
                                Exit pack mode
                            </Button>
                        </div>
                    </div>

                    {/* Seeding progress bar — only visible while actively fetching more
                        pages (automatic on base selection, or manual via "Load more
                        posts"). Uses seedProgress.current/target since count-based ETAs
                        via posts loaded are more meaningful here than a page counter. */}
                    {isSeeding && seedProgress && (
                        <div className="h-1 bg-muted flex-shrink-0 overflow-hidden">
                            <motion.div
                                className="h-full bg-teal-500"
                                initial={{ width: 0 }}
                                animate={{ width: `${Math.min(100, (seedProgress.current / seedProgress.target) * 100)}%` }}
                                transition={{ type: "tween", duration: 0.3 }}
                            />
                        </div>
                    )}
                    <div className="flex-1 overflow-y-auto min-h-0">
                        <div className="p-4 flex flex-col gap-4">
                            {(baseCard || hasSetupAnswers) && (
                                <>
                                    {/* Base card + pack kind selector — only shown when there's an
                                        actual base card; Full Setup (no base) skips straight to the
                                        custom base prompt / locked categories below. */}
                                    {baseCard && (
                                    <div className="flex items-start gap-3">
                                        <div className="relative w-16 h-24 flex-shrink-0 rounded-md overflow-hidden bg-muted border">
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
                                        <div className="flex-1 space-y-2">
                                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Pack type</span>
                                            <div className="grid grid-cols-3 gap-1.5">
                                                {(Object.keys(PACK_KIND_LABELS) as PackKind[]).map((kind) => {
                                                    const isSelected = packKind === kind
                                                    return (
                                                        <button
                                                            type="button"
                                                            key={kind}
                                                            onClick={() => setPackKind(kind)}
                                                            className={`relative overflow-hidden flex items-center justify-center py-2 text-xs font-medium rounded-md border transition-all duration-200 ${isSelected ? 'bg-teal-500/15 border-teal-500/30 text-teal-600 dark:text-teal-400 shadow-sm' : 'bg-muted/30 border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}
                                                        >
                                                            {isSelected && <Check className="w-3 h-3 mr-1" />}
                                                            {PACK_KIND_LABELS[kind]}
                                                        </button>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                    )}

                                    {/* Custom pack kind: free-text invariable base prompt, merged into
                                        every generated prompt alongside whatever categories are locked. */}
                                    <AnimatePresence initial={false}>
                                        {packKind === 'custom' && (
                                            <motion.div
                                                key="custom-base-text"
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: 'auto', opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                transition={{ duration: 0.2 }}
                                                className="overflow-hidden"
                                            >
                                                <div className="space-y-1.5 pt-0.5">
                                                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                                        Custom base prompt (always included)
                                                    </span>
                                                    <TagAutocompleteTextarea
                                                        value={customBaseText}
                                                        onValueChange={onCustomBaseTextChange}
                                                        placeholder="e.g. 1girl, mona (genshin impact), masterpiece..."
                                                        className="text-xs font-mono min-h-[3.5rem] resize-none"
                                                    />
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>

                                    {/* Locked categories (constant) — only meaningful with a real
                                        base card to pull tags from; Full Setup relies solely on the
                                        custom base prompt above instead. */}
                                    {baseCard && (
                                    <div className="space-y-1.5">
                                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Locked (constant)</span>
                                        <div className="grid grid-cols-4 gap-1.5">
                                            {CATEGORIES.map((cat) => {
                                                const isLocked = lockedCategories.has(cat)
                                                const Icon = CATEGORY_ICON[cat]
                                                return (
                                                    <button
                                                        type="button"
                                                        key={cat}
                                                        onClick={() => toggleLockedCategory(cat)}
                                                        className={`relative overflow-hidden flex items-center justify-center gap-1 py-2 text-xs font-medium rounded-md border transition-all duration-200 ${isLocked ? CATEGORY_ACTIVE_CLASS[cat] : 'bg-muted/30 border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}
                                                    >
                                                        <Icon className="w-3 h-3" />
                                                        <span className="capitalize">{cat}</span>
                                                    </button>
                                                )
                                            })}
                                        </div>

                                        {/* Live preview of what's actually locked — the real tags
                                            behind the toggles above, updated instantly as categories
                                            are switched on/off. Read-only; edit via the toggles or the
                                            custom base prompt instead. */}
                                        <div className="flex flex-wrap gap-1.5 min-h-[1.75rem] content-start rounded-md border border-dashed border-border/50 bg-muted/20 p-2">
                                            {lockedTags.length > 0 ? (
                                                lockedTags.map((tag) => {
                                                    const cat = lockedTagCategory.get(tag) ?? 'other'
                                                    return (
                                                        <span
                                                            key={tag}
                                                            className={`px-2 py-0.5 rounded border text-[11px] font-mono ${CATEGORY_CHIP_CLASS[cat]}`}
                                                        >
                                                            {tag}
                                                        </span>
                                                    )
                                                })
                                            ) : (
                                                <span className="text-[11px] text-muted-foreground italic py-1">
                                                    Nothing locked yet — lock a category above or add a custom base prompt.
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    )}

                                    {/* Axis editors for the non-locked categories */}
                                    {activeAxisCategories.length > 0 && (
                                        <div className="space-y-2">
                                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Variation axes</span>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                                {activeAxisCategories.map((cat) => (
                                                    <AxisEditor
                                                        key={cat}
                                                        category={cat}
                                                        values={axisValues[cat] || []}
                                                        minCount={axisMinCounts[cat] ?? 1}
                                                        onAdd={onAddAxisValue}
                                                        onRemove={onRemoveAxisValue}
                                                        onReseed={onReseedAxis}
                                                        onMinCountChange={onSetAxisMinCount}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {children}

                                    <PackResultsList
                                        prompts={prompts}
                                        onCopyPrompt={onCopyPrompt}
                                        onCopyAll={onCopyAll}
                                    />
                                </>
                            )}
                        </div>
                    </div>

                    {/* Prompt count + generate — fixed at the bottom of the modal, always visible */}
                    {baseCard && (
                        <div className="flex flex-col gap-3 p-4 pt-3 border-t border-border/50 bg-background/95 supports-[backdrop-filter]:bg-background/80 backdrop-blur-xl flex-shrink-0">
                            {/* Explore/Exploit control (§7.8, non-negotiable per the plan):
                                lets the user dial the local learning model's influence on
                                axis sampling back to uniform at any time, and wipe the
                                learned data entirely if it ever starts steering somewhere
                                unwanted. Never hidden behind an extra click — it's exactly
                                as visible as the Prompts count control it sits next to. */}
                            <div className="flex items-center gap-3 flex-wrap">
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                                            <Sparkles className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 flex-shrink-0" />
                                            <Label htmlFor="pack-exploration-temperature" className="text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                                                Exploit / Explore
                                            </Label>
                                            <Slider
                                                id="pack-exploration-temperature"
                                                min={1}
                                                max={10}
                                                step={0.5}
                                                value={[liveExplorationTemperature]}
                                                onValueChange={([val]) => setLiveExplorationTemperature(val)}
                                                onValueCommit={([val]) => onExplorationTemperatureChange(val)}
                                                className="[&_[role=slider]]:border-teal-500 [&_[role=slider]]:focus-visible:ring-teal-500/50 [&_.relative>.absolute]:bg-teal-500 cursor-grab active:cursor-grabbing flex-1"
                                            />
                                            <span className="text-[10px] font-bold text-muted-foreground min-w-[3rem] text-center">
                                                {liveExplorationTemperature <= 1.5 ? 'Exploit' : liveExplorationTemperature >= 8.5 ? 'Explore' : 'Mixed'}
                                            </span>
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-xs">
                                        Low = favors axis values you've copied before. High = ignores learning and samples evenly again.
                                    </TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={handleResetLearningClick}
                                            className={`h-7 px-2 text-[10px] transition-colors flex-shrink-0 ${justResetLearning ? 'text-green-600' : 'text-muted-foreground hover:text-foreground'}`}
                                        >
                                            {justResetLearning ? <Check className="w-3 h-3 mr-1" /> : <RotateCcw className="w-3 h-3 mr-1" />}
                                            {justResetLearning ? 'Reset!' : 'Reset learning'}
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Forget everything learned from copied/removed/added values (does not affect the slider above)</TooltipContent>
                                </Tooltip>
                            </div>

                            <div className="flex items-center gap-3 flex-wrap">
                                <div className="flex items-center gap-2 flex-1 min-w-[180px]">
                                    <Label htmlFor="pack-prompt-count" className="text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
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
                                        className="[&_[role=slider]]:border-teal-500 [&_[role=slider]]:focus-visible:ring-teal-500/50 [&_.relative>.absolute]:bg-teal-500 cursor-grab active:cursor-grabbing flex-1"
                                    />
                                    <span className="text-xs font-bold text-teal-600 bg-teal-500/10 px-2 py-0.5 rounded-full min-w-[2.5rem] text-center">
                                        {livePromptCount}
                                    </span>
                                </div>
                                <Button
                                    type="button"
                                    onClick={handleGenerateClick}
                                    className={`transition-colors ${justGenerated ? 'bg-green-600 hover:bg-green-700' : 'bg-teal-600 hover:bg-teal-700'} text-white`}
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
