"use client"

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { useBooruSearch } from "@/hooks/use-booru-search"
import { usePersistentState } from "@/hooks/use-persistent-state"
import { usePreferencesSync } from "@/hooks/use-preferences-sync"
import { userPreferences, STORAGE_KEYS, type TagPreset, type HistoryItem } from "@/lib/storage"
import { onSettingsChange } from "@/lib/settings-bridge"
import { SearchWithAutocomplete } from "@/components/prompt-gallery/search-with-autocomplete"
import { getGelbooruProxyUrl } from "@/lib/proxy-url"
import { cleanPrompt } from "@/lib/cleanPrompt"
import { processBackgroundTags, BackgroundMode } from "@/lib/background-detector"
import { resolveTagConflicts } from "@/lib/tag-conflicts"
import { classifyTags } from "@/lib/tag-classifier"
import { applyWeights } from "@/lib/weight-utils"
import { removeLoRaTags as removeLoRaTagsUtil, removeQualityTags as removeQualityTagsUtil, BooruPost, BooruProvider } from "@/lib/api-client"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
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
  ChevronDown,
  Sliders,
  Shield,
  Search,
  X,
  Users,
  Tag,
  Shuffle,
  History,
  Trash2,
  Save,
  CornerDownRight,
  Smile,
  User,
  Shirt,
  Mountain,
  ImageOff,
  HelpCircle,
  Crosshair,
  MousePointerClick,
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { useTagCounts } from "@/hooks/use-tag-counts"
import { InteractivePrompt } from "@/components/prompt-gallery/interactive-prompt"
import { ExtensionTour } from "@/components/extension-tour"

import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { DebouncedInput, DebouncedHTMLInput } from "@/components/ui/debounced-input"
import { InfoTooltip } from "@/components/ui/info-tooltip"
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

