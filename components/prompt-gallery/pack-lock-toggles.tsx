"use client"

/**
 * "What stays fixed" row (design spec §4.2) — one toggle per PACK_AXES
 * category, working identically whether the base is a card or a pasted
 * prompt (both reduce to `baseClassified`/`lockedTags` in usePackMode).
 * Replaces the old archetype selector.
 */
import { useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { AlertTriangle, ChevronDown, Lock, Shuffle } from "lucide-react"
import { Label } from "@/components/ui/label"
import { TagCategory } from "@/lib/tag-classifier"
import { PACK_AXES, TAG_CATEGORIES, getTagSlotFromOverrides, slotsOf } from "@/lib/tag-taxonomy"
import { TAG_CATEGORY_ICONS } from "@/components/tag-category-icon"
import { useLowMotion } from "@/hooks/use-low-motion"
import { TagAutocompleteTextarea } from "./tag-autocomplete-textarea"
import { CATEGORY_ACTIVE_CLASS, CATEGORY_CHIP_CLASS, CATEGORY_TEXT_CLASS } from "./category-chip-styles"

const CATEGORIES: TagCategory[] = [...PACK_AXES]
const CATEGORY_ICON = TAG_CATEGORY_ICONS

function slotLabel(slot: string): string {
  const sub = slot.split(":")[1]
  return sub ? sub.replace(/_/g, " ") : slot
}

export interface PackLockTogglesProps {
  lockedCategories: Set<TagCategory>
  toggleLockedCategory: (category: TagCategory) => void
  lockedSlots: Set<string>
  toggleLockedSlot: (slot: string) => void
  /** Classified tags of the base (card or prompt) — for slot lookups and chip coloring. */
  baseClassified: Record<TagCategory, string[]>
  tagOverrides: Record<string, string>
  /** The actual constant tags for every generated prompt right now. */
  lockedTags: string[]
  customBaseText: string
  onCustomBaseTextChange: (text: string) => void
  /** True when the base lists more than one character — only the first stays locked. */
  hasMultipleCharacters: boolean
  /** True when every PACK_AXES category is locked — nothing left to vary. */
  noActiveAxes: boolean
}

export function PackLockToggles({
  lockedCategories,
  toggleLockedCategory,
  lockedSlots,
  toggleLockedSlot,
  baseClassified,
  tagOverrides,
  lockedTags,
  customBaseText,
  onCustomBaseTextChange,
  hasMultipleCharacters,
  noActiveAxes,
}: PackLockTogglesProps) {
  const lowMotion = useLowMotion()
  const [showSlotLocks, setShowSlotLocks] = useState(false)

  const lockedSlotCount = (cat: TagCategory) => slotsOf(cat).filter((s) => lockedSlots.has(s)).length

  const baseSlotCounts: Record<string, number> = {}
  CATEGORIES.forEach((cat) => {
    baseClassified[cat]?.forEach((tag) => {
      const slot = getTagSlotFromOverrides(tag, tagOverrides)?.slot
      if (slot) baseSlotCounts[slot] = (baseSlotCounts[slot] ?? 0) + 1
    })
  })

  const lockedTagCategory = new Map<string, TagCategory>()
  ;(Object.keys(baseClassified) as TagCategory[]).forEach((cat) => {
    baseClassified[cat]?.forEach((tag) => lockedTagCategory.set(tag, cat))
  })

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">What stays fixed</span>
        <button
          type="button"
          onClick={() => setShowSlotLocks((v) => !v)}
          aria-expanded={showSlotLocks}
          aria-controls="pack-slot-locks"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-mode-pack-text hover:text-mode-pack-text transition-colors"
        >
          Fine-tune by slot
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showSlotLocks ? "rotate-180" : ""}`} />
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
              : "bg-muted/30 border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          const label = cat === "appearance" ? "Character" : TAG_CATEGORIES[cat].label
          return (
            <button
              type="button"
              key={cat}
              onClick={() => toggleLockedCategory(cat)}
              aria-pressed={isLocked ? true : partial > 0 ? "mixed" : false}
              title={
                isLocked
                  ? `${label} is constant — click to vary it`
                  : partial > 0
                    ? `${partial} of ${slotsOf(cat).length} slots locked — click to lock all`
                    : `${label} varies — click to keep it constant`
              }
              className={`relative overflow-hidden flex items-center justify-center gap-1 py-2 text-xs font-medium rounded-md border transition-all duration-200 ${stateClass}`}
            >
              <Icon className="w-3 h-3" />
              <span>{label}</span>
              {partial > 0 && <span className="text-[9px] tabular-nums opacity-80">{partial}/{slotsOf(cat).length}</span>}
            </button>
          )
        })}
      </div>

      {noActiveAxes && (
        <p className="text-[11px] text-muted-foreground italic">Unlock at least one category to vary.</p>
      )}

      {hasMultipleCharacters && (
        <div className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-soft p-2.5">
          <AlertTriangle className="w-3.5 h-3.5 text-warning-text flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-warning-text">
            This base lists more than one character — only the first stays locked as the pack&apos;s constant character.
          </p>
        </div>
      )}

      <AnimatePresence initial={false}>
        {showSlotLocks && (
          <motion.div
            id="pack-slot-locks"
            key="slot-locks"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: lowMotion ? 0 : 0.2 }}
            className="overflow-hidden"
          >
            <div className="rounded-md border border-border/50 bg-background/40 p-2.5 space-y-1.5">
              <p className="text-[10px] text-muted-foreground flex items-center gap-2.5 pb-0.5">
                <span className="inline-flex items-center gap-1"><Lock className="w-2.5 h-2.5" /> kept from the base</span>
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
                            title={`${slotLabel(slot)}: ${locked ? "kept from the base" : "varies"}${onBase ? ` (${onBase} on the base)` : ""}`}
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] transition-colors ${
                              locked ? CATEGORY_CHIP_CLASS[cat] : "border-border/50 bg-muted/20 text-muted-foreground hover:text-foreground"
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
            const cat = lockedTagCategory.get(tag) ?? "other"
            return (
              <span key={tag} className={`px-2 py-0.5 rounded border text-[11px] font-mono ${CATEGORY_CHIP_CLASS[cat]}`}>
                {tag}
              </span>
            )
          })
        ) : (
          <span className="text-[11px] text-muted-foreground italic py-0.5">
            Nothing locked yet — lock a category above or add extra text below.
          </span>
        )}
      </div>

      <div className="space-y-1">
        <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Extra base text</Label>
        <TagAutocompleteTextarea
          value={customBaseText}
          onValueChange={onCustomBaseTextChange}
          placeholder="e.g. LoRA triggers, masterpiece, solo..."
          className="text-xs font-mono min-h-[3rem] max-h-32 resize-y bg-background/85 dark:bg-background/40 border-mode-pack-border focus-visible:ring-1 focus-visible:ring-mode-pack/40"
        />
      </div>
    </div>
  )
}
