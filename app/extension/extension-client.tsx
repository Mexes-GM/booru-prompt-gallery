"use client"

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { useBooruSearch } from "@/hooks/use-booru-search"
import { usePersistentState } from "@/hooks/use-persistent-state"
import { usePreferencesSync } from "@/hooks/use-preferences-sync"
import { userPreferences, STORAGE_KEYS } from "@/lib/storage"
import { usePromptOptions } from "@/hooks/use-prompt-options"
import { useBackgroundSettings } from "@/hooks/use-background-settings"
import { useGlobalWeights } from "@/hooks/use-global-weights"
import { usePresetsAndHistory } from "@/hooks/use-presets-and-history"
import { useFilteredPosts } from "@/hooks/use-filtered-posts"
import { SearchWithAutocomplete } from "@/components/prompt-gallery/search-with-autocomplete"
import { TagsManagementPanel } from "@/components/prompt-gallery/tags-management-panel"
import { PromptGenerationOptionsPanel } from "@/components/prompt-gallery/prompt-generation-options-panel"
import { getGelbooruProxyUrl, getDanbooruCdnUrl } from "@/lib/proxy-url"
import type { BackgroundMode } from "@/lib/background-detector"
import { useCardPrompt, type UseCardPromptOptions } from "@/hooks/use-card-prompt"
import { BooruPost, BooruProvider } from "@/lib/api-client"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { ClientFormattedDate } from "@/components/ui/client-formatted-date"
import { Button } from "@/components/ui/button"
import { InfiniteScrollTrigger } from "@/components/ui/infinite-scroll-trigger"
import { MasonryGrid } from "@/components/masonry-grid"
import {
  Loader2,
  Settings,
  RefreshCw,
  Copy,
  Send,
  Check,
  Sliders,
  Shield,
  Search,
  X,
  Users,
  Tag,
  Shuffle,
  History,
  Trash2,
  Smile,
  User,
  Shirt,
  Mountain,
  ImageOff,
  HelpCircle,
  Crosshair,
  MousePointerClick,
  Sparkles,
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { useTagCounts } from "@/hooks/use-tag-counts"
import { InteractivePrompt } from "@/components/prompt-gallery/interactive-prompt"
import { ExtensionTour } from "@/components/extension-tour"
import { TargetSetupWizard, SiteTargetStatusBadge } from "@/components/prompt-gallery/target-setup-wizard"

import { Switch } from "@/components/ui/switch"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { GlobalWeightsModal } from "@/components/prompt-gallery/global-weights-modal"
import { BlacklistManager } from "@/components/prompt-gallery/blacklist-manager"
import { useBlacklist } from "@/hooks/use-blacklist"
import { useToast } from "@/hooks/use-toast"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ThemeProvider } from "@/components/theme-provider"
import { useTheme } from "next-themes"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { NoResultsState } from "@/components/prompt-gallery/no-results-state"

// The sidepanel host is a chrome-extension page, whose origin is dynamic
// (chrome-extension://<id>). We therefore post to the parent with "*" and rely
// on the parent verifying our origin. Messages received from the parent are
// trusted when they originate from window.parent AND from a chrome-extension://
// origin (the sidepanel) or one of the known web hosts.
const TARGET_ORIGIN = "*"
// Origins allowed to send messages into this iframe (web hosts; the extension
// sidepanel's chrome-extension:// origin is accepted dynamically below).
const ALLOWED_ORIGINS = ["https://tensor.art", "https://seaart.ai"]

/** True when a message genuinely comes from our embedding parent (the sidepanel). */
function isTrustedParentMessage(event: MessageEvent): boolean {
  if (event.source !== window.parent) return false
  if (typeof event.origin !== "string") return false
  return event.origin.startsWith("chrome-extension://") || ALLOWED_ORIGINS.includes(event.origin)
}

/**
 * Broadcasts the app's resolved theme ("dark" | "light") to the native sidepanel
 * wrapper so its chrome (body background + dev config bar) matches the app — even
 * when the user overrides the OS preference via the in-app ThemeToggle. Must be
 * rendered INSIDE <ThemeProvider> so next-themes context is available.
 */
function ThemeSync() {
  const { resolvedTheme } = useTheme()
  useEffect(() => {
    if (resolvedTheme !== "dark" && resolvedTheme !== "light") return
    try {
      window.parent?.postMessage({ type: "THEME_CHANGE", theme: resolvedTheme }, TARGET_ORIGIN)
    } catch {
      /* not embedded / parent unavailable */
    }
  }, [resolvedTheme])
  return null
}

interface QueueStatus {
  length: number
  isProcessing: boolean
  isWaitingForSlot: boolean
  isPausedForVisibility: boolean
  isPausedForError: boolean
  activeTasks: number
  limit: number
  platform: string
}

