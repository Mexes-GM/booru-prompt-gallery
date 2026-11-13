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
import { AlertTriangle, ChevronDown, Package, X } from "lucide-react"
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
import { useNaturalPrompt, usePromptFormat } from "@/hooks/use-natural-prompt"
import type { PackRatingMode } from "@/hooks/use-pack-seed-search"
import type { BooruProvider } from "@/lib/booru/types"
import { routeTag, type RequestRole } from "@/lib/pack/brief"
import { issuesFit, predictFit, preferredPostIds, promptTokens, type BriefOutfit, type FitNote } from "@/lib/pack/brief-pack"
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
import { BLOCKED, BUILDER_TEXT, RATING_OPTIONS, type FitState, type OutfitSource } from "./pack-text"
import { ResultRow } from "./result-row"
import { briefSummaryParts, companionsLabel, type CharacterInfo, type SlotId } from "./slots"
import { UndoNotice } from "./undo-notice"

export interface PackBriefBuilderProps {
  /** The characters the pack starts with (the entry dialog's pick). */
  characters: readonly string[]
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

/** Shell: the panel and its header. The work starts once the brief holds the characters. */
export function PackBriefBuilder(props: PackBriefBuilderProps) {
  const { characters, overrides, rating, onRatingChange, onExit } = props
  const pack = usePackBrief(overrides)
  // The pack starts once, with the characters it opened with, before anything is fetched.
  const [started, setStarted] = useState(false)
  if (!started) {
    setStarted(true)
    pack.startFromCharacters([...characters])
  }

  return (
    <TooltipProvider delayDuration={300}>
      <section
        aria-label={BUILDER_TEXT.title}
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[85dvh] w-full max-w-3xl flex-col overflow-hidden",
          "rounded-t-2xl border border-border bg-background shadow-2xl sm:bottom-4 sm:w-[calc(100%-2rem)] sm:rounded-2xl",
          "animate-in fade-in-0 slide-in-from-bottom-4 duration-200 ease-out-strong motion-reduce:animate-none",
        )}
      >
        <header className="flex flex-shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
          <Package className="size-5 shrink-0 text-mode-pack-text" aria-hidden />
          <h2 className="text-base font-semibold leading-tight text-foreground">{BUILDER_TEXT.title}</h2>
          <div className="ml-auto flex items-center gap-1">
            <RatingMenu value={rating} onChange={onRatingChange} />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onExit}
              aria-label={BUILDER_TEXT.exit}
              title={BUILDER_TEXT.exit}
              className="size-9 text-muted-foreground hover:text-foreground pointer-coarse:size-11"
            >
              <X className="size-4" aria-hidden />
            </Button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3 pt-2">
          {started && <BriefWorkspace {...props} pack={pack} />}
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
const UNDO_MS = 6000

/** A tag of a prompt as the brief spells it: no weight, no brackets. */
const bareToken = (token: string) => token.replace(/^\(+/, "").replace(/(:[\d.]+)?\)+$/, "").trim()

