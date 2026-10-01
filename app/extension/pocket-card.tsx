"use client"

import React, { Fragment, memo, useEffect, useRef, useState } from "react"
import { motion } from "framer-motion"
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  ImageOff,
  Loader2,
  Mountain,
  Send,
  Shirt,
  Smile,
  Tag,
  User,
  Users,
} from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { InteractivePrompt } from "@/components/prompt-gallery/interactive-prompt"
import { CopyOptionsDropdown } from "@/components/prompt-gallery/copy-options-dropdown"
import { useCardPrompt, type UseCardPromptOptions } from "@/hooks/use-card-prompt"
import { useLowMotion } from "@/hooks/use-low-motion"
import { toast } from "@/hooks/use-toast"
import { getGelbooruProxyUrl, getDanbooruCdnUrl, imageReferrerPolicy } from "@/lib/proxy-url"
import { getPostUrl } from "@/lib/constants"
import { computeGenerationResolution } from "@/lib/extension/generation-resolution"
import type { BooruPost, BooruProvider } from "@/lib/api-client"
import type { TagCategory } from "@/lib/tag-classifier"
import { postToParent } from "./pocket-bridge"

/** Same breakdown rows the web card's tag-count tooltip lists. */
const CATEGORY_BREAKDOWN = [
  { key: "appearance", label: "Appearance", Icon: Smile, className: "text-cat-appearance-text" },
  { key: "clothing", label: "Clothing", Icon: Shirt, className: "text-cat-clothing-text" },
  { key: "pose", label: "Pose", Icon: User, className: "text-cat-pose-text" },
  { key: "scenery", label: "Scene", Icon: Mountain, className: "text-cat-scenery-text" },
] as const

// footerHeight must match the card-content-medium CSS class including padding:
// p-3 (24px) + prompt container max-h-20 (80px) + gap + button h-8 (32px).
export const POCKET_FOOTER_HEIGHT = 152

export interface PocketCardProps {
  post: BooruPost
  promptOptions: UseCardPromptOptions
  booruProvider: BooruProvider
  height: number
  tagCounts: Record<string, number>
  globalWeights: Record<string, number>
  isGlobalWeightsEnabled: boolean
  onGlobalWeightChange?: (tag: string, weight: number) => void
  onSearch: (tag: string) => void
  onUsedPrompt: (post: BooruPost) => void
  isPreviouslyCopied?: boolean
  hasTarget?: boolean
  onNoTarget?: () => void
  /** "Match image resolution" toggle state (lifted from ExtensionClient settings). */
  matchResolution?: boolean
  maxLongSide?: number
  /** When true, maxLongSide is a hard per-side cap instead of a total-area budget. */
  strictResolutionCap?: boolean
  /** When true, snap to the closest curated aspect-ratio bucket instead of
   *  the post's raw aspect ratio. */
  snapToBucket?: boolean
  /** Whether this origin has widthField+heightField configured in its SiteProfile. */
  resolutionConfigured?: boolean
  /** Called once per send when matchResolution is on but fields aren't configured yet. */
  onNoResolutionFields?: () => void
  /** Auto-Downloading "group by character" — the single character tag the
   *  active search is locked to (folder-name form), or null when not locked
   *  to exactly one character. Attached to INJECT_PROMPT for the sidepanel host to
   *  use when filing the auto-downloaded image. */
  characterFolder?: string | null
}

/**
 * The Pocket's card: the web app's MasonryItem in miniature, with a Send action
 * that queues the prompt into the generator via the sidepanel host. Prompt
 * derivation goes through the shared useCardPrompt hook (same pipeline as
 * MasonryItem) so both shells always produce an identical prompt, and the image
 * overlays mirror MasonryItem's (one "prompt adjusted" dot + one tag-count chip
 * whose tooltip carries the per-category breakdown).
 *
 * Memoized: the Pocket re-renders on every QUEUE_STATUS message from the host
 * while a batch runs, and none of that should re-render the grid.
 */
