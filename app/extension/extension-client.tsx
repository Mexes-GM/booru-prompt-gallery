"use client"

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react"
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
import { SearchWithAutocomplete } from "@/components/prompt-gallery/search-with-autocomplete"
import { TagsManagementPanel } from "@/components/prompt-gallery/tags-management-panel"
import { PromptGenerationOptionsPanel } from "@/components/prompt-gallery/prompt-generation-options-panel"
import { getGelbooruProxyUrl, getDanbooruCdnUrl } from "@/lib/proxy-url"
import { computeGenerationResolution } from "@/lib/extension/generation-resolution"
import { parsePromptList } from "@/lib/extension/prompt-list-parser"
import type { BackgroundMode } from "@/lib/background-detector"
import { useCardPrompt, type UseCardPromptOptions } from "@/hooks/use-card-prompt"
import { useBulkSend, type BulkSendMode } from "@/hooks/use-bulk-send"
import { BooruPost, BooruProvider, isTagCountSupportedProvider } from "@/lib/api-client"
import { QueryStatusPanel } from "@/components/prompt-gallery/query-status-panel"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { ClientFormattedDate } from "@/components/ui/client-formatted-date"
import { Button } from "@/components/ui/button"
import { InfiniteScrollTrigger } from "@/components/ui/infinite-scroll-trigger"
import { MasonryGrid } from "@/components/masonry-grid"
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
import {
  Loader2,
  Settings,
  RefreshCw,
  Copy,
  Send,
  Check,
  Sliders,
  Replace,
  Plus,
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
  Zap,
  Pause,
  Play,
  ListPlus,
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { useTagCounts } from "@/hooks/use-tag-counts"
import { InteractivePrompt } from "@/components/prompt-gallery/interactive-prompt"
import { ExtensionTour } from "@/components/extension-tour"
import { TargetSetupWizard, SiteTargetStatusBadge } from "@/components/prompt-gallery/target-setup-wizard"

import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
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
import { toastError } from "@/lib/toast-error"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ThemeProvider } from "@/components/theme-provider"
import { useTheme } from "next-themes"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { NoResultsState } from "@/components/prompt-gallery/no-results-state"

// The sidepanel host is an extension page, whose origin is dynamic and
// browser-dependent: `chrome-extension://<id>` on Chrome/Chromium,
// `moz-extension://<id>` on Firefox (Gecko never uses the `chrome-extension://`
// scheme — the two are mutually exclusive by design, one per engine, never
// both). We therefore post to the parent with "*" and rely on the parent
// verifying our origin. Messages received from the parent are trusted when
// they originate from window.parent AND from either of those two extension-
// page origin schemes (the sidepanel) or one of the known web hosts.
const TARGET_ORIGIN = "*"
// Origins allowed to send messages into this iframe (web hosts; the extension
// sidepanel's chrome-extension:///moz-extension:// origin is accepted dynamically below).
const ALLOWED_ORIGINS = ["https://tensor.art", "https://seaart.ai"]

