"use client"

/**
 * The pack builder made of the brief: Who, Wearing, Doing, Where, Also and Never, the
 * scenes that fit on a contact sheet, a line on how well they fit, Generate, and the
 * prompts. It owns the pack's whole state (usePackBrief), its source (usePackSources),
 * the characters' looks and the engine (usePackBriefScenes); the gallery only gives
 * it the environment (taxonomy, booru, prompt settings, copy, exit) and the characters
 * it starts with.
 *
 * Anchored at the bottom over the gallery, with its own scroll. Before generating it
 * shows the brief, the sheet, the fit line and Generate; after, the prompts, with the
 * brief folded into one line that opens it again.
 */
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from "react"
import { AlertTriangle, ChevronDown, Info, Package, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TooltipProvider } from "@/components/ui/tooltip"
import { toast } from "@/hooks/use-toast"
import { usePackBrief, type UsePackBriefResult } from "@/hooks/use-pack-brief"
import { usePackBriefScenes } from "@/hooks/use-pack-brief-scenes"
import { usePackSources, type UsePackSourcesResult } from "@/hooks/use-pack-sources"
import { useTagSuggestions } from "@/hooks/use-tag-suggestions"
import { useIsMobile } from "@/hooks/use-mobile"
import { useStableCallback } from "@/hooks/use-stable-callback"
import { useNaturalPrompt, usePromptFormat } from "@/hooks/use-natural-prompt"
import { useTagSlotEnrichment } from "@/hooks/use-tag-slot-enrichment"
import { packPromptFormat } from "@/lib/pack/pack-config-migration"
import { storedPackRating, withPackRating } from "@/lib/pack/pack-rating"
import { track } from "@/lib/analytics"
import { recordPromptCopy } from "@/lib/support-prompt"
import { toastError } from "@/lib/toast-error"
import type { PackRatingMode } from "@/hooks/use-pack-seed-search"
import type { BooruPost, BooruProvider } from "@/lib/booru/types"
import {
  addLook as addLookInBrief,
  addNever,
  addOther as addOtherInBrief,
  addTagExactly,
  canBeCondition,
  briefCompositions,
  briefFromPrompt,
  routeTag,
  typedRole,
  briefRole,
  type SuggestedKind,
  setPeople as setPeopleInBrief,
  type PackBrief,
} from "@/lib/pack/brief"
import { DEFAULT_ROWS, briefFromCharacters, rowDefaults, rowMatchesDefaults, type DefaultRow } from "@/lib/pack/brief-history"
import type { CastRole } from "@/lib/pack/scene/cast"
import type { Permanence } from "@/lib/pack/scene/permanence"
import type { PackPeople } from "@/lib/pack/scene/scene-pool"
import { getTagSlotFromOverrides } from "@/lib/tag-taxonomy"
import { normalizeTagForPack } from "@/lib/pack/pack-generator"
import { splitTags } from "@/lib/utils/tag-utils"
import {
  axisRequests,
  BRIEF_EXAMPLES,
  briefAsksNothing,
  briefWithExample,
  briefFromCardPost,
  correctionAfterBriefChange,
  briefFromSearch,
  castPeopleNote,
  keptRows,
  lookOwner,
  changedRows,
  oneAxis,
  issuesFit,
  packProviderChoices,
  packCopyText,
  promptSize,
  withWaiting,
  loadedState,
  lockedWithTag,
  peopleFromCountTags,
  pickedPeopleNote,
  predictFit,
  mergeFitNotes,
  withPromptPeople,
  withSearchProgress,
  preferredPostIds,
  promptTokens,
  type BriefOutfit,
  type FitNote,
} from "@/lib/pack/brief-pack"
import type { BulkSendCleanOptions } from "@/lib/pack/bulk-send"
import type { PackPrompt } from "@/lib/pack/pack-generator"
import type { SourcePlan } from "@/lib/pack/source-plan"
import type { OutfitDetail, OutfitStyle } from "@/lib/outfit-swap"
import type { NaturalPromptSource } from "@/lib/prompt/natural-format"
import { convertPromptOnce, preloadNaturalPrompt } from "@/lib/prompt/natural-prompt-loader"
import { PROMPT_FORMATS, PROMPT_FORMAT_INFO, type PromptFormat } from "@/lib/prompt/prompt-format"
import { getPostThumbnailUrl } from "@/lib/proxy-url"
import { cn } from "@/lib/utils"
import { PROVIDERS, PROVIDER_LABELS } from "../provider-select"
import { getProviderTagLimit } from "@/lib/booru/tag-limits"
import { SearchDetails } from "./search-details"
import { savedResultOf, type SavedPack } from "@/lib/pack/saved-pack"
import { BUILDER_SWITCH_TEXT } from "./builder-switch"
import type { EntryOption } from "./tag-entry"
import { AUTO_PAGE_CAP } from "@/lib/pack/source-paging"
import { BriefSummary } from "./brief-summary"
import type { Choice } from "./choice-group"
import { ContactSheet, type ContactSheetStatus, type SceneThumb } from "./contact-sheet"
import { FitLine } from "./fit-line"
import { GenerateBar, ResultsToolbar } from "./generate-bar"
import { PackBriefPanel } from "./pack-brief-panel"
import { BLOCKED, BUILDER_TEXT, CHANGES_OPTIONS, COPY_FAILED, EXAMPLES_HEADING, EXAMPLE_TEXT, TIP_TEXT, fitText, CORRECTION_TEXT, SHEET_TEXT, copyNoteText, DEFAULTS_TEXT, SIZE_TEXT, STYLE_TEXT, PEOPLE_TEXT, COMPOSITION_TEXT, RATING_OPTIONS, START_TEXT, missingText, type FitState, type OutfitSource } from "./pack-text"
import type { BriefPackResult } from "@/hooks/use-pack-brief-scenes"
import type { BriefOffer } from "./pack-brief-panel"
import { ResultRow } from "./result-row"
import { SLOTS, briefSummaryParts, characterName, companionsLabel, showTag, type CharacterInfo, type SlotId, type TagSuggestion } from "./slots"
import { UndoNotice } from "./undo-notice"
import { PackEmptyState, type ExampleBrief } from "./pack-empty-state"
import { PackTip } from "./pack-tip"
import { userPreferences } from "@/lib/storage"

/** Where a pack starts from: each way into Pack Mode. */
export type PackBriefStart =
  /** The pack kept across a reload (lib/pack/saved-pack.ts). */
  | { kind: "restored"; saved: SavedPack }
  | { kind: "characters"; names: readonly string[] }
  | { kind: "card"; post: BooruPost }
  | { kind: "prompt"; text: string }
  | { kind: "search"; search: string; character: string | null }

/** A correction from the results: what it was, and the pack as it was before, for Undo. */
interface Correction {
  id: number
  kind: "always" | "never"
  tag: string
  snapshot: BriefPackResult
  format: PromptFormat
  /** The brief before the correction, and right after it (null until it lands). */
  briefBefore: PackBrief
  briefAfter: PackBrief | null
  /** waiting: the brief has the change, the remake hasn't started; running; done (Undo offered). */
  status: "waiting" | "running" | "done"
  message: string | null
}

/** What a start brought to the brief, for the note under the header. */
type StartNote =
  | { kind: "restored"; dropped: boolean }
  | { kind: "characters" }
  | { kind: "card"; named: boolean; outfit: string[]; pose: string[] }
  | { kind: "prompt" }
  | { kind: "search"; skipped: string[] }

export interface PackBriefBuilderProps {
  /** Where the pack starts. A new start needs a new `key` on the builder. */
  start: PackBriefStart
  /** Shown; while hidden the pack stays as it is. */
  open: boolean
  /** Opens the entry dialog for another pack; this one stays if the user cancels. */
  onNewPack: () => void
  /** The app's tag slots. The builder looks up the ones they don't cover itself, and keeps them. */
  tagOverrides: Record<string, string>
  provider: BooruProvider
  /**
   * The rating a pack starts with when none is saved. The builder keeps its own and saves it in the
   * preference it shares with the classic builder; `onRatingChange` only hears about it.
   */
  initialRating: PackRatingMode
  onRatingChange?: (rating: PackRatingMode) => void
  /** The gallery's search, for a brief without a named character. */
  gallerySearch: string
  cleanOptions: Pick<
    BulkSendCleanOptions,
    "excludeInput" | "addInput" | "findInput" | "replaceInput" | "includeCharacters" | "optimizeTags" | "smartTagExclusion" | "experimentalPromptRules"
  >
  globalWeights: Record<string, number>
  isGlobalWeightsEnabled: boolean
  outfitOptions: { styles: readonly OutfitStyle[]; detail: OutfitDetail }
  onExit: () => void
  /** Opens the pack's card or character in the classic builder. */
  onOpenClassic?: () => void
}

/**
 * The brief a start makes, and what to say about it. Pure: nothing is written while rendering.
 * `permanence`: the permanence data, to make it again once it has loaded (usePackBrief placeWith).
 */