// Styled PocketCard that mirrors the original MasonryItem's layout and style in miniature.
// Prompt derivation goes through the shared useCardPrompt hook (same pipeline as
// MasonryItem in the main web app) instead of a bespoke single-pass cleaner, so
// both shells always produce an identical prompt for the same post + settings.
function PocketCard({
  post,
  promptOptions,
  isAibooru,
  booruProvider,
  width,
  height,
  scale = "medium",
  tagCounts,
  globalWeights,
  onSearch,
  onUsedPrompt,
  queueLength,
  isGlobalWeightsEnabled,
  onGlobalWeightChange,
  isPreviouslyCopied,
  hasTarget,
  onNoTarget,
}: {
  post: BooruPost
  promptOptions: UseCardPromptOptions
  isAibooru: boolean
  booruProvider: string
  width: number
  height: number
  scale?: "small" | "medium" | "large"
  tagCounts: Record<string, number>
  globalWeights: Record<string, number>
  onSearch: (tag: string) => void
  onUsedPrompt: (prompt: string, postId: number, url?: string) => void
  queueLength: number
  isGlobalWeightsEnabled: boolean
  onGlobalWeightChange?: (tag: string, weight: number) => void
  isPreviouslyCopied?: boolean
  hasTarget?: boolean
  onNoTarget?: () => void
}) {
  const [copied, setCopied] = useState(false)
  /** 'idle' | 'queued' (amber, waiting for TensorArt) | 'sent' (green, injected) */
  const [sendState, setSendState] = useState<"idle" | "queued" | "sent">("idle")
  const [useFallbackUrl, setUseFallbackUrl] = useState(false)
  const [modifiedContent, setModifiedContent] = useState<string | null>(null)

  const {
    displayContent,
    classifiedTags: cardClassifiedTags,
    totalTagsCount: cardTotalTagsCount,
    tagCountIndicator: cardTagCountIndicator,
  } = useCardPrompt({
    post,
    tagCounts,
    ...promptOptions,
    globalWeights,
    isGlobalWeightsEnabled,
    onBaseContentChange: () => setModifiedContent(null),
  })

  const cleanedPrompt = displayContent

  const displayPrompt = modifiedContent ?? cleanedPrompt

  // footerHeight must match card-content-* CSS classes including padding.
  // card-content-medium: p-3 (12px top+bottom = 24px) + space-y-2 (8px gap) +
  // prompt-container max-h-20 (80px) + button h-8 (32px) = ~152px
  const footerHeight = scale === "small" ? 120 : scale === "large" ? 184 : 152
  const imageHeight = Math.max(80, height - footerHeight)

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(displayPrompt)
      setCopied(true)
      onUsedPrompt(displayPrompt, post.id, post.preview_file_url || post.file_url)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error(err)
    }
  }

  const handleSend = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(displayPrompt)
    } catch (err) {
      console.warn("Clipboard copy in iframe failed:", err)
    }
    // Enqueue in sidepanel.js — sidepanel will process it when TensorArt is free
    window.parent.postMessage({ type: "INJECT_PROMPT", prompt: displayPrompt }, TARGET_ORIGIN)
    // If the user hasn't picked a destination field yet, the prompt will sit in
    // the queue with nowhere to go — guide them to set a target first.
    if (!hasTarget) {
      onNoTarget?.()
    }
    // Show 'queued' (amber) immediately; it will clear after 4 s or when queue empties
    setSendState("queued")
    onUsedPrompt(displayPrompt, post.id, post.preview_file_url || post.file_url)
    // After a brief moment, revert to idle so the card is re-sendable
    setTimeout(() => setSendState("idle"), 4000)
  }

  const itemProvider = post._provider || booruProvider
  const isGelbooru = itemProvider === "gelbooru"
  const isDanbooru = itemProvider === "danbooru"

  // Gelbooru: preview_file_url is always used for thumbnails.
  // Others: fallback chain.
  const rawFileUrl = isGelbooru
    ? (post.preview_file_url || post.file_url)
    : (post.preview_file_url || post.file_url || post.large_file_url)

  const isDanbooruImg = rawFileUrl && (rawFileUrl.includes("donmai.us") || rawFileUrl.includes("cdn.donmai.us"))

  // For Gelbooru/Rule34, route through referrer-injecting worker proxy.
  const fileUrl = (isGelbooru || itemProvider === "rule34") && rawFileUrl
    ? getGelbooruProxyUrl(rawFileUrl)
    : (getDanbooruCdnUrl(rawFileUrl || '') ?? rawFileUrl)

  // For Danbooru, use proxy fallback if direct loading fails.
  const proxyFileUrl = isDanbooruImg
    ? `/api/download?url=${encodeURIComponent(rawFileUrl)}&inline=1`
    : undefined

  const displayImageUrl = (useFallbackUrl && proxyFileUrl) ? proxyFileUrl : (fileUrl || "")

  const handleImageError = () => {
    if (isDanbooruImg && !useFallbackUrl) {
      setUseFallbackUrl(true)
    }
  }

  // Tag counts, classification and character tags now come straight from
  // useCardPrompt (same derivation as MasonryItem) instead of a second,
  // pocket-only implementation that could drift from the main pipeline.
  const totalTagsCount = cardTotalTagsCount
  const tagCountIndicator = cardTagCountIndicator
  const classifiedTags = cardClassifiedTags

  return (
    <Card className="w-full h-full overflow-hidden card-hover group flex flex-col relative transition-all duration-300">
      {/* 1. Image viewport matching original layout */}
      <div className="relative bg-muted overflow-hidden cursor-pointer" style={{ height: imageHeight }}>
        {isPreviouslyCopied && (
            <div className="absolute top-2 left-2 z-20 pointer-events-none" aria-label="Previously copied">
                <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                    className="flex items-center justify-center h-6 w-6 rounded-full bg-background/80 backdrop-blur-md border border-accent/50 shadow-sm"
                >
                    <motion.div
                       animate={{ scale: [1, 1.2, 1] }}
                       transition={{ duration: 2, repeat: Infinity, repeatType: "reverse" }}
                    >
                        <Check className="w-3.5 h-3.5 text-accent" strokeWidth={3} />
                    </motion.div>
                </motion.div>
            </div>
        )}
        {!displayImageUrl ? (
          <div className="absolute inset-0 flex items-center justify-center bg-muted">
            <ImageOff className="w-8 h-8 text-muted-foreground/50" />
          </div>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={displayImageUrl}
              alt={`Booru post ${post.id}`}
              className="absolute inset-0 w-full h-full object-cover object-top transition-transform duration-300 group-hover:scale-105"
              loading="lazy"
              referrerPolicy={isAibooru ? undefined : "no-referrer"}
              onError={handleImageError}
            />
          </>
        )}

        {/* Character Tag Count Indicator */}
        {tagCountIndicator && (
          <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded-md bg-black/60 text-white/90 text-xs font-medium tracking-wide flex items-center gap-1 backdrop-blur-sm shadow-sm z-10 select-none">
            <Users className="w-3.5 h-3.5 opacity-70" />
            {tagCountIndicator}
          </div>
        )}

        <div className="absolute bottom-2 right-2 flex flex-col items-end gap-1 z-10">
          <div className="flex flex-col items-end gap-1">
            {classifiedTags.appearance.length > 0 && (
                <div className="px-1 py-0.5 rounded-md bg-black/60 text-blue-300 text-[10px] font-medium flex items-center gap-0.5 backdrop-blur-sm shadow-sm select-none">
                    <Smile className="w-2.5 h-2.5 opacity-70" />
                    {classifiedTags.appearance.length}
                </div>
            )}
            {classifiedTags.clothing.length > 0 && (
                <div className="px-1 py-0.5 rounded-md bg-black/60 text-green-300 text-[10px] font-medium flex items-center gap-0.5 backdrop-blur-sm shadow-sm select-none">
                    <Shirt className="w-2.5 h-2.5 opacity-70" />
                    {classifiedTags.clothing.length}
                </div>
            )}
            {classifiedTags.pose.length > 0 && (
                <div className="px-1 py-0.5 rounded-md bg-black/60 text-purple-300 text-[10px] font-medium flex items-center gap-0.5 backdrop-blur-sm shadow-sm select-none">
                    <User className="w-2.5 h-2.5 opacity-70" />
                    {classifiedTags.pose.length}
                </div>
            )}
            {classifiedTags.scenery.length > 0 && (
                <div className="px-1 py-0.5 rounded-md bg-black/60 text-orange-300 text-[10px] font-medium flex items-center gap-0.5 backdrop-blur-sm shadow-sm select-none">
                    <Mountain className="w-2.5 h-2.5 opacity-70" />
                    {classifiedTags.scenery.length}
                </div>
            )}
          </div>
          {/* Total Tag Count Indicator */}
          {totalTagsCount > 0 && (
            <div className="px-1.5 py-0.5 rounded-md bg-black/60 text-white/90 text-xs font-medium tracking-wide flex items-center gap-1 backdrop-blur-sm shadow-sm select-none">
              <Tag className="w-3.5 h-3.5 opacity-70" />
              {totalTagsCount}
            </div>
          )}
        </div>
      </div>

      {/* 2. Card Content Panel (prompt container) matching original app */}
      <div 
        className="card-content-medium flex flex-col justify-between" 
        style={{ height: footerHeight }}
      >
        <div className="bg-muted/50 rounded-lg overflow-hidden prompt-container">
          <InteractivePrompt
            initialPrompt={cleanedPrompt}
            onUpdate={setModifiedContent}
            globalWeights={globalWeights}
            onSearch={onSearch}
            onPromoteToGlobal={isGlobalWeightsEnabled ? onGlobalWeightChange : undefined}
          />
        </div>

        {/* 3. Action Buttons Group */}
        <div className="flex button-group items-stretch isolate w-full mt-2">
          <Button
            onClick={handleCopy}
            variant="outline"
            className={`flex-none w-9 focus-ring rounded-r-none border-r-0 px-0 h-8 flex items-center justify-center transition-colors ${
              copied
                ? "bg-accent text-accent-foreground border-accent hover:bg-accent/90"
                : isPreviouslyCopied
                ? "bg-muted text-muted-foreground hover:bg-muted/80"
                : ""
            }`}
            title="Copy Prompt"
            disabled={!displayPrompt}
          >
            <Check className={`w-4 h-4 shrink-0 ${copied || isPreviouslyCopied ? "" : "hidden"}`} />
            <Copy className={`w-4 h-4 shrink-0 ${copied || isPreviouslyCopied ? "hidden" : ""}`} />
          </Button>
          <Button
            onClick={handleSend}
            variant="outline"
            className={`pocket-card-send-btn flex-1 focus-ring rounded-l-none text-xs px-2 py-1.5 h-8 font-semibold whitespace-nowrap overflow-hidden transition-colors ${
              sendState === "queued"
                ? "border-amber-500/60 text-amber-500 hover:bg-amber-500/10"
                : sendState === "sent"
                ? "bg-accent text-accent-foreground border-accent hover:bg-accent/90"
                : ""
            }`}
            disabled={!displayPrompt}
          >
            <Check className={`w-3.5 h-3.5 shrink-0 ${sendState === "sent" ? "" : "hidden"}`} />
            <Loader2 className={`w-3.5 h-3.5 shrink-0 animate-spin ${
              sendState === "queued" ? "" : "hidden"
            }`} />
            <Send className={`w-3.5 h-3.5 shrink-0 ${
              sendState === "idle" ? "" : "hidden"
            }`} />
            <span className="ml-1 truncate">
              {sendState === "sent" ? "Sent!" : sendState === "queued" ? "Queued" : "Send"}
            </span>
          </Button>
        </div>
      </div>
    </Card>
  )
}

