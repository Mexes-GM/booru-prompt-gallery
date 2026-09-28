"use client"

import React, { useState, useEffect, useMemo, useCallback, useRef, useDeferredValue } from "react"
import { usePostHog } from "posthog-js/react"
import { useTheme } from "next-themes"
import {
  Loader2,
  Settings,
  RefreshCw,
  Sliders,
  Search,
  X,
  Shuffle,
  HelpCircle,
  Zap,
  ListPlus,
} from "lucide-react"
import { useBooruSearch } from "@/hooks/use-booru-search"
import { usePersistentState } from "@/hooks/use-persistent-state"
import { usePreferencesSync } from "@/hooks/use-preferences-sync"
import { userPreferences, STORAGE_KEYS } from "@/lib/storage"
import type { TagAppendRule } from "@/lib/cleanPrompt"
import { usePromptOptions } from "@/hooks/use-prompt-options"
import { useBackgroundSettings } from "@/hooks/use-background-settings"
import { useGlobalWeights } from "@/hooks/use-global-weights"
import { usePresetsAndHistory } from "@/hooks/use-presets-and-history"
import { useFilteredPosts } from "@/hooks/use-filtered-posts"
import { useDebounce } from "@/hooks/use-debounce"
import type { UseCardPromptOptions } from "@/hooks/use-card-prompt"
import { useBulkSend, type BulkSendMode } from "@/hooks/use-bulk-send"
import { useTagCounts } from "@/hooks/use-tag-counts"
import { useBlacklist } from "@/hooks/use-blacklist"
import { useToast } from "@/hooks/use-toast"
import { toastError } from "@/lib/toast-error"
import { parsePromptList } from "@/lib/extension/prompt-list-parser"
import { detectSearchCharacterName } from "@/lib/pack/bulk-send"
import { shouldConfirmNsfwEnable, nextRatingFilter, ALL_RATING, SAFE_RATING } from "@/lib/nsfw-consent"
import type { BooruPost, BooruProvider } from "@/lib/api-client"
import { cn } from "@/lib/utils"
import { SearchWithAutocomplete } from "@/components/prompt-gallery/search-with-autocomplete"
import { ProviderSelect } from "@/components/prompt-gallery/provider-select"
import { TagsManagementPanel } from "@/components/prompt-gallery/tags-management-panel"
import { PromptGenerationOptionsPanel } from "@/components/prompt-gallery/prompt-generation-options-panel"
import { QueryStatusPanel } from "@/components/prompt-gallery/query-status-panel"
import { GlobalWeightsModal } from "@/components/prompt-gallery/global-weights-modal"
import { BlacklistManager } from "@/components/prompt-gallery/blacklist-manager"
import { NoResultsState } from "@/components/prompt-gallery/no-results-state"
import { TargetSetupWizard } from "@/components/prompt-gallery/target-setup-wizard"
import { ExtensionTour } from "@/components/extension-tour"
import { MasonryGrid } from "@/components/masonry-grid"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { InfiniteScrollTrigger } from "@/components/ui/infinite-scroll-trigger"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { PocketCard, POCKET_FOOTER_HEIGHT } from "./pocket-card"
import { PocketHistorySheet } from "./pocket-history-sheet"
import { PocketQueueBar } from "./pocket-queue-bar"
import { postToParent, sendQueueAction, useHostMessage } from "./pocket-bridge"

/**
 * Broadcasts the app's resolved theme ("dark" | "light") to the native sidepanel
 * wrapper so its chrome (body background + loading screen) matches the app —
 * even when the user overrides the OS preference via the in-app ThemeToggle.
 * Uses the root layout's ThemeProvider.
 */
function ThemeSync() {
  const { resolvedTheme } = useTheme()
  useEffect(() => {
    if (resolvedTheme !== "dark" && resolvedTheme !== "light") return
    postToParent({ type: "THEME_CHANGE", theme: resolvedTheme })
  }, [resolvedTheme])
  return null
}

/** Compact Safe/NSFW switch with the web app's first-time consent (Capa 2). */
function PocketNsfwToggle({ ratingFilter, setRatingFilter, booruProvider }: {
  ratingFilter: string
  setRatingFilter: (rating: string) => void
  booruProvider: string
}) {
  const posthog = usePostHog()
  const [dialogOpen, setDialogOpen] = useState(false)
  const isRule34 = booruProvider === "rule34"
  const nsfwOn = isRule34 || ratingFilter !== SAFE_RATING

  const toggle = () => {
    if (shouldConfirmNsfwEnable(ratingFilter, userPreferences.getNsfwAcknowledged())) {
      setDialogOpen(true)
      return
    }
    const next = nextRatingFilter(ratingFilter)
    posthog.capture("nsfw_preference_changed", { rating_filter: next, surface: "pocket" })
    setRatingFilter(next)
  }

  const confirm = () => {
    userPreferences.setNsfwAcknowledged(true)
    posthog.capture("nsfw_preference_changed", { rating_filter: ALL_RATING, surface: "pocket" })
    setRatingFilter(ALL_RATING)
    setDialogOpen(false)
  }

  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={nsfwOn}
        disabled={isRule34}
        onClick={toggle}
        title={isRule34 ? "NSFW is always enabled for Rule34" : nsfwOn ? "Showing NSFW. Click for Safe only." : "Safe only. Click to also show NSFW."}
        aria-label={nsfwOn ? "NSFW content shown. Click to show safe content only." : "Safe content only. Click to also show NSFW content."}
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-input bg-background px-2 text-[11px] font-semibold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className={nsfwOn ? "text-foreground" : "text-success-text"}>{nsfwOn ? "NSFW" : "Safe"}</span>
        <span aria-hidden="true" className={cn("flex h-3.5 w-6 items-center rounded-full p-0.5 transition-colors", nsfwOn ? "bg-primary" : "bg-muted-foreground/30")}>
          <span className={cn("h-2.5 w-2.5 rounded-full transition-transform duration-200 ease-out", nsfwOn ? "translate-x-2.5 bg-primary-foreground" : "translate-x-0 bg-muted-foreground")} />
        </span>
      </button>
      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Show adult (NSFW) content?</AlertDialogTitle>
            <AlertDialogDescription>
              You&apos;re about to turn off the Safe filter. Results may include explicit / adult (18+)
              content. Only continue if you are of legal age and want to see this material. You can
              switch back to Safe at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Stay in Safe mode</AlertDialogCancel>
            <AlertDialogAction type="button" onClick={confirm}>Show NSFW</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

const getBulkSendMode = () => userPreferences.getBulkSendMode() as BulkSendMode
const setBulkSendModePref = (val: BulkSendMode) => userPreferences.setBulkSendMode(val)

/** A settings row with a label, hint and switch — the Pocket-only (host) toggles. */
function HostToggleRow({ id, label, hint, checked, disabled, onCheckedChange, nested = false }: {
  id: string
  label: string
  hint: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (val: boolean) => void
  nested?: boolean
}) {
  return (
    <div className={cn("flex items-center justify-between gap-2 p-1 rounded-md hover:bg-muted/30 transition-colors", nested && "pl-3")}>
      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <Label htmlFor={id} className={cn("select-none cursor-pointer", nested ? "text-[11px] text-muted-foreground" : "text-xs")}>{label}</Label>
        <span className="text-[10px] text-muted-foreground/80 leading-snug">{hint}</span>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} className="scale-75 origin-right shrink-0" />
    </div>
  )
}