// Styled PocketCard that mirrors the original MasonryItem's layout and style in miniature
function PocketCard({
  post,
  getCleanedPrompt,
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
  getCleanedPrompt: (post: BooruPost) => string
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

  const cleanedPrompt = useMemo(() => getCleanedPrompt(post), [post, getCleanedPrompt])

  useEffect(() => {
    setModifiedContent(null)
  }, [cleanedPrompt])

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
    : rawFileUrl

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

  // Calculate tag counts
  const characterTagsArray = useMemo(() => (post.tag_string_character ? post.tag_string_character.split(' ') : [])
      .map(t => t.replace(/_/g, ' ').toLowerCase().replace(/\(/g, "\\(").replace(/\)/g, "\\)")), [post.tag_string_character])

  const tagsForClassification = useMemo(() => displayPrompt ? displayPrompt.split(',').map(t => t.trim()) : [], [displayPrompt])

  const totalTagsCount = useMemo(() => tagsForClassification.filter(t => t.length > 0).length, [tagsForClassification])

  const tagCountIndicator = useMemo(() => {
      if (!tagCounts || characterTagsArray.length === 0) return null;
      
      let maxCount = 0;
      
      for (const rawTag of characterTagsArray) {
          const withSpaces = rawTag.replace(/\\/g, ''); // remove escapes
          const withUnderscores = withSpaces.replace(/\s+/g, '_');
          
          const count = tagCounts[withUnderscores] ?? tagCounts[withSpaces] ?? 0;
          if (count > maxCount) maxCount = count;
      }
      
      if (maxCount === 0) return null;
      
      return Intl.NumberFormat('en', { notation: 'compact' }).format(maxCount);
  }, [tagCounts, characterTagsArray]);

  const classifiedTags = useMemo(() => {
    const allTagsForClassification = Array.from(new Set([...characterTagsArray, ...tagsForClassification]))
    return classifyTags(allTagsForClassification, {}, characterTagsArray)
  }, [characterTagsArray, tagsForClassification])

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

interface SmoothFilterSliderProps {
  min: number
  max: number
  step?: number
  value: string
  onChange: (value: string) => void
  onCommit: (value: string) => void
  disabled?: boolean
  labelPrefix: string
  tooltipTitle: string
  tooltipDescription: string
  tooltipVisual?: React.ReactNode
  inputId: string
  isInputValid: boolean
  maxInput?: number
  ariaLabel: string
  dotColor?: string
}

function SmoothFilterSlider({
  min,
  max,
  step = 1,
  value,
  onChange,
  onCommit,
  disabled = false,
  labelPrefix,
  tooltipTitle,
  tooltipDescription,
  tooltipVisual,
  inputId,
  isInputValid,
  maxInput = 1000000,
  ariaLabel,
  dotColor,
}: SmoothFilterSliderProps) {
  const [localValue, setLocalValue] = useState(value)

  useEffect(() => {
    setLocalValue(value)
  }, [value])

  const handleSliderChange = useCallback((val: number[]) => {
    setLocalValue(val[0].toString())
  }, [])

  const handleSliderCommit = useCallback((val: number[]) => {
    const stringVal = val[0].toString()
    onChange(stringVal)
    onCommit(stringVal)
  }, [onChange, onCommit])

  const handleInputChange = useCallback((newVal: string) => {
    setLocalValue(newVal)
    onChange(newVal)
  }, [onChange])

  const handleInputBlur = useCallback(() => {
    onCommit(localValue)
  }, [onCommit, localValue])

  return (
    <div className="space-y-1 mt-2">
      <label htmlFor={inputId} className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
        {dotColor && <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`}></span>}
        <InfoTooltip
          title={tooltipTitle}
          description={tooltipDescription}
          visual={tooltipVisual}
        >
          {labelPrefix} ({`>=`} {localValue})
        </InfoTooltip>
      </label>
      <div className="flex items-center gap-3">
        <Slider
          min={min}
          max={max}
          step={step}
          value={[parseInt(localValue) || min]}
          onValueChange={handleSliderChange}
          onValueCommit={handleSliderCommit}
          disabled={disabled}
          className={`flex-1 ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          aria-label={ariaLabel}
        />
        <DebouncedInput
          id={inputId}
          type="number"
          min={min}
          max={maxInput}
          value={localValue}
          onChange={handleInputChange}
          debounceTime={500}
          onBlur={handleInputBlur}
          disabled={disabled}
          className={`h-7 w-14 text-[10px] text-center bg-background/50 ${!isInputValid ? "border-red-500 focus-visible:ring-red-500" : ""} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          aria-label={`${ariaLabel} input`}
        />
      </div>
    </div>
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

  // Pocket Settings
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

  const [promptOptions, setPromptOptions] = usePersistentState(
    { includeCharacters: true, optimizeTags: true, smartTagExclusion: true },
    userPreferences.getPromptOptions,
    userPreferences.setPromptOptions,
    "promptOptions",
    STORAGE_KEYS.PROMPT_OPTIONS
  )

  const { includeCharacters = true, optimizeTags = true, smartTagExclusion = true } = promptOptions

  const setIncludeCharacters = (val: boolean) =>
    setPromptOptions(prev => ({ ...prev, includeCharacters: val }))

  const setOptimizeTags = (val: boolean) =>
    setPromptOptions(prev => ({ ...prev, optimizeTags: val }))

  const setSmartTagExclusion = (val: boolean) =>
    setPromptOptions(prev => ({ ...prev, smartTagExclusion: val }))

  const [backgroundMode, setBackgroundMode] = usePersistentState<BackgroundMode>(
    "keep",
    userPreferences.getBackgroundMode,
    userPreferences.setBackgroundMode,
    "backgroundMode",
    STORAGE_KEYS.BACKGROUND_MODE
  )

  const [simpleBackgroundReplacementTags, setSimpleBackgroundReplacementTags] = usePersistentState(
    "simple background, white background",
    userPreferences.getSimpleBackgroundReplacementTags,
    userPreferences.setSimpleBackgroundReplacementTags,
    "simpleBackgroundReplacementTags",
    STORAGE_KEYS.SIMPLE_BACKGROUND_REPLACEMENT_TAGS
  )

  const [randomBackgroundPatterns, setRandomBackgroundPatterns] = usePersistentState(
    true,
    userPreferences.getRandomBackgroundPatterns,
    userPreferences.setRandomBackgroundPatterns,
    "randomBackgroundPatterns",
    STORAGE_KEYS.RANDOM_BACKGROUND_PATTERNS
  )

  const [randomBackgroundIncludeGradients, setRandomBackgroundIncludeGradients] = usePersistentState(
    true,
    userPreferences.getRandomBackgroundIncludeGradients,
    userPreferences.setRandomBackgroundIncludeGradients,
    "randomBackgroundIncludeGradients",
    STORAGE_KEYS.RANDOM_BACKGROUND_INCLUDE_GRADIENTS
  )

  const [isGlobalWeightsEnabled, setIsGlobalWeightsEnabled] = usePersistentState(
    false,
    userPreferences.getGlobalWeightsEnabled,
    userPreferences.setGlobalWeightsEnabled,
    "isGlobalWeightsEnabled",
    STORAGE_KEYS.GLOBAL_WEIGHTS_ENABLED
  )

  const [globalWeights, setGlobalWeights] = usePersistentState<Record<string, number>>(
    {},
    userPreferences.getGlobalWeights,
    userPreferences.setGlobalWeights,
    "globalWeights",
    STORAGE_KEYS.GLOBAL_WEIGHTS
  )

  const [isGlobalWeightsModalOpen, setIsGlobalWeightsModalOpen] = useState(false)

  // Presets State
  const [presets, setPresets] = useState<TagPreset[]>([])
  const [isPresetDialogOpen, setIsPresetDialogOpen] = useState(false)
  const [presetName, setPresetName] = useState("")

  useEffect(() => {
    if (search.isClient) {
      setPresets(userPreferences.getAddTagsPresets())
    }
  }, [search.isClient])

  const savePreset = () => {
    if (!presetName.trim() || !addInput.trim()) return
    const newPresets = userPreferences.addAddTagsPreset({ name: presetName, content: addInput })
    setPresets(newPresets)
    setPresetName("")
    setIsPresetDialogOpen(false)
    toast({ title: "Preset saved", description: "The preset has been successfully saved." })
  }

  const loadPreset = (preset: TagPreset) => {
    setAddInput(preset.content)
    toast({ title: "Preset loaded", description: `Loaded: ${preset.name}` })
  }

  const deletePreset = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const newPresets = userPreferences.removeAddTagsPreset(id)
    setPresets(newPresets)
    toast({ title: "Preset deleted", description: "The preset has been removed." })
  }

  // History State
  const [history, setHistory] = useState<HistoryItem[]>([])

  useEffect(() => {
    if (search.isClient) {
      setHistory(userPreferences.getHistory())
    }
  }, [search.isClient])

  // Listen for preset/history changes from web app/other tabs via BroadcastChannel
  useEffect(() => {
    return onSettingsChange((key) => {
      if (key === STORAGE_KEYS.ADD_TAGS_PRESETS) {
        setPresets(userPreferences.getAddTagsPresets())
      } else if (key === STORAGE_KEYS.HISTORY) {
        setHistory(userPreferences.getHistory())
      }
    })
  }, [])

  const handleUsedPrompt = useCallback((promptText: string, postId: number, thumbnailUrl?: string) => {
    const newHistory = userPreferences.addToHistory({ content: promptText, postId, thumbnailUrl })
    setHistory(newHistory)
  }, [])

  const previouslyCopiedPostIds = useMemo(() => {
    return new Set(history.map(item => item.postId).filter((id): id is number => id !== undefined))
  }, [history])

  // Detailed background list
  const [detailedBackgroundsList, setDetailedBackgroundsList] = useState<string[][]>([])

  useEffect(() => {
    const controller = new AbortController()
    fetch('/detailed-backgrounds.json', { signal: controller.signal })
      .then(res => res.json())
      .then(data => {
        if (!Array.isArray(data)) throw new Error('Invalid format')
        setDetailedBackgroundsList(data.map((item: any) => {
          if (!item.scenery || !Array.isArray(item.scenery)) return []
          return item.scenery
        }))
      })
      .catch(err => {
        if (err.name !== 'AbortError') {
          console.error("Failed to load detailed backgrounds:", err)
        }
      })
    return () => controller.abort()
  }, [])

  // Global weight handlers
  const handleGlobalWeightChange = useCallback((tag: string, weight: number) => {
    setGlobalWeights(prev => {
      const next = { ...prev }
      next[tag.toLowerCase()] = weight
      return next
    })
  }, [setGlobalWeights])

  const handleRemoveGlobalWeight = useCallback((tag: string) => {
    setGlobalWeights(prev => {
      const next = { ...prev }
      delete next[tag]
      return next
    })
  }, [setGlobalWeights])

  const handleClearGlobalWeights = useCallback(() => {
    setGlobalWeights({})
    setIsGlobalWeightsModalOpen(false)
    toast({ title: "Weights reset", description: "All weights have been cleared." })
  }, [setGlobalWeights, toast])

  const toggleGlobalWeights = (enabled: boolean) => {
    setIsGlobalWeightsEnabled(enabled)
  }

  // Exclude list (for cleaning prompt)
  const excludeList = useMemo(() => excludeInput.split(',').map(t => t.trim()).filter(Boolean), [excludeInput])

  // Autocomplete placeholders
  const placeholders = useMemo(() => [
    "Search tags (e.g. cat girl)...",
    "frieren, solo",
    "swimsuit, wet hair",
  ], [])

  // Core Prompt Cleaning Pipeline
  const getCleanedPrompt = useCallback((post: BooruPost) => {
    let aiPrompt = post.ai_metadata?.prompt
    if (aiPrompt) {
      if (search.removeLoRaTags) aiPrompt = removeLoRaTagsUtil(aiPrompt)
      if (search.removeQualityTags) aiPrompt = removeQualityTagsUtil(aiPrompt)
    }

    const baseOpts = {
      includeCharacters,
      includeCopyrights: false,
      optimizeTags,
      exclude: excludeList,
      metaTags: post.tag_string_meta,
    }

    // Single cleanPrompt pass; background/weights are applied afterwards on the cleaned array.
    const cleaned = aiPrompt
      ? cleanPrompt(aiPrompt, "", "", "", {
          ...baseOpts,
          addedTags: [],
          backgroundMode: 'keep',
          simpleBackgroundReplacementTags,
          escapeOutput: false,
        })
      : cleanPrompt(post.tag_string, post.tag_string_artist, post.tag_string_character, post.tag_string_copyright, {
          ...baseOpts,
          addedTags: [],
          backgroundMode: 'keep',
          simpleBackgroundReplacementTags,
          escapeOutput: false,
        })

    // Post-process: background
    let content = cleaned
    if (cleaned && backgroundMode !== 'keep') {
      const tags = cleaned.split(',').map(t => t.trim())
      const processed = processBackgroundTags(
        tags, backgroundMode, simpleBackgroundReplacementTags, {},
        { patternsEnabled: randomBackgroundPatterns, includeGradients: randomBackgroundIncludeGradients },
        detailedBackgroundsList
      )
      content = processed.join(', ')
    }

    // Resolve conflicts between the cleaned content and the added tags
    const addList = addInput ? addInput.split(',').map(t => t.trim()).filter(Boolean) : []
    const conflictResolution = (content && addList.length > 0 && smartTagExclusion)
      ? resolveTagConflicts(content.split(',').map(t => t.trim()), addList)
      : { validTags: addList }

    // Build final prompt: valid added tags FIRST (matches the main web app's
    // cleanPrompt, which places user-added tags at the beginning), then content.
    const finalTags = [...conflictResolution.validTags, ...content.split(',').map(t => t.trim()).filter(Boolean)]
    let finalPrompt = finalTags.join(', ')

    // Apply global weights
    if (isGlobalWeightsEnabled && finalPrompt) {
      finalPrompt = applyWeights(finalPrompt, globalWeights)
    }

    return finalPrompt
  }, [
    excludeList,
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
    addInput,
    isGlobalWeightsEnabled,
    globalWeights
  ])

  // Filter posts based on global blacklist + character count filter (mirrors prompt-gallery.tsx)
  const filteredPosts = useMemo(() => {
    if (!search.isClient) return []
    const source = search.allPosts
    const normalizedBlacklist = blacklist.map(tag => tag.replace(/\s+/g, '_'))
    const providerSupportsCharacters = source.some(p => !!p.tag_string_character)

    return source.filter(post => {
      // 1. Blacklist filter
      if (blacklist.length > 0) {
        const postTags = (post.tag_string || '').split(' ')
        if (normalizedBlacklist.some(black => postTags.includes(black))) return false
      }

      // 2. Character count filter
      const minCharPostCount = (includeCharacters && parseInt(search.appliedCharacterCountFilter)) || 0
      if (minCharPostCount > 0) {
        if (!post.tag_string_character) {
          if (!providerSupportsCharacters) return true
          return false
        }
        const charTags = post.tag_string_character.split(' ').filter(Boolean)
        let hasValidCount = false
        for (const tag of charTags) {
          const count = tagCounts[tag]
          if (count === undefined) continue
          if (count >= minCharPostCount) { hasValidCount = true; break }
        }
        if (!hasValidCount) return false
      }

      return true
    })
  }, [search.isClient, search.allPosts, blacklist, includeCharacters, search.appliedCharacterCountFilter, tagCounts])

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
                                  {new Date(item.timestamp).toLocaleString()}
                                </p>
                                <p className="text-xs line-clamp-3 break-words font-mono bg-muted/50 p-1 rounded">
                                  {item.content}
                                </p>
                              </div>
                            </div>
                            <div className="flex justify-end gap-1.5 mt-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => {
                                  userPreferences.removeFromHistory(item.id)
                                  setHistory(userPreferences.getHistory())
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-7 text-xs px-2"
                                onClick={() => {
                                  navigator.clipboard.writeText(item.content)
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
                                  window.parent.postMessage({ type: "INJECT_PROMPT", prompt: item.content }, TARGET_ORIGIN)
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
                          onClick={() => {
                            userPreferences.clearHistory()
                            setHistory([])
                          }}
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

              {/* Tags to Add */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <Label htmlFor="add-tags-input" className="text-xs font-semibold">Tags to Add</Label>
                  <span className="text-[10px] text-muted-foreground">(Only final prompt)</span>
                </div>
                <div className="flex h-8 w-full items-center rounded-md border border-input bg-background/50 pl-2 pr-1 text-xs shadow-sm focus-within:ring-1 focus-within:ring-ring">
                  <DebouncedHTMLInput
                    id="add-tags-input"
                    value={addInput}
                    onChange={setAddInput}
                    debounceTime={400}
                    placeholder="masterpiece, best quality..."
                    className="flex-1 bg-transparent border-none p-0 placeholder:text-muted-foreground focus:outline-none h-full min-w-0"
                  />
                  <div className="flex items-center gap-0.5 shrink-0 ml-1">
                    {addInput && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setAddInput("")}
                        className="h-5 w-5 text-muted-foreground hover:text-foreground rounded-full"
                      >
                        <X className="h-2.5 w-2.5" />
                      </Button>
                    )}
                    <div className="h-3.5 w-px bg-border mx-0.5" />
                    
                    <Dialog open={isPresetDialogOpen} onOpenChange={setIsPresetDialogOpen}>
                      <DialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" title="Save Preset">
                          <Save className="h-3 w-3" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-[350px]">
                        <DialogHeader>
                          <DialogTitle className="text-sm font-bold">Save Preset</DialogTitle>
                          <DialogDescription className="text-xs">
                            Enter a name to save this list of tags.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-3 py-2 text-xs">
                          <div className="space-y-1">
                            <Label className="text-xs font-medium">Preset Name</Label>
                            <Input
                              value={presetName}
                              onChange={(e) => setPresetName(e.target.value)}
                              placeholder="My awesome preset"
                              className="h-8 text-xs"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-medium">Tags</Label>
                            <div className="p-2 bg-muted rounded text-[10px] font-mono break-all max-h-20 overflow-y-auto">
                              {addInput || <span className="text-muted-foreground italic">No tags entered</span>}
                            </div>
                          </div>
                        </div>
                        <DialogFooter className="flex-row gap-1 justify-end">
                          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setIsPresetDialogOpen(false)}>Cancel</Button>
                          <Button size="sm" className="h-8 text-xs" onClick={savePreset} disabled={!presetName.trim() || !addInput.trim()}>Save</Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" title="View Presets">
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-[180px] text-xs">
                        <DropdownMenuLabel className="text-[10px]">Saved Presets</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {presets.length === 0 ? (
                          <div className="p-2 text-center text-muted-foreground text-[10px]">
                            No saved presets
                          </div>
                        ) : (
                          presets.map(preset => (
                            <DropdownMenuItem key={preset.id} className="justify-between group cursor-pointer text-xs" onClick={() => loadPreset(preset)}>
                              <span className="truncate mr-1">{preset.name}</span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                                onClick={(e) => deletePreset(preset.id, e)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </DropdownMenuItem>
                          ))
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>

              {/* Tags to Exclude */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <Label htmlFor="exclude-tags-input" className="text-xs font-semibold">Tags to Exclude</Label>
                  <span className="text-[10px] text-muted-foreground">(Only final prompt)</span>
                </div>
                <div className="relative">
                  <DebouncedInput
                    id="exclude-tags-input"
                    value={excludeInput}
                    onChange={setExcludeInput}
                    debounceTime={400}
                    placeholder="bad quality, watermark, signature..."
                    className="h-8 text-xs bg-background/50 pr-7"
                  />
                  {excludeInput && (
                    <button
                      type="button"
                      onClick={() => setExcludeInput("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground flex items-center justify-center h-5 w-5 rounded-full hover:bg-muted"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Sliders */}
              <div className="flex flex-col gap-1">
                <SmoothFilterSlider
                  min={5}
                  max={100}
                  step={1}
                  value={search.tagCountFilter}
                  onChange={search.setTagCountFilter}
                  onCommit={search.setAppliedTagCountFilter}
                  disabled={!isTagCountSupported}
                  labelPrefix="Minimum Tags"
                  tooltipTitle="Minimum Tag Count"
                  tooltipDescription="Only shows prompts that have at least this number of tags. Recommended between 20 and 30 for detailed prompts."
                  inputId="tag-count"
                  isInputValid={isTagCountValid}
                  maxInput={1000}
                  ariaLabel="Minimum tags"
                  dotColor={isTagCountSupported ? "bg-blue-500" : "bg-gray-400"}
                />

                <SmoothFilterSlider
                  min={0}
                  max={10000}
                  step={100}
                  value={search.characterCountFilter}
                  onChange={search.setCharacterCountFilter}
                  onCommit={search.setAppliedCharacterCountFilter}
                  disabled={!includeCharacters}
                  labelPrefix="Minimum Character Posts"
                  tooltipTitle="Minimum Character Posts"
                  tooltipDescription="Filters images to only include characters with more posts accumulated in the booru database, avoiding obscure characters."
                  inputId="character-count"
                  isInputValid={!!search.characterCountFilter && /^\d+$/.test(search.characterCountFilter)}
                  maxInput={1000000}
                  ariaLabel="Minimum character posts"
                  dotColor={includeCharacters ? "bg-blue-500" : "bg-gray-400"}
                />
              </div>

              {/* Switches Grid */}
              <div className="flex flex-col gap-1 border-t pt-2">
                <div className="flex items-center justify-between p-1 rounded-md hover:bg-muted/30 transition-colors">
                  <Label htmlFor="include-characters" className="text-xs select-none cursor-pointer flex-1">Include Characters</Label>
                  <Switch id="include-characters" checked={includeCharacters} onCheckedChange={setIncludeCharacters} className="scale-75 origin-right" />
                </div>
                <div className="flex items-center justify-between p-1 rounded-md hover:bg-muted/30 transition-colors">
                  <Label htmlFor="smart-tag" className="text-xs select-none cursor-pointer flex-1">Smart Tag Combination</Label>
                  <Switch id="smart-tag" checked={optimizeTags} onCheckedChange={setOptimizeTags} className="scale-75 origin-right" />
                </div>
                <div className="flex items-center justify-between p-1 rounded-md hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-1.5 flex-1">
                    <Label htmlFor="smart-exclusion" className="text-xs select-none cursor-pointer">Smart Tag Exclusion</Label>
                    <Badge variant="default" className="text-[8px] py-0 px-1 !rounded h-3.5 select-none shrink-0">Beta</Badge>
                  </div>
                  <Switch id="smart-exclusion" checked={smartTagExclusion} onCheckedChange={setSmartTagExclusion} className="scale-75 origin-right" />
                </div>

                {search.booruProvider === "aibooru" && (
                  <>
                    <div className="flex items-center justify-between p-1 rounded-md hover:bg-muted/30 transition-colors">
                      <Label htmlFor="remove-lora" className="text-xs select-none cursor-pointer flex-1">Remove LoRa tags</Label>
                      <Switch id="remove-lora" checked={search.removeLoRaTags} onCheckedChange={search.setRemoveLoRaTags} className="scale-75 origin-right" />
                    </div>
                    <div className="flex items-center justify-between p-1 rounded-md hover:bg-muted/30 transition-colors">
                      <Label htmlFor="remove-quality" className="text-xs select-none cursor-pointer flex-1">Remove Quality tags</Label>
                      <Switch id="remove-quality" checked={search.removeQualityTags} onCheckedChange={search.setRemoveQualityTags} className="scale-75 origin-right" />
                    </div>
                  </>
                )}

                <div className="flex items-center justify-between p-1 rounded-md hover:bg-muted/30 transition-colors">
                  <div className="flex flex-col gap-0.5 flex-1">
                    <Label htmlFor="global-weights-toggle" className="text-xs select-none cursor-pointer">Global Tag Weights</Label>
                    <span className="text-[10px] text-muted-foreground leading-none">Apply weights across all cards</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Switch id="global-weights-toggle" checked={isGlobalWeightsEnabled} onCheckedChange={toggleGlobalWeights} className="scale-75 origin-right" />
                    <Button variant="outline" size="sm" className="h-6 px-1.5 text-[10px]" onClick={() => setIsGlobalWeightsModalOpen(true)}>Manage</Button>
                  </div>
                </div>
              </div>

              {/* Background Options */}
              <div className="flex flex-col gap-2 p-2 rounded-lg bg-muted/40 border border-border/50">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1">
                      <Label htmlFor="background-handling-select" className="text-xs font-semibold cursor-pointer">Background Options</Label>
                      <Badge variant="default" className="text-[8px] py-0 px-1 !rounded h-3.5 select-none shrink-0">Beta</Badge>
                    </div>
                    <span className="text-[10px] text-muted-foreground leading-tight">Modify background/scene tags</span>
                  </div>
                  <Select
                    value={backgroundMode}
                    onValueChange={(val: BackgroundMode) => {
                      setBackgroundMode(val)
                    }}
                  >
                    <SelectTrigger id="background-handling-select" className="h-7 text-[11px] bg-background w-[110px]">
                      <SelectValue placeholder="Original" />
                    </SelectTrigger>
                    <SelectContent className="text-xs">
                      <SelectItem value="keep">Original</SelectItem>
                      <SelectItem value="remove_all">Remove All</SelectItem>
                      <SelectItem value="force_simple">Replace</SelectItem>
                      <SelectItem value="random">Simple Random</SelectItem>
                      <SelectItem value="detailed_random">Detailed Random</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <AnimatePresence>
                  {backgroundMode === 'force_simple' && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <div className="pt-1.5 flex items-center gap-1.5">
                        <CornerDownRight className="w-3 h-3 text-muted-foreground shrink-0" />
                        <DebouncedInput
                          value={simpleBackgroundReplacementTags}
                          onChange={setSimpleBackgroundReplacementTags}
                          debounceTime={400}
                          placeholder="e.g., white background, simple background"
                          className="h-7 text-xs bg-background flex-1"
                        />
                      </div>
                    </motion.div>
                  )}

                  {backgroundMode === 'random' && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <div className="pt-2 flex flex-col gap-1.5 pl-3">
                        <div className="flex items-center justify-between">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[11px] font-medium">Include Patterns</span>
                            <span className="text-[10px] text-muted-foreground leading-none">Stripes, dots, etc.</span>
                          </div>
                          <Switch
                            checked={randomBackgroundPatterns}
                            onCheckedChange={setRandomBackgroundPatterns}
                            className="scale-75 origin-right"
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[11px] font-medium">Include Gradients</span>
                            <span className="text-[10px] text-muted-foreground leading-none">Gradients and two-tone colors</span>
                          </div>
                          <Switch
                            checked={randomBackgroundIncludeGradients}
                            onCheckedChange={setRandomBackgroundIncludeGradients}
                            className="scale-75 origin-right"
                          />
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

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
                  getCleanedPrompt={getCleanedPrompt}
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
              <InfiniteScrollTrigger
                onIntersect={search.loadMore}
                hasNextPage={!search.noMoreResults}
                isLoading={search.isLoadingMore}
                error={search.loadMoreError}
                loadedCount={search.allPosts.length}
              />
            </div>
          </>
        )}
      </main>

      {/* Floating Queue Badge native to React App */}
      <div className="fixed bottom-6 right-1/2 translate-x-1/2 flex flex-col items-center gap-1.5 z-50 pointer-events-none w-max max-w-[95vw]">
        {/* Target Info Pill */}
        <AnimatePresence>
          {queueStatus.platform !== "Unknown" && (
            <motion.div 
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 5 }}
              className="bg-secondary/90 border border-border backdrop-blur-md px-3 py-1 rounded-full text-[11px] font-medium text-secondary-foreground pointer-events-auto shadow-sm"
            >
              Target: <span className="font-semibold ml-1">{queueStatus.platform}</span>
            </motion.div>
          )}
        </AnimatePresence>
        
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
                  <MousePointerClick className="w-3 h-3 animate-bounce" /> Click field...
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

      <ExtensionTour externalRun={tourRun} />
    </div>
    </TooltipProvider>
    </ThemeProvider>
  )
}