export const PocketCard = memo(function PocketCard({
  post,
  promptOptions,
  booruProvider,
  height,
  tagCounts,
  globalWeights,
  isGlobalWeightsEnabled,
  onGlobalWeightChange,
  onSearch,
  onUsedPrompt,
  isPreviouslyCopied,
  hasTarget,
  onNoTarget,
  matchResolution,
  maxLongSide,
  strictResolutionCap,
  snapToBucket,
  resolutionConfigured,
  onNoResolutionFields,
  characterFolder,
}: PocketCardProps) {
  const lowMotion = useLowMotion()
  const [copied, setCopied] = useState(false)
  /** 'idle' | 'queued' (amber, handed to the host queue) */
  const [sendState, setSendState] = useState<"idle" | "queued">("idle")
  const [useFallbackUrl, setUseFallbackUrl] = useState(false)
  const [cdnRetry, setCdnRetry] = useState(0)
  const [imageGaveUp, setImageGaveUp] = useState(false)
  const [modifiedContent, setModifiedContent] = useState<string | null>(null)

  // Feedback timers are tracked so an unmount (virtualized grid scrolling the
  // card away) never sets state on a dead component.
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    if (sendTimerRef.current) clearTimeout(sendTimerRef.current)
  }, [])

  const {
    isAiPost,
    displayContent,
    pureDisplayContent,
    classifiedTags,
    totalTagsCount,
    tagCountIndicator,
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

  const displayPrompt = modifiedContent ?? displayContent
  const imageHeight = Math.max(80, height - POCKET_FOOTER_HEIGHT)

  const itemProvider = (post._provider || booruProvider) as BooruProvider
  const postUrl = getPostUrl(itemProvider, post.id, isAiPost)

  const flashCopied = () => {
    setCopied(true)
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
  }

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(displayPrompt)
      flashCopied()
      onUsedPrompt(post)
    } catch (err) {
      console.warn("Clipboard copy failed:", err)
      toast({ title: "Couldn't copy", description: "Clipboard access was blocked. Use Send instead.", variant: "destructive", duration: 3000 })
    }
  }

  const copyCategory = async (category: TagCategory) => {
    if (!pureDisplayContent) return
    const subset = classifiedTags[category]
    if (subset.length === 0) {
      toast({ description: `No ${category} tags found`, variant: "destructive", duration: 2000 })
      return
    }
    try {
      await navigator.clipboard.writeText(subset.join(", "))
      flashCopied()
      toast({ description: `Copied ${subset.length} ${category} tag${subset.length === 1 ? "" : "s"}`, duration: 2000 })
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
    // "Match image resolution": derive a generation width/height from the
    // source post's real aspect ratio (post.width/post.height), scaled to
    // maxLongSide. Missing post dimensions or an unconfigured resolution
    // fields target degrade gracefully — the prompt still sends as-is.
    const resolution = matchResolution
      ? computeGenerationResolution(post.width, post.height, { maxLongSide, strictCap: strictResolutionCap, snapToBucket })
      : null
    postToParent({
      type: "INJECT_PROMPT",
      prompt: displayPrompt,
      ...(resolution ? { width: resolution.width, height: resolution.height } : {}),
      ...(characterFolder ? { character: characterFolder } : {}),
    })
    // If the user hasn't picked a destination field yet, the prompt will sit in
    // the queue with nowhere to go — guide them to set a target first.
    if (!hasTarget) onNoTarget?.()
    // Guide the user to configure width/height fields once, when the toggle
    // is on but this origin's SiteProfile has no widthField/heightField yet.
    if (matchResolution && resolution && !resolutionConfigured) onNoResolutionFields?.()
    setSendState("queued")
    onUsedPrompt(post)
    // Revert to idle so the card is re-sendable.
    if (sendTimerRef.current) clearTimeout(sendTimerRef.current)
    sendTimerRef.current = setTimeout(() => setSendState("idle"), 2500)
  }

  // Double-clicking the card triggers the same action as the Send button —
  // but NOT when the double-click lands on the interactive prompt (tags are
  // click/double-click-selectable text) or on a button/link, to avoid
  // hijacking text selection or double-firing an action.
  const handleCardDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.closest(".prompt-container") || target.closest("button, a")) return
    handleSend(e)
  }

  // Gelbooru: preview_file_url is always used for thumbnails. Others: fallback chain.
  const isGelbooru = itemProvider === "gelbooru"
  const rawFileUrl = isGelbooru
    ? (post.preview_file_url || post.file_url)
    : (post.preview_file_url || post.file_url || post.large_file_url)
  const isDanbooruImg = !!rawFileUrl && (rawFileUrl.includes("donmai.us") || rawFileUrl.includes("cdn.donmai.us"))

  // Gelbooru/Rule34 route through the referrer-injecting worker proxy.
  // Danbooru: CloudFront primary, with a one-shot cache-busting retry (?_r=N)
  // so a transient origin-pull failure retries CloudFront before falling back
  // to the same-origin /api/download proxy (keeps failures off Vercel Fluid).
  const danbooruCdnUrl = getDanbooruCdnUrl(rawFileUrl || "")
  const danbooruCdnUrlWithRetry = danbooruCdnUrl && cdnRetry > 0
    ? `${danbooruCdnUrl}${danbooruCdnUrl.includes("?") ? "&" : "?"}_r=${cdnRetry}`
    : danbooruCdnUrl
  const fileUrl = (isGelbooru || itemProvider === "rule34") && rawFileUrl
    ? getGelbooruProxyUrl(rawFileUrl)
    : (danbooruCdnUrlWithRetry ?? rawFileUrl)
  const proxyFileUrl = isDanbooruImg
    ? `/api/download?url=${encodeURIComponent(rawFileUrl)}&inline=1`
    : undefined
  const displayImageUrl = (useFallbackUrl && proxyFileUrl) ? proxyFileUrl : (fileUrl || "")

  const handleImageError = () => {
    if (isDanbooruImg && danbooruCdnUrl && !useFallbackUrl && cdnRetry < 1) {
      setCdnRetry(c => c + 1)
      return
    }
    if (isDanbooruImg && !useFallbackUrl) {
      setUseFallbackUrl(true)
      return
    }
    setImageGaveUp(true)
  }

  const promptAdjusted = hasActiveOptions || hasReplacements || hasAppends

  return (
    <Card
      className="w-full h-full overflow-hidden card-hover group flex flex-col relative border-0"
      onDoubleClick={handleCardDoubleClick}
    >
      <div className="relative bg-muted overflow-hidden" style={{ height: imageHeight }}>
        {isPreviouslyCopied && (
          <div className="absolute top-2 left-2 z-20 pointer-events-none" aria-label="Previously copied">
            <motion.div
              initial={lowMotion ? false : { opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
              className="flex items-center justify-center h-5 w-5 rounded-full bg-background/80 border border-success-border shadow-sm"
            >
              <Check className="w-3 h-3 text-success-text" strokeWidth={3} />
            </motion.div>
          </div>
        )}

        {!displayImageUrl || imageGaveUp ? (
          <div className="absolute inset-0 flex items-center justify-center bg-muted">
            <ImageOff className="w-7 h-7 text-muted-foreground/50" aria-label="Image unavailable" />
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={displayImageUrl}
            alt={`${itemProvider} post ${post.id}`}
            className="absolute inset-0 w-full h-full object-cover object-top"
            loading="lazy"
            decoding="async"
            referrerPolicy={imageReferrerPolicy(itemProvider)}
            onError={handleImageError}
          />
        )}

        {/* Top-right: open the original post. Hidden until hover/focus on
            pointer devices, always visible on touch. */}
        <a
          href={postUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="absolute top-2 right-2 z-20 flex h-7 w-7 items-center justify-center rounded-full bg-background/80 text-muted-foreground shadow-sm transition-opacity hover:bg-background/95 hover:text-foreground focus-ring opacity-100 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
          aria-label="Open original post"
          title="Open original post"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>

        {/* Bottom-left: one static "prompt adjusted" dot (same as MasonryItem);
            the tooltip carries which option changed the prompt. */}
        {promptAdjusted && (
          <div className="absolute bottom-2 left-2 z-20">
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  className="flex h-5 w-5 items-center justify-center rounded-full bg-overlay/60 shadow-sm cursor-help focus-ring"
                  aria-label="Prompt adjusted"
                >
                  <span className="h-2 w-2 rounded-full bg-info" aria-hidden="true" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs max-w-[14rem]">
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">Prompt adjusted</span>
                  {hasActiveOptions && <span className="text-muted-foreground">Smart Tag Exclusion</span>}
                  {replacedTags.map(r => (
                    <span key={`r-${r.from}-${r.to}`} className="text-muted-foreground">{r.from} → {r.to}</span>
                  ))}
                  {appendedTags.map(a => (
                    <span key={`a-${a.from}`} className="text-muted-foreground">{a.from} + {a.append.join(", ")}</span>
                  ))}
                </div>
              </TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* Bottom-right: a single tag-count chip; categories + character post
            count live in its tooltip (same as MasonryItem). */}
        {totalTagsCount > 0 && (
          <div className="absolute bottom-2 right-2 z-10">
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  className="px-1.5 py-0.5 rounded-md bg-overlay/60 text-overlay-foreground/90 text-[11px] font-medium tabular-nums flex items-center gap-1 shadow-sm cursor-help focus-ring"
                  aria-label={`${totalTagsCount} tags`}
                >
                  <Tag className="w-3 h-3 opacity-70" aria-hidden="true" />
                  {totalTagsCount}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <div className="flex flex-col gap-1 min-w-[8.5rem]">
                  <span className="font-medium">{totalTagsCount} tags</span>
                  <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-1.5 gap-y-0.5">
                    {CATEGORY_BREAKDOWN.map(({ key, label, Icon, className }) => (
                      <Fragment key={key}>
                        <Icon className={`w-3 h-3 ${className}`} aria-hidden="true" />
                        <span className="text-muted-foreground">{label}</span>
                        <span className="tabular-nums text-right">{classifiedTags[key].length}</span>
                      </Fragment>
                    ))}
                  </div>
                  {/* Hidden when "Include Characters" is off so an anonymized
                      prompt doesn't leak the character's identity. */}
                  {tagCountIndicator && promptOptions.includeCharacters && (
                    <span className="flex items-center gap-1.5 border-t border-border pt-1 text-muted-foreground">
                      <Users className="w-3 h-3" aria-hidden="true" />
                      Character posts: <span className="text-popover-foreground tabular-nums">{tagCountIndicator}</span>
                    </span>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>

      <div className="card-content-medium flex flex-col justify-between" style={{ height: POCKET_FOOTER_HEIGHT }}>
        <div className="bg-muted/50 rounded-lg overflow-hidden prompt-container">
          <InteractivePrompt
            initialPrompt={displayContent}
            onUpdate={setModifiedContent}
            globalWeights={globalWeights}
            onSearch={onSearch}
            onPromoteToGlobal={isGlobalWeightsEnabled ? onGlobalWeightChange : undefined}
            conflictingTags={conflictingTags}
          />
        </div>

        {/* Copy · per-category copy options · Send (primary). */}
        <div className="flex button-group items-stretch isolate w-full mt-2">
          <Button
            onClick={handleCopy}
            variant="outline"
            className={`flex-none w-8 focus-ring rounded-r-none border-r-0 px-0 h-8 transition-colors ${
              copied ? "bg-success-soft text-success-text border-success-border hover:bg-success-soft" : ""
            }`}
            title={isPreviouslyCopied ? "Copy prompt again" : "Copy prompt"}
            aria-label={copied ? "Copied" : "Copy prompt"}
            disabled={!displayPrompt}
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </Button>
          <CopyOptionsDropdown
            classifiedTags={classifiedTags}
            onCopyCategory={copyCategory}
            disabled={!displayPrompt}
            contentClassName="z-[10005]"
            trigger={
              <Button
                variant="outline"
                className="flex-none w-5 px-0 h-8 rounded-none border-r-0 focus-ring text-muted-foreground"
                disabled={!displayPrompt}
                aria-label="Copy options"
                title="Copy by category"
              >
                <ChevronDown className="h-3 w-3" aria-hidden="true" />
              </Button>
            }
          />
          <Button
            onClick={handleSend}
            variant={sendState === "queued" ? "outline" : "default"}
            className={`pocket-card-send-btn flex-1 min-w-0 focus-ring rounded-l-none text-xs px-2 h-8 font-semibold transition-colors ${
              sendState === "queued" ? "border-warning-border text-warning-text bg-warning-soft hover:bg-warning-soft" : ""
            }`}
            disabled={!displayPrompt}
            title="Send to generator (or double-click the card)"
          >
            {sendState === "queued"
              ? <Loader2 className={`w-3.5 h-3.5 shrink-0 ${lowMotion ? "" : "animate-spin"}`} />
              : <Send className="w-3.5 h-3.5 shrink-0" />}
            <span className="ml-1 truncate">{sendState === "queued" ? "Queued" : "Send"}</span>
          </Button>
        </div>
      </div>
    </Card>
  )
})
