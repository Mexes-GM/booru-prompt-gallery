"use client"

/**
 * The pack's card: Who, Wearing, Doing, Where, Also and Never, read top to bottom
 * as one sentence, then the People and Changes lines when they apply.
 *
 * Presentational: it shows a `PackBrief` and reports what the user did. The parent
 * runs the brief functions (addTag, removeTag, addNever…) and fetches suggestions.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { AlertTriangle, MapPin } from "lucide-react"
import type { BriefCharacter, ChangesAxis, PackBrief, RequestRole } from "@/lib/pack/brief"
import type { CastRole } from "@/lib/pack/scene/cast"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { BriefSlot, SlotNote, type SlotEntryProps } from "./brief-slot"
import { ChangesSelect } from "./changes-select"
import { ChoiceGroup, type Choice } from "./choice-group"
import { PeopleLine, type PeopleLineProps } from "./people-line"
import { RequestChip } from "./request-chip"
import { SLOTS, characterName, showTag, slotTags, type CharacterInfo, type SlotId, type SuggestionStatus, type TagSuggestion } from "./slots"
import { WearingSourceMenu } from "./wearing-source-menu"
import { OTHERS_UNUSED } from "./pack-text"
import type { OutfitSource } from "./pack-text"

export type { CharacterInfo }

export interface BriefOffer {
  id: string
  slot: SlotId
  /** "Use this card's outfit" */
  label: string
  /** The tags it would add, shown quietly after the label. */
  detail?: string
  onAccept: () => void
}

export interface PackBriefPanelProps {
  brief: PackBrief
  /** Keyed by character tag. */
  characterInfo?: Readonly<Record<string, CharacterInfo>>
  /** Most characters a pack can have. */
  maxCharacters?: number

  onAddTags: (tags: string[], slot: SlotId) => void
  onRemoveTag: (tag: string) => void
  onRemoveNever: (tag: string) => void
  onRemoveCharacter: (tag: string | null) => void
  onSetRole: (tag: string | null, role: CastRole) => void
  onRemoveTrait: (character: string | null, tag: string) => void
  onRestoreTrait: (character: string | null, tag: string) => void

  outfitSource: OutfitSource
  onOutfitSourceChange: (source: OutfitSource) => void
  officialOutfits?: readonly string[]
  /**
   * Said instead of the outfit menu when the pack takes no notice of it ("Only the outfit"
   * takes every outfit from the scenes).
   */
  outfitNote?: string
  /** With several characters: the role the pack assumes for each one, when the brief doesn't set it. */
  assumedRoles?: Readonly<Record<string, CastRole | null | undefined>>

  offers?: readonly BriefOffer[]
  /** A note per tag that clashes with something else on the card. */
  conflicts?: Readonly<Record<string, string>>
  /** Opens the named-scene picker. Without it the Where row has no picker button. */
  onOpenScenePicker?: () => void

  /** Shown only when given (and when PeopleLine decides it applies). */
  people?: PeopleLineProps | null
  /**
   * Others (how the people who are not the characters look), under People: shown when
   * the make-up has someone besides the characters (`applies`), or while it has tags.
   * With tags and `applies` false, they stay and the row says they aren't used.
   */
  others?: { applies: boolean | null } | null
  /** Shown only when given. */
  changes?: { value: ChangesAxis; onChange: (value: ChangesAxis) => void; unavailable?: readonly ChangesAxis[] } | null

  /** Suggestions for the field the user is typing in. */
  suggestions?: readonly TagSuggestion[]
  suggestionStatus?: SuggestionStatus
  onQueryChange?: (query: string, slot: SlotId) => void

  /**
   * The row that just received a tag typed in another row (a character typed in
   * Wearing goes to Who). Give a new `key` each time: the row lights up once and
   * screen readers hear "Added to Who".
   */
  routed?: { slot: SlotId | "people"; key: number } | null
  /** Focus the card's first control on mount (opening it from the summary). */
  autoFocus?: boolean

  className?: string
}

const ROLE_CHOICES: Choice<CastRole>[] = [
  { value: "girl", label: "Girl" },
  { value: "boy", label: "Boy" },
]

