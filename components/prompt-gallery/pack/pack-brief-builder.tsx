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
import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react"
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
import { useNaturalPrompt, usePromptFormat } from "@/hooks/use-natural-prompt"
import type { PackRatingMode } from "@/hooks/use-pack-seed-search"
import type { BooruPost, BooruProvider } from "@/lib/booru/types"
import { addNever, addTag, briefFromPrompt, routeTag, type RequestRole } from "@/lib/pack/brief"
import type { CastRole } from "@/lib/pack/scene/cast"
import { normalizeTagForPack } from "@/lib/pack/pack-generator"
import { splitTags } from "@/lib/utils/tag-utils"
import {
  axisRequests,
  briefFromSearch,
  castPeopleNote,
  changedRows,
  oneAxis,
  issuesFit,
  lockedWithTag,
  peopleFromCountTags,
  pickedPeopleNote,
  predictFit,
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
import { BriefSummary } from "./brief-summary"
import type { Choice } from "./choice-group"
import { ContactSheet, type ContactSheetStatus, type SceneThumb } from "./contact-sheet"
import { FitLine } from "./fit-line"
import { GenerateBar, ResultsToolbar } from "./generate-bar"
import { PackBriefPanel } from "./pack-brief-panel"
import { BLOCKED, BUILDER_TEXT, CORRECTION_TEXT, SHEET_TEXT, copyNoteText, RATING_OPTIONS, START_TEXT, missingText, type FitState, type OutfitSource } from "./pack-text"
import type { BriefPackResult } from "@/hooks/use-pack-brief-scenes"
import type { BriefOffer } from "./pack-brief-panel"
import { ResultRow } from "./result-row"
import { briefSummaryParts, companionsLabel, showTag, type CharacterInfo, type SlotId } from "./slots"
import { UndoNotice } from "./undo-notice"

/** Where a pack starts from: each way into Pack Mode. */
export type PackBriefStart =
  | { kind: "characters"; names: readonly string[] }
  | { kind: "card"; post: BooruPost }
  | { kind: "prompt"; text: string }
  | { kind: "search"; search: string; character: string | null }

/** A correction from the results: what it was, and the pack as it was before, for Undo. */
interface Correction {
  kind: "always" | "never"
  tag: string
  snapshot: BriefPackResult
  format: PromptFormat
  briefBefore: unknown
  done: boolean
  message: string | null
}

/** What a start brought to the brief, for the note under the header. */
type StartNote =
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
  /** Tag slots in use, growing as tags are looked up. */
  overrides: Record<string, string>
  /** Looks up the slots of tags the overrides don't cover yet. */
  enrichTagSlots: (tags: string[]) => Promise<boolean>
  provider: BooruProvider
  /** The pack rating preference, shared with the old builder. */
  rating: PackRatingMode
  onRatingChange: (rating: PackRatingMode) => void
  /** The gallery's search, for a brief without a named character. */
  gallerySearch: string
  cleanOptions: Pick<
    BulkSendCleanOptions,
    "excludeInput" | "addInput" | "findInput" | "replaceInput" | "includeCharacters" | "optimizeTags" | "smartTagExclusion" | "experimentalPromptRules"
  >
  globalWeights: Record<string, number>
  isGlobalWeightsEnabled: boolean
  outfitOptions: { styles: readonly OutfitStyle[]; detail: OutfitDetail }
  /** Copies text in a format; resolves true when it worked. */
  onCopy: (text: string, format: PromptFormat) => Promise<boolean>
  onExit: () => void
}

/** The brief a start makes, and what to say about it. */
function begin(pack: UsePackBriefResult, start: PackBriefStart, overrides: Record<string, string>): StartNote {
  switch (start.kind) {
    case "characters":
      pack.startFromCharacters([...start.names])
      return { kind: "characters" }
    case "card": {
      const tags = splitTags(`${start.post.tag_string ?? ""} ${start.post.tag_string_character ?? ""}`)
      const { offered } = pack.startFromCard(tags)
      const named = splitTags(start.post.tag_string_character ?? "").length > 0
      return { kind: "card", named, outfit: offered.outfit, pose: offered.pose }
    }
    case "prompt": {
      const { brief, peopleTags } = briefFromPrompt(start.text, overrides)
      pack.startWith(withPromptPeople(brief, peopleTags))
      return { kind: "prompt" }
    }
    case "search": {
      const { brief, skipped } = briefFromSearch(start.search, overrides, start.character)
      pack.startWith(brief)
      return { kind: "search", skipped }
    }
  }
}

