"use client"

/**
 * Pack Mode's "Advanced settings" (design spec §4.5) — closed by default,
 * holds what used to be always visible: per-axis pool editing (values,
 * individual/bundle mode, min tags, slot pills), seeding controls, and
 * resetting the learning model.
 */
import { memo, useCallback, useMemo, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ChevronDown, Package, Plus, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { RemovableTagChip } from "./removable-tag-chip"
import { TAG_CATEGORY_ICONS } from "@/components/tag-category-icon"
import { TagCategory } from "@/lib/tag-classifier"
import { MAX_MIN_TAGS_SLIDER, MAX_MIN_PACKS_SLIDER, type AxisTagMode, type SlotGroup } from "@/lib/pack/pack-generator"
import { formatSubcategoryLabel, slotsOf } from "@/lib/tag-taxonomy"
import { splitCommaSeparatedTags } from "@/lib/utils/tag-utils"
import { useLowMotion } from "@/hooks/use-low-motion"
import { CATEGORY_CHIP_CLASS, CATEGORY_CONTAINER_CLASS, CATEGORY_SLIDER_CLASS, CATEGORY_TEXT_CLASS } from "./category-chip-styles"

const CATEGORY_ICON: Record<TagCategory, typeof Package> = TAG_CATEGORY_ICONS
const EMPTY_GROUPS: SlotGroup[] = []
const EMPTY_COUNTS: Record<string, number> = {}
const ADVANCED_OPEN_KEY = "pack-advanced-open"

function slotLabel(slot: string | null): string {
  return slot ? formatSubcategoryLabel(slot.split(":")[1]) : "unsorted"
}

const AxisEditor = memoAxisEditor()

function memoAxisEditor() {
  const Component = ({
    category,
    values,
    groups,
    slotCounts,
    mutedSlots,
    maxPerPrompt,
    minCount,
    mode = "individual",
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
    const [draft, setDraft] = useState("")
    const Icon = CATEGORY_ICON[category]
    const lowMotion = useLowMotion()
    const maxSliderCeiling = mode === "bundle"
      ? MAX_MIN_PACKS_SLIDER
      : Math.min(MAX_MIN_TAGS_SLIDER, maxPerPrompt > 0 ? maxPerPrompt : MAX_MIN_TAGS_SLIDER)
    const maxMinCount = Math.max(1, Math.min(values.length, maxSliderCeiling))

    const pillSlots = useMemo(
      () => slotsOf(category).filter((slot) => (slotCounts[slot] ?? 0) > 0),
      [category, slotCounts]
    )
    const showGrouping = mode === "individual" && groups.some((g) => g.slot !== null)
    const clampedMinCount = Math.max(0, Math.min(minCount, maxMinCount))

    const [resampleEpoch, setResampleEpoch] = useState(0)
    const handleReseedClick = useCallback(() => {
      setResampleEpoch((e) => e + 1)
      onReseed(category)
    }, [onReseed, category])
    const handleRemoveClick = useCallback((value: string) => onRemove(category, value), [onRemove, category])
    const handleMinCountCommit = useCallback((val: number) => onMinCountChange(category, val), [onMinCountChange, category])

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
      setDraft("")
    }

    const isDeactivated = liveMinCount === 0
    const containerTheme = CATEGORY_CONTAINER_CLASS[category] || CATEGORY_CONTAINER_CLASS.other
    const textTheme = CATEGORY_TEXT_CLASS[category] || CATEGORY_TEXT_CLASS.other

    return (
      <div
        className={`rounded-xl border p-3 space-y-2.5 flex flex-col justify-between min-h-0 transition-all duration-200 shadow-xs ${containerTheme} ${
          isDeactivated ? "opacity-60 saturate-50 hover:opacity-80 transition-opacity" : ""
        }`}
      >
        <div className="flex items-center justify-between gap-1.5 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className={`p-1.5 rounded-lg bg-background/80 dark:bg-background/60 border border-border/40 ${textTheme} flex-shrink-0`}>
              <Icon className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs font-semibold capitalize truncate text-foreground">{category}</span>
            <span className="text-[10px] font-medium text-muted-foreground bg-background/80 dark:bg-background/60 px-1.5 py-0.5 rounded-full border border-border/40 flex-shrink-0 tabular-nums">
              {values.length} {mode === "bundle" ? (values.length === 1 ? "pack" : "packs") : (values.length === 1 ? "tag" : "tags")}
            </span>
            {isDeactivated && (
              <span className="text-[9px] font-semibold text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border/50 uppercase tracking-wider flex-shrink-0">
                Off
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <div className="flex items-center rounded-md border border-border/60 bg-background/80 dark:bg-background/60 p-0.5 text-[10px]">
              <button
                type="button"
                onClick={() => onModeChange?.(category, "individual")}
                className={`px-1.5 py-0.5 rounded transition-all ${
                  mode === "individual" ? "bg-muted text-foreground font-semibold shadow-xs" : "text-muted-foreground hover:text-foreground"
                }`}
                title="Individual tags mode: mix and match loose tags"
              >
                Tags
              </button>
              <button
                type="button"
                onClick={() => {
                  onModeChange?.(category, "bundle")
                  if (minCount > MAX_MIN_PACKS_SLIDER) onMinCountChange(category, MAX_MIN_PACKS_SLIDER)
                }}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-all ${
                  mode === "bundle" ? "bg-mode-pack/20 text-mode-pack-text font-semibold shadow-xs" : "text-muted-foreground hover:text-foreground"
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
              <TooltipContent>Re-sample {mode === "bundle" ? "packs" : "values"} from current results</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {mode === "individual" && (pillSlots.length > 1 || pillSlots.some((s) => mutedSlots.has(s))) && (
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
                      ? "border-dashed border-border/60 text-muted-foreground/60 line-through hover:text-muted-foreground"
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
                  key={`slot-header:${group.slot ?? "none"}`}
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
                if (mode === "bundle") {
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
                        ×
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
              {mode === "bundle" ? "No packs yet — add one or re-sample from results." : "No values yet — add one or re-sample from results."}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAdd() } }}
            placeholder={mode === "bundle" ? `Add a ${category} pack (e.g. tag1, tag2)...` : `Add a ${category} tag...`}
            className="h-7 text-xs bg-background/90 dark:bg-background/80 border-border/50 focus-visible:ring-1 focus-visible:ring-mode-pack/50"
          />
          <Button type="button" variant="secondary" size="sm" onClick={handleAdd} className="h-7 px-2 border border-border/40 hover:bg-background/60">
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="flex items-center gap-2 pt-1.5 border-t border-border/30">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
            {mode === "bundle" ? "Min packs" : "Min tags"}
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
            {liveMinCount === 0 ? "Off" : liveMinCount}
          </span>
        </div>
      </div>
    )
  }
  Component.displayName = "AxisEditor"
  return memo(Component)
}

export interface PackAdvancedPanelProps {
  activeAxisCategories: TagCategory[]
  axisValues: Partial<Record<TagCategory, string[]>>
  axisSlotGroups: Partial<Record<TagCategory, SlotGroup[]>>
  axisSlotCounts: Partial<Record<TagCategory, Record<string, number>>>
  axisMaxPerPrompt: Partial<Record<TagCategory, number>>
  axisMinCounts: Partial<Record<TagCategory, number>>
  axisTagModes: Partial<Record<TagCategory, AxisTagMode>>
  mutedSlots: Set<string>
  onAddAxisValue: (category: TagCategory, value: string) => void
  onRemoveAxisValue: (category: TagCategory, value: string) => void
  onReseedAxis: (category: TagCategory) => void
  onSetAxisMinCount: (category: TagCategory, count: number) => void
  onSetAxisTagMode?: (category: TagCategory, mode: AxisTagMode) => void
  onSetAllAxisTagModes?: (mode: AxisTagMode) => void
  toggleMutedSlot: (slot: string) => void
  isSeeding: boolean
  seedProgress: { current: number; target: number } | null
  loadedPostCount: number
  canLoadMorePosts: boolean
  onLoadMorePosts: () => void
  onResetLearning?: () => void
}

export function PackAdvancedPanel({
  activeAxisCategories,
  axisValues,
  axisSlotGroups,
  axisSlotCounts,
  axisMaxPerPrompt,
  axisMinCounts,
  axisTagModes,
  mutedSlots,
  onAddAxisValue,
  onRemoveAxisValue,
  onReseedAxis,
  onSetAxisMinCount,
  onSetAxisTagMode,
  onSetAllAxisTagModes,
  toggleMutedSlot,
  isSeeding,
  seedProgress,
  loadedPostCount,
  canLoadMorePosts,
  onLoadMorePosts,
  onResetLearning,
}: PackAdvancedPanelProps) {
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return false
    try {
      return window.localStorage.getItem(ADVANCED_OPEN_KEY) === "true"
    } catch {
      return false
    }
  })

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    try {
      window.localStorage.setItem(ADVANCED_OPEN_KEY, String(next))
    } catch {
      // Non-fatal: this is a UI convenience, not durable state.
    }
  }

  return (
    <Collapsible open={open} onOpenChange={handleOpenChange} className="rounded-xl border border-border/60 bg-card/60 dark:bg-card/40 backdrop-blur-xs shadow-xs">
      <CollapsibleTrigger asChild>
        <button type="button" className="w-full flex items-center justify-between gap-2 p-3 text-xs font-bold uppercase tracking-wider text-foreground">
          Advanced settings
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="p-3 pt-0 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 bg-muted/60 dark:bg-muted/40 border border-border/50 rounded-lg px-2.5 py-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-xs font-medium text-foreground/90 tabular-nums flex items-center gap-1.5 cursor-default">
                  <span className="w-2 h-2 rounded-full bg-success shrink-0" />
                  {loadedPostCount} posts in pool
                </span>
              </TooltipTrigger>
              <TooltipContent>Sampling pool for variation axes — more posts loaded means richer, more varied values.</TooltipContent>
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
                    ? "Fetch more posts to sample from (metadata only, no images)"
                    : "No more posts available for this search, or session limit reached"}
                </TooltipContent>
              </Tooltip>
            ) : (
              <span className="flex items-center gap-1 text-[11px] text-mode-pack-text bg-mode-pack-soft px-2 py-0.5 rounded-full tabular-nums">
                <RefreshCw className="w-3 h-3 animate-spin" />
                {seedProgress ? `${seedProgress.current}/${seedProgress.target}` : "Loading..."}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {onSetAllAxisTagModes && (
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground bg-muted/60 dark:bg-muted/40 border border-border/50 rounded-lg p-0.5">
                <span className="text-[10px] text-muted-foreground/80 px-1.5 hidden sm:inline">All axes:</span>
                <button type="button" onClick={() => onSetAllAxisTagModes("individual")} className="px-2 py-0.5 text-[10px] font-medium rounded transition-colors hover:text-foreground text-muted-foreground">
                  Tags
                </button>
                <button type="button" onClick={() => onSetAllAxisTagModes("bundle")} className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded transition-colors hover:text-foreground text-muted-foreground">
                  <Package className="w-2.5 h-2.5" />
                  Packs
                </button>
              </div>
            )}
            {onResetLearning && (
              <Button type="button" variant="outline" size="sm" onClick={onResetLearning} className="h-7 text-[11px]">
                Reset learning
              </Button>
            )}
          </div>
        </div>

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
              mode={axisTagModes[cat] ?? "individual"}
              onModeChange={onSetAxisTagMode}
              onAdd={onAddAxisValue}
              onRemove={onRemoveAxisValue}
              onReseed={onReseedAxis}
              onMinCountChange={onSetAxisMinCount}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