const same = (a: string, b: string) => a.trim().toLowerCase().replace(/_/g, " ") === b.trim().toLowerCase().replace(/_/g, " ")

interface LastChip {
  label: string
  remove: () => void
}

export const PackBriefPanel = memo(function PackBriefPanel(props: PackBriefPanelProps) {
  const {
    brief,
    characterInfo = {},
    maxCharacters = 3,
    onAddTags,
    onRemoveTag,
    onRemoveNever,
    onRemoveCharacter,
    onSetRole,
    onRemoveTrait,
    onRestoreTrait,
    outfitSource,
    onOutfitSourceChange,
    officialOutfits,
    outfitNote,
    assumedRoles,
    offers = [],
    conflicts = {},
    onOpenScenePicker,
    people,
    others,
    changes,
    suggestions,
    suggestionStatus,
    onQueryChange,
    routed,
    autoFocus = false,
    className,
  } = props

  const sectionRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!autoFocus) return
    sectionRef.current?.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled]), [tabindex='0']")?.focus()
    // Only when the card opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const flashFor = (slot: SlotId | "people") => (routed?.slot === slot ? routed.key : undefined)

  // Suggestions belong to the field that asked for them.
  const [querySlot, setQuerySlot] = useState<SlotId | null>(null)
  // The row whose last chip a first Backspace picked.
  const [picked, setPicked] = useState<SlotId | null>(null)

  const entryFor = useCallback(
    (slot: SlotId, last: LastChip | null): SlotEntryProps => ({
      onAdd: (tags) => onAddTags(tags, slot),
      onQueryChange: (q) => {
        setQuerySlot(slot)
        onQueryChange?.(q, slot)
      },
      suggestions: querySlot === slot ? suggestions : undefined,
      suggestionStatus: querySlot === slot ? suggestionStatus : "idle",
      lastChipLabel: last?.label,
      onPickLast: (on) => setPicked(on ? slot : null),
      onRemoveLast: last?.remove,
    }),
    [onAddTags, onQueryChange, querySlot, suggestions, suggestionStatus],
  )

  const offersIn = (slot: SlotId) =>
    offers
      .filter((o) => o.slot === slot)
      .map((o) => <RequestChip key={o.id} variant="offered" label={o.label} detail={o.detail} onAccept={o.onAccept} />)

  const conflictNotes = (tags: readonly string[]) => {
    const lines = tags.filter((t) => conflicts[t])
    if (lines.length === 0) return null
    return lines.map((t) => (
      <SlotNote key={t} tone="warning" icon={<AlertTriangle aria-hidden />}>
        {showTag(t)}: {conflicts[t]}
      </SlotNote>
    ))
  }

  /** A request row: chips for its tags, the last one removable from the keyboard. */
  const requestRow = (slot: RequestRole | "style" | "others", extra?: { actions?: ReactNode; notes?: ReactNode }) => {
    const tags = slotTags(brief, slot)
    const lastTag = tags[tags.length - 1]
    const last = lastTag ? { label: showTag(lastTag), remove: () => onRemoveTag(lastTag) } : null
    const offered = offersIn(slot)
    const conflictLines = conflictNotes(tags)
    const notes =
      conflictLines || extra?.notes ? (
        <>
          {conflictLines}
          {extra?.notes}
        </>
      ) : undefined
    return (
      <BriefSlot
        key={slot}
        slot={slot}
        filled={tags.length > 0}
        entry={entryFor(slot, last)}
        actions={extra?.actions}
        notes={notes}
        flashKey={flashFor(slot)}
      >
        {tags.map((tag, i) => (
          <RequestChip
            key={tag}
            label={showTag(tag)}
            conflict={conflicts[tag]}
            selected={picked === slot && i === tags.length - 1}
            onRemove={() => onRemoveTag(tag)}
          />
        ))}
        {offered}
      </BriefSlot>
    )
  }

  const named = brief.who.filter((c) => c.tag !== null)
  const hasNamed = named.length > 0
  const wearing = slotTags(brief, "wearing")
  const othersShown = !!others && (others.applies === true || brief.others.length > 0)

  return (
    <TooltipProvider delayDuration={300}>
      <section ref={sectionRef} aria-label="Pack" className={cn("@container", className)}>
        <WhoRow
          who={brief.who}
          characterInfo={characterInfo}
          maxCharacters={maxCharacters}
          picked={picked === "who"}
          entryFor={entryFor}
          offers={offersIn("who")}
          onRemoveTag={onRemoveTag}
          onRemoveCharacter={onRemoveCharacter}
          onSetRole={onSetRole}
          onRemoveTrait={onRemoveTrait}
          onRestoreTrait={onRestoreTrait}
          assumedRoles={assumedRoles}
          flashKey={flashFor("who")}
        />
        {requestRow("wearing", {
          actions:
            wearing.length === 0 && !outfitNote ? (
              <WearingSourceMenu
                value={outfitSource}
                onChange={onOutfitSourceChange}
                officialOutfits={officialOutfits}
                noCharacter={!hasNamed}
              />
            ) : undefined,
          notes: outfitNote && wearing.length === 0
            ? <SlotNote>{outfitNote}</SlotNote>
            : wearing.length > 0 && hasNamed ? <SlotNote>Replaces the usual outfit</SlotNote> : undefined,
        })}
        {requestRow("doing")}
        {requestRow("where", {
          actions: onOpenScenePicker ? (
            <button
              type="button"
              onClick={onOpenScenePicker}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground pointer-coarse:h-11",
                "transition-[color,background-color] duration-150 ease-out-strong hover:bg-muted hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <MapPin className="size-3.5" aria-hidden />
              Browse places
            </button>
          ) : undefined,
        })}
        {requestRow("also")}
        {requestRow("style")}
        <NeverRow
          tags={brief.never}
          picked={picked === "never"}
          entryFor={entryFor}
          onRemoveNever={onRemoveNever}
          flashKey={flashFor("never")}
        />

        {(people || changes || othersShown) && (
          <div className="mt-1 border-t border-border/60 pt-1">
            {people && <PeopleLine {...people} flashKey={flashFor("people")} />}
            {othersShown &&
              requestRow("others", {
                notes: others?.applies === false && brief.others.length > 0 ? <SlotNote>{OTHERS_UNUSED}</SlotNote> : undefined,
              })}
            {changes && <ChangesSelect value={changes.value} onChange={changes.onChange} unavailable={changes.unavailable} />}
          </div>
        )}
        <span className="sr-only" role="status" aria-live="polite">
          {routed ? <span key={routed.key}>Added to {routed.slot === "people" ? "People" : SLOTS[routed.slot].label}</span> : null}
        </span>
      </section>
    </TooltipProvider>
  )
})