function begin(
  start: PackBriefStart,
  overrides: Record<string, string>,
  permanence?: (tag: string) => Permanence,
): { brief: PackBrief; note: StartNote } {
  switch (start.kind) {
    case "restored":
      return { brief: start.saved.brief, note: { kind: "restored", dropped: !!start.saved.resultsDropped } }
    case "characters":
      return { brief: briefFromCharacters([...start.names]), note: { kind: "characters" } }
    case "card": {
      // The card's characters come from the post's own character field, known to the taxonomy or not.
      const characters = splitTags(start.post.tag_string_character ?? "")
      const tags = splitTags(`${start.post.tag_string ?? ""} ${start.post.tag_string_character ?? ""}`)
      const { brief, offered } = briefFromCardPost(tags, characters, overrides, permanence)
      return { brief, note: { kind: "card", named: characters.length > 0, outfit: offered.outfit, pose: offered.pose } }
    }
    case "prompt": {
      const { brief, peopleTags } = briefFromPrompt(start.text, overrides, permanence)
      return { brief: withPromptPeople(brief, peopleTags), note: { kind: "prompt" } }
    }
    case "search": {
      const { brief, skipped } = briefFromSearch(start.search, overrides, start.character, permanence)
      return { brief, note: { kind: "search", skipped } }
    }
  }
}

/**
 * Shell: the panel and its header. Closed, it stays mounted (the pack and its posts wait
 * here) but inert: not shown, not focusable, and the environment it works from is held as
 * it was when it closed, so nothing is fetched, timed or worked out until it opens again.
 */
export const PackBriefBuilder = memo(function PackBriefBuilder(props: PackBriefBuilderProps) {
  const { start, open, tagOverrides, onExit, onNewPack, onOpenClassic } = props
  // The slots of tags the app's don't cover, looked up for this pack and kept here: the lookups
  // that every page of posts brings re-render the pack, never the gallery behind it.
  const slots = useTagSlotEnrichment(tagOverrides)
  const overrides = slots.overrides
  const [begun] = useState(() => ({
    ...begin(start, tagOverrides),
    // The same start with the permanence data: the brief above may be made before it loads.
    remake: (permanence: (tag: string) => Permanence) => begin(start, tagOverrides, permanence).brief,
  }))
  const pack = usePackBrief(overrides, begun.brief, { seeded: start.kind === "restored", remake: begun.remake })
  // The environment while open; held while closed.
  // The pack keeps the booru and gallery search it was started with, open or closed; only
  // "New pack" takes the gallery's current ones. Its own controls (site, rating) stay live:
  // another site is another source, like another rating.
  const [startSource, setStartSource] = useState(() => start.kind === "restored"
    ? { provider: start.saved.provider, gallerySearch: start.saved.gallerySearch }
    : { provider: props.provider, gallerySearch: props.gallerySearch })
  const onProviderChange = useCallback((provider: BooruProvider) => setStartSource((s) => ({ ...s, provider })), [])
  // The rating is the pack's own, like its site: saved in the preference the classic builder
  // reads, never set in the gallery while the pack is open.
  const [rating, setRating] = useState<PackRatingMode>(() => {
    try {
      return storedPackRating(userPreferences.getPackSourceAnswers(), props.initialRating)
    } catch {
      return props.initialRating
    }
  })
  const { onRatingChange } = props
  const changeRating = useCallback((next: PackRatingMode) => {
    setRating(next)
    try {
      userPreferences.setPackSourceAnswers(withPackRating(userPreferences.getPackSourceAnswers(), next, {
        ratingMode: next, tagsSource: "current", searchTags: startSource.gallerySearch, booruProvider: startSource.provider,
      }))
    } catch {
      // Storage unavailable: the choice lasts this pack.
    }
    onRatingChange?.(next)
  }, [onRatingChange, startSource])
  // While closed, the rest of the environment is held as it was when it closed.
  const [held, setHeld] = useState<PackBriefBuilderProps | null>(null)
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    setHeld(open ? null : props)
  }
  const env = { ...(open || !held ? props : held), ...startSource, onProviderChange, overrides, enrichTagSlots: slots.enrich, rating }

  // Focus goes into the panel when it opens and back where it was when it closes.
  const headingRef = useRef<HTMLHeadingElement>(null)
  const returnRef = useRef<Element | null>(null)
  useEffect(() => {
    if (open) {
      returnRef.current = document.activeElement
      headingRef.current?.focus()
      return
    }
    const back = returnRef.current
    if (back instanceof HTMLElement && back.isConnected && back !== document.body) back.focus()
    else document.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Mode"] [data-mode="pack"]')?.focus()
  }, [open])

  return (
    <TooltipProvider delayDuration={300}>
      <section
        aria-label={BUILDER_TEXT.title}
        inert={!open}
        onKeyDown={(e) => {
          // Lists, menus, a marked chip and the scene picker close first (they stop the key or own it).
          if (e.key !== "Escape" || e.defaultPrevented || e.isPropagationStopped()) return
          const target = e.target instanceof Element ? e.target : null
          if (target?.closest("[role='menu'], [role='listbox'], [role='dialog'], [data-radix-popper-content-wrapper]")) return
          onExit()
        }}
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[85dvh] w-full max-w-3xl flex-col overflow-clip",
          "rounded-t-2xl border border-border bg-background shadow-2xl sm:bottom-4 sm:w-[calc(100%-2rem)] sm:rounded-2xl",
          "animate-in fade-in-0 slide-in-from-bottom-4 duration-200 ease-out-strong motion-reduce:animate-none",
          // Last, so it wins over "flex": closed is not shown.
          !open && "hidden",
        )}
      >
        <header className="flex flex-shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
          <Package className="size-5 shrink-0 text-mode-pack-text" aria-hidden />
          <h2 ref={headingRef} tabIndex={-1} className="text-base font-semibold leading-tight text-foreground focus-visible:outline-none">
            {BUILDER_TEXT.title}
          </h2>
          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onNewPack}
              title={BUILDER_TEXT.newPackHint}
              className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground pointer-coarse:h-11"
            >
              {BUILDER_TEXT.newPack}
            </Button>
            {onOpenClassic && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onOpenClassic}
                title={BUILDER_SWITCH_TEXT.classicHint}
                aria-label={BUILDER_SWITCH_TEXT.classic}
                className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground pointer-coarse:h-11"
              >
                <span className="sm:hidden">{BUILDER_SWITCH_TEXT.classicShort}</span>
                <span className="max-sm:hidden">{BUILDER_SWITCH_TEXT.classic}</span>
              </Button>
            )}
            <ProviderMenu value={startSource.provider} rating={rating} onChange={onProviderChange} />
            <RatingMenu value={rating} onChange={changeRating} />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onExit}
              aria-label={BUILDER_TEXT.close}
              title={BUILDER_TEXT.closeHint}
              className="size-9 text-muted-foreground hover:text-foreground pointer-coarse:size-11"
            >
              <X className="size-4" aria-hidden />
            </Button>
          </div>
        </header>
        <div data-pack-scroll="" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-2">
          <BriefWorkspace {...env} open={open} pack={pack} startNote={begun.note} />
        </div>
      </section>
    </TooltipProvider>
  )
})

const MENU_TRIGGER = cn(
  "inline-flex h-8 max-w-[12rem] items-center gap-1 rounded-md border border-border bg-background px-2 text-xs pointer-coarse:h-11",
  "transition-[border-color,background-color] duration-150 ease-out-strong hover:border-foreground/30 data-[state=open]:border-foreground/30",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
)