/** Shell: the panel and its header. The work starts once the brief holds the start. */
export function PackBriefBuilder(props: PackBriefBuilderProps) {
  const { start, open, overrides, rating, onRatingChange, onExit, onNewPack } = props
  const pack = usePackBrief(overrides)
  // The pack starts once, before anything is fetched.
  const [note, setNote] = useState<StartNote | null>(null)
  if (!note) setNote(begin(pack, start, overrides))

  return (
    <TooltipProvider delayDuration={300}>
      <section
        aria-label={BUILDER_TEXT.title}
        aria-hidden={!open || undefined}
        className={cn(
          // Hidden, not unmounted: the pack waits here until Pack Mode comes back.
          !open && "hidden",
          "fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[85dvh] w-full max-w-3xl flex-col overflow-hidden",
          "rounded-t-2xl border border-border bg-background shadow-2xl sm:bottom-4 sm:w-[calc(100%-2rem)] sm:rounded-2xl",
          "animate-in fade-in-0 slide-in-from-bottom-4 duration-200 ease-out-strong motion-reduce:animate-none",
        )}
      >
        <header className="flex flex-shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
          <Package className="size-5 shrink-0 text-mode-pack-text" aria-hidden />
          <h2 className="text-base font-semibold leading-tight text-foreground">{BUILDER_TEXT.title}</h2>
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
            <RatingMenu value={rating} onChange={onRatingChange} />
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
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3 pt-2">
          {note && <BriefWorkspace {...props} pack={pack} startNote={note} />}
        </div>
      </section>
    </TooltipProvider>
  )
}