function NeverRow({
  tags,
  picked,
  entryFor,
  onRemoveNever,
  flashKey,
}: {
  tags: readonly string[]
  picked: boolean
  entryFor: (slot: SlotId, last: LastChip | null) => SlotEntryProps
  onRemoveNever: (tag: string) => void
  flashKey?: number
}) {
  const lastTag = tags[tags.length - 1]
  const last = lastTag ? { label: showTag(lastTag), remove: () => onRemoveNever(lastTag) } : null
  return (
    <BriefSlot slot="never" filled={tags.length > 0} entry={entryFor("never", last)} flashKey={flashKey}>
      {tags.map((tag, i) => (
        <RequestChip
          key={tag}
          variant="never"
          label={showTag(tag)}
          selected={picked && i === tags.length - 1}
          onRemove={() => onRemoveNever(tag)}
        />
      ))}
    </BriefSlot>
  )
}

interface WhoRowProps {
  who: readonly BriefCharacter[]
  characterInfo: Readonly<Record<string, CharacterInfo>>
  maxCharacters: number
  picked: boolean
  entryFor: (slot: SlotId, last: LastChip | null) => SlotEntryProps
  offers: ReactNode[]
  onRemoveTag: (tag: string) => void
  onRemoveCharacter: (tag: string | null) => void
  onSetRole: (tag: string | null, role: CastRole) => void
  onRemoveTrait: (character: string | null, tag: string) => void
  onRestoreTrait: (character: string | null, tag: string) => void
  assumedRoles?: Readonly<Record<string, CastRole | null | undefined>>
  flashKey?: number
}