/** The slot of the brief a typed tag lands in. */
function landsIn(tag: string, typedIn: SlotId, overrides: Record<string, string>): SlotId | null {
  if (typedIn === "never") return "never"
  const route = routeTag(tag, overrides)
  if (route.kind === "character" || route.kind === "look") return "who"
  if (route.kind === "request") return route.role
  if (route.kind === "people") return null
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
}: PackBriefBuilderProps & { pack: UsePackBriefResult }) {
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
  const leftOut = useMemo(() => new Set(brief.leftOut), [brief.leftOut])
  // The source ran out without a single post: there is nothing to wait for.
  const noPosts = !!source && source.noMoreResults && !source.isLoadingMore && posts.length === 0
  const usable = useMemo(
    () => (candidates ? candidates.filter((c) => !leftOut.has(String(c.postId))) : noPosts ? [] : null),
    [candidates, leftOut, noPosts]
  )
  const poses = pack.requests.select
  const have = usable ? (poses.length > 0 ? usable.filter((c) => c.hasPose).length : usable.length) : 0
  const canLoad = !!source && !source.noMoreResults && !source.failed && !source.sessionCapReached && !source.scrollLimited && !limited
  const needMore = !!usable && !candidatesPending && have < count
  // Short of scenes: fetch more pages, one at a time, until there are enough, the source
  // runs out or the pace limit stops it (then the fit line says what there is).
  useEffect(() => {
    if (needMore && canLoad && source && !source.isLoadingMore) source.loadMore()
  }, [needMore, canLoad, source])
  const loadingPosts = !!source?.isLoadingMore || (searching && !source)
  const finding = loadingPosts || (needMore && canLoad) || (!candidates && searching && !noPosts && !source?.failed && !engine.loadFailed)
  const canOfferSensitive = rating === "sfw" && plan.sensitive === "excluded" && !finding

  const stale = !!result && (result.brief !== brief || result.count !== count || result.outfit !== outfit)
  const notes: FitNote[] = useMemo(() => {
    if (!result) return predictFit({ candidates: usable, count, poses, finding, canOfferSensitive })
    const after = issuesFit({
      issues: result.issues,
      count: result.count,
      made: result.prompts.length,
      cast: identity.cast,
      scenes: usable ? have : null,
      canOfferSensitive,
    })
    return stale ? [{ kind: "stale" }, ...after] : after
  }, [result, usable, count, poses, finding, canOfferSensitive, identity.cast, have, stale])
  const { setIncludeSensitive } = pack
  const includeSensitive = useCallback(() => setIncludeSensitive(true), [setIncludeSensitive])
  const fitStates = useMemo<FitState[]>(
    () => notes.map((n) => (n.kind === "few-rated" ? { kind: "few-rated", onInclude: includeSensitive } : n)),
    [notes, includeSensitive]
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
  const [routed, setRouted] = useState<{ slot: SlotId; key: number } | null>(null)
  const { add, never, remove, unnever, removeCharacter, setRole, removeLook, restoreLook, leaveOutScene, restoreScene, setPeople, undo } = pack
  const onAddTags = useCallback((tags: string[], slot: SlotId) => {
    let elsewhere: SlotId | null = null
    for (const tag of tags) {
      if (slot === "never") never(tag)
      else add(tag, slot === "who" ? undefined : (slot as RequestRole))
      const dest = landsIn(tag, slot, overrides)
      if (dest && dest !== slot) elsewhere = dest
    }
    if (elsewhere) setRouted({ slot: elsewhere, key: Date.now() })
  }, [add, never, overrides])
  // The tag menu of a result writes on the brief; the prompts already made stay as they are.
  const onAlways = useCallback((tag: string) => add(bareToken(tag), "also"), [add])
  const onNever = useCallback((tag: string) => never(bareToken(tag)), [never])
  const onRemoveCharacter = useCallback((tag: string | null) => { if (tag) removeCharacter(tag) }, [removeCharacter])
  const onToggleScene = useCallback(
    (id: string) => (leftOut.has(id) ? restoreScene(id) : leaveOutScene(id)),
    [leftOut, leaveOutScene, restoreScene]
  )

  // Undo: the last change of the brief, for a few seconds.
  const [undoFor, setUndoFor] = useState<object | null>(null)
  const [seenBrief, setSeenBrief] = useState(brief)
  if (seenBrief !== brief) {
    setSeenBrief(brief)
    setUndoFor(pack.canUndo ? brief : null)
  }
  useEffect(() => {
    if (!undoFor) return
    const timer = setTimeout(() => setUndoFor(null), UNDO_MS)
    return () => clearTimeout(timer)
  }, [undoFor])
  const showUndo = undoFor === brief && !!pack.lastChange
  const onUndo = useCallback(() => {
    undo()
    setUndoFor(null)
  }, [undo])

  // ── What the brief shows of each character ──────────────────────────────────────
  const characterInfo = useMemo(() => {
    const out: Record<string, CharacterInfo> = {}
    for (const c of brief.who) if (c.tag) out[c.tag] = { usualLook: engine.looks[c.tag]?.look ?? [] }
    return out
  }, [brief.who, engine.looks])
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
  const sheetStatus: ContactSheetStatus = engine.loadFailed || (source?.failed && thumbs.length === 0)
    ? "error"
    : !candidates && (finding || !engine.ready)
      ? "loading"
      : "ready"
  const retrySheet = useCallback(() => {
    if (engine.loadFailed) engine.retryLoad()
    else source?.retry()
  }, [engine, source])

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
      {engine.loadFailed && (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive-text">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {BUILDER_TEXT.loadFailed}
          <Button type="button" variant="outline" size="sm" onClick={engine.retryLoad} className="h-7 px-2.5 text-xs pointer-coarse:h-11">
            {BUILDER_TEXT.retry}
          </Button>
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
          people={people}
        />
      )}

      <div className="space-y-1">
        {fitStates.map((state, i) => (
          <FitLine key={`${state.kind}-${i}`} state={state} hint={i === 0 && !folded && thumbs.length > 0 && !result ? BUILDER_TEXT.sheetHint : undefined} />
        ))}
      </div>
      {!folded && (
        <ContactSheet
          scenes={thumbs}
          leftOut={brief.leftOut}
          onToggle={onToggleScene}
          status={sheetStatus}
          expected={count}
          onRetry={retrySheet}
        />
      )}

      <GenerateBar
        count={count}
        onCountChange={pack.setPromptCount}
        onGenerate={engine.generate}
        generating={isGenerating}
        blockedReason={blockedReason}
      />

      {showUndo && pack.lastChange && (
        <UndoNotice message={pack.lastChange} onUndo={onUndo} onDismiss={() => setUndoFor(null)} />
      )}

      {result && result.prompts.length > 0 && (
        <Results
          prompts={result.prompts}
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

// ── Results ──────────────────────────────────────────────────────────────────────

const warnTagsCopied = () => toast({ description: BUILDER_TEXT.convertFailed, variant: "destructive", duration: 3000 })

function Results({
  prompts,
  naturalSourceOf,
  overrides,
  onCopy,
  onReroll,
  onAlways,
  onNever,
}: {
  prompts: PackPrompt[]
  naturalSourceOf: (prompt: PackPrompt) => NaturalPromptSource
  overrides: Record<string, string>
  onCopy: (text: string, format: PromptFormat) => Promise<boolean>
  onReroll: (index: number) => boolean
  onAlways: (tag: string) => void
  onNever: (tag: string) => void
}) {
  const { format, fullDetail, setFormat } = usePromptFormat()
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
      <ResultsToolbar formats={FORMATS} format={format} onFormatChange={onFormatChange} count={prompts.length} onCopyAll={copyAll} />
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
  onCopy,
  onReroll,
  onAlways,
  onNever,
}: {
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
      onCopy={onCopy}
      onReroll={onReroll}
      onAlways={onAlways}
      onNever={onNever}
    />
  )
})
