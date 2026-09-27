import { useState, memo, useCallback, useMemo } from 'react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Trash2, Check, RefreshCw, Plus, Smile, Package, Shuffle, Copy, CopyCheck, X, Lock, ChevronDown } from "lucide-react"
import { BooruPost } from '@/lib/booru/types'
import { TagCategory } from '@/lib/tag-classifier'
import { MAX_PACK_PROMPTS, MAX_MIN_TAGS_SLIDER, MAX_MIN_PACKS_SLIDER, type PackPrompt, type AxisTagMode, type SlotGroup } from '@/lib/pack/pack-generator'
import { TAG_CATEGORY_ICONS } from '@/components/tag-category-icon'
import { PACK_AXES, TAG_CATEGORIES, formatSubcategoryLabel, getTagSlotFromOverrides, slotsOf } from '@/lib/tag-taxonomy'
import { splitCommaSeparatedTags } from '@/lib/utils/tag-utils'
import { motion, AnimatePresence } from 'framer-motion'
import { useLowMotion } from '@/hooks/use-low-motion'
import { useCopyFeedback } from '@/hooks/use-copy-feedback'
import Image from 'next/image'
import { getDanbooruProxyUrl } from "@/lib/proxy-url"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { TagAutocompleteTextarea } from "./tag-autocomplete-textarea"
import { RemovableTagChip } from './removable-tag-chip'
import { CATEGORY_ACTIVE_CLASS, CATEGORY_CHIP_CLASS, CATEGORY_SLIDER_CLASS, CATEGORY_CONTAINER_CLASS, CATEGORY_TEXT_CLASS } from './category-chip-styles'

export interface PackBuilderStickyFooterProps {
    isOpen: boolean
    baseCard: BooruPost | null
    /** True once the Pack Setup questionnaire has been confirmed — including
     *  a "Full Setup" run with no base card. Lets the builder Dialog open
     *  without requiring baseCard, while the hint still shows until either
     *  a base is picked or Full Setup is confirmed. */
    hasSetupAnswers: boolean
    lockedCategories: Set<TagCategory>
    toggleLockedCategory: (category: TagCategory) => void
    /** Slots locked inside a partially locked category (see usePackMode). */
    lockedSlots: Set<string>
    toggleLockedSlot: (slot: string) => void
    /** Slots switched off inside varying categories. */
    mutedSlots: Set<string>
    toggleMutedSlot: (slot: string) => void
    /** Visible pool per axis, grouped by slot. */
    axisSlotGroups: Partial<Record<TagCategory, SlotGroup[]>>
    /** Pool size per slot before muting, for the slot pills. */
    axisSlotCounts: Partial<Record<TagCategory, Record<string, number>>>
    /** Most values one prompt can take per axis under the slot constraints. */
    axisMaxPerPrompt: Partial<Record<TagCategory, number>>
    /** Overrides used to resolve each base-card tag's slot. */
    tagOverrides: Record<string, string>
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
    /** Mode of tag collection for each axis ('individual' tags vs 'bundle' card sets). */
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
    /** Whether an automatic or manual seed fetch is currently in flight. */
    isSeeding?: boolean
    seedProgress?: { current: number; target: number } | null
    /** How many posts are currently loaded in the seed search pool. */
    loadedPostCount: number
    /** Whether more pages can be fetched for this search. */
    canLoadMorePosts: boolean
    onLoadMorePosts: () => void
    promptCount: number
    setPromptCount: (count: number) => void
    onRegenerate: () => void
    onClearBase: () => void
    onExit: () => void
    onFullSetup?: () => void
    prompts: PackPrompt[]
    /** Copy a single prompt to the clipboard. Receives the full PackPrompt
     *  (not just its text) so the caller can also credit the local learning
     *  model's positive signal for the values that produced it (§7.2). */
    onCopyPrompt: (prompt: PackPrompt) => void
    /** Copy every generated prompt, one per line, to the clipboard. */
    onCopyAll: (text: string) => void
    /** Optional learning params kept for backwards compatibility; now handled backend-only */
    explorationTemperature?: number
    onExplorationTemperatureChange?: (temperature: number) => void
    onResetLearning?: () => void
    /** Rendered below the controls — extra content slot, if needed. */
    children?: React.ReactNode
}