export default function ExtensionClient() {
  const mainScrollRef = useRef<HTMLElement>(null)
  const search = useBooruSearch()
  usePreferencesSync()
  const [showSettings, setShowSettings] = useState(false)
  const [tourRun, setTourRun] = useState(false)
  const tagCounts = useTagCounts(search.allPosts, search.booruProvider)
  const { toast } = useToast()

  // Queue status received from sidepanel.js via postMessage
  const [queueStatus, setQueueStatus] = useState<QueueStatus>({
    length: 0,
    isProcessing: false,
    isWaitingForSlot: false,
    isPausedForVisibility: false,
    isPausedForError: false,
    activeTasks: 0,
    limit: 5,
    platform: "Unknown"
  })
  const [autoDownload, setAutoDownload] = useState(false)
  
  // Targeting state machine, driven by TARGET_STATUS messages from sidepanel.js
  // "idle" | "arming" | "waiting" | "selected" | "none" | "error" | "cancelled"
  const [targetState, setTargetState] = useState<string>("idle")
  const isTargeting = targetState === "arming" || targetState === "waiting"
  // True once the user has successfully picked a destination field this session.
  // Used to guide first-time users through the Target → Send flow.
  const [hasTargetSet, setHasTargetSet] = useState(false)
  // (Fase 5b) Controls the 3-step site setup wizard dialog.
  const [wizardOpen, setWizardOpen] = useState(false)

  // Responsive column count for the masonry grid, based on the panel width.
  // Chrome side panels are resizable, so we adapt instead of forcing 2 columns.
  const [gridCols, setGridCols] = useState(2)
  useEffect(() => {
    const el = mainScrollRef.current
    if (!el) return
    const compute = () => {
      const w = el.clientWidth
      // Baseline is 2 columns (matches the main web app); only widen to 3 when
      // the panel is clearly large. Never drop to 1 — a single column makes the
      // image fill the card and pushes the prompt/buttons off-screen.
      if (w <= 0) return
      setGridCols(w > 620 ? 3 : 2)
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [search.isClient])

  const guideToTarget = useCallback(() => {
    toast({
      title: "Pick a target field first",
      description: "Click \"Target\", then click the prompt box on your image generator page so prompts know where to go.",
    })
  }, [toast])

  // Listen for targeting status updates from the parent sidepanel.js
  useEffect(() => {
    function handleTargetStatus(event: MessageEvent) {
      if (!isTrustedParentMessage(event)) return
      if (!event.data || event.data.type !== "TARGET_STATUS") return

      const { state, detail } = event.data
      setTargetState(state)
      console.log(`[Target UI] state="${state}"`, detail || "")

      switch (state) {
        case "arming":
          break
        case "waiting":
          toast({
            title: "🎯 Click the prompt field",
            description: `${detail?.candidates ?? 0} field(s) detected on ${detail?.platform ?? "the page"}. Click the one to fill.`,
          })
          break
        case "selected":
          setHasTargetSet(true)
          toast({
            title: "✓ Target set",
            description: detail?.placeholder
              ? `Selected <${(detail.tag || "input").toLowerCase()}> "${detail.placeholder}"`
              : `Selected <${(detail?.tag || "input").toLowerCase()}>. Prompts will be sent here.`,
          })
          // Reset to idle shortly after so the button returns to normal
          setTimeout(() => setTargetState("idle"), 1500)
          break
        case "none":
          toast({
            variant: "destructive",
            title: "No prompt field found",
            description: detail?.message || "Make sure the prompt node is visible on the page, then retry.",
          })
          setTimeout(() => setTargetState("idle"), 2500)
          break
        case "error":
          toast({
            variant: "destructive",
            title: "Targeting failed",
            description: detail?.message || "Could not start targeting. Open the generation page and retry.",
          })
          setTimeout(() => setTargetState("idle"), 2500)
          break
        case "cancelled":
          setTimeout(() => setTargetState("idle"), 500)
          break
        default:
          break
      }
    }
    window.addEventListener("message", handleTargetStatus)
    return () => window.removeEventListener("message", handleTargetStatus)
  }, [toast])

  // Apply extension-mode class to <html> to neutralize the forced html-level
  // overflow-y:scroll from globals.css (which causes a phantom scrollbar in iframe)
  useEffect(() => {
    document.documentElement.classList.add("extension-mode")
    return () => {
      document.documentElement.classList.remove("extension-mode")
    }
  }, [])

  // Listen for queue status updates from the parent sidepanel.js
  useEffect(() => {
    function handleQueueStatus(event: MessageEvent) {
      if (!isTrustedParentMessage(event)) return
      if (event.data && event.data.type === "QUEUE_STATUS") {
        setQueueStatus({
          length: event.data.queueLength ?? 0,
          isProcessing: event.data.isProcessing ?? false,
          isWaitingForSlot: event.data.isWaitingForSlot ?? false,
          isPausedForVisibility: event.data.isPausedForVisibility ?? false,
          isPausedForError: event.data.isPausedForError ?? false,
          activeTasks: event.data.currentActiveTasks ?? 0,
          limit: event.data.seaArtLimit ?? 5,
          platform: event.data.platform ?? "Unknown"
        })
        if (typeof event.data.autoDownloadEnabled === "boolean") {
          setAutoDownload(event.data.autoDownloadEnabled)
        }
      }
    }
    window.addEventListener("message", handleQueueStatus)
    
    // Request initial state in case the iframe reloaded while parent stayed alive
    if (typeof window !== "undefined") {
      window.parent.postMessage({ type: "REQUEST_QUEUE_STATUS" }, TARGET_ORIGIN)
    }
    
    return () => window.removeEventListener("message", handleQueueStatus)
  }, [])

  const { blacklist, addTag, removeTag, resetBlacklist } = useBlacklist()

  // Pocket Settings — same shared hooks the main web app uses, so a feature
  // added to one of these hooks (e.g. a new prompt option or background mode)
  // shows up in the Pocket automatically instead of needing a hand-written copy.
  const [addInput, setAddInput] = usePersistentState(
    "",
    userPreferences.getAddTagsInput,
    userPreferences.setAddTagsInput,
    "addTags",
    STORAGE_KEYS.ADD_TAGS
  )

  const [excludeInput, setExcludeInput] = usePersistentState(
    "",
    userPreferences.getExcludeTagsInput,
    userPreferences.setExcludeTagsInput,
    "excludeTags",
    STORAGE_KEYS.EXCLUDE_TAGS
  )

  const [findInput, setFindInput] = usePersistentState(
    "",
    userPreferences.getFindReplaceFindInput,
    userPreferences.setFindReplaceFindInput,
    "findReplaceFind",
    STORAGE_KEYS.FIND_REPLACE_FIND
  )

  const [replaceInput, setReplaceInput] = usePersistentState(
    "",
    userPreferences.getFindReplaceReplaceInput,
    userPreferences.setFindReplaceReplaceInput,
    "findReplaceReplace",
    STORAGE_KEYS.FIND_REPLACE_REPLACE
  )

  const {
    includeCharacters, optimizeTags, smartTagExclusion,
    setIncludeCharacters, setOptimizeTags, setSmartTagExclusion,
  } = usePromptOptions()

  const {
    backgroundMode, setBackgroundMode,
    detailedBackgroundsList,
    simpleBackgroundReplacementTags, setSimpleBackgroundReplacementTags,
    randomBackgroundPatterns, setRandomBackgroundPatterns,
    randomBackgroundIncludeGradients, setRandomBackgroundIncludeGradients,
  } = useBackgroundSettings()

  const {
    globalWeights, setGlobalWeights,
    isGlobalWeightsEnabled, setIsGlobalWeightsEnabled,
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

  const handleUsedPrompt = useCallback((promptText: string, postId: number, thumbnailUrl?: string) => {
    if (postId) {
      addToHistory({ postId, provider: search.booruProvider })
    }
  }, [addToHistory, search.booruProvider])

  // Autocomplete placeholders
  const placeholders = useMemo(() => [
    "Search tags (e.g. cat girl)...",
    "frieren, solo",
    "swimsuit, wet hair",
  ], [])

  // Prompt options bundle passed down to PocketCard, which derives the actual
  // prompt via the shared useCardPrompt hook — the same pipeline MasonryItem
  // uses in the main web app. This replaces the old bespoke, single-pass
  // getCleanedPrompt() that had drifted from useCardPrompt's two-pass pipeline
  // (added tags used to be concatenated outside cleanPrompt instead of going
  // through it, which skipped normalization/dedup against the rest of the tags).
  const cardPromptOptions: UseCardPromptOptions = useMemo(() => ({
    excludeInput,
    addInput,
    findInput,
    replaceInput,
    includeCharacters,
    optimizeTags,
    smartTagExclusion,
    removeLoRaTags: search.removeLoRaTags,
    removeQualityTags: search.removeQualityTags,
    backgroundMode,
    simpleBackgroundReplacementTags,
    randomBackgroundPatterns,
    randomBackgroundIncludeGradients,
    detailedBackgroundsList,
  }), [
    excludeInput,
    addInput,
    findInput,
    replaceInput,
    includeCharacters,
    optimizeTags,
    smartTagExclusion,
    search.removeLoRaTags,
    search.removeQualityTags,
    backgroundMode,
    simpleBackgroundReplacementTags,
    randomBackgroundPatterns,
    randomBackgroundIncludeGradients,
    detailedBackgroundsList,
  ])

  // Filter posts: shared with the web app via useFilteredPosts (blacklist +
  // character-count filter; the Pocket has no favorites, so that part is
  // simply omitted). isClient guard preserved: return [] until hydrated.
  const filteredPosts = useFilteredPosts({
    allPosts: search.isClient ? search.allPosts : [],
    booruProvider: search.booruProvider,
    blacklist,
    includeCharacters,
    appliedCharacterCountFilter: search.appliedCharacterCountFilter,
    tagCounts,
  })

  const isRule34 = search.booruProvider === "rule34"
  const isTagCountSupported = search.booruProvider === 'danbooru' || search.booruProvider === 'gelbooru' || search.booruProvider === 'rule34'
  const isTagCountValid = !!search.tagCountFilter && /^\d+$/.test(search.tagCountFilter)

  if (!search.isClient) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background text-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
    <ThemeSync />
    <TooltipProvider>
      <div className="h-screen bg-background text-foreground flex flex-col p-3 gap-3 overflow-hidden">
      {/* Pocket Header - Replicates Main App Header Style */}
      <header className="w-full shrink-0 border-b glass-effect py-2.5 px-3 flex items-center justify-between rounded-lg">
        <div className="flex items-center space-x-2">
          <h1 className="text-sm font-bold text-foreground leading-none">
            Booru Prompt Gallery
          </h1>
          <div className="flex items-center gap-1.5">
            <Badge variant="secondary" className="text-[10px] font-medium bg-muted text-muted-foreground border-0 px-1 py-0 h-fit select-none">
              By Mexes
            </Badge>
            <Badge variant="outline" className="text-[10px] font-bold bg-primary/10 text-primary border-primary/20 px-1 py-0.5 h-fit select-none font-mono">
              Pocket
            </Badge>
          </div>
        </div>
        <div className="flex items-center shrink-0">
          <ThemeToggle />
        </div>
      </header>

      {/* Main control card with glass-effect */}
      <Card className="relative z-20 glass-effect shadow-md rounded-xl p-3 border-none flex flex-col gap-3 shrink-0">
        {/* Provider Selector tab bar, copied from original UI */}
        <div className="flex flex-col gap-1 w-full">
          <span className="text-[10px] font-bold text-muted-foreground/85 ml-1 uppercase tracking-wider select-none">
            API Provider
          </span>
          <div
            className="bg-muted/50 p-0.5 rounded-lg flex gap-0.5 w-full overflow-x-auto scrollbar-none"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            {(["danbooru", "gelbooru", "aibooru", "rule34", "e621"] as const).map((p) => (
              <Button
                key={p}
                type="button"
                variant="ghost"
                onClick={() => {
                  search.setBooruProvider(p)
                }}
                className={`relative h-6 text-[10px] px-1.5 min-w-0 shrink-0 whitespace-nowrap rounded-md ${
                  search.booruProvider === p
                    ? "text-foreground font-semibold hover:bg-transparent"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {search.booruProvider === p && (
                  <motion.div
                    layoutId="activeProvider"
                    className="absolute inset-0 bg-background shadow-sm rounded-md"
                    transition={{ type: "spring", bounce: 0.15, duration: 0.5 }}
                  />
                )}
                <span className="relative z-10">
                  {p === "aibooru"
                    ? "Aibooru"
                    : p === "danbooru"
                    ? "Danbooru"
                    : p === "rule34"
                    ? "Rule34"
                    : p === "gelbooru"
                    ? "Gelbooru"
                    : "e621"}
                </span>
              </Button>
            ))}
          </div>
        </div>

        {/* Search Input, Blacklist, NSFW and buttons */}
        <div className="flex flex-col gap-2 w-full">
          <div className="flex w-full items-center">
            <div className="relative flex-1 group">
              <div className="absolute left-2.5 top-1/2 -translate-y-1/2 flex items-center justify-center w-4 h-4 text-muted-foreground pointer-events-none z-20">
                <Search className="h-3.5 w-3.5" />
              </div>
              <SearchWithAutocomplete
                value={search.searchTags}
                setValue={search.setSearchTags}
                onSearch={() => search.handleSearch({} as React.FormEvent)}
                placeholders={placeholders}
                className="pl-7 pr-7 h-8 text-[11px] shadow-none border border-input rounded-r-none border-r-0 z-10 relative bg-background focus-within:ring-1 focus-within:ring-ring"
              />
              {search.searchTags && (
                <button
                  type="button"
                  onClick={search.clearSearch}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-0.5 z-20"
                  aria-label="Clear search"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
            
            {/* Blacklist Manager */}
            {search.isClient && (
              <BlacklistManager
                blacklist={blacklist}
                onAdd={addTag}
                onRemove={removeTag}
                onReset={resetBlacklist}
                className="h-8 text-[11px] px-2"
              />
            )}

            {/* NSFW Toggle */}
            <Button
              type="button"
              disabled={isRule34}
              variant="outline"
              onClick={() => {
                const newRating = search.ratingFilter === "rating:general" ? "all" : "rating:general"
                search.setRatingFilter(newRating)
              }}
              className={`h-8 px-2 rounded-l-none border-l-0 border border-input shadow-sm transition-all z-0 text-[11px] font-semibold flex items-center gap-1 select-none ${
                isRule34
                  ? "opacity-50 cursor-not-allowed bg-muted"
                  : search.ratingFilter === "rating:general"
                  ? "bg-green-50 text-green-700 hover:bg-green-100 hover:text-green-800 border-green-200/50 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30 dark:border-green-800/50"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              title={isRule34 ? "NSFW is always enabled for Rule34" : "Toggle NSFW content"}
            >
              <Shield className="w-3 h-3" />
              <span>{search.ratingFilter === "rating:general" ? "Safe" : "NSFW"}</span>
            </Button>
          </div>

          {/* Action Row: Shuffle, Refresh, History, Settings */}
          <div className="flex items-center gap-1.5 w-full justify-between mt-0.5">
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant={search.isShuffle ? "default" : "outline"}
                onClick={search.toggleShuffle}
                className="h-8 w-8 p-0 shadow-sm"
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
                title="Refresh results"
                aria-label="Refresh results"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${search.isValidating ? "animate-spin text-primary" : ""}`} />
              </Button>
              <Sheet>
                <SheetTrigger asChild>
                  <Button type="button" variant="outline" className="h-8 w-8 p-0 shadow-sm" title="History" aria-label="Open prompt history">
                    <History className="w-3.5 h-3.5" />
                  </Button>
                </SheetTrigger>
                <SheetContent className="w-full sm:w-[400px]">
                  <SheetHeader>
                    <SheetTitle className="text-sm font-bold">Prompt History</SheetTitle>
                    <SheetDescription className="text-xs">Recently copied or sent prompts.</SheetDescription>
                  </SheetHeader>
                  <div className="mt-4 overflow-y-auto max-h-[calc(100vh-120px)] pr-1 space-y-3">
                    {history.length === 0 ? (
                      <p className="text-center text-xs text-muted-foreground py-8">History is empty</p>
                    ) : (
                      <>
                        {history.map((item) => (
                          <div key={item.id} className="border rounded-lg p-2.5 space-y-2 relative group bg-card">
                            <div className="flex gap-2">
                              {item.thumbnailUrl && (
                                <div className="relative w-12 h-12 flex-shrink-0 rounded overflow-hidden bg-muted">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={item.thumbnailUrl}
                                    alt="Thumbnail"
                                    className="object-cover w-full h-full"
                                  />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-[10px] text-muted-foreground mb-1">
                                  <ClientFormattedDate timestamp={item.timestamp} />
                                </p>
                                <p className="text-xs line-clamp-3 break-words font-mono bg-muted/50 p-1 rounded">
                                  {item.content ?? `Post #${item.postId} (${item.provider})`}
                                </p>
                              </div>
                            </div>
                            <div className="flex justify-end gap-1.5 mt-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => removeHistoryItem(item.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-7 text-xs px-2"
                                onClick={() => {
                                  navigator.clipboard.writeText(item.content ?? "")
                                  toast({ title: "Copied", description: "Prompt copied to clipboard." })
                                }}
                              >
                                <Copy className="h-3 w-3 mr-1" /> Copy
                              </Button>
                              <Button
                                size="sm"
                                variant="default"
                                className="h-7 text-xs px-2"
                                onClick={() => {
                                  window.parent.postMessage({ type: "INJECT_PROMPT", prompt: item.content ?? "" }, TARGET_ORIGIN)
                                  toast({ title: "Sent", description: "Prompt injected into generator." })
                                }}
                              >
                                <Send className="h-3 w-3 mr-1" /> Send
                              </Button>
                            </div>
                          </div>
                        ))}
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full text-xs text-destructive hover:text-destructive hover:bg-destructive/10 h-8"
                          onClick={clearHistory}
                        >
                          Clear History
                        </Button>
                      </>
                    )}
                  </div>
                </SheetContent>
              </Sheet>
            </div>
            
            <div className="flex items-center gap-1.5">
              <Button
                id="extension-settings-btn"
                type="button"
                variant="outline"
                onClick={() => setShowSettings(!showSettings)}
                className={`h-8 px-2.5 gap-1.5 shadow-sm text-xs font-semibold ${
                  showSettings ? "bg-primary/10 text-primary border-primary/30" : "text-muted-foreground hover:text-foreground hover:bg-muted bg-background"
                }`}
                title="Quick settings"
              >
                <Settings size={14} className={showSettings ? "text-primary animate-pulse" : ""} />
                <span>Settings</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setTourRun(true)}
                className="h-8 w-8 p-0 shadow-sm text-muted-foreground hover:text-foreground hover:bg-muted bg-background"
                title="Show guided tour"
                aria-label="Show guided tour"
              >
                <HelpCircle size={14} />
              </Button>
            </div>
          </div>
        </div>

        {/* Collapsible Settings Panel */}
        <Collapsible open={showSettings} onOpenChange={setShowSettings}>
          <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
            <div className="p-3 bg-muted/20 border border-border/50 rounded-lg flex flex-col gap-3.5 max-h-[45vh] overflow-y-auto scrollbar-none">
              <h2 className="text-[10px] font-bold tracking-wider uppercase text-muted-foreground/80 flex items-center gap-1 select-none">
                <Sliders size={10} /> Prompt Settings
              </h2>

              {/* Same panel the main web app uses (compact variant): Tags to
                  Add/Exclude + presets + minimum tag/character sliders. Any
                  control added here shows up in the Pocket automatically. */}
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

              {/* Same panel the main web app uses (compact variant): prompt
                  option switches + background handling. */}
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
              />

              {/* Auto-Downloading */}
              <div className="flex flex-col gap-1 border-t pt-2">
                <div className="flex items-center justify-between p-1 rounded-md hover:bg-muted/30 transition-colors">
                  <div className="flex flex-col gap-0.5 flex-1">
                    <Label htmlFor="auto-download" className="text-xs select-none cursor-pointer">Auto-Downloading</Label>
                    <span className="text-[10px] text-muted-foreground leading-none">
                      {queueStatus.platform === "SeaArt"
                        ? "Download images with metadata when generation completes"
                        : "Only available on SeaArt"}
                    </span>
                  </div>
                  <Switch
                    id="auto-download"
                    checked={autoDownload}
                    disabled={queueStatus.platform !== "SeaArt" && queueStatus.platform !== "Unknown"}
                    onCheckedChange={(val) => {
                      setAutoDownload(val)
                      window.parent.postMessage({ type: "QUEUE_ACTION", action: "set_auto_download", value: val }, TARGET_ORIGIN)
                    }}
                    className="scale-75 origin-right"
                  />
                </div>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Results Grid - Uses actual virtualized MasonryGrid */}
      <main ref={mainScrollRef as React.RefObject<HTMLElement>} className="flex-1 overflow-y-auto relative scrollbar-none pb-20">
        {search.isLoading ? (
          <div className="flex h-48 w-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : search.isEmpty ? (
          <div className="flex flex-col w-full items-center justify-center text-center gap-3 pt-2">
            <NoResultsState className="py-4 px-0" />
            <Button size="sm" variant="outline" onClick={search.clearSearch} className="h-7 text-[10px]">
              Clear search
            </Button>
          </div>
        ) : (
          <>
            <MasonryGrid
              items={filteredPosts}
              forceColumns={gridCols}
              gap={12}
              scale="medium" // Corresponds to footerHeight = 152px
              footerHeightOverride={152}
              scrollContainerRef={mainScrollRef as React.RefObject<HTMLElement>}
              renderItem={(post, width, height, index) => (
                <PocketCard
                  key={post.id}
                  post={post}
                  promptOptions={cardPromptOptions}
                  isAibooru={post._provider === "aibooru" || search.booruProvider === "aibooru"}
                  booruProvider={search.booruProvider}
                  width={width}
                  height={height}
                  scale="medium"
                  tagCounts={tagCounts}
                  globalWeights={isGlobalWeightsEnabled ? globalWeights : {}}
                  onSearch={search.setSearchTags}
                  onUsedPrompt={handleUsedPrompt}
                  queueLength={queueStatus.length}
                  isGlobalWeightsEnabled={isGlobalWeightsEnabled}
                  onGlobalWeightChange={handleGlobalWeightChange}
                  isPreviouslyCopied={previouslyCopiedPostIds.has(post.id)}
                  hasTarget={hasTargetSet}
                  onNoTarget={guideToTarget}
                />
              )}
            />

            {/* Infinite Scroll Trigger */}
            <div className="pt-4 flex items-center justify-center">
              {search.sessionCapReached ? (
                <div className="space-y-1 max-w-xs mx-auto text-center">
                  <p className="text-sm text-amber-600 dark:text-amber-400">
                    Session limit reached for this search.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Try a new search, provider, or filter to keep browsing.
                  </p>
                </div>
              ) : search.scrollLimited ? (
                <div className="flex flex-col items-center gap-3 w-full max-w-xs mx-auto">
                  <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                    <div className="w-1/4 h-full bg-amber-500 rounded-full animate-indeterminate-bar" />
                  </div>
                  <p className="text-sm text-amber-600 dark:text-amber-400">
                    Scrolling too fast — pausing for 5s.
                  </p>
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

      {/* Floating Queue Badge native to React App */}
      <div className="fixed bottom-6 right-1/2 translate-x-1/2 flex flex-col items-center gap-1.5 z-50 pointer-events-none w-max max-w-[95vw]">
        {/* Target Info Pill + per-site config status */}
        <div className="flex items-center gap-1.5 pointer-events-auto">
          <AnimatePresence>
            {queueStatus.platform !== "Unknown" && (
              <motion.div 
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 5 }}
                className="bg-secondary/90 border border-border backdrop-blur-md px-3 py-1 rounded-full text-[11px] font-medium text-secondary-foreground shadow-sm"
              >
                Target: <span className="font-semibold ml-1">{queueStatus.platform}</span>
              </motion.div>
            )}
          </AnimatePresence>
          <SiteTargetStatusBadge onOpenWizard={() => setWizardOpen(true)} />
        </div>
        
        {/* Main Queue Bar */}
        <Card className="flex items-center justify-center gap-2.5 px-3.5 py-1.5 rounded-full text-xs shadow-lg pointer-events-auto whitespace-nowrap bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-border">
          {/* Status Indicator */}
          <div className="flex items-center gap-1.5" title="Queue Status">
            <span className={`w-2 h-2 rounded-full shrink-0 ${
              queueStatus.isPausedForError ? "bg-red-500 animate-pulse" :
              queueStatus.isPausedForVisibility ? "bg-red-500 animate-pulse" :
              queueStatus.isWaitingForSlot ? "bg-orange-500 animate-pulse" :
              queueStatus.isProcessing ? "bg-blue-500 animate-pulse" :
              queueStatus.length > 0 ? "bg-amber-500 animate-pulse" : 
              "bg-green-500"
            }`} />
            <span className="text-foreground font-semibold shrink-0">
              {queueStatus.isPausedForError ? "Error: Paused" :
               queueStatus.isPausedForVisibility ? "Paused (Tab hidden)" :
               queueStatus.isWaitingForSlot ? `Waiting (${queueStatus.limit ? `${queueStatus.activeTasks}/${queueStatus.limit}` : `${queueStatus.activeTasks} active`})` :
               queueStatus.isProcessing ? "Generating..." :
               queueStatus.length > 0 ? "Queued" : 
               "Ready"}
            </span>
          </div>

          {/* Queue Count Badge */}
          {queueStatus.length > 0 && (
            <Badge variant="default" className="px-1.5 py-[1px] h-5 rounded-full text-[10px] font-semibold shrink-0">
              {queueStatus.length} queued
            </Badge>
          )}

          {/* Actions */}
          <div className="flex items-center gap-1.5 ml-1">
            <Button
              id="extension-target-btn"
              variant="outline" 
              size="sm"
              title="Select target textarea on page"
              aria-label="Select the target prompt field on the generator page"
              onClick={() => {
                setTargetState("arming")
                window.parent.postMessage({ type: "QUEUE_ACTION", action: "target" }, TARGET_ORIGIN)
              }}
              className={`h-6 px-2.5 rounded-full text-[11px] gap-1 transition-all duration-300 ${
                isTargeting 
                  ? "bg-blue-500/20 text-blue-400 border-blue-500/50 animate-pulse pointer-events-none"
                  : targetState === "selected"
                  ? "bg-green-500/20 text-green-500 border-green-500/50"
                  : "bg-transparent hover:bg-green-500/10 hover:text-green-600 hover:border-green-500/50"
              }`}
            >
              {targetState === "arming" ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" /> Detecting...
                </>
              ) : targetState === "waiting" ? (
                <>
                  <MousePointerClick className="w-3 h-3 animate-nudge" /> Click field...
                </>
              ) : targetState === "selected" ? (
                <>
                  <Check className="w-3 h-3" /> Target set
                </>
              ) : (
                <>
                  <Crosshair className="w-3 h-3" /> Target
                </>
              )}
            </Button>

            <Button
              variant="outline"
              size="sm"
              title="Full setup: prompt, generate button, and queue"
              aria-label="Open the site setup wizard"
              onClick={() => setWizardOpen(true)}
              className="h-6 w-6 p-0 rounded-full text-[11px] bg-transparent hover:bg-primary/10 hover:text-primary hover:border-primary/50"
            >
              <Sparkles className="w-3 h-3" />
            </Button>
            
            {queueStatus.length > 0 && (
              <Button 
                variant="outline" 
                size="sm"
                title="Clear prompt queue"
                aria-label="Clear the prompt queue"
                onClick={() => window.parent.postMessage({ type: "QUEUE_ACTION", action: "clear" }, TARGET_ORIGIN)}
                className="h-6 px-2.5 rounded-full text-[11px] gap-1 bg-transparent hover:bg-destructive/10 hover:text-destructive hover:border-destructive/50"
              >
                <X className="w-3 h-3" /> Clear
              </Button>
            )}
          </div>
        </Card>
      </div>

      <GlobalWeightsModal
        open={isGlobalWeightsModalOpen}
        onOpenChange={setIsGlobalWeightsModalOpen}
        weights={globalWeights}
        onRemoveWeight={handleRemoveGlobalWeight}
        onClearWeights={handleClearGlobalWeights}
        onSaveWeight={handleGlobalWeightChange}
      />

      <TargetSetupWizard open={wizardOpen} onOpenChange={setWizardOpen} />
      <ExtensionTour externalRun={tourRun} />
    </div>
    </TooltipProvider>
    </ThemeProvider>
  )
}