/** The site the scenes come from, as the gallery's menu lists them; changing it is another source for the pack. */
const ProviderMenu = memo(function ProviderMenu({
  value,
  rating,
  onChange,
}: {
  value: BooruProvider
  rating: PackRatingMode
  onChange: (provider: BooruProvider) => void
}) {
  // Whether the gallery's adult-content confirmation was given, read when the menu opens.
  const [adultAcknowledged, setAdultAcknowledged] = useState(false)
  const choices = useMemo(() => packProviderChoices(PROVIDERS, rating, adultAcknowledged), [rating, adultAcknowledged])
  const label = PROVIDER_LABELS[value]
  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(isOpen) => {
        if (isOpen) setAdultAcknowledged(userPreferences.getRule34Acknowledged())
      }}
    >
      <DropdownMenuTrigger aria-label={`${BUILDER_TEXT.providerMenu}: ${label}`} className={MENU_TRIGGER}>
        <span className="truncate font-medium text-foreground">{label}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">{BUILDER_TEXT.providerMenu}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as BooruProvider)}>
          {choices.map((c) => {
            const detail = c.reason === "adult-consent" ? BUILDER_TEXT.providerNeedsConsent : c.note === "no-sensitive" ? BUILDER_TEXT.providerNoSensitive : null
            return (
              <DropdownMenuRadioItem
                key={c.provider}
                value={c.provider}
                disabled={!c.available}
                className="flex-col items-start gap-0.5 pointer-coarse:min-h-11"
              >
                <span>{PROVIDER_LABELS[c.provider]}</span>
                {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
})

const RatingMenu = memo(function RatingMenu({ value, onChange }: { value: PackRatingMode; onChange: (rating: PackRatingMode) => void }) {
  const label = RATING_OPTIONS.find((o) => o.value === value)?.label ?? RATING_OPTIONS[0].label
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger aria-label={`${BUILDER_TEXT.ratingMenu}: ${label}`} className={MENU_TRIGGER}>
        <span className="truncate font-medium text-foreground">{label}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">{BUILDER_TEXT.ratingMenu}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as PackRatingMode)}>
          {RATING_OPTIONS.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value} className="pointer-coarse:min-h-11">
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
})

// ── The source ───────────────────────────────────────────────────────────────────

/**
 * Runs the source plan. Mounted only while the plan has something to search:
 * usePackSources fetches page 1 of every search on mount.
 */
function BriefSource({
  plan,
  onResult,
}: {
  plan: SourcePlan
  onResult: (result: UsePackSourcesResult | null) => void
}) {
  const result = usePackSources({ plan })
  useEffect(() => onResult(result), [result, onResult])
  useEffect(() => () => onResult(null), [onResult])
  return null
}

// ── The workspace ────────────────────────────────────────────────────────────────

const FORMATS: Choice<PromptFormat>[] = PROMPT_FORMATS.map((f) => ({ value: f, label: PROMPT_FORMAT_INFO[f].label }))
const NO_POSTS: never[] = []
const NO_IDS: string[] = []
const NO_PROGRESS: never[] = []
const NO_DONORS: number[] = []
const UNDO_MS = 6000
/** Changes to the pack wait this long before it is saved for the next visit. */
const SAVE_DELAY_MS = 600

/** A sentence that ends with its stop, once. */
const sentence = (text: string) => (/[.!?…]$/.test(text) ? text : `${text}.`)

/** A tag of a prompt as the brief spells it: no weight, no brackets. */
const bareToken = (token: string) => token.replace(/^\(+/, "").replace(/(:[\d.]+)?\)+$/, "").trim()

/**
 * The slot of the brief a typed tag lands in, by its role (routeTag); null for a people count
 * (it sets People) and "people" for a pairing or focus ("hetero": People sets it, never a tag).
 * A tag about the people who are not the characters (`othersTag`) goes to Others wherever it is
 * typed; typed in Others, a look of anyone and a tag nothing knows stay there.
 */
function landsIn(
  tag: string,
  typedIn: SlotId,
  overrides: Record<string, string>,
  othersTag: (tag: string) => boolean,
  suggested?: SuggestedKind,
): SlotId | "people" | null {
  const route = routeTag(tag, overrides)
  if (route.kind === "people") return null
  if (route.kind === "composition") return "people"
  if (typedIn === "never") return "never"
  if (route.kind === "character") return "who"
  if (othersTag(tag)) return "others"
  if (typedIn === "others" && (route.kind === "look" || briefRole(tag, overrides).kind === "aspect")) return "others"
  if (route.kind === "look") return "who"
  if (route.kind === "request") return route.role
  if (typedIn === "others") return briefRole(tag, overrides).kind === "unknown" ? "others" : "style"
  return typedRole(tag, typedIn, overrides, suggested) ?? "style"
}

/** What an autocomplete suggestion said a tag is (slotSuggestions' kind); none for a typed tag. */
function suggestedKind(picked?: TagSuggestion): SuggestedKind | undefined {
  if (!picked) return undefined
  if (picked.kind === "Artist") return "artist"
  if (picked.kind === "Series") return "copyright"
  if (picked.kind === "Meta") return "meta"
  return picked.kind ? undefined : "general"
}

/** What the shell works out for the workspace: the pack's own site, rating and tag slots. */
interface WorkspaceEnv {
  onProviderChange: (provider: BooruProvider) => void
  /** The app's slots plus the ones looked up for this pack. */
  overrides: Record<string, string>
  enrichTagSlots: (tags: string[]) => Promise<boolean>
  rating: PackRatingMode
}

function BriefWorkspace({
  pack,
  overrides,
  enrichTagSlots,
  provider,
  rating,
  gallerySearch,
  onProviderChange,
  cleanOptions,
  globalWeights,
  isGlobalWeightsEnabled,
  outfitOptions,
  open,
  start,
  startNote,
}: PackBriefBuilderProps & WorkspaceEnv & { pack: UsePackBriefResult; startNote: StartNote }) {
  const { brief, preferences } = pack
  const count = preferences.promptCount
  const restored = start.kind === "restored" ? start.saved : null
  const [outfit, setOutfit] = useState<BriefOutfit>(() => restored?.outfit ?? { kind: "scene" })
  // A pack kept across a reload gets its pool back once the source is done loading (from the last render).
  const [sourceSettled, setSourceSettled] = useState(false)
  // Collecting: the pool can't have enough scenes yet, whatever they turn out to be, so pages keep
  // coming by themselves and the scenes that fit are worked out once they stop (from the last render).
  const [collecting, setCollecting] = useState(false)

  // ── Source ──────────────────────────────────────────────────────────────────────
  const [source, setSource] = useState<UsePackSourcesResult | null>(null)

  const posts = source?.allPosts ?? NO_POSTS
  const [ownKey, setOwnKey] = useState("")
  const originOf = source?.originOf
  const preferredPosts = useMemo(
    () => (originOf && ownKey ? preferredPostIds(originOf, new Set(ownKey.split("||"))) : []),
    [originOf, ownKey]
  )
  // Posts only the donor searches brought: they lend clothes or a place to the scenes.
  const [donorKey, setDonorKey] = useState("")
  const donorPosts = useMemo(
    () => (originOf && donorKey ? preferredPostIds(originOf, new Set(donorKey.split("||"))) : NO_DONORS),
    [originOf, donorKey]
  )

  // The pack's own prompt format: the gallery's until one is picked here, and picking one here
  // never changes the gallery's cards (it is a preference of the builder).
  const { format: galleryFormat, fullDetail } = usePromptFormat()
  const promptFormat = packPromptFormat(preferences, galleryFormat)
  const { setPromptFormat: setFormat } = pack
  const copy = useCallback((text: string, format: PromptFormat) => copyPackText(text, format, provider), [provider])

  const engine = usePackBriefScenes({
    brief,
    posts,
    preferredPosts,
    donorPosts,
    restored: restored?.result ?? null,
    sourceSettled,
    deferCandidates: collecting,
    provider,
    rating,
    includeSensitive: preferences.includeSensitive,
    gallerySearch,
    promptCount: count,
    outfit,
    overrides,
    enrichTagSlots,
    cleanOptions,
    globalWeights,
    isGlobalWeightsEnabled,
    outfitOptions,
    promptFormat,
  })
  const { plan, identity, candidates, candidatesPending, result, isGenerating, othersTag } = engine
  // The start's tags placed before the permanence data loaded go where it says, once it has.
  const { placeWith } = pack
  const { permanence } = engine
  useEffect(() => {
    if (permanence) placeWith(permanence)
  }, [permanence, placeWith])
  // The searches of the character's own posts: their posts' scenes go first. Read
  // from the plan of the previous render (the plan needs the posts to settle).
  const planOwnKey = plan.scenes.filter((s) => s.kind === "own").map((s) => s.id).join("||")
  if (planOwnKey !== ownKey) setOwnKey(planOwnKey)
  const planDonorKey = plan.donors.map((s) => s.id).join("||")
  if (planDonorKey !== donorKey) setDonorKey(planDonorKey)
  const searching = plan.scenes.some((s) => s.tags.length > 0)

  // ── What fits ───────────────────────────────────────────────────────────────────
  // One-part packs ("Only the outfit"…) leave out variants, a list of their own: back on
  // "Whole scene" the scenes left out before are as they were.
  const axis = oneAxis(brief)
  const leftOutList = axis ? brief.leftOutVariants ?? NO_IDS : brief.leftOut
  const leftOut = useMemo(() => new Set(leftOutList), [leftOutList])
  // The source ran out without a single post: there is nothing to wait for.
  const noPosts = !!source && source.noMoreResults && !source.isLoadingMore && posts.length === 0
  const usable = useMemo(
    () => (candidates ? candidates.filter((c) => !leftOut.has(String(c.postId))) : noPosts ? [] : null),
    [candidates, leftOut, noPosts]
  )
  const poses = pack.requests.select
  const have = usable ? (poses.length > 0 && !axis ? usable.filter((c) => c.hasPose).length : usable.length) : 0
  // Pages go one at a time to the search that can bring most; one the pace limit doesn't
  // allow yet waits and goes by itself (usePackSources). By itself the pack stops at
  // AUTO_PAGE_CAP pages; "Find more scenes" goes on from there.
  const canLoad = !!source && !source.noMoreResults && !source.failed && !source.sessionCapReached && source.pages < AUTO_PAGE_CAP
  // While the pool alone says there can't be enough scenes yet, the next page goes as soon as the
  // pool has taken the last one, without waiting for the scenes that fit (they wait for the batch).
  const collectingNow = open && canLoad && engine.sceneEstimate !== null && engine.sceneEstimate < count
  if (collectingNow !== collecting) setCollecting(collectingNow)
  const needMore = (collectingNow && !engine.poolBehind) || (!!usable && !candidatesPending && have < count)
  // Short of scenes: fetch more pages until there are enough, every search has run out or
  // the cap is reached (then the fit line says what there is).
  useEffect(() => {
    if (open && needMore && canLoad && source && !source.isLoadingMore && !source.waiting) source.loadMore()
  }, [open, needMore, canLoad, source])
  const loadingPosts = !!source?.isLoadingMore || (searching && !source)
  // One state for any failed load (the pack data or a page of posts): one line, one retry.
  const loadError = engine.loadFailed || !!source?.failed
  // Waiting for roles is not searching: the button says what is missing.
  const rolesMissing = identity.missingRoles.length > 0
  const finding = !loadError && !rolesMissing && (loadingPosts || (needMore && canLoad) || (!candidates && searching && !noPosts))
  const settledNow = !!source && !finding && !source.waiting && !loadError
  if (settledNow !== sourceSettled) setSourceSettled(settledNow)
  const canOfferSensitive = rating === "sfw" && plan.sensitive === "excluded" && !finding
  // Nothing stops the loading for good any more: a page waits for the pace limit and goes
  // by itself, and past the cap "Find more scenes" is on the loaded line.
  const paused = false
  const waiting = !!source?.waiting && !loadError
  // A page asked for by hand: searching while it is on its way, then whether it brought
  // new scenes. `seen` once the request is in flight; `before` the scenes there were.
  const [manual, setManual] = useState<{ before: number; seen: boolean; nothingNew: boolean } | null>(null)
  const sourceLoading = !!source?.isLoadingMore
  const usableCount = usable?.length ?? 0
  if (manual && !manual.nothingNew) {
    if (sourceLoading && !manual.seen) setManual({ ...manual, seen: true })
    // The page failed: nothing is on its way, the offer comes back.
    else if (!manual.seen && source?.failed) setManual(null)
    else if (manual.seen && !sourceLoading && !candidatesPending) {
      setManual(usableCount > manual.before ? null : { ...manual, nothingNew: true })
    }
  }
  const [manualPlan, setManualPlan] = useState(plan.sceneKey)
  if (manualPlan !== plan.sceneKey) {
    setManualPlan(plan.sceneKey)
    setManual(null)
  }
  const loadOnePage = useCallback(() => {
    // Only a page really asked for shows "searching".
    if (source?.loadMore()) setManual({ before: usableCount, seen: false, nothingNew: false })
  }, [source, usableCount])
  // What the scenes were found in, and the way to ask the site for more whenever it has more
  // (the automatic loading stops once there are enough scenes; this goes on by hand).
  const loadedNow = source
    ? loadedState({
        posts: posts.length,
        noMoreResults: source.noMoreResults,
        failed: source.failed,
        sessionCapReached: source.sessionCapReached,
        paused: waiting,
        finding,
        loading: sourceLoading || (!!manual && !manual.nothingNew),
      })
    : null
  const loadedPosts = loadedNow?.posts ?? 0
  const loadedAll = !!loadedNow?.all
  const loadedMore = !!loadedNow?.more
  const loaded = useMemo(
    () =>
      loadedPosts > 0
        ? {
            // The posts that give scenes, and the donors' apart: the same numbers How it searches adds up.
            text: BUILDER_TEXT.loadedFrom(loadedPosts - donorPosts.length, PROVIDER_LABELS[provider], loadedAll, donorPosts.length),
            onFindMore: loadedMore ? loadOnePage : undefined,
          }
        : null,
    [loadedPosts, loadedAll, loadedMore, provider, loadOnePage, donorPosts.length]
  )
  // What the pack searches, folded under the fit line until asked for.
  const searchesId = useId()
  const [searchesOpen, setSearchesOpen] = useState(false)
  const toggleSearches = useCallback(() => setSearchesOpen((v) => !v), [])
  const searchesToggle = useMemo(
    () => (searching && !loadError ? { open: searchesOpen, onToggle: toggleSearches, controls: searchesId } : null),
    [searching, loadError, searchesOpen, toggleSearches, searchesId]
  )
  const firstTag = brief.who[0]?.tag ?? null
  const firstName = firstTag ? characterName(firstTag) : null
  const axisNote = useMemo(() => (axis ? { axis, requested: axisRequests(brief, axis) } : null), [axis, brief])
  const peopleNote = pickedPeopleNote({ picked: brief.people, available: engine.available, using: engine.people, cast: identity.cast })

  // A correction from the results remakes the prompts itself: no "generate again" for it
  // while it runs. A pack made from another source (booru, rating, characters) is out of date.
  const [correction, setCorrection] = useState<Correction | null>(null)
  const correcting = !!correction && correction.status !== "done"
  const stale = !!result && (engine.sourceChanged || (!correcting && (result.brief !== brief || result.count !== count || result.outfit !== outfit)))
  const notes: FitNote[] = useMemo(() => {
    const castNote = castPeopleNote(brief.people, identity.cast)
    const lead = [peopleNote, castNote].filter((n): n is FitNote => !!n)
    const progress = {
      loading: (sourceLoading || (!!manual && !manual.nothingNew)) && !loadError,
      found: have,
      nothingNew: manual?.nothingNew ? { exhausted: !!source?.noMoreResults } : null,
    }
    if (loadError) return []
    const predicted = () => predictFit({ candidates: usable, count, poses, finding, canOfferSensitive, paused, axis: axisNote, conditions: engine.conditionSupply })
    if (!result) return mergeFitNotes(withSearchProgress([...lead, ...predicted()], progress))
    // Out of date: the last pack's notes are about another brief; the line speaks of the brief as it is.
    if (stale) return mergeFitNotes(withSearchProgress([{ kind: "stale" }, ...lead, ...predicted()], progress))
    const after = issuesFit({
      issues: result.issues,
      count: result.count,
      made: result.prompts.length,
      cast: identity.cast,
      scenes: usable ? have : null,
      canOfferSensitive,
      paused,
      axis: oneAxis(result.brief),
    })
    return mergeFitNotes(withSearchProgress([...lead, ...after], progress))
  }, [result, usable, count, poses, finding, canOfferSensitive, paused, axisNote, peopleNote, brief.people, identity.cast, have, stale, sourceLoading, manual, loadError, source?.noMoreResults, engine.conditionSupply])
  // A page waiting for the pace limit: said in place of "Finding scenes…", gone once it goes.
  const lineNotes = useMemo(() => withWaiting(notes, waiting), [notes, waiting])
  const { setIncludeSensitive } = pack
  const includeSensitive = useCallback(() => setIncludeSensitive(true), [setIncludeSensitive])
  const fitStates = useMemo<FitState[]>(
    () => lineNotes.map((n): FitState =>
      n.kind === "few-rated"
        ? { kind: "few-rated", onInclude: includeSensitive }
        : n.kind === "paused"
          ? { kind: "paused", onLoadMore: loadOnePage, waiting: !!source?.scrollLimited, nothingNew: n.nothingNew }
          : n),
    [lineNotes, includeSensitive, loadOnePage, source?.scrollLimited]
  )

  // ── Folding ─────────────────────────────────────────────────────────────────────
  // A pack kept across a reload with its prompts comes back as a made pack does: prompts first.
  const [folded, setFolded] = useState(() => !!restored?.result?.prompts.length)
  const [openedFromSummary, setOpenedFromSummary] = useState(false)
  // A pack just made folds the brief away, so the prompts come first.
  const [wasGenerating, setWasGenerating] = useState(false)
  const [briefOpenNarrow, setBriefOpenNarrow] = useState(false)
  if (wasGenerating !== isGenerating) {
    setWasGenerating(isGenerating)
    if (!isGenerating && result) {
      setFolded(true)
      setBriefOpenNarrow(false)
      setOpenedFromSummary(false)
    }
  }
  const expand = useCallback(() => {
    setFolded(false)
    setOpenedFromSummary(true)
  }, [])
  // On a phone the brief is a line that opens and closes in place: what the pack will be,
  // the fit line, Generate and the prompts come first. Focus stays on the line.
  const narrow = useIsMobile()
  const toggleBriefNarrow = useCallback(() => setBriefOpenNarrow((v) => !v), [])
  const showBrief = narrow ? briefOpenNarrow : !folded
  // After a pack is made, focus goes to the prompts.
  const resultsRef = useRef<HTMLDivElement>(null)
  const wasGeneratingRef = useRef(false)
  useEffect(() => {
    if (wasGeneratingRef.current && !isGenerating) {
      // The brief is folded by now: the top of the panel is the summary, the fit line and the results.
      resultsRef.current?.closest("[data-pack-scroll]")?.scrollTo({ top: 0 })
      resultsRef.current?.focus({ preventScroll: true })
    }
    wasGeneratingRef.current = isGenerating
  }, [isGenerating])

  // ── Brief edits ─────────────────────────────────────────────────────────────────
  const [routed, setRouted] = useState<{ slot: SlotId | "people"; key: number } | null>(null)
  const suggestions = useTagSuggestions(overrides)
  const { add, addOther, never, remove, unnever, removeCharacter, setRole, removeLook, restoreLook, leaveOutScene, restoreScene, setPeople, undo } = pack
  const { leaveOutVariant, restoreVariant, setBaseScene } = pack
  const cast = identity.cast
  const onAddTags = useCallback((tags: string[], slot: SlotId, picked?: TagSuggestion) => {
    let elsewhere: SlotId | "people" | null = null
    const counts: string[] = []
    const kind = suggestedKind(picked)
    for (const tag of tags) {
      const dest = landsIn(tag, slot, overrides, othersTag, kind)
      // A typed count ("2girls", "1boy", "solo") sets who is in the picture.
      if (dest === null) {
        counts.push(tag)
        continue
      }
      // A pairing or a focus ("hetero") is who is in the picture: People sets it, the pack says so.
      if (dest === "people") {
        toast({ description: COMPOSITION_TEXT.setByPeople(showTag(tag)), duration: 5000 })
        elsewhere = "people"
        continue
      }
      if (slot === "never") never(tag)
      else if (dest === "others") addOther(tag)
      else add(tag, typedRole(tag, slot === "others" ? "style" : slot, overrides, kind))
      if (dest !== slot) elsewhere = dest
    }
    const people = peopleFromCountTags(counts, cast)
    if (people) {
      setPeople(people)
      elsewhere = "people"
    }
    if (elsewhere) setRouted({ slot: elsewhere, key: Date.now() })
  }, [add, addOther, never, setPeople, overrides, cast, othersTag])
  // Undo: the last change of the brief, for a few seconds.
  const [undoFor, setUndoFor] = useState<object | null>(null)
  const [providerUndo, setProviderUndo] = useState<{ from: BooruProvider; to: BooruProvider } | null>(null)
  const [seenBrief, setSeenBrief] = useState(brief)
  // A brief that came back through Undo opens no notice: the one before would name an older change.
  const [undoing, setUndoing] = useState(false)
  if (seenBrief !== brief) {
    setSeenBrief(brief)
    // The correction's own change has its own notice; any other change retires it, and from
    // then on the brief's undo and "The pack changed…" apply.
    const next = correctionAfterBriefChange(correction, brief)
    const own = next.own
    if (next.correction !== correction) setCorrection(next.correction)
    setUndoFor(pack.canUndo && !undoing && !own ? brief : null)
    if (undoing) setUndoing(false)
    setProviderUndo(null)
  }
  // Another site: one notice with Undo, which goes back to the site before (and opens no notice).
  const [seenProvider, setSeenProvider] = useState(provider)
  const [undoingProvider, setUndoingProvider] = useState(false)
  if (seenProvider !== provider) {
    setSeenProvider(provider)
    setProviderUndo(undoingProvider ? null : { from: seenProvider, to: provider })
    if (undoingProvider) setUndoingProvider(false)
    setUndoFor(null)
  }
  if (!open && providerUndo) setProviderUndo(null)
  // Never and Style defaults: set on purpose from the row, never part of the brief's Undo; the
  // notice that confirms a change has its own Undo, which puts the defaults back as they were.
  const { setRowDefaults, removeRowDefault } = pack
  const [defaultsUndo, setDefaultsUndo] = useState<{ row: DefaultRow; before: string[]; message: string } | null>(null)
  if (!open && defaultsUndo) setDefaultsUndo(null)
  useEffect(() => {
    if (!defaultsUndo) return
    const timer = setTimeout(() => setDefaultsUndo(null), UNDO_MS)
    return () => clearTimeout(timer)
  }, [defaultsUndo])
  const rowDefaultsProps = useMemo(() => {
    const prefs = pack.preferences
    const make = (row: DefaultRow, label: string) => {
      const saved = new Set(rowDefaults(prefs, row).map(normalizeTagForPack))
      const tags = DEFAULT_ROWS[row].tagsOf(brief)
      return {
        has: (tag: string) => saved.has(normalizeTagForPack(tag)),
        matches: rowMatchesDefaults(brief, prefs, row),
        empty: tags.length === 0,
        onUse: () => {
          const before = setRowDefaults(row, tags)
          setDefaultsUndo({ row, before, message: tags.length === 0 ? DEFAULTS_TEXT.cleared(label) : DEFAULTS_TEXT.saved(label) })
        },
        onRemove: (tag: string) => {
          const before = removeRowDefault(row, tag)
          setDefaultsUndo({ row, before, message: DEFAULTS_TEXT.removed(showTag(tag)) })
        },
      }
    }
    return { never: make("never", SLOTS.never.label), style: make("style", SLOTS.style.label) }
  }, [pack.preferences, brief, setRowDefaults, removeRowDefault])
  const onUndoDefaults = useCallback(() => {
    if (!defaultsUndo) return
    setRowDefaults(defaultsUndo.row, defaultsUndo.before)
    setDefaultsUndo(null)
  }, [defaultsUndo, setRowDefaults])
  useEffect(() => {
    if (!providerUndo) return
    const timer = setTimeout(() => setProviderUndo(null), UNDO_MS)
    return () => clearTimeout(timer)
  }, [providerUndo])
  const onUndoProvider = useCallback(() => {
    if (!providerUndo) return
    setUndoingProvider(true)
    setProviderUndo(null)
    onProviderChange(providerUndo.from)
  }, [providerUndo, onProviderChange])
  // Closed: no notices and no timers.
  if (!open && (undoFor || correction)) {
    setUndoFor(null)
    setCorrection(null)
  }
  useEffect(() => {
    if (!undoFor) return
    const timer = setTimeout(() => setUndoFor(null), UNDO_MS)
    return () => clearTimeout(timer)
  }, [undoFor])
  const showUndo = undoFor === brief && !!pack.lastChange
  const onUndo = useCallback(() => {
    if (undo() !== null) setUndoing(true)
    setUndoFor(null)
  }, [undo])

  // ── Corrections from the results ────────────────────────────────────────────────
  // The tag menu changes the brief and the pack is remade at once with the same seed and
  // scenes; Undo puts brief, prompts, locks and format back as they were.
  const correctionIdRef = useRef(0)
  const { addLook, addExactly } = pack
  const correct = useCallback((kind: "always" | "never", raw: string) => {
    if (!result || engine.busy || engine.sourceChanged || engine.poolPending) return
    const tag = bareToken(raw)
    const route = routeTag(tag, overrides)
    let next: PackBrief
    let apply: () => void
    if (kind === "never") {
      next = addNever(brief, tag)
      apply = () => never(tag)
    } else if (route.kind === "composition") {
      // A pairing or a focus is who is in the picture: People sets it.
      toast({ description: COMPOSITION_TEXT.setByPeople(showTag(tag)), duration: 5000 })
      return
    } else if (route.kind === "people") {
      // A count says who is in the picture: it goes to People, as when typed.
      const people = peopleFromCountTags([tag], cast)
      if (!people) return
      next = setPeopleInBrief(brief, people)
      apply = () => setPeople(people)
    } else if (othersTag(tag)) {
      // "dark-skinned male" next to girls is how the others look, as when typed.
      next = addOtherInBrief(brief, tag)
      apply = () => addOther(tag)
    } else if (route.kind === "look" && identity.castSize >= 2) {
      // With several characters a look tag goes to the one it came from, never to a guess.
      const owner = lookOwner(tag, identity.blocks)
      const ownerTag = owner ? brief.who.find((c) => c.tag && normalizeTagForPack(c.tag) === owner)?.tag ?? null : null
      if (!ownerTag) {
        toast({ description: CORRECTION_TEXT.lookWhose(showTag(tag)), duration: 5000 })
        return
      }
      next = addLookInBrief(brief, ownerTag, tag)
      apply = () => addLook(ownerTag, tag)
    } else {
      // Like a tag typed in Also: one the taxonomy does not know goes to Style.
      // Always on a garment or a place of a prompt asks for that tag: exact, not any form of it.
      const role = typedRole(tag, "also", overrides)
      next = addTagExactly(brief, tag, overrides, role)
      apply = () => addExactly(tag, role)
    }
    if (JSON.stringify(next) === JSON.stringify(brief)) return
    setCorrection({
      id: ++correctionIdRef.current, kind, tag, snapshot: result, format: promptFormat,
      briefBefore: brief, briefAfter: null, status: "waiting", message: null,
    })
    apply()
  }, [result, engine.busy, engine.sourceChanged, engine.poolPending, overrides, brief, cast, identity.castSize, identity.blocks, promptFormat, never, setPeople, addLook, addExactly, othersTag, addOther])
  // Stable: `correct` follows the brief, the slots and the engine, which change with every page of
  // posts, and the rows would all render again for it.
  const onAlways = useStableCallback((tag: string) => correct("always", tag))
  const onNever = useStableCallback((tag: string) => correct("never", tag))
  // Runs once the brief has the change (the engine's arguments follow it). Every outcome
  // closes the notice: done offers Undo; replaced, skipped or failed goes.
  const { recompose, restore } = engine
  const runningRef = useRef(0)
  useEffect(() => {
    if (!correction || correction.status !== "waiting" || correction.briefAfter !== brief || runningRef.current === correction.id) return
    runningRef.current = correction.id
    const { id, kind, tag } = correction
    void recompose().then((outcome) => {
      if (outcome.status !== "done") {
        setCorrection((cur) => (cur?.id === id ? null : cur))
        return
      }
      const { before, after } = outcome
      const changed = changedRows(before.prompts, after.prompts)
      const kept = keptRows(after.prompts.length, new Set(after.locked), after.made.slots)
      const parts = [CORRECTION_TEXT[kind](tag, changed)]
      if (kind === "never") {
        const locked = lockedWithTag(after.prompts, kept.locked, tag)
        const older = lockedWithTag(after.prompts, kept.older, tag)
        if (locked > 0) parts.push(CORRECTION_TEXT.lockedKeep(locked))
        if (older > 0) parts.push(CORRECTION_TEXT.olderKeep(older))
      }
      setCorrection((cur) => (cur?.id === id ? { ...cur, status: "done", message: parts.join(". ") } : cur))
    })
  }, [correction, brief, recompose])
  const undoCorrection = useCallback(() => {
    if (!correction || correction.status !== "done") return
    // Any other change would have retired this notice: the last change is the correction's.
    if (undo() !== null) setUndoing(true)
    restore(correction.snapshot)
    setFormat(correction.format)
    setCorrection(null)
  }, [correction, undo, restore, setFormat])
  // A correction notice goes after a while, like the brief's.
  useEffect(() => {
    if (correction?.status !== "done") return
    const timer = setTimeout(() => setCorrection((cur) => (cur?.id === correction.id ? null : cur)), UNDO_MS)
    return () => clearTimeout(timer)
  }, [correction])
  // Locking and re-rolling are changes too: a correction's Undo must not throw them away.
  const { toggleLock, reroll } = engine
  const onToggleLock = useCallback((index: number) => {
    setCorrection(null)
    toggleLock(index)
  }, [toggleLock])
  // Stable for the rows: `reroll` follows the engine's arguments, which change with every page.
  const onReroll = useStableCallback((index: number) => {
    const done = reroll(index)
    if (done) setCorrection(null)
    return done
  })
  // Generate is another operation: a correction's notice goes.
  const { generate } = engine
  const onGenerate = useCallback(() => {
    setCorrection(null)
    generate()
  }, [generate])
  const onRemoveCharacter = useCallback((tag: string | null) => { if (tag) removeCharacter(tag) }, [removeCharacter])
  const onToggleScene = useCallback(
    (id: string) => {
      if (axis) return leftOut.has(id) ? restoreVariant(id) : leaveOutVariant(id)
      return leftOut.has(id) ? restoreScene(id) : leaveOutScene(id)
    },
    [axis, leftOut, leaveOutScene, restoreScene, leaveOutVariant, restoreVariant]
  )
  // One-part packs: the first tile is the scene that repeats; selecting it chooses another.
  const [pickingFixed, setPickingFixed] = useState(false)
  const fixedId = axis && candidates?.[0]?.axisRole === "base" ? String(candidates[0].postId) : null
  if (pickingFixed && !fixedId) setPickingFixed(false)
  // With locked rows the scene that repeats is the pack's: choosing another waits until they're unlocked.
  const fixedLocked = !!axis && !!result && result.locked.length > 0
  const fixed = useMemo(() => (fixedId
    ? {
        id: fixedId,
        picking: pickingFixed && !fixedLocked,
        blockedReason: fixedLocked ? SHEET_TEXT.fixedLocked : undefined,
        onStartPick: () => { if (!fixedLocked) setPickingFixed(true) },
        onCancelPick: () => setPickingFixed(false),
        onPick: (id: string) => {
          setPickingFixed(false)
          setBaseScene(Number(id))
        },
      }
    : undefined), [fixedId, pickingFixed, fixedLocked, setBaseScene])


  // ── What the start brought ──────────────────────────────────────────────────────
  // The card's outfit and pose are offered, never copied: a request is a condition.
  const { addTags } = pack
  const has = useCallback((tag: string) => brief.requests.some((r) => r.tag === normalizeTagForPack(tag)), [brief.requests])
  const offers = useMemo<BriefOffer[]>(() => {
    if (startNote.kind !== "card") return []
    const out: BriefOffer[] = []
    const outfit = startNote.outfit.filter((t) => !has(t))
    const pose = startNote.pose.filter((t) => !has(t))
    if (outfit.length > 0) {
      out.push({ id: "card-outfit", slot: "wearing", label: BUILDER_TEXT.cardOutfit, detail: outfit.map(showTag).join(", "), onAccept: () => addTags(outfit, "wearing") })
    }
    if (pose.length > 0) {
      out.push({ id: "card-pose", slot: "doing", label: BUILDER_TEXT.cardPose, detail: pose.map(showTag).join(", "), onAccept: () => addTags(pose, "doing") })
    }
    return out
  }, [startNote, has, addTags])
  // Said until the first change: what the start put in, and what it left out.
  const startText = pack.canUndo ? null : startNoteText(startNote, engine.poolPending)
  // The note on a pack that came back stays in view with the brief folded: it explains the prompts.
  const showStartText = !!startText && (showBrief || startNote.kind === "restored")

  // ── Saved for the next visit ────────────────────────────────────────────────────
  // The pack as it is now replaces the one saved before, a moment after each change (never while
  // rendering); a change still waiting is written when the page goes or the pack is replaced.
  const pendingSave = useRef<(() => void) | null>(null)
  useEffect(() => {
    const write = () => {
      try {
        userPreferences.setSavedPack({ brief, outfit, provider, gallerySearch, result: result ? savedResultOf(result, brief, outfit) : null })
      } catch {
        // Storage unavailable: the pack lasts this visit.
      }
    }
    pendingSave.current = write
    const timer = setTimeout(() => {
      pendingSave.current = null
      write()
    }, SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [brief, outfit, provider, gallerySearch, result])
  useEffect(() => {
    const flush = () => {
      const write = pendingSave.current
      pendingSave.current = null
      write?.()
    }
    window.addEventListener("pagehide", flush)
    return () => {
      window.removeEventListener("pagehide", flush)
      flush()
    }
  }, [])

  // ── What the brief shows of each character ──────────────────────────────────────
  const characterInfo = useMemo(() => {
    const out: Record<string, CharacterInfo> = {}
    for (const c of brief.who) if (c.tag) out[c.tag] = { usualLook: engine.looks[c.tag]?.look ?? [], replacedLook: engine.replacedLook[c.tag] }
    return out
  }, [brief.who, engine.looks, engine.replacedLook])
  // With several characters, the role the pack assumes for each one (the user corrects it in Who).
  const assumedRoles = useMemo(() => {
    const out: Record<string, CastRole | null> = {}
    brief.who.forEach((c, i) => { if (c.tag) out[c.tag] = identity.members[i]?.role ?? null })
    return out
  }, [brief.who, identity.members])
  const { setChanges } = pack
  const changesControl = useMemo(() => ({ value: brief.changes, onChange: setChanges }), [brief.changes, setChanges])
  // Several make-ups can be marked; a one-part pack keeps one (its scene that repeats sets it).
  const { toggleComposition } = pack
  const enginePeople = engine.people
  const onTogglePeople = useCallback((option: PackPeople) => toggleComposition(option, enginePeople), [toggleComposition, enginePeople])
  const people = engine.peopleLine
    ? {
        options: engine.peopleLine.options,
        value: engine.peopleLine.value,
        onChange: setPeople,
        cast: identity.cast,
        poseNeeds: engine.peopleLine.poseNeeds,
        ...(axis
          ? { note: PEOPLE_TEXT.axis }
          : { selected: engine.peopleSelected, onToggle: onTogglePeople, blocked: engine.peopleBlocked }),
      }
    : null
  // ── Wearing and Where as conditions ─────────────────────────────────────────────
  // Every garment, and a place, is met with a different form per prompt unless made exact.
  const exactness = useMemo(() => {
    const out: Record<string, boolean> = {}
    for (const r of brief.requests) if (canBeCondition(r, overrides)) out[r.tag] = !!r.exact
    return out
  }, [brief.requests, overrides])
  // The library's styles: offered in the Wearing field, chosen as chips.
  const { addStyle, removeStyle } = pack
  const chosenStyles = brief.outfitStyles ?? NO_IDS
  const styleOptions = useMemo<EntryOption[]>(
    () => engine.allowedStyles
      .filter((style) => !chosenStyles.includes(style) && (engine.styleCounts[style] ?? 0) > 0)
      .map((style) => ({
        id: style,
        label: STYLE_TEXT.name(style),
        detail: STYLE_TEXT.count(engine.styleCounts[style] ?? 0),
        onPick: () => addStyle(style, STYLE_TEXT.chip(style)),
      })),
    [engine.allowedStyles, engine.styleCounts, chosenStyles, addStyle]
  )
  const styleChips = useMemo(
    () => chosenStyles.map((style) => ({
      style,
      label: STYLE_TEXT.chip(style),
      inactive: engine.allowedStyles.includes(style as OutfitStyle) ? undefined : STYLE_TEXT.notAtRating,
      onRemove: () => removeStyle(style, STYLE_TEXT.chip(style)),
    })),
    [chosenStyles, engine.allowedStyles, removeStyle]
  )
  const unusedStyles = chosenStyles.filter((style) => !engine.allowedStyles.includes(style as OutfitStyle))
  const styleNote = unusedStyles.length > 0 ? STYLE_TEXT.unused(unusedStyles) : undefined

  // Others shows once the make-up has someone besides the characters (the chosen one, or the one the scenes give).
  const composition = engine.people ?? brief.people
  const othersApply = composition ? composition.girls + composition.boys > identity.cast.girls + identity.cast.boys : null
  const othersRow = useMemo(() => ({ applies: othersApply }), [othersApply])
  const summary = useMemo(() => {
    // Several make-ups: "with 2 boys or with 3 boys".
    const label = brief.people ? briefCompositions(brief).map((p) => companionsLabel(p, identity.cast)).join(" or ") : null
    const parts = briefSummaryParts(brief, label, characterInfo)
    // The folded line says when only one part changes.
    const changes = CHANGES_OPTIONS.find((o) => o.value === brief.changes)
    return axis && changes ? [...parts, changes.label.toLowerCase()] : parts
  }, [brief, identity.cast, characterInfo, axis])

  // ── The contact sheet ───────────────────────────────────────────────────────────
  const thumbs = useMemo<SceneThumb[]>(
    () => (candidates ?? []).map((c) => ({ id: String(c.postId), postId: c.postId, src: c.preview ? getPostThumbnailUrl(c.preview) : undefined })),
    [candidates]
  )
  // The sheet never shows its own error: the builder's one line above covers every failed load.
  const sheetStatus: ContactSheetStatus = !candidates && !loadError && (finding || !engine.ready) ? "loading" : "ready"
  const { loadFailed: dataFailed, retryLoad } = engine
  // Retries everything that failed, data and pages; each clears its error as it starts again.
  const retryAll = useCallback(() => {
    if (dataFailed) retryLoad()
    if (source?.failed) source.retry()
  }, [dataFailed, retryLoad, source])

  // ── Help: examples for an empty brief, and tips shown once ──────────────────────
  const { changeTo } = pack
  const showExamples = showBrief && !result && briefAsksNothing(brief)
  const examples = useMemo<ExampleBrief[]>(
    () => BRIEF_EXAMPLES.map((ex) => ({ id: ex.id, parts: [EXAMPLE_TEXT[ex.id]?.title ?? ex.id, EXAMPLE_TEXT[ex.id]?.detail ?? ""] })),
    []
  )
  const pickExample = useCallback((id: string) => {
    const ex = BRIEF_EXAMPLES.find((e) => e.id === id)
    if (!ex) return
    const label = ex.tags.length > 0 ? `Added ${ex.tags.map((t) => t.tag).join(", ")}` : "Changed what varies"
    changeTo(briefWithExample(brief, ex, overrides), label)
  }, [brief, overrides, changeTo])
  // Each tip shows the first time it is useful, and never again (marked as seen when shown).
  const [tipsSeen] = useState<ReadonlySet<string>>(() => {
    try {
      return new Set(userPreferences.getPackTipsSeen())
    } catch {
      return new Set()
    }
  })
  const [tipsClosed, setTipsClosed] = useState<ReadonlySet<string>>(() => new Set())
  const tipOn = (id: string, when: boolean) => open && when && !tipsSeen.has(id) && !tipsClosed.has(id)
  const sheetTip = tipOn("sheet", showBrief && !axis && thumbs.length > 0)
  const axisTip = tipOn("axis", showBrief && !!axis && !!fixedId)
  const resultsTip = tipOn("results", !!result && result.prompts.length > 0)
  useEffect(() => {
    const shown = [sheetTip && "sheet", axisTip && "axis", resultsTip && "results"].filter((id): id is string => !!id)
    try {
      shown.forEach((id) => userPreferences.markPackTipSeen(id))
    } catch {
      // Storage unavailable: the tip may show again next time.
    }
  }, [sheetTip, axisTip, resultsTip])
  const closeTip = useCallback((id: string) => setTipsClosed((prev) => new Set(prev).add(id)), [])

  // ── Generate ────────────────────────────────────────────────────────────────────
  const named = brief.who.some((c) => c.tag)
  const blockedReason = !named
    ? BLOCKED.noCharacter
    : identity.missingRoles.length > 0
      ? BLOCKED.roles
      : noPosts
        ? BLOCKED.noScenes
        : !engine.pool
        ? BLOCKED.waiting
        : usable && usable.length === 0 && !finding
          ? BLOCKED.noScenes
          : undefined

  return (
    <div className="space-y-3">
      {loadError && (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive-text">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {BUILDER_TEXT.loadFailed}
          <Button type="button" variant="outline" size="sm" onClick={retryAll} className="h-7 px-2.5 text-xs pointer-coarse:h-11">
            {BUILDER_TEXT.retry}
          </Button>
        </p>
      )}

      {showStartText && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground text-pretty">
          <Info className="mt-px size-3.5 shrink-0 text-info-text" aria-hidden />
          {startText}
        </p>
      )}
      {narrow ? (
        <BriefSummary parts={summary} onExpand={toggleBriefNarrow} expanded={briefOpenNarrow} />
      ) : folded ? (
        <BriefSummary parts={summary} onExpand={expand} />
      ) : null}
      {showBrief && (
        <PackBriefPanel
          brief={brief}
          characterInfo={characterInfo}
          autoFocus={openedFromSummary && !narrow}
          routed={routed}
          onAddTags={onAddTags}
          onRemoveTag={remove}
          onRemoveNever={unnever}
          onRemoveCharacter={onRemoveCharacter}
          onSetRole={setRole}
          onRemoveTrait={removeLook}
          onRestoreTrait={restoreLook}
          outfitSource={outfit as OutfitSource}
          onOutfitSourceChange={setOutfit}
          officialOutfits={engine.officialOutfits}
          outfitNote={axis === "outfit" ? SHEET_TEXT.outfitChanges : undefined}
          assumedRoles={assumedRoles}
          changes={changesControl}
          people={people}
          others={othersRow}
          exactness={exactness}
          onSetExact={pack.setExact}
          styleOptions={styleOptions}
          styleChips={styleChips}
          styleNote={styleNote}
          rowDefaults={rowDefaultsProps}
          offers={offers}
          suggestions={suggestions.suggestions}
          suggestionStatus={suggestions.status}
          onQueryChange={suggestions.onQueryChange}
        />
      )}

      {/* One live region for the fit line and the run: the lines themselves stay quiet. */}
      <p className="sr-only" role="status" aria-live="polite">
        {isGenerating ? BUILDER_TEXT.generatingSpoken : fitStates.map((st) => sentence(fitText(st).spoken)).join(" ")}
      </p>
      <div className="space-y-1">
        {fitStates.map((state, i) => (
          <FitLine
            // Several notes of one kind (one per tag) need their own key.
            key={`${state.kind}:${"tag" in state ? state.tag : i}`}
            announce={false}
            state={state}
            onIncludeSensitive={includeSensitive}
            hint={i === 0 && showBrief && thumbs.length > 0 && !result ? (axis ? SHEET_TEXT.hint(axis) : BUILDER_TEXT.sheetHint) : undefined}
            loaded={i === fitStates.length - 1 && !isGenerating ? loaded ?? undefined : undefined}
            searches={i === fitStates.length - 1 && searchesToggle ? searchesToggle : undefined}
          />
        ))}
      </div>
      {searchesToggle?.open && (
        <SearchDetails
          id={searchesId}
          className="mt-1"
          plan={plan}
          progress={source?.searches ?? NO_PROGRESS}
          character={firstName}
          site={PROVIDER_LABELS[provider]}
          limit={getProviderTagLimit(provider)}
        />
      )}
      {showExamples && (
        <PackEmptyState heading={EXAMPLES_HEADING} examples={examples} onPick={pickExample} />
      )}
      {sheetTip && <PackTip text={TIP_TEXT.sheet} onDismiss={() => closeTip("sheet")} />}
      {axisTip && axis && <PackTip text={TIP_TEXT.axis(axis)} onDismiss={() => closeTip("axis")} />}
      {showBrief && !(loadError && thumbs.length === 0) && (
        <ContactSheet
          scenes={thumbs}
          leftOut={leftOutList}
          emptyTitle={rolesMissing ? BLOCKED.roles : undefined}
          emptyHint={rolesMissing ? "" : undefined}
          onToggle={onToggleScene}
          fixed={fixed}
          status={sheetStatus}
          expected={count}
        />
      )}


      {resultsTip && <PackTip text={TIP_TEXT.results} onDismiss={() => closeTip("results")} />}
      {result && result.prompts.length > 0 && (
        <Results
          containerRef={resultsRef}
          prompts={result.prompts}
          locked={result.locked}
          missing={result.shortBy}
          copyNote={copyNoteText({ missing: result.shortBy, stale })}
          onToggleLock={onToggleLock}
          busy={engine.busy || engine.sourceChanged || engine.poolPending}
          busyReason={engine.sourceChanged ? BUILDER_TEXT.busySource : engine.poolPending ? BUILDER_TEXT.busyReloading : BUILDER_TEXT.busyRunning}
          naturalSourceOf={engine.naturalSourceOf}
          overrides={overrides}
          format={promptFormat}
          fullDetail={fullDetail}
          onFormatChange={setFormat}
          onCopy={copy}
          onReroll={onReroll}
          onAlways={onAlways}
          onNever={onNever}
        />
      )}

      {/* Generate stays at the bottom edge of the panel, above the home indicator, whatever is scrolled. */}
      <div className="sticky bottom-0 z-10 -mx-3 border-t border-border/60 bg-background px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {/* Notices with Undo sit with Generate: always in view, whatever the brief or the list shows. */}
        <div className="mb-2 empty:hidden">
          {correction?.status === "done" && correction.message ? (
            <UndoNotice message={correction.message} onUndo={undoCorrection} onDismiss={() => setCorrection(null)} />
          ) : correcting ? (
            <p role="status" className="text-sm text-muted-foreground">{CORRECTION_TEXT.working}</p>
          ) : showUndo && pack.lastChange ? (
            <UndoNotice message={pack.lastChange} onUndo={onUndo} onDismiss={() => setUndoFor(null)} />
          ) : defaultsUndo ? (
            <UndoNotice message={defaultsUndo.message} onUndo={onUndoDefaults} onDismiss={() => setDefaultsUndo(null)} />
          ) : providerUndo ? (
            <UndoNotice message={BUILDER_TEXT.providerChanged(PROVIDER_LABELS[providerUndo.to])} onUndo={onUndoProvider} onDismiss={() => setProviderUndo(null)} />
          ) : null}
        </div>
        <GenerateBar
          count={count}
          onCountChange={pack.setPromptCount}
          onGenerate={onGenerate}
          generating={isGenerating}
          blockedReason={blockedReason}
          locked={result?.locked.length ?? 0}
        />
      </div>

      {searching && (
        <BriefSource plan={plan} onResult={setSource} />
      )}
    </div>
  )
}

function startNoteText(note: StartNote, poolPending: boolean): string | null {
  switch (note.kind) {
    case "restored":
      return note.dropped ? START_TEXT.restoredDropped : poolPending ? START_TEXT.restoredLoading : START_TEXT.restored
    case "characters":
      return null
    case "card": {
      const who = note.named ? START_TEXT.cardNamed : START_TEXT.cardUnnamed
      return note.outfit.length + note.pose.length > 0 ? `${who} ${START_TEXT.cardOffers}` : who
    }
    case "prompt":
      return START_TEXT.prompt
    case "search":
      return note.skipped.length > 0 ? `${START_TEXT.search} ${START_TEXT.searchSkipped(note.skipped)}` : START_TEXT.search
  }
}

// ── Results ──────────────────────────────────────────────────────────────────────

/**
 * Copies a pack's text without the gallery: no card is marked copied and no gallery state changes.
 * The rows and the toolbar say it was copied; a failure says so here.
 */
async function copyPackText(text: string, format: PromptFormat, provider: BooruProvider): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    toastError({
      title: "Error",
      description: "Could not copy prompt",
      errorSource: "copy_to_clipboard",
      context: { provider, postId: 0, isPrompt: true },
    })
    return false
  }
  track("prompt_copied", {
    copy_type: "ai_text",
    booru_source: provider,
    has_translated_tags: text.includes("Masterpiece"),
    prompt_format: format,
  })
  recordPromptCopy()
  return true
}

const warnTagsCopied = () => toast({ description: BUILDER_TEXT.convertFailed, variant: "destructive", duration: 3000 })

function Results({
  containerRef,
  prompts,
  busy,
  busyReason,
  locked,
  missing,
  copyNote,
  onToggleLock,
  naturalSourceOf,
  overrides,
  format,
  fullDetail,
  onFormatChange: setFormat,
  onCopy,
  onReroll,
  onAlways,
  onNever,
}: {
  /** Where focus goes after a pack is made. */
  containerRef?: RefObject<HTMLDivElement | null>
  prompts: PackPrompt[]
  /** A run is going on, or the pack is from another source: re-roll and the tag menu wait. */
  busy: boolean
  /** Said on those controls while they wait. */
  busyReason: string
  locked: readonly number[]
  /** Prompts asked for and not made. */
  missing: number
  copyNote?: string
  onToggleLock: (index: number) => void
  naturalSourceOf: (prompt: PackPrompt) => NaturalPromptSource
  overrides: Record<string, string>
  /** The pack's own format (never the gallery's) and its "every detail" length, read from the app. */
  format: PromptFormat
  fullDetail: boolean
  onFormatChange: (format: PromptFormat) => void
  onCopy: (text: string, format: PromptFormat) => Promise<boolean>
  onReroll: (index: number) => boolean
  onAlways: (tag: string) => void
  onNever: (tag: string) => void
}) {
  const lockedSet = useMemo(() => new Set(locked), [locked])
  // Text on screen per row, so a copy matches what is shown.
  const shownRef = useRef(new Map<number, string>())

  const bodyOf = useCallback(async (p: PackPrompt, shown?: string): Promise<{ text: string; failed: boolean }> => {
    if (format === "tags") return { text: p.prompt, failed: false }
    if (shown) return { text: shown, failed: false }
    try {
      return { text: (await convertPromptOnce(format, naturalSourceOf(p), overrides, fullDetail)).text, failed: false }
    } catch {
      return { text: p.prompt, failed: true }
    }
  }, [format, fullDetail, naturalSourceOf, overrides])

  // "Add size as [WIDTHxHEIGHT]": the old builder's preference (pack-add-resolution), kept.
  const [withSize, setWithSize] = useState(() => {
    try {
      return userPreferences.getPackAddResolution()
    } catch {
      return false
    }
  })
  const changeWithSize = useCallback((next: boolean) => {
    setWithSize(next)
    try {
      userPreferences.setPackAddResolution(next)
    } catch {
      // Storage unavailable: the choice lasts this session.
    }
  }, [])
  const sizeOption = useMemo(() => ({ value: withSize, onChange: changeWithSize }), [withSize, changeWithSize])

  // One live region for every row's copy.
  const [copySaid, setCopySaid] = useState("")
  const copyOne = useCallback(async (index: number) => {
    const p = prompts[index]
    if (!p) return false
    const body = await bodyOf(p, shownRef.current.get(index))
    if (body.failed) warnTagsCopied()
    const { text, unsized } = packCopyText([p], [body.text], withSize)
    const ok = await onCopy(text, body.failed ? "tags" : format)
    setCopySaid(ok ? `Prompt ${index + 1} copied${withSize && unsized === 0 ? " with its size" : ""}` : COPY_FAILED)
    return ok
  }, [prompts, bodyOf, onCopy, format, withSize])

  // Stable for the rows: it follows the slots, which grow with every page of posts.
  const copyRow = useStableCallback(copyOne)

  // The slots the rows convert with: those of the moment the prompts were made, renewed only when
  // the prompts change or a slot of one of their tags does. Slots looked up for the pages that
  // keep arriving are about other posts, and every row would be converted again for them.
  const promptTags = useMemo(() => {
    const out = new Set<string>()
    for (const p of prompts) for (const raw of p.prompt.split(",")) {
      const tag = bareToken(raw).toLowerCase()
      if (tag) out.add(tag).add(tag.replace(/ /g, "_"))
    }
    return out
  }, [prompts])
  const [rowSlots, setRowSlots] = useState({ prompts, overrides })
  if (rowSlots.overrides !== overrides && (rowSlots.prompts !== prompts || Array.from(promptTags).some((t) => rowSlots.overrides[t] !== overrides[t]))) {
    setRowSlots({ prompts, overrides })
  }
  const rowOverrides = rowSlots.overrides

  const [unsizedCopied, setUnsizedCopied] = useState(0)
  const copyAll = useCallback(async () => {
    const bodies = await Promise.all(prompts.map((p, i) => bodyOf(p, shownRef.current.get(i))))
    const failed = bodies.some((b) => b.failed)
    if (failed) warnTagsCopied()
    const { text, unsized } = packCopyText(prompts, bodies.map((b) => b.text), withSize)
    setUnsizedCopied(unsized)
    return onCopy(text, failed ? "tags" : format)
  }, [prompts, bodyOf, onCopy, format, withSize])
  const allCopyNote = [copyNote, unsizedCopied > 0 ? SIZE_TEXT.unsized(unsizedCopied) : null].filter(Boolean).join(" ") || undefined

  const reroll = useStableCallback((index: number) => {
    if (!onReroll(index)) toast({ description: BUILDER_TEXT.rerollFailed, duration: 3000 })
  })

  const onFormatChange = useCallback((next: PromptFormat) => {
    if (next !== "tags") preloadNaturalPrompt()
    setFormat(next)
  }, [setFormat])

  return (
    <div ref={containerRef} tabIndex={-1} aria-label={BUILDER_TEXT.resultsLabel} className="space-y-2 focus-visible:outline-none">
      <p className="sr-only" role="status" aria-live="polite">{copySaid}</p>
      <ResultsToolbar
        formats={FORMATS}
        format={format}
        onFormatChange={onFormatChange}
        count={prompts.length}
        onCopyAll={copyAll}
        copyNote={allCopyNote}
        withSize={sizeOption}
      >
        {missing > 0 && <span className="text-xs tabular-nums text-warning-text">{missingText(missing)}</span>}
      </ResultsToolbar>
      <div className="space-y-1.5">
        {prompts.map((p, i) => (
          <BriefResultRow
            // By position: a row whose prompt changes is the same row (focus stays in it).
            key={`row-${i}`}
            index={i}
            prompt={p}
            format={format}
            fullDetail={fullDetail}
            naturalSourceOf={naturalSourceOf}
            overrides={rowOverrides}
            shownRef={shownRef}
            locked={lockedSet.has(i)}
            busy={busy}
            busyReason={busyReason}
            onToggleLock={onToggleLock}
            onCopy={copyRow}
            onReroll={reroll}
            onAlways={onAlways}
            onNever={onNever}
          />
        ))}
      </div>
    </div>
  )
}

/** A result row in the chosen format: tags, or the prompt converted the way a gallery card is. */
const BriefResultRow = memo(function BriefResultRow({
  index,
  prompt,
  format,
  fullDetail,
  naturalSourceOf,
  overrides,
  shownRef,
  locked,
  busy,
  busyReason,
  onToggleLock,
  onCopy,
  onReroll,
  onAlways,
  onNever,
}: {
  locked: boolean
  busy: boolean
  busyReason: string
  onToggleLock: (index: number) => void
  index: number
  prompt: PackPrompt
  format: PromptFormat
  fullDetail: boolean
  naturalSourceOf: (prompt: PackPrompt) => NaturalPromptSource
  overrides: Record<string, string>
  shownRef: RefObject<Map<number, string>>
  onCopy: (index: number) => Promise<boolean>
  onReroll: (index: number) => void
  onAlways: (tag: string) => void
  onNever: (tag: string) => void
}) {
  const source = useMemo(() => naturalSourceOf(prompt), [naturalSourceOf, prompt])
  const natural = useNaturalPrompt({ enabled: true, format, fullDetail, source, overrides })
  const text = natural.prompt?.text
  useEffect(() => {
    const shown = shownRef.current
    if (text) shown.set(index, text)
    else shown.delete(index)
  }, [shownRef, index, text])
  const tokens = useMemo(() => promptTokens(prompt), [prompt])
  return (
    <ResultRow
      index={index}
      tokens={tokens}
      text={text}
      postId={prompt.scene?.postId}
      thumbSrc={prompt.scene?.preview ? getPostThumbnailUrl(prompt.scene.preview) : undefined}
      size={promptSize(prompt)}
      pending={format !== "tags" && natural.status === "loading"}
      locked={locked}
      busy={busy}
      busyReason={busyReason}
      announce={false}
      onToggleLock={onToggleLock}
      onCopy={onCopy}
      onReroll={onReroll}
      onAlways={onAlways}
      onNever={onNever}
    />
  )
})