const RatingMenu = memo(function RatingMenu({ value, onChange }: { value: PackRatingMode; onChange: (rating: PackRatingMode) => void }) {
  const label = RATING_OPTIONS.find((o) => o.value === value)?.label ?? RATING_OPTIONS[0].label
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={`${BUILDER_TEXT.ratingMenu}: ${label}`}
        className={cn(
          "inline-flex h-8 max-w-[12rem] items-center gap-1 rounded-md border border-border bg-background px-2 text-xs pointer-coarse:h-11",
          "transition-[border-color,background-color] duration-150 ease-out-strong hover:border-foreground/30 data-[state=open]:border-foreground/30",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <span className="truncate font-medium text-foreground">{label}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">{BUILDER_TEXT.ratingMenu}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as PackRatingMode)}>
          {RATING_OPTIONS.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>
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
  onLimited,
}: {
  plan: SourcePlan
  onResult: (result: UsePackSourcesResult | null) => void
  onLimited: () => void
}) {
  const result = usePackSources({ plan, onSessionCapReached: onLimited, onScrollLimited: onLimited })
  useEffect(() => onResult(result), [result, onResult])
  useEffect(() => () => onResult(null), [onResult])
  return null
}

// ── The workspace ────────────────────────────────────────────────────────────────

const FORMATS: Choice<PromptFormat>[] = PROMPT_FORMATS.map((f) => ({ value: f, label: PROMPT_FORMAT_INFO[f].label }))
const NO_POSTS: never[] = []
const NO_IDS: string[] = []
const UNDO_MS = 6000

/** A tag of a prompt as the brief spells it: no weight, no brackets. */
const bareToken = (token: string) => token.replace(/^\(+/, "").replace(/(:[\d.]+)?\)+$/, "").trim()

/** The slot of the brief a typed tag lands in; null for a people count (it sets People). */
function landsIn(tag: string, typedIn: SlotId, overrides: Record<string, string>): SlotId | null {
  const route = routeTag(tag, overrides)
  if (route.kind === "people") return null
  if (typedIn === "never") return "never"
  if (route.kind === "character" || route.kind === "look") return "who"
  if (route.kind === "request") return route.role
  return typedIn === "who" ? "also" : typedIn
}

function BriefWorkspace({
  pack,
  overrides,
  enrichTagSlots,
  provider,
  rating,
  gallerySearch,
  cleanOptions,
  globalWeights,
  isGlobalWeightsEnabled,
  outfitOptions,
  onCopy,
  open,
  startNote,
}: PackBriefBuilderProps & { pack: UsePackBriefResult; startNote: StartNote }) {
  const { brief, preferences } = pack
  const count = preferences.promptCount
  const [outfit, setOutfit] = useState<BriefOutfit>({ kind: "scene" })

  // ── Source ──────────────────────────────────────────────────────────────────────
  const [source, setSource] = useState<UsePackSourcesResult | null>(null)
  const [limitedKey, setLimitedKey] = useState<string | null>(null)
  const planKeyRef = useRef("")
  const onLimited = useCallback(() => setLimitedKey(planKeyRef.current), [])

  const posts = source?.allPosts ?? NO_POSTS
  const [ownKey, setOwnKey] = useState("")
  const originOf = source?.originOf
  const preferredPosts = useMemo(
    () => (originOf && ownKey ? preferredPostIds(originOf, new Set(ownKey.split("||"))) : []),
    [originOf, ownKey]
  )

  const engine = usePackBriefScenes({
    brief,
    posts,
    preferredPosts,
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
  })
  const { plan, identity, candidates, candidatesPending, result, isGenerating } = engine
  // The searches of the character's own posts: their posts' scenes go first. Read
  // from the plan of the previous render (the plan needs the posts to settle).
  const planOwnKey = plan.scenes.filter((s) => s.kind === "own").map((s) => s.id).join("||")
  if (planOwnKey !== ownKey) setOwnKey(planOwnKey)
  useEffect(() => { planKeyRef.current = plan.sceneKey }, [plan.sceneKey])
  const searching = plan.scenes.some((s) => s.tags.length > 0)
  const limited = limitedKey === plan.sceneKey

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
  const canLoad = !!source && !source.noMoreResults && !source.failed && !source.sessionCapReached && !source.scrollLimited && !limited
  const needMore = !!usable && !candidatesPending && have < count
  // Short of scenes: fetch more pages, one at a time, until there are enough, the source
  // runs out or the pace limit stops it (then the fit line says what there is).
  useEffect(() => {
    if (open && needMore && canLoad && source && !source.isLoadingMore) source.loadMore()
  }, [open, needMore, canLoad, source])
  const loadingPosts = !!source?.isLoadingMore || (searching && !source)
  // One state for any failed load (the pack data or a page of posts): one line, one retry.
  const loadError = engine.loadFailed || !!source?.failed
  const finding = !loadError && (loadingPosts || (needMore && canLoad) || (!candidates && searching && !noPosts))
  const canOfferSensitive = rating === "sfw" && plan.sensitive === "excluded" && !finding
  // The pace limit stopped the fetching and the source has more: one click asks for one page.
  const paused = !!source && (limited || source.scrollLimited) && !source.isLoadingMore &&
    !source.noMoreResults && !source.failed && !source.sessionCapReached
  // A page asked for by hand: searching while it is on its way, then whether it brought
  // new scenes. `seen` once the request is in flight; `before` the scenes there were.
  const [manual, setManual] = useState<{ before: number; seen: boolean; nothingNew: boolean } | null>(null)
  const sourceLoading = !!source?.isLoadingMore
  const usableCount = usable?.length ?? 0
  if (manual && !manual.nothingNew) {
    if (sourceLoading && !manual.seen) setManual({ ...manual, seen: true })
    // The pace limit refused the page: nothing is on its way, the offer comes back.
    else if (!manual.seen && (source?.scrollLimited || source?.failed)) setManual(null)
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
    if (!source) return
    setManual({ before: usableCount, seen: false, nothingNew: false })
    source.loadMore()
  }, [source, usableCount])
  const axisNote = useMemo(() => (axis ? { axis, requested: axisRequests(brief, axis) } : null), [axis, brief])
  const peopleNote = pickedPeopleNote({ picked: brief.people, available: engine.available, using: engine.people, cast: identity.cast })

  // A correction from the results remakes the prompts itself: no "generate again" for it.
  const [correction, setCorrection] = useState<Correction | null>(null)
  const correcting = !!correction && !correction.done
  const stale = !!result && !correcting && (result.brief !== brief || result.count !== count || result.outfit !== outfit)
  const notes: FitNote[] = useMemo(() => {
    const castNote = castPeopleNote(brief.people, identity.cast)
    const lead = [peopleNote, castNote].filter((n): n is FitNote => !!n)
    const progress = {
      loading: (sourceLoading || (!!manual && !manual.nothingNew)) && !loadError,
      found: have,
      nothingNew: manual?.nothingNew ? { exhausted: !!source?.noMoreResults } : null,
    }
    if (loadError) return []
    if (!result) return withSearchProgress([...lead, ...predictFit({ candidates: usable, count, poses, finding, canOfferSensitive, paused, axis: axisNote })], progress)
    const after = issuesFit({
      issues: result.issues,
      count: result.count,
      made: result.prompts.length,
      cast: identity.cast,
      scenes: usable ? have : null,
      canOfferSensitive,
      paused,
    })
    return withSearchProgress(stale ? [{ kind: "stale" }, ...lead, ...after] : [...lead, ...after], progress)
  }, [result, usable, count, poses, finding, canOfferSensitive, paused, axisNote, peopleNote, brief.people, identity.cast, have, stale, sourceLoading, manual, loadError, source?.noMoreResults])
  const { setIncludeSensitive } = pack
  const includeSensitive = useCallback(() => setIncludeSensitive(true), [setIncludeSensitive])
  const fitStates = useMemo<FitState[]>(
    () => notes.map((n): FitState =>
      n.kind === "few-rated"
        ? { kind: "few-rated", onInclude: includeSensitive }
        : n.kind === "paused"
          ? { kind: "paused", onLoadMore: loadOnePage, waiting: !!source?.scrollLimited }
          : n),
    [notes, includeSensitive, loadOnePage, source?.scrollLimited]
  )

  // ── Folding ─────────────────────────────────────────────────────────────────────
  const [folded, setFolded] = useState(false)
  const [openedFromSummary, setOpenedFromSummary] = useState(false)
  // A pack just made folds the brief away, so the prompts come first.
  const [wasGenerating, setWasGenerating] = useState(false)
  if (wasGenerating !== isGenerating) {
    setWasGenerating(isGenerating)
    if (!isGenerating && result) {
      setFolded(true)
      setOpenedFromSummary(false)
    }
  }
  const expand = useCallback(() => {
    setFolded(false)
    setOpenedFromSummary(true)
  }, [])

  // ── Brief edits ─────────────────────────────────────────────────────────────────
  const [routed, setRouted] = useState<{ slot: SlotId | "people"; key: number } | null>(null)
  const suggestions = useTagSuggestions()
  const { add, never, remove, unnever, removeCharacter, setRole, removeLook, restoreLook, leaveOutScene, restoreScene, setPeople, undo } = pack
  const { leaveOutVariant, restoreVariant, setBaseScene } = pack
  const cast = identity.cast
  const onAddTags = useCallback((tags: string[], slot: SlotId) => {
    let elsewhere: SlotId | "people" | null = null
    const counts: string[] = []
    for (const tag of tags) {
      const dest = landsIn(tag, slot, overrides)
      // A typed count ("2girls", "1boy", "solo") sets who is in the picture.
      if (dest === null) {
        counts.push(tag)
        continue
      }
      if (slot === "never") never(tag)
      else add(tag, slot === "who" ? undefined : (slot as RequestRole))
      if (dest !== slot) elsewhere = dest
    }
    const people = peopleFromCountTags(counts, cast)
    if (people) {
      setPeople(people)
      elsewhere = "people"
    }
    if (elsewhere) setRouted({ slot: elsewhere, key: Date.now() })
  }, [add, never, setPeople, overrides, cast])
  // Undo: the last change of the brief, for a few seconds.
  const [undoFor, setUndoFor] = useState<object | null>(null)
  const [seenBrief, setSeenBrief] = useState(brief)
  // A brief that came back through Undo opens no notice: the one before would name an older change.
  const [undoing, setUndoing] = useState(false)
  if (seenBrief !== brief) {
    setSeenBrief(brief)
    // A correction has its own notice.
    setUndoFor(pack.canUndo && !undoing && !correction ? brief : null)
    if (undoing) setUndoing(false)
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
  const { format: promptFormat, setFormat } = usePromptFormat()
  const correct = useCallback((kind: "always" | "never", raw: string) => {
    const tag = bareToken(raw)
    const next = kind === "never" ? addNever(brief, tag) : addTag(brief, tag, overrides, "also")
    if (JSON.stringify(next) === JSON.stringify(brief)) return
    if (result) setCorrection({ kind, tag, snapshot: result, format: promptFormat, briefBefore: brief, done: false, message: null })
    if (kind === "never") never(tag)
    else add(tag, "also")
  }, [brief, overrides, result, promptFormat, never, add])
  const onAlways = useCallback((tag: string) => correct("always", tag), [correct])
  const onNever = useCallback((tag: string) => correct("never", tag), [correct])
  // Runs once the brief has the change (the engine's arguments follow it).
  const { recompose, restore } = engine
  const runningRef = useRef<Correction | null>(null)
  useEffect(() => {
    if (!correction || correction.done || brief === correction.briefBefore || runningRef.current === correction) return
    runningRef.current = correction
    void recompose().then((out) => {
      if (!out) return
      const changed = changedRows(out.before.prompts, out.after.prompts)
      const locked = correction.kind === "never" ? lockedWithTag(out.after.prompts, out.after.locked, correction.tag) : 0
      const base = CORRECTION_TEXT[correction.kind](correction.tag, changed)
      const message = locked > 0 ? `${base}. ${CORRECTION_TEXT.lockedKeep(locked)}` : base
      setCorrection((cur) => (cur === correction ? { ...cur, done: true, message } : cur))
    })
  }, [correction, brief, recompose])
  const undoCorrection = useCallback(() => {
    if (!correction) return
    if (undo() !== null) setUndoing(true)
    restore(correction.snapshot)
    setFormat(correction.format)
    setCorrection(null)
  }, [correction, undo, restore, setFormat])
  // A correction notice goes after a while, like the brief's.
  useEffect(() => {
    if (!correction?.done) return
    const timer = setTimeout(() => setCorrection((cur) => (cur === correction ? null : cur)), UNDO_MS)
    return () => clearTimeout(timer)
  }, [correction])
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
  const fixed = useMemo(() => (fixedId
    ? {
        id: fixedId,
        picking: pickingFixed,
        onStartPick: () => setPickingFixed(true),
        onCancelPick: () => setPickingFixed(false),
        onPick: (id: string) => {
          setPickingFixed(false)
          setBaseScene(Number(id))
        },
      }
    : undefined), [fixedId, pickingFixed, setBaseScene])


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
  const startText = pack.canUndo ? null : startNoteText(startNote)

  // ── What the brief shows of each character ──────────────────────────────────────
  const characterInfo = useMemo(() => {
    const out: Record<string, CharacterInfo> = {}
    for (const c of brief.who) if (c.tag) out[c.tag] = { usualLook: engine.looks[c.tag]?.look ?? [] }
    return out
  }, [brief.who, engine.looks])
  // With several characters, the role the pack assumes for each one (the user corrects it in Who).
  const assumedRoles = useMemo(() => {
    const out: Record<string, CastRole | null> = {}
    brief.who.forEach((c, i) => { if (c.tag) out[c.tag] = identity.members[i]?.role ?? null })
    return out
  }, [brief.who, identity.members])
  const { setChanges } = pack
  const changesControl = useMemo(() => ({ value: brief.changes, onChange: setChanges }), [brief.changes, setChanges])
  const people = engine.peopleLine
    ? { options: engine.peopleLine.options, value: engine.peopleLine.value, onChange: setPeople, cast: identity.cast, poseNeeds: engine.peopleLine.poseNeeds }
    : null
  const summary = useMemo(() => {
    const label = brief.people ? companionsLabel(brief.people, identity.cast) : null
    return briefSummaryParts(brief, label, characterInfo)
  }, [brief, identity.cast, characterInfo])

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

      {startText && !folded && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground text-pretty">
          <Info className="mt-px size-3.5 shrink-0 text-info-text" aria-hidden />
          {startText}
        </p>
      )}
      {folded ? (
        <BriefSummary parts={summary} onExpand={expand} />
      ) : (
        <PackBriefPanel
          brief={brief}
          characterInfo={characterInfo}
          autoFocus={openedFromSummary}
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
          offers={offers}
          suggestions={suggestions.suggestions}
          suggestionStatus={suggestions.status}
          onQueryChange={suggestions.onQueryChange}
        />
      )}

      <div className="space-y-1">
        {fitStates.map((state, i) => (
          <FitLine key={`${state.kind}-${i}`} state={state} hint={i === 0 && !folded && thumbs.length > 0 && !result ? (axis ? SHEET_TEXT.hint(axis) : BUILDER_TEXT.sheetHint) : undefined} />
        ))}
      </div>
      {!folded && !(loadError && thumbs.length === 0) && (
        <ContactSheet
          scenes={thumbs}
          leftOut={leftOutList}
          onToggle={onToggleScene}
          fixed={fixed}
          status={sheetStatus}
          expected={count}
        />
      )}

      <GenerateBar
        count={count}
        onCountChange={pack.setPromptCount}
        onGenerate={engine.generate}
        generating={isGenerating}
        blockedReason={blockedReason}
        locked={result?.locked.length ?? 0}
      />

      {correction ? (
        <UndoNotice
          message={correction.message ?? CORRECTION_TEXT.working}
          onUndo={undoCorrection}
          onDismiss={() => setCorrection(null)}
        />
      ) : showUndo && pack.lastChange && (
        <UndoNotice message={pack.lastChange} onUndo={onUndo} onDismiss={() => setUndoFor(null)} />
      )}

      {result && result.prompts.length > 0 && (
        <Results
          prompts={result.prompts}
          locked={result.locked}
          missing={result.shortBy}
          copyNote={copyNoteText({ missing: result.shortBy, stale })}
          onToggleLock={engine.toggleLock}
          naturalSourceOf={engine.naturalSourceOf}
          overrides={overrides}
          onCopy={onCopy}
          onReroll={engine.reroll}
          onAlways={onAlways}
          onNever={onNever}
        />
      )}

      {searching && (
        <BriefSource plan={plan} onResult={setSource} onLimited={onLimited} />
      )}
    </div>
  )
}

function startNoteText(note: StartNote): string | null {
  switch (note.kind) {
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

const warnTagsCopied = () => toast({ description: BUILDER_TEXT.convertFailed, variant: "destructive", duration: 3000 })

function Results({
  prompts,
  locked,
  missing,
  copyNote,
  onToggleLock,
  naturalSourceOf,
  overrides,
  onCopy,
  onReroll,
  onAlways,
  onNever,
}: {
  prompts: PackPrompt[]
  locked: readonly number[]
  /** Prompts asked for and not made. */
  missing: number
  copyNote?: string
  onToggleLock: (index: number) => void
  naturalSourceOf: (prompt: PackPrompt) => NaturalPromptSource
  overrides: Record<string, string>
  onCopy: (text: string, format: PromptFormat) => Promise<boolean>
  onReroll: (index: number) => boolean
  onAlways: (tag: string) => void
  onNever: (tag: string) => void
}) {
  const { format, fullDetail, setFormat } = usePromptFormat()
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

  const copyOne = useCallback(async (index: number) => {
    const p = prompts[index]
    if (!p) return false
    const body = await bodyOf(p, shownRef.current.get(index))
    if (body.failed) warnTagsCopied()
    return onCopy(body.text, body.failed ? "tags" : format)
  }, [prompts, bodyOf, onCopy, format])

  const copyAll = useCallback(async () => {
    const bodies = await Promise.all(prompts.map((p, i) => bodyOf(p, shownRef.current.get(i))))
    const failed = bodies.some((b) => b.failed)
    if (failed) warnTagsCopied()
    return onCopy(bodies.map((b) => b.text).join("\n"), failed ? "tags" : format)
  }, [prompts, bodyOf, onCopy, format])

  const reroll = useCallback((index: number) => {
    if (!onReroll(index)) toast({ description: BUILDER_TEXT.rerollFailed, duration: 3000 })
  }, [onReroll])

  const onFormatChange = useCallback((next: PromptFormat) => {
    if (next !== "tags") preloadNaturalPrompt()
    setFormat(next)
  }, [setFormat])

  return (
    <div className="space-y-2">
      <ResultsToolbar formats={FORMATS} format={format} onFormatChange={onFormatChange} count={prompts.length} onCopyAll={copyAll} copyNote={copyNote}>
        {missing > 0 && <span className="text-xs tabular-nums text-warning-text">{missingText(missing)}</span>}
      </ResultsToolbar>
      <div className="space-y-1.5">
        {prompts.map((p, i) => (
          <BriefResultRow
            key={`${i}-${p.prompt}`}
            index={i}
            prompt={p}
            format={format}
            fullDetail={fullDetail}
            naturalSourceOf={naturalSourceOf}
            overrides={overrides}
            shownRef={shownRef}
            locked={lockedSet.has(i)}
            onToggleLock={onToggleLock}
            onCopy={copyOne}
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
  onToggleLock,
  onCopy,
  onReroll,
  onAlways,
  onNever,
}: {
  locked: boolean
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
      pending={format !== "tags" && natural.status === "loading"}
      locked={locked}
      onToggleLock={onToggleLock}
      onCopy={onCopy}
      onReroll={onReroll}
      onAlways={onAlways}
      onNever={onNever}
    />
  )
})
