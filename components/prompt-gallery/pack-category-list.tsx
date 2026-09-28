"use client"

/**
 * Pack Builder's per-category editor — one row per pack axis that holds
 * everything about that category in one place (it used to be split between
 * "What stays fixed" and "Advanced settings"):
 *
 *   - its role: Keep (base tags stay), Vary (sampled per prompt), or Off;
 *   - the base's own tags for it, each removable from the base;
 *   - its subcategories, each Keep-from-base / Vary / Off;
 *   - when varying: the sampled pool, picks per prompt, loose tags vs. full sets.
 *
 * Deliberately neutral (no per-category colour): the only accent is the
 * Pack Mode colour on active controls.
 */
import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Ban, Check, ChevronDown, Lock, Minus, Package, Plus, RefreshCw, RotateCcw, Shuffle, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TAG_CATEGORY_ICONS } from "@/components/tag-category-icon"
import { TagCategory } from "@/lib/tag-classifier"
import { MAX_MIN_TAGS_SLIDER, MAX_MIN_PACKS_SLIDER, type AxisTagMode, type SlotGroup } from "@/lib/pack/pack-generator"
import { TAG_CATEGORIES, formatSubcategoryLabel, getTagSlotFromOverrides, slotsOf } from "@/lib/tag-taxonomy"
import { DEFAULT_MIN_SET_TAGS, MAX_MIN_SET_TAGS, type PackCategoryState, type PackSlotState } from "@/hooks/use-pack-mode"
import { useLowMotion } from "@/hooks/use-low-motion"
import { PACK_TOUR_OPEN_PARTS_EVENT } from "./pack-builder-tour"

const EMPTY_GROUPS: SlotGroup[] = []
const EMPTY_COUNTS: Record<string, number> = {}
const EMPTY_TAGS: string[] = []

function slotLabel(slot: string | null): string {
  return slot ? formatSubcategoryLabel(slot.split(":")[1]) : "other"
}

const CATEGORY_STATE_OPTIONS: { value: PackCategoryState; label: string; hint: string }[] = [
  { value: "keep", label: "Keep", hint: "Keep the base's tags in every prompt" },
  { value: "vary", label: "Vary", hint: "Swap in different tags on each prompt" },
  { value: "off", label: "Off", hint: "Leave this category out entirely" },
]

const SLOT_STATE_META: Record<PackSlotState, { label: string; icon: typeof Lock }> = {
  base: { label: "Keep from base", icon: Lock },
  vary: { label: "Vary", icon: Shuffle },
  off: { label: "Leave out", icon: Ban },
}