/** True when a message genuinely comes from our embedding parent (the sidepanel). */
function isTrustedParentMessage(event: MessageEvent): boolean {
  if (event.source !== window.parent) return false
  if (typeof event.origin !== "string") return false
  return (
    event.origin.startsWith("chrome-extension://") ||
    event.origin.startsWith("moz-extension://") ||
    ALLOWED_ORIGINS.includes(event.origin)
  )
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
  isPausedManually: boolean
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
  matchResolution,
  maxLongSide,
  strictResolutionCap,
  resolutionConfigured,
  onNoResolutionFields,
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
  onUsedPrompt: (prompt: string, postId: number, url?: string, provider?: BooruProvider) => void
  queueLength: number
  isGlobalWeightsEnabled: boolean
  onGlobalWeightChange?: (tag: string, weight: number) => void
  isPreviouslyCopied?: boolean
  hasTarget?: boolean
  onNoTarget?: () => void
  /** "Match image resolution" toggle state (lifted from ExtensionClient settings). */
  matchResolution?: boolean
  maxLongSide?: number
  /** When true, maxLongSide is a hard per-side cap instead of a total-area budget. */
  strictResolutionCap?: boolean
  /** Whether this origin has widthField+heightField configured in its SiteProfile. */
  resolutionConfigured?: boolean
  /** Called once per send when matchResolution is on but fields aren't configured yet. */
  onNoResolutionFields?: () => void
}) {
  const [copied, setCopied] = useState(false)
  /** 'idle' | 'queued' (amber, waiting for TensorArt) | 'sent' (green, injected) */
  const [sendState, setSendState] = useState<"idle" | "queued" | "sent">("idle")
  const [useFallbackUrl, setUseFallbackUrl] = useState(false)
  const [cdnRetry, setCdnRetry] = useState(0)
  const [modifiedContent, setModifiedContent] = useState<string | null>(null)

  const {
    displayContent,
    classifiedTags: cardClassifiedTags,
    totalTagsCount: cardTotalTagsCount,
    tagCountIndicator: cardTagCountIndicator,
    hasActiveOptions,
    hasReplacements,
    replacedTags,
    hasAppends,
    appendedTags,
    conflictingTags,
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
      onUsedPrompt(displayPrompt, post.id, post.preview_file_url || post.file_url, post._provider as BooruProvider | undefined)
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
    // "Match image resolution": derive a generation width/height from the
    // source post's real aspect ratio (post.width/post.height), scaled to
    // maxLongSide. Missing post dimensions or an unconfigured resolution
    // fields target degrade gracefully — the prompt still sends as-is.
    const resolution = matchResolution
      ? computeGenerationResolution(post.width, post.height, { maxLongSide, strictCap: strictResolutionCap })
      : null
    if (process.env.NODE_ENV !== "production") {
      console.log("%c[BooruMatchRes]", "color:#8b5cf6;font-weight:bold", `handleSend — matchResolution=${matchResolution} post.width=${post.width} post.height=${post.height} maxLongSide=${maxLongSide} strictResolutionCap=${strictResolutionCap} -> resolution=${resolution ? `${resolution.width}x${resolution.height}` : "null"}`)
    }
    window.parent.postMessage({
      type: "INJECT_PROMPT",
      prompt: displayPrompt,
      ...(resolution ? { width: resolution.width, height: resolution.height } : {}),
    }, TARGET_ORIGIN)
    // If the user hasn't picked a destination field yet, the prompt will sit in
    // the queue with nowhere to go — guide them to set a target first.
    if (!hasTarget) {
      onNoTarget?.()
    }
    // Guide the user to configure width/height fields once, when the toggle
    // is on but this origin's SiteProfile has no widthField/heightField yet
    // (resolution was requested but couldn't be attached to this send).
    if (matchResolution && resolution && !resolutionConfigured) {
      onNoResolutionFields?.()
    }
    // Show 'queued' (amber) immediately; it will clear after 4 s or when queue empties
    setSendState("queued")
    onUsedPrompt(displayPrompt, post.id, post.preview_file_url || post.file_url, post._provider as BooruProvider | undefined)
    // After a brief moment, revert to idle so the card is re-sendable
    setTimeout(() => setSendState("idle"), 4000)
  }

  // Double-clicking the card triggers the same action as the Send button —
  // but NOT when the double-click lands on the interactive prompt (tags are
  // click/double-click-selectable text) or on one of the footer buttons
  // (which already have their own handlers), to avoid hijacking text
  // selection or double-firing an action the user is already triggering.
  const handleCardDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.closest(".prompt-container") || target.closest("button")) return
    handleSend(e)
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
  // Danbooru: CloudFront primary, with a one-shot cache-busting retry (?_r=N)
  // so a transient origin-pull failure retries CloudFront before falling back
  // to the same-origin /api/download proxy (keeps failures off Vercel Fluid).
  const danbooruCdnUrl = getDanbooruCdnUrl(rawFileUrl || '')
  const danbooruCdnUrlWithRetry = danbooruCdnUrl && cdnRetry > 0
    ? `${danbooruCdnUrl}${danbooruCdnUrl.includes('?') ? '&' : '?'}_r=${cdnRetry}`
    : danbooruCdnUrl
  const fileUrl = (isGelbooru || itemProvider === "rule34") && rawFileUrl
    ? getGelbooruProxyUrl(rawFileUrl)
    : (danbooruCdnUrlWithRetry ?? rawFileUrl)

  // For Danbooru, use proxy fallback if direct loading fails.
  const proxyFileUrl = isDanbooruImg
    ? `/api/download?url=${encodeURIComponent(rawFileUrl)}&inline=1`
    : undefined

  const displayImageUrl = (useFallbackUrl && proxyFileUrl) ? proxyFileUrl : (fileUrl || "")

  const handleImageError = () => {
    // Danbooru via CloudFront: retry CloudFront once (warm cache / transient
    // origin challenge) before falling back to the same-origin /api/download
    // proxy, keeping transient failures off the Vercel serverless function.
    if (isDanbooruImg && danbooruCdnUrl && !useFallbackUrl && cdnRetry < 1) {
      setCdnRetry(c => c + 1)
      return
    }
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
    <Card
      className="w-full h-full overflow-hidden card-hover group flex flex-col relative transition-all duration-300"
      onDoubleClick={handleCardDoubleClick}
      title="Double-click to send this prompt"
    >
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

        {/* Bottom-left stack: options/replacement indicators above the character
            post count — mirrors MasonryItem's equivalent stack so the Pocket
            surfaces the same "something changed your prompt" signals. */}
        {(hasActiveOptions || hasReplacements || hasAppends || (tagCountIndicator && promptOptions.includeCharacters)) && (
          <div className="absolute bottom-2 left-2 z-10 flex flex-col items-start gap-1">
            {hasActiveOptions && (
              <div
                className="flex items-center justify-center h-6 w-6 rounded-full bg-background/80 border border-blue-500/40 shadow-sm select-none"
                title="Smart Tag Exclusion blocked a conflicting added tag"
              >
                <Sliders className="w-3.5 h-3.5 text-blue-500" strokeWidth={3} />
              </div>
            )}
            {hasReplacements && (
              <div
                className="flex items-center justify-center h-6 w-6 rounded-full bg-background/80 border border-amber-500/40 shadow-sm select-none"
                title={`Find & Replace applied: ${replacedTags.map(r => `${r.from} → ${r.to}`).join(', ')}`}
              >
                <Replace className="w-3.5 h-3.5 text-amber-500" strokeWidth={3} />
              </div>
            )}
            {hasAppends && (
              <div
                className="flex items-center justify-center h-6 w-6 rounded-full bg-background/80 border border-violet-500/40 shadow-sm select-none"
                title={`Find & Append applied: ${appendedTags.map(a => `${a.from} → ${a.append.join(', ')}`).join(' | ')}`}
              >
                <Plus className="w-3.5 h-3.5 text-violet-500" strokeWidth={3} />
              </div>
            )}
            {/* Character Tag Count Indicator — hidden when "Include Characters" is
                off, matching MasonryItem's `tagCountIndicator && includeCharacters`
                gate in the main app (otherwise it leaks the character identity
                even when the user explicitly asked to anonymize the prompt). */}
            {tagCountIndicator && promptOptions.includeCharacters && (
              <div
                className="px-1.5 py-0.5 rounded-md bg-black/60 text-white/90 text-xs font-medium tracking-wide flex items-center gap-1 backdrop-blur-sm shadow-sm select-none"
                title="Character Post Count"
              >
                <Users className="w-3.5 h-3.5 opacity-70" />
                {tagCountIndicator}
              </div>
            )}
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
            conflictingTags={conflictingTags}
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
    isPausedManually: false,
    activeTasks: 0,
    limit: 5,
    platform: "Unknown"
  })
  const [autoDownload, setAutoDownload] = useState(false)
  const [backgroundGeneration, setBackgroundGeneration] = useState(false)
  
  // Targeting state machine, driven by TARGET_STATUS messages from sidepanel.js
  // "idle" | "arming" | "waiting" | "selected" | "none" | "error" | "cancelled"
  const [targetState, setTargetState] = useState<string>("idle")
  const isTargeting = targetState === "arming" || targetState === "waiting"
  // True once the user has successfully picked a destination field this session.
  // Used to guide first-time users through the Target → Send flow.
  const [hasTargetSet, setHasTargetSet] = useState(false)
  // (Fase 5b) Controls the 3-step site setup wizard dialog.
  const [wizardOpen, setWizardOpen] = useState(false)

  // ── Import Prompt List ─────────────────────────────────────────────────────
  // Pasting a block of prompts (one per line) and enqueueing them all at once,
  // reusing the same parse → enqueue → toast pipeline as Bulk Send.
  const [importListOpen, setImportListOpen] = useState(false)
  const [importListText, setImportListText] = useState("")
  const importListCount = useMemo(() => parsePromptList(importListText).length, [importListText])

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
      // Pass `state` (from a postMessage payload) as a separate console arg
      // instead of interpolating it into the format string, so a value like
      // "%s" can't be interpreted as a format specifier (js/tainted-format-string).
      console.log("[Target UI] state=%o", state, detail || "")

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
          toastError({
            title: "No prompt field found",
            description: detail?.message || "Make sure the prompt node is visible on the page, then retry.",
            errorSource: "extension_target_none",
          })
          setTimeout(() => setTargetState("idle"), 2500)
          break
        case "error":
          toastError({
            title: "Targeting failed",
            description: detail?.message || "Could not start targeting. Open the generation page and retry.",
            errorSource: "extension_target_error",
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
          isPausedManually: event.data.isPausedManually ?? false,
          activeTasks: event.data.currentActiveTasks ?? 0,
          limit: event.data.seaArtLimit ?? 5,
          platform: event.data.platform ?? "Unknown"
        })
        if (typeof event.data.autoDownloadEnabled === "boolean") {
          setAutoDownload(event.data.autoDownloadEnabled)
        }
        if (typeof event.data.backgroundGenerationEnabled === "boolean") {
          setBackgroundGeneration(event.data.backgroundGenerationEnabled)
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

  // "Match image resolution": track whether the ACTIVE tab's origin has both
  // widthField and heightField configured (via the wizard's "Resolution"
  // step), so PocketCard can guide the user to configure them once instead of
  // silently sending prompts with no size adjustment forever.
  const [resolutionConfigured, setResolutionConfigured] = useState(false)
  useEffect(() => {
    function handleSiteProfileStatus(event: MessageEvent) {
      if (!isTrustedParentMessage(event)) return
      if (!event.data || event.data.type !== "SITE_PROFILE_STATUS") return
      setResolutionConfigured(!!event.data.widthConfigured && !!event.data.heightConfigured)
    }
    window.addEventListener("message", handleSiteProfileStatus)
    if (typeof window !== "undefined") {
      window.parent.postMessage({ type: "REQUEST_SITE_PROFILE_STATUS" }, TARGET_ORIGIN)
    }
    return () => window.removeEventListener("message", handleSiteProfileStatus)
  }, [])

  const guideToResolutionFields = useCallback(() => {
    toast({
      title: "Set the width/height fields first",
      description: "Open Setup and configure the Resolution step so \"Match image resolution\" can adjust the canvas size.",
    })
  }, [toast])

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

  const [tagAppendRules, setTagAppendRules] = usePersistentState<TagAppendRule[]>(
    [],
    userPreferences.getTagAppendRules,
    userPreferences.setTagAppendRules,
    "tagAppendRules",
    STORAGE_KEYS.TAG_APPEND_RULES
  )

  // "Match image resolution" — extension-only toggle: when enabled, sending a
  // prompt also computes a generation width/height from the source post's
  // aspect ratio (capped at maxLongSide) and attaches it to INJECT_PROMPT.
  const [matchResolution, setMatchResolution] = usePersistentState(
    false,
    userPreferences.getMatchResolutionEnabled,
    userPreferences.setMatchResolutionEnabled,
    "matchResolutionEnabled",
    STORAGE_KEYS.MATCH_RESOLUTION_ENABLED
  )

  const [maxLongSide, setMaxLongSide] = usePersistentState(
    1536,
    userPreferences.getMatchResolutionMaxLongSide,
    userPreferences.setMatchResolutionMaxLongSide,
    "matchResolutionMaxLongSide",
    STORAGE_KEYS.MATCH_RESOLUTION_MAX_LONG_SIDE
  )

  // Toggle between the two capping semantics computeGenerationResolution
  // supports: "area" budget (default, off) lets a non-square result exceed
  // maxLongSide on one side as long as total area stays in budget; "strict"
  // (on) makes maxLongSide a hard per-side ceiling that's never exceeded.
  const [strictResolutionCap, setStrictResolutionCap] = usePersistentState(
    false,
    userPreferences.getMatchResolutionStrictCap,
    userPreferences.setMatchResolutionStrictCap,
    "matchResolutionStrictCap",
    STORAGE_KEYS.MATCH_RESOLUTION_STRICT_CAP
  )

  const {
    includeCharacters, optimizeTags, smartTagExclusion, prependAnimaArtist,
    setIncludeCharacters, setOptimizeTags, setSmartTagExclusion, setPrependAnimaArtist,
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

  const handleUsedPrompt = useCallback((promptText: string, postId: number, thumbnailUrl?: string, provider?: BooruProvider) => {
    if (postId) {
      // Prefer the copied post's own provider (passed up from PocketCard's
      // `post._provider`) over the currently-selected provider tab — they can
      // differ, and mislabeling here permanently corrupts the stored provider
      // (see the matching fix in prompt-gallery.tsx's copyToClipboard).
      addToHistory({ postId, provider: provider || search.booruProvider })
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
    searchTags: search.debouncedSearchTags,
    findInput,
    replaceInput,
    tagAppendRules,
    includeCharacters,
    optimizeTags,
    smartTagExclusion,
    prependAnimaArtist,
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
    search.debouncedSearchTags,
    findInput,
    replaceInput,
    tagAppendRules,
    includeCharacters,
    optimizeTags,
    smartTagExclusion,
    prependAnimaArtist,
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
    appliedTagCountFilter: search.appliedTagCountFilter,
  })

  // ── Bulk Send (docs/superpowers/specs/2026-07-19-extension-bulk-send-design.md) ──
  // "Send N prompts to generate quickly" for the current search query, in two
  // modes: real posts (one prompt per fetched post) or synthetic (pack-style
  // variations seeded from a handful of posts). Both modes reuse the exact
  // same cleaner pipeline as a single card (cardPromptOptions above).
  const [bulkSendMode, setBulkSendMode] = usePersistentState<BulkSendMode>(
    "real",
    () => userPreferences.getBulkSendMode() as BulkSendMode,
    (val) => userPreferences.setBulkSendMode(val),
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
    // Micro-stagger so we don't fire N postMessages in the same tick — the
    // sidepanel's own queue throttles processing, this just avoids bursting
    // the messaging channel itself.
    items.forEach((item, index) => {
      setTimeout(() => {
        window.parent.postMessage({
          type: "INJECT_PROMPT",
          prompt: item.prompt,
          ...(item.width && item.height ? { width: item.width, height: item.height } : {}),
        }, TARGET_ORIGIN)
      }, index * 40)
    })
  }, [])

  const runBulkSend = useCallback(async (count: number) => {
    if (!hasTargetSet) {
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
  }, [hasTargetSet, guideToTarget, bulkSend, bulkSendMode, search.searchTags, enqueueBulkPrompts, toast])

  const handleImportPromptList = useCallback(() => {
    const prompts = parsePromptList(importListText)
    if (prompts.length === 0) return
    if (!hasTargetSet) {
      guideToTarget()
      return
    }
    enqueueBulkPrompts(prompts.map((prompt) => ({ prompt })))
    toast({
      title: `${prompts.length} prompt${prompts.length === 1 ? "" : "s"} imported`,
      description: "Added to the generation queue.",
    })
    setImportListOpen(false)
    setImportListText("")
  }, [importListText, hasTargetSet, guideToTarget, enqueueBulkPrompts, toast])

  const isRule34 = search.booruProvider === "rule34"
  // In the extension (Pocket), the minimum tags slider is always enabled:
  // providers with server-side `tagcount:>=N` support use it at the API level,
  // and providers without it (Gelbooru, Rule34) use the client-side fallback
  // filter in useFilteredPosts. The web app keeps its original behavior
  // (disabled when unsupported) since it doesn't pass appliedTagCountFilter.
  const isTagCountSupported = true
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
                onSearch={() => search.handleSearch()}
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
              <Sheet open={importListOpen} onOpenChange={setImportListOpen}>
                <SheetTrigger asChild>
                  <Button type="button" variant="outline" className="h-8 w-8 p-0 shadow-sm" title="Import prompt list" aria-label="Import a list of prompts">
                    <ListPlus className="w-3.5 h-3.5" />
                  </Button>
                </SheetTrigger>
                <SheetContent className="w-full sm:w-[400px] flex flex-col">
                  <SheetHeader>
                    <SheetTitle className="text-sm font-bold">Import Prompt List</SheetTitle>
                    <SheetDescription className="text-xs">
                      Paste prompts, one per line. Each prompt is a comma-separated tag list that ends without a trailing comma.
                    </SheetDescription>
                  </SheetHeader>
                  <textarea
                    value={importListText}
                    onChange={(e) => setImportListText(e.target.value)}
                    placeholder={"thick thighs, wide hips, ..., explicit\n1girl, solo, ..., full body"}
                    className="mt-4 w-full flex-1 min-h-[220px] rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
                  />
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      {importListCount > 0
                        ? `${importListCount} prompt${importListCount === 1 ? "" : "s"} detected`
                        : "No prompts yet"}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => { setImportListOpen(false); setImportListText("") }}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={importListCount === 0}
                        onClick={handleImportPromptList}
                      >
                        Import
                      </Button>
                    </div>
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

              {/* Active Query breakdown + API tag-limit warnings + misused
                  metatag warnings — same panel the main web app uses, so the
                  Pocket surfaces the same per-provider dynamic tag limits. */}
              <QueryStatusPanel
                searchTags={search.searchTags}
                ratingFilter={search.ratingFilter}
                order={search.order}
                appliedTagCountFilter={search.appliedTagCountFilter}
                appliedScoreTier={search.appliedScoreTier}
                booruProvider={search.booruProvider}
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
                prependAnimaArtist={prependAnimaArtist}
                setPrependAnimaArtist={setPrependAnimaArtist}
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

              {/* Keep generating in background */}
              <div className="flex flex-col gap-1 border-t pt-2">
                <div className="flex items-center justify-between p-1 rounded-md hover:bg-muted/30 transition-colors">
                  <div className="flex flex-col gap-0.5 flex-1">
                    <Label htmlFor="background-generation" className="text-xs select-none cursor-pointer">Keep generating in background</Label>
                    <span className="text-[10px] text-muted-foreground leading-none">
                      Keep the queue running when the generator tab is not focused. Keep its window open (not minimized) for best results.
                    </span>
                  </div>
                  <Switch
                    id="background-generation"
                    checked={backgroundGeneration}
                    onCheckedChange={(val) => {
                      setBackgroundGeneration(val)
                      window.parent.postMessage({ type: "QUEUE_ACTION", action: "set_background_generation", value: val }, TARGET_ORIGIN)
                    }}
                    className="scale-75 origin-right"
                  />
                </div>
              </div>

              {/* Match image resolution */}
              <div className="flex flex-col gap-1 border-t pt-2">
                <div className="flex items-center justify-between p-1 rounded-md hover:bg-muted/30 transition-colors">
                  <div className="flex flex-col gap-0.5 flex-1">
                    <Label htmlFor="match-resolution" className="text-xs select-none cursor-pointer">Match image resolution</Label>
                    <span className="text-[10px] text-muted-foreground leading-none">
                      Set the generator&apos;s width/height from this image&apos;s aspect ratio
                    </span>
                  </div>
                  <Switch
                    id="match-resolution"
                    checked={matchResolution}
                    onCheckedChange={(val) => setMatchResolution(val)}
                    className="scale-75 origin-right"
                  />
                </div>
                {matchResolution && (
                  <div className="flex items-center justify-between p-1 pl-2">
                    <Label htmlFor="max-long-side" className="text-[11px] text-muted-foreground select-none cursor-pointer">
                      Max long side (px)
                    </Label>
                    <Input
                      id="max-long-side"
                      type="number"
                      min={64}
                      step={64}
                      inputMode="numeric"
                      value={maxLongSide}
                      onChange={(e) => {
                        const parsed = Number.parseInt(e.target.value, 10)
                        setMaxLongSide(Number.isFinite(parsed) && parsed > 0 ? parsed : 1536)
                      }}
                      className="h-6 w-20 text-[11px] px-2"
                    />
                  </div>
                )}
                {matchResolution && (
                  <div className="flex items-center justify-between p-1 pl-2">
                    <div className="flex flex-col gap-0.5 flex-1">
                      <Label htmlFor="strict-resolution-cap" className="text-[11px] text-muted-foreground select-none cursor-pointer">
                        Strict max long side cap
                      </Label>
                      <span className="text-[10px] text-muted-foreground/70 leading-none">
                        {strictResolutionCap
                          ? "Longest side never exceeds the value above"
                          : "Longest side may exceed it if total area still fits"}
                      </span>
                    </div>
                    <Switch
                      id="strict-resolution-cap"
                      checked={strictResolutionCap}
                      onCheckedChange={(val) => setStrictResolutionCap(val)}
                      className="scale-75 origin-right"
                    />
                  </div>
                )}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Bulk Send row — always visible, below the Settings row (see
            docs/superpowers/specs/2026-07-19-extension-bulk-send-design.md).
            Sends N prompts to the generation queue in one click, for the
            current search query, without picking cards one by one. */}
        <div className="flex flex-col gap-1.5 border-t pt-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold tracking-wider uppercase text-muted-foreground/80 flex items-center gap-1 select-none">
              <Zap size={10} /> Bulk Send
            </span>
            {/* Real | Synthetic segmented toggle */}
            <div className="bg-muted/50 p-0.5 rounded-md flex gap-0.5">
              {(["real", "synthetic"] as const).map((mode) => (
                <Button
                  key={mode}
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={bulkSend.isRunning}
                  onClick={() => setBulkSendMode(mode)}
                  className={`h-5 px-1.5 text-[10px] rounded-sm ${
                    bulkSendMode === mode
                      ? "bg-background shadow-sm text-foreground font-semibold hover:bg-background"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {mode === "real" ? "Real posts" : "Synthetic"}
                </Button>
              ))}
            </div>
          </div>

          {bulkSend.isRunning ? (
            <div className="flex items-center gap-2 h-7 px-1">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
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
                  disabled={!search.searchTags.trim()}
                  onClick={() => setBulkSendConfirmCount(count)}
                  className="h-7 flex-1 text-xs font-semibold shadow-sm"
                  title={
                    !search.searchTags.trim()
                      ? "Type a search query first"
                      : `Send ${count} prompts (${bulkSendMode === "real" ? "real posts" : "synthetic"}) for "${search.searchTags}"`
                  }
                >
                  {count}
                </Button>
              ))}
            </div>
          )}
          {search.searchTags.trim() && !bulkSend.isRunning && (
            <p className="text-[10px] text-muted-foreground/70 truncate px-0.5" title={search.searchTags}>
              from &ldquo;{search.searchTags}&rdquo;
            </p>
          )}
        </div>
      </Card>

      {/* Bulk Send confirmation dialog */}
      <AlertDialog open={bulkSendConfirmCount !== null} onOpenChange={(open) => { if (!open) setBulkSendConfirmCount(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send {bulkSendConfirmCount} prompts?</AlertDialogTitle>
            <AlertDialogDescription>
              This will queue {bulkSendConfirmCount} {bulkSendMode === "real" ? "real-post" : "synthetic"} prompts
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
                  matchResolution={matchResolution}
                  maxLongSide={maxLongSide}
                  strictResolutionCap={strictResolutionCap}
                  resolutionConfigured={resolutionConfigured}
                  onNoResolutionFields={guideToResolutionFields}
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
                    <div className="w-1/4 h-full bg-amber-500 rounded-full animate-indeterminate-bar [content-visibility:auto]" />
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
              queueStatus.isPausedManually ? "bg-slate-400" :
              queueStatus.isPausedForError ? "bg-red-500 animate-pulse" :
              queueStatus.isPausedForVisibility ? "bg-red-500 animate-pulse" :
              queueStatus.isWaitingForSlot ? "bg-orange-500 animate-pulse" :
              queueStatus.isProcessing ? "bg-blue-500 animate-pulse" :
              queueStatus.length > 0 ? "bg-amber-500 animate-pulse" : 
              "bg-green-500"
            }`} />
            <span className="text-foreground font-semibold shrink-0">
              {queueStatus.isPausedManually ? "Paused" :
               queueStatus.isPausedForError ? "Error: Paused" :
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

            {/* Manual pause/resume — safety valve to stop the queue from
                sending more prompts without losing what's already queued
                (unlike Clear, which drops everything). Always available so
                the user can pre-emptively pause before a Bulk Send, not just
                once something is already queued/processing. */}
            <Button
              variant="outline"
              size="sm"
              title={queueStatus.isPausedManually ? "Resume sending prompts" : "Pause sending prompts"}
              aria-label={queueStatus.isPausedManually ? "Resume the prompt queue" : "Pause the prompt queue"}
              onClick={() => window.parent.postMessage({ type: "QUEUE_ACTION", action: queueStatus.isPausedManually ? "resume" : "pause" }, TARGET_ORIGIN)}
              className={`h-6 px-2.5 rounded-full text-[11px] gap-1 transition-colors ${
                queueStatus.isPausedManually
                  ? "bg-slate-500/20 text-slate-500 border-slate-500/50 hover:bg-slate-500/30"
                  : "bg-transparent hover:bg-amber-500/10 hover:text-amber-600 hover:border-amber-500/50"
              }`}
            >
              {queueStatus.isPausedManually ? (
                <>
                  <Play className="w-3 h-3" /> Resume
                </>
              ) : (
                <>
                  <Pause className="w-3 h-3" /> Pause
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

      <TargetSetupWizard open={wizardOpen} onOpenChange={setWizardOpen} />
      <ExtensionTour externalRun={tourRun} />
    </div>
    </TooltipProvider>
    </ThemeProvider>
  )
}