/** Who: each character on its own line with its usual look; a role picker once there are two. */
function WhoRow({
  who,
  characterInfo,
  maxCharacters,
  picked,
  entryFor,
  offers,
  onRemoveTag,
  onRemoveCharacter,
  onSetRole,
  onRemoveTrait,
  onRestoreTrait,
  assumedRoles = {},
  flashKey,
}: WhoRowProps) {
  const named = who.filter((c) => c.tag !== null)
  const showRoles = who.length >= 2
  const full = named.length >= maxCharacters

  const lines = useMemo(
    () =>
      who.map((c) => {
        const info = c.tag ? characterInfo[c.tag] : undefined
        const usual = info?.usualLook ?? []
        // Added look tags that are already part of the usual look show once, as the trait.
        const added = c.addedLook.filter((t) => !usual.some((u) => same(u, t)))
        const removed = new Set(c.removedLook.map((t) => t.toLowerCase()))
        const replaced = new Set((info?.replacedLook ?? []).map((t) => t.toLowerCase()))
        return { c, name: c.tag ? characterName(c.tag, info) : null, usual, added, removed, replaced }
      }),
    [who, characterInfo],
  )

  // Backspace works on the last character's look: its last added tag, else its last usual trait.
  const lastLine = lines[lines.length - 1]
  let last: LastChip | null = null
  let lastKey: string | null = null
  if (lastLine) {
    const lastAdded = lastLine.added[lastLine.added.length - 1]
    const lastTrait = [...lastLine.usual].reverse().find((t) => !lastLine.removed.has(t.toLowerCase()) && !lastLine.replaced.has(t.toLowerCase()))
    if (lastAdded) {
      last = { label: showTag(lastAdded), remove: () => onRemoveTag(lastAdded) }
      lastKey = `added:${lastAdded}`
    } else if (lastTrait) {
      last = { label: showTag(lastTrait), remove: () => onRemoveTrait(lastLine.c.tag, lastTrait) }
      lastKey = `trait:${lastTrait}`
    }
  }

  const filled = lines.some((l) => l.name || l.usual.length > 0 || l.added.length > 0)

  return (
    <BriefSlot
      slot="who"
      filled={filled}
      entry={entryFor("who", last)}
      placeholder={!filled ? undefined : full ? "Add a look tag" : undefined}
      notes={full ? <SlotNote>A pack can have up to {maxCharacters} characters.</SlotNote> : undefined}
      flashKey={flashKey}
    >
      {lines.map(({ c, name, usual, added, removed, replaced }, i) => {
        const isLast = i === lines.length - 1
        const empty = !name && usual.length === 0 && added.length === 0
        if (empty) return null
        return (
          <div key={c.tag ?? `unnamed-${i}`} className="flex basis-full flex-wrap items-center gap-1.5">
            {name && (
              <RequestChip strong label={name} onRemove={() => onRemoveCharacter(c.tag)} />
            )}
            {name && showRoles && (
              <ChoiceGroup
                size="sm"
                choices={ROLE_CHOICES}
                value={c.role ?? (c.tag ? assumedRoles[c.tag] ?? null : null)}
                onChange={(role) => onSetRole(c.tag, role)}
                label={`${name} is a`}
              />
            )}
            {name && showRoles && !c.role && (
              <span className="text-xs text-muted-foreground">
                {c.tag && assumedRoles[c.tag] ? "Guessed from their pictures" : "Pick one so the pack knows who is who"}
              </span>
            )}
            {usual.map((t) => {
              const off = removed.has(t.toLowerCase())
              return (
                <RequestChip
                  key={`trait:${t}`}
                  variant="trait"
                  label={showTag(t)}
                  removed={off}
                  replaced={replaced.has(t.toLowerCase())}
                  selected={picked && isLast && lastKey === `trait:${t}`}
                  onRemove={() => onRemoveTrait(c.tag, t)}
                  onRestore={() => onRestoreTrait(c.tag, t)}
                />
              )
            })}
            {added.map((t) => (
              <RequestChip
                key={`added:${t}`}
                label={showTag(t)}
                selected={picked && isLast && lastKey === `added:${t}`}
                onRemove={() => onRemoveTag(t)}
              />
            ))}
          </div>
        )
      })}
      {offers}
    </BriefSlot>
  )
}