/** Small neutral tag chip; `onRemove` adds an X. */
function TagChip({
  text,
  tone = "default",
  onRemove,
  removeLabel,
  lowMotion,
}: {
  text: string
  tone?: "default" | "kept" | "faded"
  onRemove?: () => void
  removeLabel?: string
  lowMotion: boolean
}) {
  const toneClass =
    tone === "kept"
      ? "bg-foreground/[0.07] border-border text-foreground"
      : tone === "faded"
        ? "border-dashed border-border/60 text-muted-foreground/70"
        : "bg-muted/40 border-border/50 text-foreground/85"
  return (
    <motion.span
      layout={!lowMotion}
      initial={lowMotion ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
      animate={lowMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
      exit={lowMotion ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
      transition={lowMotion ? { duration: 0.12 } : { type: "spring", stiffness: 500, damping: 32 }}
      className={`group inline-flex items-center gap-1 max-w-full rounded-md border px-1.5 py-0.5 font-mono text-[11px] leading-5 ${toneClass}`}
    >
      <span className="truncate max-w-[16rem]" title={text}>{text}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel ?? `Remove ${text}`}
          className="-mr-0.5 rounded p-0.5 text-muted-foreground/60 hover:text-destructive-text hover:bg-destructive-soft transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </motion.span>
  )
}

/** "− n +" stepper; 0 renders as `zeroLabel`. */
function Stepper({
  value,
  min,
  max,
  onChange,
  zeroLabel,
  ariaLabel,
}: {
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  zeroLabel?: string
  ariaLabel: string
}) {
  return (
    <div className="inline-flex items-center rounded-md border border-border/60 bg-background" role="group" aria-label={ariaLabel}>
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label={`Decrease ${ariaLabel}`}
        className="h-7 w-7 grid place-items-center text-muted-foreground hover:text-foreground disabled:opacity-30"
      >
        <Minus className="w-3 h-3" />
      </button>
      <span className="min-w-[2.25rem] text-center text-xs font-semibold tabular-nums">
        {value === 0 && zeroLabel ? zeroLabel : value}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label={`Increase ${ariaLabel}`}
        className="h-7 w-7 grid place-items-center text-muted-foreground hover:text-foreground disabled:opacity-30"
      >
        <Plus className="w-3 h-3" />
      </button>
    </div>
  )
}

export { Stepper as PackStepper }

interface CategoryRowProps {
  category: TagCategory
  state: PackCategoryState
  onSetState: (category: TagCategory, state: PackCategoryState) => void
  /** The base's tags in this category (removed ones included, see excludedBaseTags). */
  baseTags: string[]
  keptTags: ReadonlySet<string>
  excludedBaseTags: ReadonlySet<string>
  onToggleExcludedBaseTag: (tag: string) => void
  onRestoreExcluded: (category: TagCategory) => void
  slotStateOf: (slot: string) => PackSlotState
  onSetSlotState: (slot: string, state: PackSlotState) => void
  tagOverrides: Record<string, string>
  values: string[]
  groups: SlotGroup[]
  slotCounts: Record<string, number>
  maxPerPrompt: number
  minCount: number
  mode: AxisTagMode
  onMinCountChange: (category: TagCategory, count: number) => void
  onModeChange?: (category: TagCategory, mode: AxisTagMode) => void
  onAdd: (category: TagCategory, value: string) => void
  onRemove: (category: TagCategory, value: string) => void
  onReseed: (category: TagCategory) => void
  isCollecting: boolean
  note?: string
  minSetTags: number
  onMinSetTagsChange: (category: TagCategory, count: number) => void
  hiddenThinSets: number
  /** Marks this row's controls as the Pack Builder tour's anchors. */
  tourRole?: boolean
  tourPool?: boolean
}

const CategoryRow = memo(function CategoryRow({
  category,
  state,
  onSetState,
  baseTags,
  keptTags,
  excludedBaseTags,
  onToggleExcludedBaseTag,
  onRestoreExcluded,
  slotStateOf,
  onSetSlotState,
  tagOverrides,
  values,
  groups,
  slotCounts,
  maxPerPrompt,
  minCount,
  mode,
  onMinCountChange,
  onModeChange,
  onAdd,
  onRemove,
  onReseed,
  isCollecting,
  note,
  minSetTags,
  onMinSetTagsChange,
  hiddenThinSets,
  tourRole,
  tourPool,
}: CategoryRowProps) {
  const lowMotion = useLowMotion()
  const [draft, setDraft] = useState("")
  const [showSlots, setShowSlots] = useState(false)
  // The Pack Builder tour opens this row's subcategories when it explains them.
  useEffect(() => {
    if (!tourPool) return
    const open = () => setShowSlots(true)
    window.addEventListener(PACK_TOUR_OPEN_PARTS_EVENT, open)
    return () => window.removeEventListener(PACK_TOUR_OPEN_PARTS_EVENT, open)
  }, [tourPool])
  const Icon = TAG_CATEGORY_ICONS[category]
  const def = TAG_CATEGORIES[category]
  const label = category === "appearance" ? "Character" : def.label

  const visibleBase = baseTags.filter((t) => !excludedBaseTags.has(t))
  const removedCount = baseTags.length - visibleBase.length

  // Base tags per slot, for the subcategory list's "n on base" hints.
  const baseSlotCounts = useMemo(() => {
    const out: Record<string, number> = {}
    visibleBase.forEach((tag) => {
      const slot = getTagSlotFromOverrides(tag, tagOverrides)?.slot
      if (slot) out[slot] = (out[slot] ?? 0) + 1
    })
    return out
  }, [visibleBase, tagOverrides])

  const slots = slotsOf(category)
  const slotStates = slots.map((slot) => slotStateOf(slot))
  const customizedSlots = slots.filter((slot, i) => {
    const expected: PackSlotState = state === "keep" ? "base" : "vary"
    return state !== "off" && slotStates[i] !== expected
  }).length

  const ceiling = mode === "bundle" ? MAX_MIN_PACKS_SLIDER : Math.min(MAX_MIN_TAGS_SLIDER, maxPerPrompt > 0 ? maxPerPrompt : MAX_MIN_TAGS_SLIDER)
  const maxPicks = Math.max(1, Math.min(values.length, ceiling))
  const picks = Math.max(1, Math.min(minCount, maxPicks))

  // A "full set" is an outfit for clothing; elsewhere (weapons, poses…) just a set.
  const unit = mode === "bundle" ? (category === "clothing" ? "outfit" : "set") : "tag"
  const units = `${unit}s`

  const handleAdd = () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    onAdd(category, trimmed)
    setDraft("")
  }

  const showGrouping = mode === "individual" && groups.some((g) => g.slot !== null)

  return (
    <section
      className={`rounded-xl border bg-card/70 transition-colors ${state === "off" ? "border-border/40 bg-card/30" : "border-border/70"}`}
      aria-label={label}
    >
      {/* Header: identity + role */}
      <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
        <div className={`flex items-center gap-2.5 min-w-0 flex-1 ${state === "off" ? "opacity-60" : ""}`}>
          <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight">{label}</div>
            <div className="text-[11px] text-muted-foreground truncate">{def.description}</div>
          </div>
        </div>

        {state === "vary" && values.length > 0 && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="hidden sm:inline"><span className="capitalize">{units}</span> per prompt</span>
            <Stepper
              value={picks}
              min={1}
              max={maxPicks}
              onChange={(v) => onMinCountChange(category, v)}
              ariaLabel={`${label} ${units} per prompt`}
            />
          </div>
        )}

        <div
          className="inline-flex rounded-lg border border-border/60 bg-muted/40 p-0.5"
          role="radiogroup"
          aria-label={`${label} role`}
          data-pack-tour={tourRole ? "category-role" : undefined}
        >
          {CATEGORY_STATE_OPTIONS.map((opt) => {
            const active = state === opt.value
            return (
              <Tooltip key={opt.value}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => onSetState(category, opt.value)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      active
                        ? opt.value === "off"
                          ? "bg-background text-foreground shadow-xs"
                          : "bg-mode-pack text-mode-pack-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{opt.hint}</TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      </div>

      {state !== "off" && (
        <div className="px-4 pb-4 space-y-3">
          {note && <p className="text-[11px] text-warning-text">{note}</p>}

          {/* The base's own tags for this category */}
          {baseTags.length > 0 && (
            <div className="flex items-start gap-3">
              <span className="w-16 flex-shrink-0 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Base
              </span>
              <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
                <AnimatePresence initial={false} mode="popLayout">
                  {visibleBase.map((tag) => (
                    <TagChip
                      key={tag}
                      text={tag}
                      tone={keptTags.has(tag) ? "kept" : "faded"}
                      onRemove={() => onToggleExcludedBaseTag(tag)}
                      removeLabel={`Remove ${tag} from the base`}
                      lowMotion={lowMotion}
                    />
                  ))}
                </AnimatePresence>
                {removedCount > 0 && (
                  <button
                    type="button"
                    onClick={() => onRestoreExcluded(category)}
                    className="inline-flex items-center gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <RotateCcw className="w-3 h-3" />
                    {removedCount} removed · restore
                  </button>
                )}
                {visibleBase.length > 0 && state === "vary" && !visibleBase.some((t) => keptTags.has(t)) && (
                  <span className="self-center text-[11px] text-muted-foreground italic">replaced by the varied tags</span>
                )}
              </div>
            </div>
          )}

          {/* Subcategories */}
          <div className="flex items-start gap-3" data-pack-tour={tourPool ? "category-parts" : undefined}>
            <span className="w-16 flex-shrink-0 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Parts
            </span>
            <div className="flex-1 min-w-0">
              <button
                type="button"
                onClick={() => setShowSlots((v) => !v)}
                aria-expanded={showSlots}
                data-pack-tour={tourPool ? "category-parts-toggle" : undefined}
                className="inline-flex items-center gap-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
              >
                {slots.length} subcategories
                {customizedSlots > 0 && (
                  <span className="rounded-full bg-mode-pack-soft text-mode-pack-text border border-mode-pack-border px-1.5 text-[10px] font-semibold">
                    {customizedSlots} customized
                  </span>
                )}
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showSlots ? "rotate-180" : ""}`} />
              </button>
              {showSlots && (
                <div className="mt-2 grid grid-cols-1 @md:grid-cols-2 @3xl:grid-cols-3 gap-1.5">
                  {slots.map((slot, i) => {
                    const slotState = slotStates[i]
                    const meta = SLOT_STATE_META[slotState]
                    const StateIcon = meta.icon
                    const onBase = baseSlotCounts[slot] ?? 0
                    const inPool = slotCounts[slot] ?? 0
                    const empty = onBase === 0 && inPool === 0
                    return (
                      <DropdownMenu key={slot}>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted/60 ${
                              slotState === "off" ? "border-dashed border-border/60 text-muted-foreground" : "border-border/60 bg-background/60"
                            } ${empty ? "opacity-50" : ""}`}
                          >
                            <StateIcon className={`w-3.5 h-3.5 flex-shrink-0 ${slotState === "vary" ? "text-mode-pack-text" : "text-muted-foreground"}`} />
                            <span className="font-medium capitalize truncate">{slotLabel(slot)}</span>
                            <span className="ml-auto text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
                              {onBase > 0 && `${onBase} base`}
                              {onBase > 0 && inPool > 0 && " · "}
                              {inPool > 0 && `${inPool} pool`}
                            </span>
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-52">
                          <DropdownMenuLabel className="capitalize">{slotLabel(slot)}</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuRadioGroup value={slotState} onValueChange={(v) => onSetSlotState(slot, v as PackSlotState)}>
                            {(Object.keys(SLOT_STATE_META) as PackSlotState[]).map((s) => {
                              const ItemIcon = SLOT_STATE_META[s].icon
                              return (
                                <DropdownMenuRadioItem key={s} value={s} className="gap-2">
                                  <ItemIcon className="w-3.5 h-3.5 text-muted-foreground" />
                                  {SLOT_STATE_META[s].label}
                                </DropdownMenuRadioItem>
                              )
                            })}
                          </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )
                  })}
                </div>
              )}
              {showSlots && (
                <p className="mt-2 flex items-center gap-x-3 gap-y-1 flex-wrap text-[10px] text-muted-foreground">
                  <span>Click a part to change it:</span>
                  <span className="inline-flex items-center gap-1"><Lock className="w-3 h-3" /> keep the base&apos;s tags</span>
                  <span className="inline-flex items-center gap-1"><Shuffle className="w-3 h-3 text-mode-pack-text" /> vary</span>
                  <span className="inline-flex items-center gap-1"><Ban className="w-3 h-3" /> leave out</span>
                </p>
              )}
            </div>
          </div>

          {/* Pool of candidate values */}
          {state === "vary" && (
            <div className="flex items-start gap-3" data-pack-tour={tourPool ? "category-pool" : undefined}>
              <span className="w-16 flex-shrink-0 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Pool
              </span>
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
                  <span className="tabular-nums">
                    {values.length} {values.length === 1 ? unit : units}
                  </span>
                  {onModeChange && (
                    <div className="inline-flex rounded-md border border-border/60 p-0.5" data-pack-tour={tourPool ? "category-mode" : undefined}>
                      <button
                        type="button"
                        onClick={() => onModeChange(category, "individual")}
                        title="Mix loose tags from different posts"
                        className={`px-1.5 py-0.5 rounded text-[10px] ${mode === "individual" ? "bg-muted text-foreground font-semibold" : "hover:text-foreground"}`}
                      >
                        Loose tags
                      </button>
                      <button
                        type="button"
                        onClick={() => onModeChange(category, "bundle")}
                        title="Keep each post's full set together (e.g. a whole outfit)"
                        className={`px-1.5 py-0.5 rounded text-[10px] inline-flex items-center gap-1 ${mode === "bundle" ? "bg-muted text-foreground font-semibold" : "hover:text-foreground"}`}
                      >
                        <Package className="w-2.5 h-2.5" />
                        Full sets
                      </button>
                    </div>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => onReseed(category)}
                        className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-foreground hover:bg-muted"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Re-sample
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Rebuild this pool from the collected posts (restores removed tags)</TooltipContent>
                  </Tooltip>
                  {mode === "bundle" && (
                    <div className="flex items-center gap-1.5 ml-auto">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-default">Min tags per set</span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          Sets with fewer tags than this are left out of the pool — a lone “sword” or “hat” isn&apos;t much of a set. Sets you add yourself always stay.
                        </TooltipContent>
                      </Tooltip>
                      <Stepper
                        value={minSetTags}
                        min={1}
                        max={MAX_MIN_SET_TAGS}
                        onChange={(v) => onMinSetTagsChange(category, v)}
                        ariaLabel={`${label} minimum tags per set`}
                      />
                      {hiddenThinSets > 0 && (
                        <span className="tabular-nums text-muted-foreground/80">{hiddenThinSets} hidden</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto pr-1 content-start">
                  <AnimatePresence initial={false} mode="popLayout">
                    {(showGrouping ? groups : [{ slot: null, values }]).flatMap((group) => [
                      showGrouping ? (
                        <motion.span
                          key={`h:${group.slot ?? "none"}`}
                          layout={!lowMotion}
                          className="basis-full flex items-center gap-2 pt-1 first:pt-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80"
                        >
                          {slotLabel(group.slot)}
                          <span className="h-px flex-1 bg-border/50" />
                        </motion.span>
                      ) : null,
                      ...group.values.map((value) => (
                        <TagChip
                          key={value}
                          text={value}
                          onRemove={() => onRemove(category, value)}
                          lowMotion={lowMotion}
                        />
                      )),
                    ])}
                  </AnimatePresence>
                  {values.length === 0 && isCollecting &&
                    [56, 72, 48, 88, 64, 52].map((w, i) => (
                      <span key={i} className="h-6 rounded-md bg-muted animate-pulse" style={{ width: w }} />
                    ))}
                  {values.length === 0 && !isCollecting && (
                    <span className="text-[11px] text-muted-foreground italic py-1">
                      Nothing found in the collected posts — add some below or load more posts.
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 max-w-md">
                  <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        handleAdd()
                      }
                    }}
                    placeholder={mode === "bundle" ? "Add a set (tag1, tag2, …)" : `Add a ${label.toLowerCase()} tag`}
                    className="h-7 text-xs"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={handleAdd} disabled={!draft.trim()} className="h-7 px-2">
                    <Plus className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {state === "keep" && visibleBase.length === 0 && (
            <p className="text-[11px] text-muted-foreground italic flex items-center gap-1.5">
              <Check className="w-3 h-3" />
              The base has no {label.toLowerCase()} tags — nothing to keep here.
            </p>
          )}
        </div>
      )}
    </section>
  )
})

export interface PackCategoryListProps {
  categories: readonly TagCategory[]
  categoryStates: Record<TagCategory, PackCategoryState>
  onSetCategoryState: (category: TagCategory, state: PackCategoryState) => void
  baseClassified: Record<TagCategory, string[]>
  lockedTags: string[]
  excludedBaseTags: Set<string>
  onToggleExcludedBaseTag: (tag: string) => void
  onRestoreExcluded: (category?: TagCategory) => void
  slotStateOf: (slot: string) => PackSlotState
  onSetSlotState: (slot: string, state: PackSlotState) => void
  tagOverrides: Record<string, string>
  axisValues: Partial<Record<TagCategory, string[]>>
  axisSlotGroups: Partial<Record<TagCategory, SlotGroup[]>>
  axisSlotCounts: Partial<Record<TagCategory, Record<string, number>>>
  axisMaxPerPrompt: Partial<Record<TagCategory, number>>
  axisMinCounts: Partial<Record<TagCategory, number>>
  axisTagModes: Partial<Record<TagCategory, AxisTagMode>>
  onSetAxisMinCount: (category: TagCategory, count: number) => void
  onSetAxisTagMode?: (category: TagCategory, mode: AxisTagMode) => void
  onAddAxisValue: (category: TagCategory, value: string) => void
  onRemoveAxisValue: (category: TagCategory, value: string) => void
  onReseedAxis: (category: TagCategory) => void
  isCollecting: boolean
  hasMultipleCharacters: boolean
  minSetTags: Partial<Record<TagCategory, number>>
  onSetMinSetTags: (category: TagCategory, count: number) => void
  hiddenThinSets: Partial<Record<TagCategory, number>>
}

export function PackCategoryList({
  categories,
  categoryStates,
  onSetCategoryState,
  baseClassified,
  lockedTags,
  excludedBaseTags,
  onToggleExcludedBaseTag,
  onRestoreExcluded,
  slotStateOf,
  onSetSlotState,
  tagOverrides,
  axisValues,
  axisSlotGroups,
  axisSlotCounts,
  axisMaxPerPrompt,
  axisMinCounts,
  axisTagModes,
  onSetAxisMinCount,
  onSetAxisTagMode,
  onAddAxisValue,
  onRemoveAxisValue,
  onReseedAxis,
  isCollecting,
  hasMultipleCharacters,
  minSetTags,
  onSetMinSetTags,
  hiddenThinSets,
}: PackCategoryListProps) {
  const keptTags = useMemo(() => new Set(lockedTags), [lockedTags])
  const firstVarying = categories.find((c) => categoryStates[c] === "vary")
  const handleRestore = useCallback((category: TagCategory) => onRestoreExcluded(category), [onRestoreExcluded])

  return (
    <div className="@container space-y-2.5">
      {categories.map((cat) => (
        <CategoryRow
          key={cat}
          category={cat}
          state={categoryStates[cat]}
          onSetState={onSetCategoryState}
          baseTags={baseClassified[cat] ?? EMPTY_TAGS}
          keptTags={keptTags}
          excludedBaseTags={excludedBaseTags}
          onToggleExcludedBaseTag={onToggleExcludedBaseTag}
          onRestoreExcluded={handleRestore}
          slotStateOf={slotStateOf}
          onSetSlotState={onSetSlotState}
          tagOverrides={tagOverrides}
          values={axisValues[cat] ?? EMPTY_TAGS}
          groups={axisSlotGroups[cat] ?? EMPTY_GROUPS}
          slotCounts={axisSlotCounts[cat] ?? EMPTY_COUNTS}
          maxPerPrompt={axisMaxPerPrompt[cat] ?? 0}
          minCount={axisMinCounts[cat] ?? 1}
          mode={axisTagModes[cat] ?? "individual"}
          onMinCountChange={onSetAxisMinCount}
          onModeChange={onSetAxisTagMode}
          onAdd={onAddAxisValue}
          onRemove={onRemoveAxisValue}
          onReseed={onReseedAxis}
          isCollecting={isCollecting}
          minSetTags={minSetTags[cat] ?? DEFAULT_MIN_SET_TAGS}
          onMinSetTagsChange={onSetMinSetTags}
          hiddenThinSets={hiddenThinSets[cat] ?? 0}
          tourRole={cat === categories[0]}
          tourPool={cat === firstVarying}
          note={
            cat === "appearance" && hasMultipleCharacters
              ? "This base lists more than one character — only the first one is kept."
              : undefined
          }
        />
      ))}
    </div>
  )
}
