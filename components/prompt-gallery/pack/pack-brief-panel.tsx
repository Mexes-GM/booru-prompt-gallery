"use client"

/**
 * The pack's card: Who, Wearing, Doing, Where, Also and Never, read top to bottom
 * as one sentence, then the People and Changes lines when they apply.
 *
 * Presentational: it shows a `PackBrief` and reports what the user did. The parent
 * runs the brief functions (addTag, removeTag, addNever…) and fetches suggestions.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { AlertTriangle, MapPin, Repeat2 } from "lucide-react"
import { castLimit, type BriefCharacter, type CastMember, type CastMode, type ChangesAxis, type PackBrief, type RandomCast, type RequestRole } from "@/lib/pack/brief"
import type { CastGender } from "@/lib/pack/cast-picker"
import type { BooruProvider } from "@/lib/booru/types"
import { MAX_CAST, MAX_TURNS_CAST, type CastRole } from "@/lib/pack/scene/cast"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { BriefSlot, SlotNote, type SlotEntryProps } from "./brief-slot"
import { ChangesSelect } from "./changes-select"
import { ChoiceGroup, type Choice } from "./choice-group"
import { PeopleLine, type PeopleLineProps } from "./people-line"
import { RequestChip, type RequestChipTone } from "./request-chip"
import type { EntryOption } from "./tag-entry"
import { SLOTS, characterName, showTag, slotTags, type CharacterInfo, type SlotId, type SuggestionStatus, type TagSuggestion } from "./slots"
import { OutfitDetailMenu, WearingSourceMenu } from "./wearing-source-menu"
import { CastPickerButton, RandomCastButton, seriesName } from "./cast-picker"
import { CAST_MODE_TEXT, DEFAULTS_TEXT, OTHERS_UNUSED, RANDOM_CAST_TEXT, WEARING_TEXT, WHO_MANY_TEXT, outfitSourceLabel } from "./pack-text"
import type { OutfitSource } from "./pack-text"
import type { OutfitDetail } from "@/lib/outfit-swap"

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
  /** Most characters a pack can have; by default the brief's own limit (castLimit). */
  maxCharacters?: number
  /**
   * "Add several" in Who: characters picked at once (popular, or of a series), named as the pack's
   * site names them. Without it Who has no such button.
   */
  castPicker?: { provider: BooruProvider; onAdd: (members: CastMember[]) => void } | null
  /** Prompts the pack makes: with one character per prompt and fewer prompts than characters, Who says so. */
  promptCount?: number
  /**
   * Random characters in an empty Who (lib/pack/random-cast.ts): the brief's choice, what Auto
   * means with the pack's People, and the change (null takes it off). Without it Who doesn't offer them.
   */
  randomCast?: { autoGender: CastGender; onChange: (randomCast: RandomCast | null) => void } | null

  /** `picked`: the autocomplete suggestion the tag came from, if any. */
  onAddTags: (tags: string[], slot: SlotId, picked?: TagSuggestion) => void
  onRemoveTag: (tag: string) => void
  onRemoveNever: (tag: string) => void
  onRemoveCharacter: (tag: string | null) => void
  onSetRole: (tag: string | null, role: CastRole) => void
  onRemoveTrait: (character: string | null, tag: string) => void
  onRestoreTrait: (character: string | null, tag: string) => void

  /** What the pack wears while Wearing has no chips: read in the empty field, with its menu at the end. */
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
  /** With two or more named characters: all of them in every prompt, or one per prompt in turn. */
  onCastModeChange?: (mode: CastMode) => void

  offers?: readonly BriefOffer[]
  /** A note per tag that clashes with something else on the card. */
  conflicts?: Readonly<Record<string, string>>
  /** Opens the named-scene picker. Without it the Where row has no picker button. */
  onOpenScenePicker?: () => void

  /**
   * Wearing and Where tags that can be met as conditions, keyed by tag: true when the user made
   * it exact. A tag missing here has no Any / Exactly switch (a time of day, a thing in a place).
   */
  exactness?: Readonly<Record<string, boolean>>
  onSetExact?: (tag: string, exact: boolean) => void
  /** Wearing: the outfit library's styles, offered in the field (not tags), and the ones chosen as chips. */
  styleOptions?: readonly EntryOption[]
  styleChips?: readonly { style: string; label: string; inactive?: string; onRemove: () => void }[]
  /** How much of each library outfit goes in a prompt: its menu shows beside Wearing while a style chip applies. */
  outfitDetail?: { value: OutfitDetail; onChange: (detail: OutfitDetail) => void }
  /** Under Wearing when a chosen style doesn't apply at the pack's rating. */
  styleNote?: string
  /**
   * Never and Style: the tags new packs start with. Their chips are marked; the row offers to make
   * what it has now the defaults when it differs from them.
   */
  rowDefaults?: Readonly<Record<"never" | "style", RowDefaultsProps>>

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