// Icons come from lib/tag-taxonomy.ts. Note this file previously used `User` for
// pose while quick-teach-modal used `PersonStanding` for the same category; the
// taxonomy settles on one so both surfaces match.
const CATEGORY_ICON: Record<TagCategory, typeof Smile> = TAG_CATEGORY_ICONS

// Per-category color classes (CATEGORY_ACTIVE_CLASS, CATEGORY_CHIP_CLASS,
// CATEGORY_SLIDER_CLASS) now live in ./category-chip-styles, shared with the
// Merge/Variations sticky footer (previously a duplicate copy — see plan U3/3.1).

const CATEGORIES: TagCategory[] = [...PACK_AXES]

const EMPTY_GROUPS: SlotGroup[] = []
const EMPTY_COUNTS: Record<string, number> = {}

function slotLabel(slot: string | null): string {
    return slot ? formatSubcategoryLabel(slot.split(':')[1]) : 'unsorted'
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

const AxisEditor = memo(({
    category,
    values,
    groups,
    slotCounts,
    mutedSlots,
    maxPerPrompt,
    minCount,
    mode = 'individual',
    onAdd,
    onRemove,
    onReseed,
    onMinCountChange,
    onModeChange,
    onToggleMute,
}: {
    category: TagCategory
    values: string[]
    groups: SlotGroup[]
    slotCounts: Record<string, number>
    mutedSlots: Set<string>
    /** Most values one prompt can take under the slot constraints (0 = unknown). */
    maxPerPrompt: number
    minCount: number
    mode?: AxisTagMode
    onAdd: (category: TagCategory, value: string) => void
    onRemove: (category: TagCategory, value: string) => void
    onReseed: (category: TagCategory) => void
    onMinCountChange: (category: TagCategory, minCount: number) => void
    onModeChange?: (category: TagCategory, mode: AxisTagMode) => void
    onToggleMute: (slot: string) => void
}) => {
    const [draft, setDraft] = useState('')
    const Icon = CATEGORY_ICON[category]
    const lowMotion = useLowMotion()
    // Tags: capped by what the slot constraints let one prompt hold (e.g. pose
    // tops out around 5), so the slider never promises picks that would be
    // dropped. Packs: pool size, up to MAX_MIN_PACKS_SLIDER.
    const maxSliderCeiling = mode === 'bundle'
        ? MAX_MIN_PACKS_SLIDER
        : Math.min(MAX_MIN_TAGS_SLIDER, maxPerPrompt > 0 ? maxPerPrompt : MAX_MIN_TAGS_SLIDER)
    const maxMinCount = Math.max(1, Math.min(values.length, maxSliderCeiling))

    // Slot pills: every slot this axis has candidates in (muted ones included,
    // so they can be switched back on), in taxonomy order.
    const pillSlots = useMemo(
        () => slotsOf(category).filter((slot) => (slotCounts[slot] ?? 0) > 0),
        [category, slotCounts]
    )
    const showGrouping = mode === 'individual' && groups.some((g) => g.slot !== null)
    const clampedMinCount = Math.max(0, Math.min(minCount, maxMinCount))

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

    const isDeactivated = liveMinCount === 0
    const containerTheme = CATEGORY_CONTAINER_CLASS[category] || CATEGORY_CONTAINER_CLASS.other
    const textTheme = CATEGORY_TEXT_CLASS[category] || CATEGORY_TEXT_CLASS.other

    return (
        <div
            className={`rounded-xl border p-3 space-y-2.5 flex flex-col justify-between min-h-0 transition-all duration-200 shadow-xs ${containerTheme} ${
                isDeactivated ? 'opacity-60 saturate-50 hover:opacity-80 transition-opacity' : ''
            }`}
        >
            <div className="flex items-center justify-between gap-1.5 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                    <div className={`p-1.5 rounded-lg bg-background/80 dark:bg-background/60 border border-border/40 ${textTheme} flex-shrink-0`}>
                        <Icon className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-xs font-semibold capitalize truncate text-foreground">{category}</span>
                    <span className="text-[10px] font-medium text-muted-foreground bg-background/80 dark:bg-background/60 px-1.5 py-0.5 rounded-full border border-border/40 flex-shrink-0 tabular-nums">
                        {values.length} {mode === 'bundle' ? (values.length === 1 ? 'pack' : 'packs') : (values.length === 1 ? 'tag' : 'tags')}
                    </span>
                    {isDeactivated && (
                        <span className="text-[9px] font-semibold text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border/50 uppercase tracking-wider flex-shrink-0">
                            Off
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                    {/* Toggle between Individual Tags and Card Bundles */}
                    <div className="flex items-center rounded-md border border-border/60 bg-background/80 dark:bg-background/60 p-0.5 text-[10px]">
                        <button
                            type="button"
                            onClick={() => onModeChange?.(category, 'individual')}
                            className={`px-1.5 py-0.5 rounded transition-all ${
                                mode === 'individual'
                                    ? 'bg-muted text-foreground font-semibold shadow-xs'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                            title="Individual tags mode: mix and match loose tags"
                        >
                            Tags
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                onModeChange?.(category, 'bundle')
                                if (minCount > MAX_MIN_PACKS_SLIDER) {
                                    onMinCountChange(category, MAX_MIN_PACKS_SLIDER)
                                }
                            }}
                            className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-all ${
                                mode === 'bundle'
                                    ? 'bg-mode-pack/20 text-mode-pack-text font-semibold shadow-xs'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                            title="Packs mode: keep full card outfits/sets together"
                        >
                            <Package className="w-2.5 h-2.5" />
                            Packs
                        </button>
                    </div>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={handleReseedClick}
                                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground hover:bg-background/60 flex items-center justify-center"
                            >
                                <RefreshCw className="w-3 h-3" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Re-sample {mode === 'bundle' ? 'packs' : 'values'} from current results</TooltipContent>
                    </Tooltip>
                </div>
            </div>

            {/* Slot pills: click to switch a slot off/on for this axis. Only
                when there's a real choice (2+ slots) or something is muted. */}
            {mode === 'individual' && (pillSlots.length > 1 || pillSlots.some((s) => mutedSlots.has(s))) && (
                <div className="flex flex-wrap gap-1" role="group" aria-label={`${category} slots`}>
                    {pillSlots.map((slot) => {
                        const muted = mutedSlots.has(slot)
                        return (
                            <button
                                type="button"
                                key={slot}
                                onClick={() => onToggleMute(slot)}
                                aria-pressed={!muted}
                                title={muted ? `Turn ${slotLabel(slot)} back on` : `Stop varying ${slotLabel(slot)}`}
                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] transition-colors ${
                                    muted
                                        ? 'border-dashed border-border/60 text-muted-foreground/60 line-through hover:text-muted-foreground'
                                        : `${CATEGORY_CHIP_CLASS[category]} hover:opacity-80`
                                }`}
                            >
                                {slotLabel(slot)}
                                <span className="tabular-nums opacity-60">{slotCounts[slot]}</span>
                            </button>
                        )
                    })}
                </div>
            )}

            <div className="relative isolate flex flex-wrap gap-1.5 h-36 min-h-[9rem] max-h-36 content-start overflow-y-auto overflow-x-hidden p-2 rounded-lg bg-background/80 dark:bg-background/40 border border-border/40 dark:border-border/30">
                <AnimatePresence mode="popLayout" key={resampleEpoch}>
                    {(showGrouping ? groups : [{ slot: null, values }]).flatMap((group) => [
                        showGrouping ? (
                            <motion.div
                                key={`slot-header:${group.slot ?? 'none'}`}
                                layout={!lowMotion}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="basis-full flex items-center gap-1.5 pt-1 first:pt-0 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/80"
                            >
                                {slotLabel(group.slot)}
                                <span className="h-px flex-1 bg-border/50" />
                            </motion.div>
                        ) : null,
                        ...group.values.map((value) => {
                        if (mode === 'bundle') {
                            return (
                                <motion.div
                                    key={value}
                                    layout={!lowMotion}
                                    initial={lowMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
                                    animate={lowMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                                    exit={lowMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
                                    transition={lowMotion ? { duration: 0.15 } : { type: "spring", stiffness: 450, damping: 30 }}
                                    className="group relative flex items-center gap-1.5 rounded-md border border-mode-pack-border bg-mode-pack-soft hover:bg-mode-pack/20 px-2 py-1 text-xs shadow-xs transition-colors max-w-full"
                                >
                                    <Package className="w-3 h-3 text-mode-pack-text flex-shrink-0" />
                                    <span className="font-mono text-[11px] truncate max-w-[190px] text-foreground/90" title={value}>
                                        {value}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => handleRemoveClick(value)}
                                        aria-label="Remove pack"
                                        className="opacity-50 hover:opacity-100 hover:text-destructive-text transition-opacity flex-shrink-0 ml-0.5"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                </motion.div>
                            )
                        }
                        return (
                            <RemovableTagChip
                                key={value}
                                text={value}
                                category={category}
                                onRemove={() => handleRemoveClick(value)}
                                exitVariant="fade"
                                reducedMotion={lowMotion}
                            />
                        )
                    }),
                    ])}
                </AnimatePresence>
                {values.length === 0 && (
                    <span className="text-[11px] text-muted-foreground italic py-1">
                        {mode === 'bundle'
                            ? "No packs yet — add one or re-sample from results."
                            : "No values yet — add one or re-sample from results."}
                    </span>
                )}
            </div>

            <div className="flex items-center gap-1.5">
                <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd() } }}
                    placeholder={mode === 'bundle' ? `Add a ${category} pack (e.g. tag1, tag2)...` : `Add a ${category} tag...`}
                    className="h-7 text-xs bg-background/90 dark:bg-background/80 border-border/50 focus-visible:ring-1 focus-visible:ring-mode-pack/50"
                />
                <Button type="button" variant="secondary" size="sm" onClick={handleAdd} className="h-7 px-2 border border-border/40 hover:bg-background/60">
                    <Plus className="w-3.5 h-3.5" />
                </Button>
            </div>

            {/* Min tags from this category per generated prompt — slide to 0 to deactivate. */}
            <div className="flex items-center gap-2 pt-1.5 border-t border-border/30">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                    {mode === 'bundle' ? 'Min packs' : 'Min tags'}
                </span>
                <Slider
                    min={0}
                    max={maxMinCount}
                    step={1}
                    value={[liveMinCount]}
                    onValueChange={([val]) => setLiveMinCount(val)}
                    onValueCommit={([val]) => handleMinCountCommit(val)}
                    disabled={values.length === 0}
                    className={`flex-1 ${CATEGORY_SLIDER_CLASS[category]}`}
                />
                <span className="text-[10px] font-bold text-muted-foreground min-w-[1.25rem] text-center tabular-nums">
                    {liveMinCount === 0 ? 'Off' : liveMinCount}
                </span>
            </div>
        </div>
    )
})
AxisEditor.displayName = "AxisEditor"