export default function ExtensionClient() {
  const mainScrollRef = useRef<HTMLElement>(null)
  const search = useBooruSearch()
  usePreferencesSync()
  const [showSettings, setShowSettings] = useState(false)
  const [tourRunSignal, setTourRunSignal] = useState(0)
  const tagCounts = useTagCounts(search.allPosts, search.booruProvider)
  const { toast } = useToast()

  // Auto-Downloading "group by character": resolve once per search-tags/posts
  // change (not per card) so single-card sends, Bulk Send (real + synthetic),
  // and Import List all agree on the same detected character folder name.
  const activeCharacterFolder = useMemo(
    () => detectSearchCharacterName(search.searchTags, search.allPosts),
    [search.searchTags, search.allPosts]
  )

  // Handshake for the sidepanel's loading screen / host failover: tells the
  // host the Pocket app actually booted (not a curtain or an error page).
  useEffect(() => {
    postToParent({ type: "POCKET_READY" })
  }, [])

  // ── Host-owned settings (source of truth: chrome.storage in extension/sidepanel/) ──
  // Only the few primitive fields the settings panel needs are mirrored here;
  // the high-frequency queue status lives in PocketQueueBar so a running batch
  // doesn't re-render the grid. Same-value setState calls bail out.
  const [hostPlatform, setHostPlatform] = useState("Unknown")
  const [autoDownload, setAutoDownload] = useState(false)
  const [backgroundGeneration, setBackgroundGeneration] = useState(false)
  const [characterSubfolders, setCharacterSubfolders] = useState(true)
  useHostMessage<Record<string, unknown>>("QUEUE_STATUS", (d) => {
    if (typeof d.platform === "string") setHostPlatform(d.platform)
    if (typeof d.autoDownloadEnabled === "boolean") setAutoDownload(d.autoDownloadEnabled)
    if (typeof d.characterSubfoldersEnabled === "boolean") setCharacterSubfolders(d.characterSubfoldersEnabled)
    if (typeof d.backgroundGenerationEnabled === "boolean") setBackgroundGeneration(d.backgroundGenerationEnabled)
  })
  useEffect(() => {
    postToParent({ type: "REQUEST_QUEUE_STATUS" })
  }, [])

  // ── Targeting ──────────────────────────────────────────────────────────────
  // "idle" | "arming" | "waiting" | "selected" | "none" | "error" | "cancelled"
  const [targetState, setTargetState] = useState<string>("idle")
  // True once the user has picked a destination field this session.
  const [hasTargetSet, setHasTargetSet] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const targetResetRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (targetResetRef.current) clearTimeout(targetResetRef.current) }, [])

  const resetTargetStateAfter = (ms: number) => {
    if (targetResetRef.current) clearTimeout(targetResetRef.current)
    targetResetRef.current = setTimeout(() => setTargetState("idle"), ms)
  }

  useHostMessage<{ state: string; detail?: Record<string, string | number | undefined> }>("TARGET_STATUS", ({ state, detail }) => {
    // The wizard reuses TARGET_STATUS for its own steps (targetKind set) and for
    // "site_profile" pings; the quick Target button only reacts to plain ones.
    if (state === "site_profile" || (detail?.targetKind && detail.targetKind !== "prompt")) return
    setTargetState(state)
    switch (state) {
      case "waiting":
        toast({
          title: "Click the prompt field",
          description: `${detail?.candidates ?? 0} field(s) detected on ${detail?.platform ?? "the page"}. Click the one to fill.`,
        })
        break
      case "selected":
        setHasTargetSet(true)
        postToParent({ type: "REQUEST_SITE_PROFILE_STATUS" })
        toast({
          title: "Target set",
          description: detail?.placeholder
            ? `Selected <${String(detail.tag || "input").toLowerCase()}> "${detail.placeholder}"`
            : "Prompts will be sent here.",
        })
        resetTargetStateAfter(1500)
        break
      case "none":
        toastError({
          title: "No prompt field found",
          description: (detail?.message as string) || "Make sure the prompt box is visible on the page, then retry.",
          errorSource: "extension_target_none",
        })
        resetTargetStateAfter(2500)
        break
      case "error":
        toastError({
          title: "Targeting failed",
          description: (detail?.message as string) || "Could not start targeting. Open the generation page and retry.",
          errorSource: "extension_target_error",
        })
        resetTargetStateAfter(2500)
        break
      case "cancelled":
        resetTargetStateAfter(500)
        break
    }
  })

  const startTargeting = useCallback(() => {
    setTargetState("arming")
    sendQueueAction({ action: "target" })
  }, [])

  // Per-origin SiteProfile: a saved prompt field (or a built-in platform
  // profile) means prompts already know where to go, so a reloaded Pocket
  // shouldn't nag the user to pick a target again.
  const [profileHasPrompt, setProfileHasPrompt] = useState(false)
  // "Match image resolution": whether the active origin has widthField +
  // heightField configured (or auto-detected LiteGraph size widgets).
  const [resolutionConfigured, setResolutionConfigured] = useState(false)
  useHostMessage<Record<string, unknown>>("SITE_PROFILE_STATUS", (d) => {
    setProfileHasPrompt(!!d.promptConfigured || !!d.builtin)
    setResolutionConfigured((!!d.widthConfigured && !!d.heightConfigured) || !!d.liteGraphResolutionAvailable)
  })
  useEffect(() => {
    postToParent({ type: "REQUEST_SITE_PROFILE_STATUS" })
  }, [])
  const hasTarget = hasTargetSet || profileHasPrompt

  const guideToTarget = useCallback(() => {
    toast({
      title: "Pick a target field first",
      description: "Click \"Target\", then click the prompt box on your image generator page so prompts know where to go.",
    })
  }, [toast])

  const guideToResolutionFields = useCallback(() => {
    toast({
      title: "Set the width/height fields first",
      description: "Open Setup and configure the Resolution step so \"Match image resolution\" can adjust the canvas size.",
    })
  }, [toast])

  // Responsive column count for the masonry grid, based on the panel width.
  // Side panels are resizable, so we adapt instead of forcing 2 columns.
  const [gridCols, setGridCols] = useState(2)
  useEffect(() => {
    const el = mainScrollRef.current
    if (!el) return
    const compute = () => {
      const w = el.clientWidth
      // Baseline is 2 columns; widen when the panel is clearly large. Never
      // drop to 1 — a single column pushes the prompt/buttons off-screen.
      if (w <= 0) return
      setGridCols(w > 900 ? 4 : w > 620 ? 3 : 2)
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [search.isClient])

  const { blacklist, addTag, removeTag, resetBlacklist } = useBlacklist()

  // Pocket Settings — same shared hooks/stores the main web app uses.
  const [addInput, setAddInput] = usePersistentState(
    "", userPreferences.getAddTagsInput, userPreferences.setAddTagsInput, "addTags", STORAGE_KEYS.ADD_TAGS
  )
  const [excludeInput, setExcludeInput] = usePersistentState(
    "", userPreferences.getExcludeTagsInput, userPreferences.setExcludeTagsInput, "excludeTags", STORAGE_KEYS.EXCLUDE_TAGS
  )
  const [findInput, setFindInput] = usePersistentState(
    "", userPreferences.getFindReplaceFindInput, userPreferences.setFindReplaceFindInput, "findReplaceFind", STORAGE_KEYS.FIND_REPLACE_FIND
  )
  const [replaceInput, setReplaceInput] = usePersistentState(
    "", userPreferences.getFindReplaceReplaceInput, userPreferences.setFindReplaceReplaceInput, "findReplaceReplace", STORAGE_KEYS.FIND_REPLACE_REPLACE
  )
  const [tagAppendRules, setTagAppendRules] = usePersistentState<TagAppendRule[]>(
    [], userPreferences.getTagAppendRules, userPreferences.setTagAppendRules, "tagAppendRules", STORAGE_KEYS.TAG_APPEND_RULES
  )

  // "Match image resolution" — extension-only: sending a prompt also attaches
  // a generation width/height derived from the source post's aspect ratio.
  const [matchResolution, setMatchResolution] = usePersistentState(
    false, userPreferences.getMatchResolutionEnabled, userPreferences.setMatchResolutionEnabled,
    "matchResolutionEnabled", STORAGE_KEYS.MATCH_RESOLUTION_ENABLED
  )
  const [maxLongSide, setMaxLongSide] = usePersistentState(
    1536, userPreferences.getMatchResolutionMaxLongSide, userPreferences.setMatchResolutionMaxLongSide,
    "matchResolutionMaxLongSide", STORAGE_KEYS.MATCH_RESOLUTION_MAX_LONG_SIDE
  )
  // "area" budget (off) lets one side exceed maxLongSide while total area fits;
  // "strict" (on) makes maxLongSide a hard per-side ceiling.
  const [strictResolutionCap, setStrictResolutionCap] = usePersistentState(
    false, userPreferences.getMatchResolutionStrictCap, userPreferences.setMatchResolutionStrictCap,
    "matchResolutionStrictCap", STORAGE_KEYS.MATCH_RESOLUTION_STRICT_CAP
  )
  // Typed locally and committed on blur/Enter so clearing the field to retype
  // doesn't snap it back to the default mid-edit.
  // null = not editing, show the stored value.
  const [maxLongSideDraft, setMaxLongSideDraft] = useState<string | null>(null)
  const commitMaxLongSide = () => {
    if (maxLongSideDraft === null) return
    const parsed = Number.parseInt(maxLongSideDraft, 10)
    if (Number.isFinite(parsed) && parsed >= 64) setMaxLongSide(Math.min(parsed, 4096))
    setMaxLongSideDraft(null)
  }

  const {
    includeCharacters, optimizeTags, smartTagExclusion, prependAnimaArtist, autoAppendSearchTags,
    setIncludeCharacters, setOptimizeTags, setSmartTagExclusion, setPrependAnimaArtist, setAutoAppendSearchTags,
  } = usePromptOptions()

  const {
    backgroundMode, setBackgroundMode,
    detailedBackgroundsList,
    simpleBackgroundReplacementTags, setSimpleBackgroundReplacementTags,
    randomBackgroundPatterns, setRandomBackgroundPatterns,
    randomBackgroundIncludeGradients, setRandomBackgroundIncludeGradients,
    backgroundMatchStrictness, setBackgroundMatchStrictness,
  } = useBackgroundSettings()

  const {
    globalWeights,
    isGlobalWeightsEnabled,
    isGlobalWeightsModalOpen, setIsGlobalWeightsModalOpen,
    handleGlobalWeightChange, handleClearGlobalWeights, handleRemoveGlobalWeight,
    toggleGlobalWeights,
  } = useGlobalWeights(toast)

  const {
    presets,
    history,
    previouslyCopiedPostIds,
    isPresetDialogOpen, setIsPresetDialogOpen,
    presetName, setPresetName,
    savePreset, loadPreset, deletePreset,
    addToHistory, removeHistoryItem, clearHistory,
  } = usePresetsAndHistory({ isClient: search.isClient, addInput, setAddInput, toast })

  // Store the copied post's snapshot (like the web app) so History can render
  // it — and rebuild its prompt — without any network round-trip.
  const handleUsedPrompt = useCallback((post: BooruPost) => {
    if (!post?.id) return
    const provider = (post._provider as BooruProvider | undefined) || search.booruProvider
    addToHistory({ postId: post.id, provider, post: { ...post, _provider: provider } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.booruProvider])

  const placeholders = useMemo(() => search.isShuffle ? ["Search tag (e.g., cat_girl)…"] : [
    "Search tags (e.g., cat girl)…",
    "frieren, solo",
    "swimsuit, wet hair",
  ], [search.isShuffle])

  // Card-facing, debounced/deferred copies of the settings (same approach as
  // the web app): typing in "Tags to add" or flipping a switch repaints the
  // control immediately; the per-card prompt re-derivation runs afterwards.
  const debouncedAddInput = useDebounce(addInput, 350)
  const debouncedExcludeInput = useDebounce(excludeInput, 350)
  const debouncedFindInput = useDebounce(findInput, 350)
  const debouncedReplaceInput = useDebounce(replaceInput, 350)
  const cardIncludeCharacters = useDeferredValue(includeCharacters)
  const cardOptimizeTags = useDeferredValue(optimizeTags)
  const cardSmartTagExclusion = useDeferredValue(smartTagExclusion)
  const cardPrependAnimaArtist = useDeferredValue(prependAnimaArtist)
  const cardAutoAppendSearchTags = useDeferredValue(autoAppendSearchTags)
  const cardRemoveLoRaTags = useDeferredValue(search.removeLoRaTags)
  const cardRemoveQualityTags = useDeferredValue(search.removeQualityTags)
  const cardBackgroundMode = useDeferredValue(backgroundMode)
  const cardIsGlobalWeightsEnabled = useDeferredValue(isGlobalWeightsEnabled)
  const debouncedSimpleBackgroundReplacementTags = useDebounce(simpleBackgroundReplacementTags, 350)

  // Prompt options bundle passed to PocketCard, which derives the prompt via
  // the shared useCardPrompt hook — the same pipeline MasonryItem uses.
  const cardPromptOptions: UseCardPromptOptions = useMemo(() => ({
    excludeInput: debouncedExcludeInput,
    addInput: debouncedAddInput,
    searchTags: search.debouncedSearchTags,
    autoAppendSearchTags: cardAutoAppendSearchTags,
    findInput: debouncedFindInput,
    replaceInput: debouncedReplaceInput,
    tagAppendRules,
    includeCharacters: cardIncludeCharacters,
    optimizeTags: cardOptimizeTags,
    smartTagExclusion: cardSmartTagExclusion,
    prependAnimaArtist: cardPrependAnimaArtist,
    removeLoRaTags: cardRemoveLoRaTags,
    removeQualityTags: cardRemoveQualityTags,
    backgroundMode: cardBackgroundMode,
    simpleBackgroundReplacementTags: debouncedSimpleBackgroundReplacementTags,
    randomBackgroundPatterns,
    randomBackgroundIncludeGradients,
    detailedBackgroundsList,
    backgroundMatchStrictness,
  }), [
    debouncedExcludeInput, debouncedAddInput, search.debouncedSearchTags, cardAutoAppendSearchTags,
    debouncedFindInput, debouncedReplaceInput, tagAppendRules,
    cardIncludeCharacters, cardOptimizeTags, cardSmartTagExclusion, cardPrependAnimaArtist,
    cardRemoveLoRaTags, cardRemoveQualityTags,
    cardBackgroundMode, debouncedSimpleBackgroundReplacementTags,
    randomBackgroundPatterns, randomBackgroundIncludeGradients, detailedBackgroundsList, backgroundMatchStrictness,
  ])

  const cardGlobalWeights = useMemo(
    () => (cardIsGlobalWeightsEnabled ? globalWeights : {}),
    [cardIsGlobalWeightsEnabled, globalWeights]
  )

  // Blacklist + character-count + tag-count filters, shared with the web app.
  const filteredPosts = useFilteredPosts({
    allPosts: search.isClient ? search.allPosts : [],
    booruProvider: search.booruProvider,
    blacklist,
    includeCharacters: cardIncludeCharacters,
    appliedCharacterCountFilter: search.appliedCharacterCountFilter,
    tagCounts,
    appliedTagCountFilter: search.appliedTagCountFilter,
  })

  // ── Bulk Send (docs/superpowers/specs/2026-07-19-extension-bulk-send-design.md) ──
  const [bulkSendMode, setBulkSendMode] = usePersistentState<BulkSendMode>(
    "real",
    getBulkSendMode,
    setBulkSendModePref,
    "bulkSendMode",
    STORAGE_KEYS.BULK_SEND_MODE
  )
  const [bulkSendConfirmCount, setBulkSendConfirmCount] = useState<number | null>(null)

  const bulkSend = useBulkSend(
    {
      allPosts: search.allPosts,
      isLoadingMore: search.isLoadingMore,
      noMoreResults: search.noMoreResults,
      sessionCapReached: search.sessionCapReached,
      scrollLimited: search.scrollLimited,
      loadMore: search.loadMore,
    },
    {
      realCleanOptions: cardPromptOptions,
      syntheticCleanOptions: cardPromptOptions,
      matchResolution,
      maxLongSide,
      strictResolutionCap,
    }
  )

  const enqueueBulkPrompts = useCallback((items: { prompt: string; width?: number; height?: number }[]) => {
    // Micro-stagger so N postMessages don't fire in one tick — the sidepanel's
    // own queue throttles processing, this only avoids bursting the channel.
    items.forEach((item, index) => {
      setTimeout(() => {
        postToParent({
          type: "INJECT_PROMPT",
          prompt: item.prompt,
          ...(item.width && item.height ? { width: item.width, height: item.height } : {}),
          ...(activeCharacterFolder ? { character: activeCharacterFolder } : {}),
        })
      }, index * 40)
    })
  }, [activeCharacterFolder])

  const runBulkSend = useCallback(async (count: number) => {
    if (!hasTarget) {
      guideToTarget()
      return
    }
    try {
      const result = await bulkSend.run(bulkSendMode, count, search.searchTags)
      if (result.produced === 0) {
        toastError({
          title: "No prompts generated",
          description: "Couldn't find enough posts for this search to build any prompts.",
          errorSource: "extension_bulk_send_empty",
        })
        return
      }
      enqueueBulkPrompts(result.items)
      toast({
        title: result.produced === result.requested
          ? `${result.produced} prompts queued`
          : `${result.produced} of ${result.requested} prompts queued`,
        description: result.produced < result.requested
          ? "Fewer posts/variations were available for this search than requested."
          : `Sent from "${search.searchTags}" (${bulkSendMode === "real" ? "real posts" : "synthetic"} mode).`,
      })
    } catch {
      toastError({
        title: "Bulk send failed",
        description: "Something went wrong while preparing the prompts. Please try again.",
        errorSource: "extension_bulk_send_error",
      })
    }
  }, [hasTarget, guideToTarget, bulkSend, bulkSendMode, search.searchTags, enqueueBulkPrompts, toast])

  // ── Import Prompt List ─────────────────────────────────────────────────────
  // Paste prompts (one per line) and enqueue them all at once. A prompt may
  // prefix its own resolution as "[1024x1536]" (capped per side by the parser).
  const [importListOpen, setImportListOpen] = useState(false)
  const [importListText, setImportListText] = useState("")
  const importListItems = useMemo(() => parsePromptList(importListText), [importListText])
  const importListCount = importListItems.length
  const importListSizedCount = useMemo(
    () => importListItems.filter((item) => item.width && item.height).length,
    [importListItems]
  )

  const handleImportPromptList = useCallback(() => {
    if (importListItems.length === 0) return
    if (!hasTarget) {
      guideToTarget()
      return
    }
    enqueueBulkPrompts(importListItems)
    toast({
      title: `${importListItems.length} prompt${importListItems.length === 1 ? "" : "s"} imported`,
      description: importListSizedCount > 0
        ? `Added to the generation queue (${importListSizedCount} with a custom resolution).`
        : "Added to the generation queue.",
    })
    setImportListOpen(false)
    setImportListText("")
  }, [importListItems, importListSizedCount, hasTarget, guideToTarget, enqueueBulkPrompts, toast])

  // In the Pocket the minimum-tags slider is always enabled: providers with
  // server-side `tagcount:>=N` use it at the API level, the rest (Gelbooru,
  // Rule34) use the client-side fallback filter in useFilteredPosts.
  const isTagCountSupported = true
  const isTagCountValid = !!search.tagCountFilter && /^\d+$/.test(search.tagCountFilter)
  const hasQuery = !!search.searchTags.trim()

  const renderCard = useCallback((post: BooruPost, _width: number, height: number) => (
    <PocketCard
      key={post.id}
      post={post}
      promptOptions={cardPromptOptions}
      booruProvider={search.booruProvider}
      height={height}
      tagCounts={tagCounts}
      globalWeights={cardGlobalWeights}
      isGlobalWeightsEnabled={cardIsGlobalWeightsEnabled}
      onGlobalWeightChange={handleGlobalWeightChange}
      onSearch={search.setSearchTags}
      onUsedPrompt={handleUsedPrompt}
      isPreviouslyCopied={previouslyCopiedPostIds.has(post.id)}
      hasTarget={hasTarget}
      onNoTarget={guideToTarget}
      matchResolution={matchResolution}
      maxLongSide={maxLongSide}
      strictResolutionCap={strictResolutionCap}
      resolutionConfigured={resolutionConfigured}
      onNoResolutionFields={guideToResolutionFields}
      characterFolder={activeCharacterFolder}
    />
  ), [
    cardPromptOptions, search.booruProvider, search.setSearchTags, tagCounts, cardGlobalWeights,
    cardIsGlobalWeightsEnabled, handleGlobalWeightChange, handleUsedPrompt, previouslyCopiedPostIds,
    hasTarget, guideToTarget, matchResolution, maxLongSide, strictResolutionCap, resolutionConfigured,
    guideToResolutionFields, activeCharacterFolder,
  ])

  if (!search.isClient) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background text-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-primary-text" />
      </div>
    )
  }

  return (
    <TooltipProvider>
      <ThemeSync />
      <div className="h-screen bg-background text-foreground flex flex-col p-2.5 gap-2.5 overflow-hidden">
        {/* Header */}
        <header className="w-full shrink-0 flex items-center justify-between px-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <h1 className="text-sm font-bold text-foreground leading-none truncate">Booru Prompt Gallery</h1>
            <Badge variant="outline" className="text-[10px] font-semibold bg-primary/10 text-primary-text border-primary/20 px-1.5 py-0 h-4 select-none">
              Pocket
            </Badge>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setTourRunSignal((n) => n + 1)}
              className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
              title="Show guided tour"
              aria-label="Show guided tour"
            >
              <HelpCircle size={15} />
            </Button>
            <ThemeToggle />
          </div>
        </header>

        {/* Main control card */}
        <Card className="relative z-20 glass-effect shadow-md rounded-xl p-2.5 border-none flex flex-col gap-2 shrink-0">
          {/* Search row: provider picker docked to the input (same as the web app) + Safe/NSFW */}
          <div className="flex w-full items-center gap-1.5">
            <div className="flex flex-1 min-w-0 h-8">
              <div className="flex h-8 shrink-0 overflow-hidden rounded-l-md border border-r-0 border-input">
                <ProviderSelect
                  booruProvider={search.booruProvider}
                  setBooruProvider={search.setBooruProvider}
                  onProviderChange={() => {}}
                  className="px-2 text-[11px] gap-1"
                />
              </div>
              <div className="relative flex-1 min-w-0">
                <div className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center text-muted-foreground pointer-events-none z-20">
                  <Search className="h-3.5 w-3.5" />
                </div>
                <SearchWithAutocomplete
                  value={search.searchTags}
                  setValue={search.setSearchTags}
                  onSearch={() => search.handleSearch()}
                  placeholders={placeholders}
                  className="pl-7 pr-7 h-8 text-[11px] shadow-none rounded-l-none rounded-r-md z-10 relative bg-background focus-within:ring-1 focus-within:ring-ring"
                  aria-label="Search tags"
                />
                {search.searchTags && (
                  <button
                    type="button"
                    onClick={search.clearSearch}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1 z-20 rounded focus-ring"
                    aria-label="Clear search"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
            <PocketNsfwToggle
              ratingFilter={search.ratingFilter}
              setRatingFilter={search.setRatingFilter}
              booruProvider={search.booruProvider}
            />
          </div>

          {/* Action row */}
          <div className="flex items-center gap-1.5 w-full justify-between">
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                onClick={search.toggleShuffle}
                aria-pressed={search.isShuffle}
                className={cn("h-8 w-8 p-0 shadow-sm", search.isShuffle && "border-primary/40 bg-primary/10 text-primary-text hover:bg-primary/15 hover:text-primary-text")}
                title={search.isShuffle ? "Disable shuffle" : "Enable shuffle"}
                aria-label={search.isShuffle ? "Disable shuffle" : "Enable shuffle"}
              >
                <Shuffle className="w-3.5 h-3.5" />
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={search.refresh}
                disabled={search.isValidating}
                className="h-8 w-8 p-0 shadow-sm"
                title={search.isShuffle ? "Reshuffle results" : "Refresh results"}
                aria-label={search.isShuffle ? "Reshuffle results" : "Refresh results"}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${search.isValidating ? "animate-spin text-primary-text" : ""}`} />
              </Button>
              <PocketHistorySheet
                history={history}
                promptOptions={cardPromptOptions}
                globalWeights={cardGlobalWeights}
                isGlobalWeightsEnabled={cardIsGlobalWeightsEnabled}
                hasTarget={hasTarget}
                onNoTarget={guideToTarget}
                onUsedPrompt={handleUsedPrompt}
                removeHistoryItem={removeHistoryItem}
                clearHistory={clearHistory}
              />
              <Sheet open={importListOpen} onOpenChange={setImportListOpen}>
                <SheetTrigger asChild>
                  <Button type="button" variant="outline" className="h-8 w-8 p-0 shadow-sm" title="Import prompt list" aria-label="Import a list of prompts">
                    <ListPlus className="w-3.5 h-3.5" />
                  </Button>
                </SheetTrigger>
                <SheetContent className="w-full sm:w-[400px] flex flex-col p-4">
                  <SheetHeader className="text-left">
                    <SheetTitle className="text-sm font-bold">Import Prompt List</SheetTitle>
                    <SheetDescription className="text-xs">
                      Paste prompts, one per line. Optionally start a prompt with{" "}
                      <code className="font-mono">[1024x1536]</code> to set its resolution (max 1536 per side).
                    </SheetDescription>
                  </SheetHeader>
                  <textarea
                    value={importListText}
                    onChange={(e) => setImportListText(e.target.value)}
                    placeholder={"thick thighs, wide hips, ..., explicit\n[1024x1536] 1girl, solo, ..., full body"}
                    aria-label="Prompts to import, one per line"
                    className="mt-4 w-full flex-1 min-h-[220px] rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent resize-none"
                  />
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {importListCount > 0
                        ? `${importListCount} prompt${importListCount === 1 ? "" : "s"}${importListSizedCount > 0 ? ` · ${importListSizedCount} sized` : ""}`
                        : "No prompts yet"}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Button type="button" variant="outline" size="sm" onClick={() => { setImportListOpen(false); setImportListText("") }}>
                        Cancel
                      </Button>
                      <Button type="button" size="sm" disabled={importListCount === 0} onClick={handleImportPromptList}>
                        Import
                      </Button>
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
              <BlacklistManager
                blacklist={blacklist}
                onAdd={addTag}
                onRemove={removeTag}
                onReset={resetBlacklist}
                className="h-8 px-2 rounded-md shadow-sm"
              />
            </div>

            <Button
              id="extension-settings-btn"
              type="button"
              variant="outline"
              onClick={() => setShowSettings(!showSettings)}
              aria-expanded={showSettings}
              aria-controls="pocket-settings"
              className={cn(
                "h-8 px-2.5 gap-1.5 shadow-sm text-xs font-semibold",
                showSettings ? "bg-primary/10 text-primary-text border-primary/30 hover:bg-primary/15 hover:text-primary-text" : "text-muted-foreground hover:text-foreground"
              )}
              title="Prompt settings"
            >
              <Settings size={14} className={cn("transition-transform duration-300 ease-out", showSettings && "rotate-90")} />
              <span>Settings</span>
            </Button>
          </div>

          {/* Collapsible Settings Panel */}
          <Collapsible open={showSettings} onOpenChange={setShowSettings}>
            <CollapsibleContent id="pocket-settings" className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
              <div className="p-2.5 bg-muted/20 border border-border/50 rounded-lg flex flex-col gap-3 max-h-[48vh] overflow-y-auto overscroll-contain">
                <h2 className="text-[10px] font-bold tracking-wider uppercase text-muted-foreground/80 flex items-center gap-1 select-none">
                  <Sliders size={10} /> Prompt Settings
                </h2>

                {/* Same panels the web app uses (compact variant). */}
                <TagsManagementPanel
                  variant="compact"
                  addInput={addInput}
                  setAddInput={setAddInput}
                  isPresetDialogOpen={isPresetDialogOpen}
                  setIsPresetDialogOpen={setIsPresetDialogOpen}
                  presetName={presetName}
                  setPresetName={setPresetName}
                  savePreset={savePreset}
                  presets={presets}
                  loadPreset={loadPreset}
                  deletePreset={deletePreset}
                  excludeInput={excludeInput}
                  setExcludeInput={setExcludeInput}
                  findInput={findInput}
                  setFindInput={setFindInput}
                  replaceInput={replaceInput}
                  setReplaceInput={setReplaceInput}
                  tagAppendRules={tagAppendRules}
                  setTagAppendRules={setTagAppendRules}
                  tagCountFilter={search.tagCountFilter}
                  setTagCountFilter={search.setTagCountFilter}
                  setAppliedTagCountFilter={search.setAppliedTagCountFilter}
                  isTagCountSupported={isTagCountSupported}
                  isTagCountValid={isTagCountValid}
                  scoreTier={search.scoreTier}
                  setScoreTier={search.setScoreTier}
                  setAppliedScoreTier={search.setAppliedScoreTier}
                  characterCountFilter={search.characterCountFilter}
                  setCharacterCountFilter={search.setCharacterCountFilter}
                  setAppliedCharacterCountFilter={search.setAppliedCharacterCountFilter}
                  includeCharacters={includeCharacters}
                />

                <QueryStatusPanel
                  searchTags={search.searchTags}
                  ratingFilter={search.ratingFilter}
                  order={search.order}
                  appliedTagCountFilter={search.appliedTagCountFilter}
                  appliedScoreTier={search.appliedScoreTier}
                  booruProvider={search.booruProvider}
                />

                <PromptGenerationOptionsPanel
                  variant="compact"
                  isPromptOptionsExpanded={showSettings}
                  setIsPromptOptionsExpanded={setShowSettings}
                  booruProvider={search.booruProvider}
                  includeCharacters={includeCharacters}
                  setIncludeCharacters={setIncludeCharacters}
                  optimizeTags={optimizeTags}
                  setOptimizeTags={setOptimizeTags}
                  smartTagExclusion={smartTagExclusion}
                  setSmartTagExclusion={setSmartTagExclusion}
                  prependAnimaArtist={prependAnimaArtist}
                  setPrependAnimaArtist={setPrependAnimaArtist}
                  autoAppendSearchTags={autoAppendSearchTags}
                  setAutoAppendSearchTags={setAutoAppendSearchTags}
                  removeLoRaTags={search.removeLoRaTags}
                  setRemoveLoRaTags={search.setRemoveLoRaTags}
                  removeQualityTags={search.removeQualityTags}
                  setRemoveQualityTags={search.setRemoveQualityTags}
                  isGlobalWeightsEnabled={isGlobalWeightsEnabled}
                  toggleGlobalWeights={toggleGlobalWeights}
                  setIsGlobalWeightsModalOpen={setIsGlobalWeightsModalOpen}
                  backgroundMode={backgroundMode}
                  setBackgroundMode={setBackgroundMode}
                  simpleBackgroundReplacementTags={simpleBackgroundReplacementTags}
                  setSimpleBackgroundReplacementTags={setSimpleBackgroundReplacementTags}
                  randomBackgroundPatterns={randomBackgroundPatterns}
                  setRandomBackgroundPatterns={setRandomBackgroundPatterns}
                  randomBackgroundIncludeGradients={randomBackgroundIncludeGradients}
                  setRandomBackgroundIncludeGradients={setRandomBackgroundIncludeGradients}
                  backgroundMatchStrictness={backgroundMatchStrictness}
                  setBackgroundMatchStrictness={setBackgroundMatchStrictness}
                />

                {/* Generator (host) settings — Pocket-only */}
                <div className="flex flex-col gap-1 border-t pt-2">
                  <span className="text-[10px] font-bold tracking-wider uppercase text-muted-foreground/80 select-none px-1">Generator</span>
                  <HostToggleRow
                    id="auto-download"
                    label="Auto-Downloading"
                    hint={hostPlatform === "SeaArt" || hostPlatform === "Unknown"
                      ? "Download images with metadata when generation completes (SeaArt)"
                      : "Only available on SeaArt"}
                    checked={autoDownload}
                    disabled={hostPlatform !== "SeaArt" && hostPlatform !== "Unknown"}
                    onCheckedChange={(val) => {
                      setAutoDownload(val)
                      sendQueueAction({ action: "set_auto_download", value: val })
                    }}
                  />
                  {autoDownload && (
                    <HostToggleRow
                      nested
                      id="character-subfolders"
                      label="Group by character"
                      hint="When the search is locked to one character, file its images into a subfolder"
                      checked={characterSubfolders}
                      onCheckedChange={(val) => {
                        setCharacterSubfolders(val)
                        sendQueueAction({ action: "set_character_subfolders", value: val })
                      }}
                    />
                  )}
                  <HostToggleRow
                    id="background-generation"
                    label="Keep generating in background"
                    hint="Keep the queue running when the generator tab isn't focused. Keep its window open (not minimized)."
                    checked={backgroundGeneration}
                    onCheckedChange={(val) => {
                      setBackgroundGeneration(val)
                      sendQueueAction({ action: "set_background_generation", value: val })
                    }}
                  />
                  <HostToggleRow
                    id="match-resolution"
                    label="Match image resolution"
                    hint="Set the generator's width/height from the image's aspect ratio"
                    checked={matchResolution}
                    onCheckedChange={setMatchResolution}
                  />
                  {matchResolution && (
                    <>
                      <div className="flex items-center justify-between gap-2 p-1 pl-3">
                        <Label htmlFor="max-long-side" className="text-[11px] text-muted-foreground select-none cursor-pointer">
                          Max long side (px)
                        </Label>
                        <Input
                          id="max-long-side"
                          type="number"
                          min={64}
                          max={4096}
                          step={64}
                          inputMode="numeric"
                          value={maxLongSideDraft ?? String(maxLongSide)}
                          onChange={(e) => setMaxLongSideDraft(e.target.value)}
                          onBlur={commitMaxLongSide}
                          onKeyDown={(e) => { if (e.key === "Enter") commitMaxLongSide() }}
                          className="h-6 w-20 text-[11px] px-2 tabular-nums"
                        />
                      </div>
                      <HostToggleRow
                        nested
                        id="strict-resolution-cap"
                        label="Strict max long side"
                        hint={strictResolutionCap ? "Longest side never exceeds the value above" : "Longest side may exceed it if total area still fits"}
                        checked={strictResolutionCap}
                        onCheckedChange={setStrictResolutionCap}
                      />
                    </>
                  )}
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Bulk Send — sends N prompts for the current query in one click. */}
          <div id="extension-bulk-send" className="flex flex-col gap-1.5 border-t pt-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold tracking-wider uppercase text-muted-foreground/80 flex items-center gap-1 select-none">
                <Zap size={10} /> Bulk Send
              </span>
              <div className="bg-muted/50 p-0.5 rounded-md flex gap-0.5" role="radiogroup" aria-label="Bulk send mode">
                {(["real", "synthetic"] as const).map((mode) => (
                  <Button
                    key={mode}
                    type="button"
                    variant="ghost"
                    size="sm"
                    role="radio"
                    aria-checked={bulkSendMode === mode}
                    disabled={bulkSend.isRunning}
                    onClick={() => setBulkSendMode(mode)}
                    title={mode === "real" ? "One prompt per real post" : "Pack-style variations seeded from a few posts"}
                    className={cn(
                      "h-5 px-1.5 text-[10px] rounded-sm",
                      bulkSendMode === mode
                        ? "bg-background shadow-sm text-foreground font-semibold hover:bg-background"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {mode === "real" ? "Real posts" : "Synthetic"}
                  </Button>
                ))}
              </div>
            </div>

            {bulkSend.isRunning ? (
              <div className="flex items-center gap-2 h-7 px-1" role="status">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary-text shrink-0" />
                <span className="text-[11px] text-muted-foreground truncate">{bulkSend.progressLabel}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                {[20, 40, 50].map((count) => (
                  <Button
                    key={count}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!hasQuery}
                    onClick={() => setBulkSendConfirmCount(count)}
                    className="h-7 flex-1 text-xs font-semibold shadow-sm tabular-nums"
                    title={hasQuery
                      ? `Send ${count} prompts (${bulkSendMode === "real" ? "real posts" : "synthetic"}) for "${search.searchTags}"`
                      : "Type a search query first"}
                  >
                    {count}
                  </Button>
                ))}
              </div>
            )}
            <p className="text-[10px] text-muted-foreground/70 truncate px-0.5" title={search.searchTags}>
              {hasQuery ? <>from &ldquo;{search.searchTags}&rdquo;</> : "Search something to enable Bulk Send"}
            </p>
          </div>
        </Card>

        {/* Bulk Send confirmation */}
        <AlertDialog open={bulkSendConfirmCount !== null} onOpenChange={(open) => { if (!open) setBulkSendConfirmCount(null) }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Send {bulkSendConfirmCount} prompts?</AlertDialogTitle>
              <AlertDialogDescription>
                This queues {bulkSendConfirmCount} {bulkSendMode === "real" ? "real-post" : "synthetic"} prompts
                from &ldquo;{search.searchTags}&rdquo; to your generator. Fewer may be sent if not enough
                posts/variations are available.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const count = bulkSendConfirmCount
                  setBulkSendConfirmCount(null)
                  if (count !== null) runBulkSend(count)
                }}
              >
                Send
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Results grid */}
        <main ref={mainScrollRef as React.RefObject<HTMLElement>} className="flex-1 overflow-y-auto relative scrollbar-none pb-24 overscroll-contain">
          {search.isLoading ? (
            <div className="flex h-48 w-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary-text" />
            </div>
          ) : search.isEmpty ? (
            <div className="flex flex-col w-full items-center justify-center text-center gap-3 pt-2">
              <NoResultsState className="py-4 px-0" />
              <Button size="sm" variant="outline" onClick={search.clearSearch} className="h-7 text-[11px]">
                Clear search
              </Button>
            </div>
          ) : (
            <>
              <MasonryGrid
                items={filteredPosts}
                forceColumns={gridCols}
                gap={10}
                scale="medium"
                footerHeightOverride={POCKET_FOOTER_HEIGHT}
                scrollContainerRef={mainScrollRef as React.RefObject<HTMLElement>}
                renderItem={renderCard}
              />

              <div className="pt-4 flex items-center justify-center">
                {search.sessionCapReached ? (
                  <div className="space-y-1 max-w-xs mx-auto text-center">
                    <p className="text-sm text-warning-text">Session limit reached for this search.</p>
                    <p className="text-xs text-muted-foreground">Try a new search, provider, or filter to keep browsing.</p>
                  </div>
                ) : search.scrollLimited ? (
                  <div className="flex flex-col items-center gap-3 w-full max-w-xs mx-auto">
                    <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                      <div className="w-1/4 h-full bg-warning rounded-full animate-indeterminate-bar [content-visibility:auto]" />
                    </div>
                    <p className="text-sm text-warning-text">Scrolling too fast — pausing for 5s.</p>
                  </div>
                ) : (
                  <InfiniteScrollTrigger
                    onIntersect={search.loadMore}
                    hasNextPage={!search.noMoreResults}
                    isLoading={search.isLoadingMore}
                    error={search.loadMoreError}
                    loadedCount={search.allPosts.length}
                  />
                )}
              </div>
            </>
          )}
        </main>

        <PocketQueueBar targetState={targetState} onTarget={startTargeting} onOpenWizard={() => setWizardOpen(true)} />

        <GlobalWeightsModal
          open={isGlobalWeightsModalOpen}
          onOpenChange={setIsGlobalWeightsModalOpen}
          weights={globalWeights}
          onRemoveWeight={handleRemoveGlobalWeight}
          onClearWeights={handleClearGlobalWeights}
          onSaveWeight={handleGlobalWeightChange}
          isEnabled={isGlobalWeightsEnabled}
        />

        <TargetSetupWizard open={wizardOpen} onOpenChange={setWizardOpen} />
        <ExtensionTour runSignal={tourRunSignal} />
      </div>
    </TooltipProvider>
  )
}