const NO_EXACTNESS: Readonly<Record<string, boolean>> = {}
const NO_STYLE_CHIPS: NonNullable<PackBriefPanelProps["styleChips"]> = []

const ROLE_CHOICES: Choice<CastRole>[] = [
  { value: "girl", label: "Girl" },
  { value: "boy", label: "Boy" },
]

const CAST_MODE_CHOICES: Choice<CastMode>[] = [
  { value: "together", label: CAST_MODE_TEXT.together },
  { value: "turns", label: CAST_MODE_TEXT.turns },
]

/** Requests wear their row's prompt category, as tags do on the gallery's cards. */
const ROW_TONE: Record<RequestRole | "style" | "others", RequestChipTone> = {
  wearing: "clothing",
  doing: "pose",
  where: "scenery",
  also: "plain",
  style: "plain",
  others: "appearance",
}

const same = (a: string, b: string) => a.trim().toLowerCase().replace(/_/g, " ") === b.trim().toLowerCase().replace(/_/g, " ")

interface LastChip {
  label: string
  remove: () => void
}

export const PackBriefPanel = memo(function PackBriefPanel(props: PackBriefPanelProps) {
  const {
    brief,
    characterInfo = {},
    maxCharacters: maxCharactersProp,
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
    onCastModeChange,
    offers = [],
    conflicts = {},
    onOpenScenePicker,
    people,
    others,
    changes,
    exactness = NO_EXACTNESS,
    onSetExact,
    styleOptions,
    styleChips = NO_STYLE_CHIPS,
    styleNote,
    outfitDetail,
    rowDefaults,
    suggestions,
    suggestionStatus,
    onQueryChange,
    routed,
    autoFocus = false,
    castPicker,
    promptCount,
    randomCast,
    className,
  } = props
  const maxCharacters = maxCharactersProp ?? castLimit(brief)

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
      onAdd: (tags, picked) => onAddTags(tags, slot, picked),
      onQueryChange: (q) => {
        setQuerySlot(slot)
        onQueryChange?.(q, slot)
      },
      suggestions: querySlot === slot ? suggestions : undefined,
      suggestionStatus: querySlot === slot ? suggestionStatus : "idle",
      lastChipLabel: last?.label,
      onPickLast: (on) => setPicked(on ? slot : null),
      onRemoveLast: last?.remove,
      ...(slot === "wearing" && styleOptions ? { options: styleOptions } : {}),
    }),
    [onAddTags, onQueryChange, querySlot, suggestions, suggestionStatus, styleOptions],
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
  const requestRow = (
    slot: RequestRole | "style" | "others",
    extra?: { actions?: ReactNode; notes?: ReactNode; leading?: ReactNode; filled?: boolean; defaults?: RowDefaultsProps; placeholder?: string; trailing?: ReactNode },
  ) => {
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
        filled={tags.length > 0 || !!extra?.filled}
        entry={extra?.trailing ? { ...entryFor(slot, last), trailing: extra.trailing } : entryFor(slot, last)}
        placeholder={extra?.placeholder}
        actions={extra?.actions}
        notes={notes}
        flashKey={flashFor(slot)}
      >
        {extra?.leading}
        {tags.map((tag, i) => {
          const exact = exactness[tag]
          return (
            <RequestChip
              key={tag}
              label={showTag(tag)}
              tone={ROW_TONE[slot]}
              conflict={conflicts[tag]}
              selected={picked === slot && i === tags.length - 1}
              onRemove={() => onRemoveTag(tag)}
              mode={exact !== undefined && onSetExact
                ? { exact, onToggle: () => onSetExact(tag, !exact), ambience: brief.requests.some((r) => r.tag === tag && r.ambience) }
                : undefined}
              inDefaults={extra?.defaults?.has(tag) ? { onRemove: () => extra.defaults!.onRemove(tag) } : undefined}
            />
          )
        })}
        {offered}
      </BriefSlot>
    )
  }

  const named = brief.who.filter((c) => c.tag !== null)
  const hasNamed = named.length > 0
  const wearing = slotTags(brief, "wearing")
  const othersShown = !!others && (others.applies === true || brief.others.length > 0)
  // What Wearing does to the character's own clothes: a kind per prompt, or the same tags in all.
  const anyKind = wearing.some((t) => exactness[t] === false)
  const sourceShown = wearing.length === 0 && styleChips.length === 0 && !outfitNote
  const wearingNote = outfitNote && wearing.length === 0
    ? outfitNote
    : wearing.length > 0 && hasNamed
      ? (anyKind ? WEARING_TEXT.anyKind : WEARING_TEXT.exact)
      : wearing.length === 0 && styleChips.some((c) => !c.inactive)
        ? WEARING_TEXT.styles
        : null

  return (
    <TooltipProvider delayDuration={300}>
      <section ref={sectionRef} aria-label="Pack" className={cn("@container divide-y divide-border/50 [&>*:first-child]:pt-0", className)}>
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
          castMode={brief.castMode ?? "together"}
          onCastModeChange={onCastModeChange}
          castPicker={castPicker}
          promptCount={promptCount}
          random={randomCast && castPicker ? { ...randomCast, value: brief.randomCast ?? null, provider: castPicker.provider } : null}
          flashKey={flashFor("who")}
        />
        {requestRow("wearing", {
          filled: styleChips.length > 0,
          leading: styleChips.map((c) => (
            <RequestChip key={`style:${c.style}`} label={c.label} inactive={c.inactive} onRemove={c.onRemove} />
          )),
          // While a style applies: how much of each library outfit goes in. Not otherwise.
          actions: outfitDetail && styleChips.some((c) => !c.inactive) ? (
            <OutfitDetailMenu value={outfitDetail.value} onChange={outfitDetail.onChange} />
          ) : undefined,
          // Empty, the field reads what the pack wears instead, with its menu; any chip replaces it.
          ...(sourceShown
            ? {
                placeholder: outfitSourceLabel(outfitSource),
                trailing: (
                  <WearingSourceMenu
                    value={outfitSource}
                    onChange={onOutfitSourceChange}
                    officialOutfits={officialOutfits}
                    noCharacter={!hasNamed}
                  />
                ),
              }
            : {}),
          notes: wearingNote || styleNote ? (
            <>
              {wearingNote && <SlotNote>{wearingNote}</SlotNote>}
              {styleNote && <SlotNote>{styleNote}</SlotNote>}
            </>
          ) : undefined,
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
        {requestRow("style", rowDefaults ? { defaults: rowDefaults.style, actions: rowDefaults.style.matches ? undefined : <UseDefaults defaults={rowDefaults.style} /> } : undefined)}
        <NeverRow
          tags={brief.never}
          picked={picked === "never"}
          entryFor={entryFor}
          onRemoveNever={onRemoveNever}
          flashKey={flashFor("never")}
          defaults={rowDefaults?.never}
        />

        {(people || changes || othersShown) && (
          <div className="space-y-1 py-2">
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

/** A row's defaults (Never, Style): which of its tags new packs start with, and the row's two actions. */
export interface RowDefaultsProps {
  /** True for a tag of the row that new packs start with. */
  has: (tag: string) => boolean
  /** The row holds exactly the defaults: nothing to offer. */
  matches: boolean
  /** The row is empty: the action clears the defaults. */
  empty: boolean
  onUse: () => void
  onRemove: (tag: string) => void
}

/** "Use in new packs" beside a row whose tags differ from its defaults; nothing when they match. */
function UseDefaults({ defaults }: { defaults: RowDefaultsProps }) {
  if (defaults.matches) return null
  return (
    <button
      type="button"
      onClick={defaults.onUse}
      title={DEFAULTS_TEXT.useHint}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground pointer-coarse:h-11",
        "transition-[color,background-color] duration-150 ease-out-strong hover:bg-muted hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <Repeat2 className="size-3.5" aria-hidden />
      {defaults.empty ? DEFAULTS_TEXT.clear : DEFAULTS_TEXT.use}
    </button>
  )
}

function NeverRow({
  tags,
  picked,
  entryFor,
  onRemoveNever,
  flashKey,
  defaults,
}: {
  tags: readonly string[]
  picked: boolean
  entryFor: (slot: SlotId, last: LastChip | null) => SlotEntryProps
  onRemoveNever: (tag: string) => void
  flashKey?: number
  defaults?: RowDefaultsProps
}) {
  const lastTag = tags[tags.length - 1]
  const last = lastTag ? { label: showTag(lastTag), remove: () => onRemoveNever(lastTag) } : null
  return (
    <BriefSlot
      slot="never"
      filled={tags.length > 0}
      entry={entryFor("never", last)}
      flashKey={flashKey}
      actions={defaults && !defaults.matches ? <UseDefaults defaults={defaults} /> : undefined}
    >
      {tags.map((tag, i) => (
        <RequestChip
          key={tag}
          variant="never"
          label={showTag(tag)}
          selected={picked && i === tags.length - 1}
          onRemove={() => onRemoveNever(tag)}
          inDefaults={defaults?.has(tag) ? { onRemove: () => defaults.onRemove(tag) } : undefined}
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
  castMode: CastMode
  onCastModeChange?: (mode: CastMode) => void
  castPicker?: PackBriefPanelProps["castPicker"]
  promptCount?: number
  random?: (NonNullable<PackBriefPanelProps["randomCast"]> & { value: RandomCast | null; provider: CastPickerProvider }) | null
  flashKey?: number
}

type CastPickerProvider = NonNullable<PackBriefPanelProps["castPicker"]>["provider"]

const GENDER_WORD: Record<RandomCast["gender"], string> = { auto: "auto", girls: "girls", boys: "boys", any: "any gender" }

/** With more characters than Together holds, Together can't be chosen. */
const CAST_MODE_CHOICES_MANY: Choice<CastMode>[] = CAST_MODE_CHOICES.map((c) => (c.value === "together" ? { ...c, disabled: true } : c))

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
  castMode,
  onCastModeChange,
  castPicker,
  promptCount,
  random,
  flashKey,
}: WhoRowProps) {
  const named = who.filter((c) => c.tag !== null)
  const showRoles = who.length >= 2
  const full = named.length >= maxCharacters
  // Two or more characters: together in every prompt, or one per prompt in turn.
  const castChoice = named.length >= 2 && onCastModeChange
  const turns = castChoice && castMode === "turns"
  // More than Together holds: a line of names, each character's look on request.
  const many = named.length > MAX_CAST
  const [looksShown, setLooksShown] = useState(false)
  const compact = many && !looksShown
  const unseen = turns && promptCount !== undefined && promptCount < named.length ? named.length - promptCount : 0

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
  // In the line of names the looks are hidden: Backspace has nothing of theirs to take.
  if (lastLine && !compact) {
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

  // Random characters: Who names nobody, a chip says where they come from.
  const drawing = !!random?.value && named.length === 0
  const filled = drawing || lines.some((l) => l.name || l.usual.length > 0 || l.added.length > 0)

  return (
    <BriefSlot
      slot="who"
      filled={filled}
      entry={entryFor("who", last)}
      placeholder={!filled ? undefined : full ? "Add a look tag" : undefined}
      actions={castChoice ? (
        <ChoiceGroup size="sm" choices={many ? CAST_MODE_CHOICES_MANY : CAST_MODE_CHOICES} value={castMode} onChange={onCastModeChange} label={CAST_MODE_TEXT.label} />
      ) : undefined}
      notes={full || turns || many ? (
        <>
          {turns && <SlotNote>{CAST_MODE_TEXT.turnsNote}{many && !full ? ` ${WHO_MANY_TEXT.togetherLimit(MAX_CAST)}` : ""}</SlotNote>}
          {full && <SlotNote>{castMode === "turns" ? WHO_MANY_TEXT.turnsFull(maxCharacters) : maxCharacters < MAX_TURNS_CAST && onCastModeChange ? WHO_MANY_TEXT.togetherFull(maxCharacters) : `A pack can have up to ${maxCharacters} characters.`}</SlotNote>}
          {unseen > 0 && promptCount !== undefined && <SlotNote tone="warning">{WHO_MANY_TEXT.fewPrompts(promptCount, unseen)}</SlotNote>}
          {many && (
            <button
              type="button"
              aria-expanded={looksShown}
              onClick={() => setLooksShown((v) => !v)}
              className="-mx-1 rounded px-1 font-medium text-foreground underline decoration-border underline-offset-[3px] transition-[text-decoration-color] duration-150 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
            >
              {looksShown ? WHO_MANY_TEXT.hideLooks : WHO_MANY_TEXT.showLooks}
            </button>
          )}
        </>
      ) : undefined}
      after={(castPicker && named.length < MAX_TURNS_CAST) || (random && named.length === 0 && !drawing) ? (
        <>
          {castPicker && named.length < MAX_TURNS_CAST && (
            <CastPickerButton provider={castPicker.provider} onAdd={castPicker.onAdd} exclude={named.map((c) => c.tag!)} room={MAX_TURNS_CAST - named.length} />
          )}
          {random && named.length === 0 && !drawing && (
            <RandomCastButton provider={random.provider} autoGender={random.autoGender} promptCount={promptCount ?? 10} onSubmit={random.onChange} />
          )}
        </>
      ) : undefined}
      flashKey={flashKey}
    >
      {compact && (
        <div className="flex basis-full flex-wrap items-center gap-1.5">
          {lines.map(({ c, name }) => name && (
            <RequestChip key={c.tag ?? "unnamed"} strong label={name} onRemove={() => onRemoveCharacter(c.tag)} />
          ))}
        </div>
      )}
      {lines.map(({ c, name, usual, added, removed, replaced }, i) => {
        const isLast = i === lines.length - 1
        const empty = !name && usual.length === 0 && added.length === 0
        if (empty) return null
        // In the line of names, only a character whose gender nobody knows gets a line of their own: they need the choice.
        if (compact && (c.role || (c.tag && assumedRoles[c.tag]))) return null
        if (compact && name) {
          return (
            <div key={c.tag ?? `unnamed-${i}`} className="flex basis-full flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-foreground">{name}</span>
              <ChoiceGroup size="sm" choices={ROLE_CHOICES} value={null} onChange={(role) => onSetRole(c.tag, role)} label={`${name} is a`} />
              <span className="text-xs text-muted-foreground">Pick one so the pack knows who is who</span>
            </div>
          )
        }
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
                tone="appearance"
                selected={picked && isLast && lastKey === `added:${t}`}
                onRemove={() => onRemoveTag(t)}
              />
            ))}
          </div>
        )
      })}
      {drawing && random?.value && (
        <div className="flex basis-full flex-wrap items-center gap-1.5">
          <RequestChip strong label={RANDOM_CAST_TEXT.chip} onRemove={() => random.onChange(null)} />
          <span className="min-w-0 text-xs text-muted-foreground">
            {RANDOM_CAST_TEXT.detail(
              random.value.source.kind === "series" ? seriesName(random.value.source.series) : RANDOM_CAST_TEXT.popular,
              random.value.gender === "auto" ? GENDER_WORD[random.autoGender] : GENDER_WORD[random.value.gender],
            )}
          </span>
          <RandomCastButton
            label={RANDOM_CAST_TEXT.change}
            value={random.value}
            provider={random.provider}
            autoGender={random.autoGender}
            promptCount={promptCount ?? 10}
            onSubmit={random.onChange}
          />
          <p className="basis-full text-xs text-muted-foreground text-pretty">{RANDOM_CAST_TEXT.note}</p>
        </div>
      )}
      {offers}
    </BriefSlot>
  )
}