/** A single generated prompt row: text + a per-item copy button with its own "Copied!" feedback. */
const PromptRow = memo(({
    prompt,
    index,
    onCopy,
    lockedSet,
    variedCategory,
}: {
    prompt: PackPrompt
    index: number
    onCopy: (prompt: PackPrompt) => void
    /** Bare base tags, shown muted. */
    lockedSet: ReadonlySet<string>
    /** Bare varied tag -> its axis, shown in that axis's colour. */
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
                    // Only axis values are coloured; base tags and anything the
                    // cleaner adds (quality tags, characters) read as constant.
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

/** Results list: generated prompts with per-item copy + a "Copy all" action. */
const PackResultsList = memo(({
    prompts,
    onCopyPrompt,
    onCopyAll,
    lockedSet,
    variedCategory,
}: {
    prompts: PackPrompt[]
    onCopyPrompt: (prompt: PackPrompt) => void
    onCopyAll: (text: string) => void
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
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-mode-pack text-mode-pack-foreground text-xs font-bold shadow-xs">
                        3
                    </span>
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
                        No prompts yet — adjust base tags and variation axes above, then click <span className="font-semibold text-foreground">Generate</span> in the bottom toolbar.
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
    hasSetupAnswers,
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

    // How many base-card tags sit in each slot — shown on the lock pills so
    // "lock footwear" visibly means "keep these 1 tag(s)" vs "keep none".
    const baseSlotCounts = useMemo(() => {
        const counts: Record<string, number> = {}
        CATEGORIES.forEach((cat) => {
            baseClassified[cat]?.forEach((tag) => {
                const slot = getTagSlotFromOverrides(tag, tagOverrides)?.slot
                if (slot) counts[slot] = (counts[slot] ?? 0) + 1
            })
        })
        return counts
    }, [baseClassified, tagOverrides])

    const lockedSlotCount = useCallback(
        (cat: TagCategory) => slotsOf(cat).filter((s) => lockedSlots.has(s)).length,
        [lockedSlots]
    )
    const [showSlotLocks, setShowSlotLocks] = useState(false)

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
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onFullSetup}
                            className="flex-shrink-0 border-mode-pack-border text-mode-pack-text hover:bg-mode-pack-soft hover:text-mode-pack-text"
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
                    className="max-w-7xl w-[96vw] h-[90vh] max-h-[90vh] p-0 gap-0 flex flex-col overflow-hidden"
                    onEscapeKeyDown={onExit}
                >
                    <DialogTitle className="sr-only">Pack Builder</DialogTitle>

                    {/* Header — outside the scroll area so it's always visible. The native
                        Dialog close (X, top-right) clears the base and returns to the hint
                        state; "Exit pack mode" here fully leaves Pack Mode. */}
                    <div className="flex items-center justify-between gap-2 flex-wrap p-4 pb-3 pr-12 border-b border-border/50 flex-shrink-0 bg-background/95">
                        <div className="flex items-center gap-2.5">
                            <div className="p-1.5 rounded-lg bg-mode-pack-soft border border-mode-pack-border text-mode-pack-text">
                                <Package className="w-4 h-4" />
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="font-bold text-sm sm:text-base text-foreground">Pack Builder</span>
                                {baseCard ? (
                                    <span className="text-[11px] font-medium text-muted-foreground bg-muted/80 px-2 py-0.5 rounded-full border border-border/40">
                                        base #{baseCard.id}
                                    </span>
                                ) : (
                                    <span className="text-[11px] font-semibold text-mode-pack-text bg-mode-pack-soft px-2.5 py-0.5 rounded-full border border-mode-pack-border">
                                        Full Setup
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={onClearBase}
                                className="h-8 px-2.5 text-xs bg-destructive-soft hover:bg-destructive/20 text-destructive-text hover:text-destructive-text"
                            >
                                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                                <span className="hidden sm:inline">Clear</span>
                            </Button>
                            <Button variant="ghost" size="sm" onClick={onExit} className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground">
                                Exit pack mode
                            </Button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto min-h-0 bg-muted/10">
                        <div className="p-4 sm:p-5 flex flex-col gap-4">
                            {(baseCard || hasSetupAnswers) && (
                                <>
                                    {/* STEP 1: Constant Base */}
                                    <div className="rounded-xl border border-mode-pack-border bg-mode-pack-soft/60 dark:bg-mode-pack-soft hover:border-mode-pack/60 transition-colors p-4 space-y-3 shadow-xs">
                                        <div className="flex items-center justify-between gap-2 flex-wrap pb-2 border-b border-mode-pack/15 dark:border-mode-pack-border">
                                            <div className="flex items-center gap-2">
                                                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-mode-pack text-mode-pack-foreground text-xs font-bold shadow-xs">
                                                    1
                                                </span>
                                                <span className="text-xs font-bold uppercase tracking-wider text-mode-pack-text">
                                                    Constant Base
                                                </span>
                                                <span className="text-[11px] text-mode-pack-text/80 hidden sm:inline">
                                                    (always included in every generated prompt)
                                                </span>
                                            </div>
                                            {baseCard && (
                                                <span className="text-[11px] font-medium text-mode-pack-text bg-mode-pack-soft px-2 py-0.5 rounded-full border border-mode-pack-border">
                                                    base #{baseCard.id}
                                                </span>
                                            )}
                                        </div>

                                        {/* Base card thumbnail — only shown when there's an actual base card */}
                                        {baseCard && (
                                            <div className="flex items-start gap-3 pt-1">
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
                                            </div>
                                        )}

                                        {/* No base card (the "From my prompt" flow): free-text invariable base prompt */}
                                        <AnimatePresence initial={false}>
                                            {!baseCard && (
                                                <motion.div
                                                    key="custom-base-text"
                                                    initial={{ height: 0, opacity: 0 }}
                                                    animate={{ height: 'auto', opacity: 1 }}
                                                    exit={{ height: 0, opacity: 0 }}
                                                    transition={{ duration: 0.2 }}
                                                    className="overflow-hidden space-y-1.5 pt-0.5"
                                                >
                                                    <div className="flex items-center justify-between text-xs">
                                                        <span className="font-medium text-mode-pack-text/90 dark:text-mode-pack-text uppercase tracking-wider">
                                                            Custom base prompt
                                                        </span>
                                                        <span className="text-[11px] text-mode-pack-text/80 hidden sm:inline">
                                                            Autocomplete enabled — type to search booru tags
                                                        </span>
                                                    </div>
                                                    <TagAutocompleteTextarea
                                                        value={customBaseText}
                                                        onValueChange={onCustomBaseTextChange}
                                                        placeholder="e.g. 1girl, mona (genshin impact), masterpiece, solo..."
                                                        className="text-xs font-mono min-h-[5.5rem] max-h-48 resize-y bg-background/85 dark:bg-background/40 border-mode-pack-border focus-visible:ring-1 focus-visible:ring-mode-pack/40"
                                                    />
                                                </motion.div>
                                            )}
                                        </AnimatePresence>

                                        {/* Locked categories (constant) — only meaningful with a real base card */}
                                        {baseCard && (
                                            <div className="space-y-2 pt-1 border-t border-mode-pack-border">
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Locked (constant)</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowSlotLocks((v) => !v)}
                                                        aria-expanded={showSlotLocks}
                                                        aria-controls="pack-slot-locks"
                                                        className="inline-flex items-center gap-1 text-[11px] font-medium text-mode-pack-text hover:text-mode-pack-text transition-colors"
                                                    >
                                                        Fine-tune by slot
                                                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showSlotLocks ? 'rotate-180' : ''}`} />
                                                    </button>
                                                </div>
                                                <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                                                    {CATEGORIES.map((cat) => {
                                                        const isLocked = lockedCategories.has(cat)
                                                        const partial = !isLocked ? lockedSlotCount(cat) : 0
                                                        const Icon = CATEGORY_ICON[cat]
                                                        const stateClass = isLocked
                                                            ? CATEGORY_ACTIVE_CLASS[cat]
                                                            : partial > 0
                                                                ? `${CATEGORY_ACTIVE_CLASS[cat]} border-dashed opacity-80`
                                                                : 'bg-muted/30 border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                                                        return (
                                                            <button
                                                                type="button"
                                                                key={cat}
                                                                onClick={() => toggleLockedCategory(cat)}
                                                                aria-pressed={isLocked ? true : partial > 0 ? 'mixed' : false}
                                                                title={
                                                                    isLocked
                                                                        ? `${TAG_CATEGORIES[cat].label} is constant — click to vary it`
                                                                        : partial > 0
                                                                            ? `${partial} of ${slotsOf(cat).length} slots locked — click to lock all`
                                                                            : `${TAG_CATEGORIES[cat].label} varies — click to keep it constant`
                                                                }
                                                                className={`relative overflow-hidden flex items-center justify-center gap-1 py-2 text-xs font-medium rounded-md border transition-all duration-200 ${stateClass}`}
                                                            >
                                                                <Icon className="w-3 h-3" />
                                                                <span>{TAG_CATEGORIES[cat].label}</span>
                                                                {partial > 0 && (
                                                                    <span className="text-[9px] tabular-nums opacity-80">{partial}/{slotsOf(cat).length}</span>
                                                                )}
                                                            </button>
                                                        )
                                                    })}
                                                </div>

                                                {/* Per-slot locks: 🔒 keeps the base card's tags for that
                                                    slot, ↻ lets it vary. Collapsed by default — the
                                                    category row above already covers the common case. */}
                                                <AnimatePresence initial={false}>
                                                    {showSlotLocks && (
                                                        <motion.div
                                                            id="pack-slot-locks"
                                                            key="slot-locks"
                                                            initial={{ height: 0, opacity: 0 }}
                                                            animate={{ height: 'auto', opacity: 1 }}
                                                            exit={{ height: 0, opacity: 0 }}
                                                            transition={{ duration: lowMotion ? 0 : 0.2 }}
                                                            className="overflow-hidden"
                                                        >
                                                            <div className="rounded-md border border-border/50 bg-background/40 p-2.5 space-y-1.5">
                                                                <p className="text-[10px] text-muted-foreground flex items-center gap-2.5 pb-0.5">
                                                                    <span className="inline-flex items-center gap-1"><Lock className="w-2.5 h-2.5" /> kept from the base card</span>
                                                                    <span className="inline-flex items-center gap-1"><Shuffle className="w-2.5 h-2.5" /> varies across prompts</span>
                                                                </p>
                                                                {CATEGORIES.map((cat) => {
                                                                    const Icon = CATEGORY_ICON[cat]
                                                                    const wholeLocked = lockedCategories.has(cat)
                                                                    return (
                                                                        <div key={cat} className="flex items-start gap-2">
                                                                            <div className={`flex items-center gap-1 w-24 flex-shrink-0 pt-0.5 text-[10px] font-medium ${CATEGORY_TEXT_CLASS[cat]}`}>
                                                                                <Icon className="w-3 h-3" />
                                                                                {TAG_CATEGORIES[cat].label}
                                                                            </div>
                                                                            <div className="flex flex-wrap gap-1 flex-1">
                                                                                {slotsOf(cat).map((slot) => {
                                                                                    const locked = wholeLocked || lockedSlots.has(slot)
                                                                                    const onBase = baseSlotCounts[slot] ?? 0
                                                                                    return (
                                                                                        <button
                                                                                            type="button"
                                                                                            key={slot}
                                                                                            onClick={() => toggleLockedSlot(slot)}
                                                                                            aria-pressed={locked}
                                                                                            title={`${slotLabel(slot)}: ${locked ? 'kept from the base card' : 'varies'}${onBase ? ` (${onBase} on the base card)` : ''}`}
                                                                                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] transition-colors ${
                                                                                                locked
                                                                                                    ? CATEGORY_CHIP_CLASS[cat]
                                                                                                    : 'border-border/50 bg-muted/20 text-muted-foreground hover:text-foreground'
                                                                                            }`}
                                                                                        >
                                                                                            {locked ? <Lock className="w-2.5 h-2.5" /> : <Shuffle className="w-2.5 h-2.5" />}
                                                                                            {slotLabel(slot)}
                                                                                            {onBase > 0 && <span className="tabular-nums opacity-60">{onBase}</span>}
                                                                                        </button>
                                                                                    )
                                                                                })}
                                                                            </div>
                                                                        </div>
                                                                    )
                                                                })}
                                                            </div>
                                                        </motion.div>
                                                    )}
                                                </AnimatePresence>

                                                <div className="flex flex-wrap gap-1.5 min-h-[1.75rem] content-start rounded-md border border-dashed border-border/50 bg-background/40 p-2">
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
                                                        <span className="text-[11px] text-muted-foreground italic py-0.5">
                                                            Nothing locked yet — lock a category above or add a custom base prompt.
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* STEP 2: Dynamic Variation Axes */}
                                    {activeAxisCategories.length > 0 && (
                                        <div className="rounded-xl border border-border/60 bg-card/60 dark:bg-card/40 backdrop-blur-xs p-4 space-y-3 shadow-xs">
                                            <div className="flex items-center justify-between gap-2 flex-wrap pb-2 border-b border-border/40">
                                                <div className="flex items-center gap-2">
                                                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-mode-pack text-mode-pack-foreground text-xs font-bold shadow-xs">
                                                        2
                                                    </span>
                                                    <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                                                        Dynamic Variation Axes
                                                    </span>
                                                    <span className="text-[11px] text-muted-foreground hidden lg:inline">
                                                        (sampled values that vary across prompts)
                                                    </span>
                                                </div>

                                                {/* Post pool indicator & controls + global tag/pack toggle */}
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    {/* Post pool badge + Load more */}
                                                    <div className="flex items-center gap-1.5 bg-muted/60 dark:bg-muted/40 border border-border/50 rounded-lg px-2.5 py-1">
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <span className="text-xs font-medium text-foreground/90 tabular-nums flex items-center gap-1.5 cursor-default">
                                                                    <span className="w-2 h-2 rounded-full bg-success shrink-0" />
                                                                    {loadedPostCount} posts in pool
                                                                </span>
                                                            </TooltipTrigger>
                                                            <TooltipContent>
                                                                Sampling pool for variation axes — more posts loaded means richer, more varied values.
                                                            </TooltipContent>
                                                        </Tooltip>

                                                        {!isSeeding ? (
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <Button
                                                                        type="button"
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        onClick={onLoadMorePosts}
                                                                        disabled={!canLoadMorePosts}
                                                                        className="h-5 px-1.5 text-[11px] text-mode-pack-text hover:bg-mode-pack-soft disabled:opacity-40"
                                                                    >
                                                                        <RefreshCw className="w-3 h-3 mr-1" />
                                                                        Load more
                                                                    </Button>
                                                                </TooltipTrigger>
                                                                <TooltipContent>
                                                                    {canLoadMorePosts
                                                                        ? "Fetch more posts to sample from (metadata only, no images — same rate limits as normal browsing)"
                                                                        : "No more posts available for this search, or session limit reached"}
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        ) : (
                                                            <span className="flex items-center gap-1 text-[11px] text-mode-pack-text bg-mode-pack-soft px-2 py-0.5 rounded-full tabular-nums">
                                                                <RefreshCw className="w-3 h-3 animate-spin" />
                                                                {seedProgress ? `${seedProgress.current}/${seedProgress.target}` : 'Loading...'}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* All axes mode toggle */}
                                                    {onSetAllAxisTagModes && (
                                                        <div className="flex items-center gap-1 text-[11px] text-muted-foreground bg-muted/60 dark:bg-muted/40 border border-border/50 rounded-lg p-0.5">
                                                            <span className="text-[10px] text-muted-foreground/80 px-1.5 hidden sm:inline">All axes:</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => onSetAllAxisTagModes('individual')}
                                                                className="px-2 py-0.5 text-[10px] font-medium rounded transition-colors hover:text-foreground text-muted-foreground"
                                                                title="Set all variation axes to individual tags"
                                                            >
                                                                Tags
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => onSetAllAxisTagModes('bundle')}
                                                                className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded transition-colors hover:text-foreground text-muted-foreground"
                                                                title="Set all variation axes to card packs"
                                                            >
                                                                <Package className="w-2.5 h-2.5" />
                                                                Packs
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Seeding progress bar — only visible while actively fetching */}
                                            {isSeeding && seedProgress && (
                                                <div className="h-1 bg-muted/60 rounded-full overflow-hidden w-full">
                                                    <motion.div
                                                        className="h-full bg-mode-pack"
                                                        initial={{ width: 0 }}
                                                        animate={{ width: `${Math.min(100, (seedProgress.current / seedProgress.target) * 100)}%` }}
                                                        transition={{ type: "tween", duration: 0.3 }}
                                                    />
                                                </div>
                                            )}

                                            {/* 4-column axis grid */}
                                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                                                {activeAxisCategories.map((cat) => (
                                                    <AxisEditor
                                                        key={cat}
                                                        category={cat}
                                                        values={axisValues[cat] || []}
                                                        groups={axisSlotGroups[cat] ?? EMPTY_GROUPS}
                                                        slotCounts={axisSlotCounts[cat] ?? EMPTY_COUNTS}
                                                        mutedSlots={mutedSlots}
                                                        maxPerPrompt={axisMaxPerPrompt[cat] ?? 0}
                                                        onToggleMute={toggleMutedSlot}
                                                        minCount={axisMinCounts[cat] ?? 1}
                                                        mode={axisTagModes[cat] ?? 'individual'}
                                                        onModeChange={onSetAxisTagMode}
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

                                    {/* STEP 3: Generated Prompts */}
                                    <PackResultsList
                                        prompts={prompts}
                                        onCopyPrompt={onCopyPrompt}
                                        onCopyAll={onCopyAll}
                                        lockedSet={lockedSet}
                                        variedCategory={variedCategory}
                                    />
                                </>
                            )}
                        </div>
                    </div>

                    {/* Prompt count + generate — fixed at the bottom of the modal, centered slider */}
                    {(baseCard || hasSetupAnswers) && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 items-center gap-3 p-3 sm:px-6 border-t border-border/50 bg-background/95 supports-[backdrop-filter]:bg-background/80 backdrop-blur-xl flex-shrink-0">
                            {/* Left: Active axes summary pill */}
                            <div className="hidden sm:flex items-center gap-2">
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/60 border border-border/40 text-xs font-medium text-muted-foreground">
                                    <span className="w-1.5 h-1.5 rounded-full bg-mode-pack animate-pulse" />
                                    {activeAxisCategories.length} {activeAxisCategories.length === 1 ? 'active axis' : 'active axes'}
                                </span>
                            </div>

                            {/* Center: Centered Prompts Slider */}
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

                            {/* Right: Generate button */}
                            <div className="flex items-center justify-end">
                                <Button
                                    type="button"
                                    onClick={handleGenerateClick}
                                    className={`font-semibold shadow-sm transition-all duration-200 ${justGenerated ? 'bg-success hover:bg-success/90 text-success-foreground' : 'bg-mode-pack hover:bg-mode-pack/90 text-mode-pack-foreground'} px-6`}
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
