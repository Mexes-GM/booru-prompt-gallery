"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
import { motion } from "framer-motion"
import { useLowMotion } from "@/hooks/use-low-motion"
import { usePostHog } from "posthog-js/react"
import { Button } from "@/components/ui/button"
import { InfoTooltip } from "@/components/ui/info-tooltip"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog"
import { Heart, History, FileCheck2, Dices, Sparkles } from "lucide-react"
import type { BooruProvider } from "@/lib/api-client"
import { userPreferences } from "@/lib/storage"
import { shouldConfirmProvider, ADULT_ONLY_PROVIDER } from "@/lib/nsfw-consent"

const TrendSheet = dynamic(() => import("@/components/trends/trend-sheet").then(m => m.TrendSheet), { ssr: false, loading: () => null })
const FeedbackDialog = dynamic(() => import("@/components/feedback-dialog").then(m => m.FeedbackDialog), { ssr: false, loading: () => null })

const PROVIDERS = ['danbooru', 'gelbooru', 'aibooru', 'rule34', 'e621'] as const

const PROVIDER_LABELS: Record<typeof PROVIDERS[number], string> = {
  danbooru: 'Danbooru',
  gelbooru: 'Gelbooru',
  aibooru: 'Aibooru',
  rule34: 'Rule34',
  e621: 'e621',
}

interface GalleryToolbarProps {
  booruProvider: BooruProvider
  setBooruProvider: (provider: BooruProvider) => void
  showFavorites: boolean
  toggleShowFavorites: () => void
  favoritesCount: number
  showHistory: boolean
  toggleShowHistory: () => void
  historyCount: number
  isMergeMode: boolean
  mergeModeType: 'merge' | 'variations'
  disableMergeMode: () => void
  enableMergeMode: () => void
  enableVariationMode: () => void
  setSearchTags: (tags: string) => void
  onOpenReverseParser: () => void
  onProviderChange: (provider: BooruProvider) => void
}

/**
 * "Top Bar" above the search input: the API provider selector (with the
 * shared-layout "active provider" pill animation) and the row of quick action
 * buttons — Favorites toggle, Trending sheet, Merge mode, Variation mode,
 * Import & Clean (reverse prompt parser), and the feedback dialog.
 */
export function GalleryToolbar({
  booruProvider,
  setBooruProvider,
  showFavorites,
  toggleShowFavorites,
  favoritesCount,
  showHistory,
  toggleShowHistory,
  historyCount,
  isMergeMode,
  mergeModeType,
  disableMergeMode,
  enableMergeMode,
  enableVariationMode,
  setSearchTags,
  onOpenReverseParser,
  onProviderChange,
}: GalleryToolbarProps) {
  // Capa 3: first-time confirmation before switching to the adult-only Rule34
  // provider (which cannot be rating-filtered). Once acknowledged, switching is
  // instant. Applies the same side effects as a normal provider switch.
  const [rule34DialogOpen, setRule34DialogOpen] = useState(false)
  const posthog = usePostHog()
  const lowMotion = useLowMotion()

  const applyProvider = (p: BooruProvider) => {
    setBooruProvider(p)
    if (showFavorites) {
      toggleShowFavorites()
    }
    if (showHistory) {
      toggleShowHistory()
    }
    onProviderChange(p)
    posthog.capture('provider_changed', { provider: p })
  }

  const handleSelectProvider = (p: BooruProvider) => {
    if (shouldConfirmProvider(p, userPreferences.getRule34Acknowledged())) {
      setRule34DialogOpen(true)
      return
    }
    applyProvider(p)
  }

  const confirmRule34 = () => {
    userPreferences.setRule34Acknowledged(true)
    applyProvider(ADULT_ONLY_PROVIDER as BooruProvider)
    setRule34DialogOpen(false)
    posthog.capture('rule34_consent_confirmed')
  }

  return (
    <div className="flex flex-col lg:flex-row gap-8 justify-start items-start lg:items-center">
      {/* API Provider Selector */}
      <div className="flex flex-col gap-1.5 w-full lg:w-auto" data-tour="provider">
        <span className="text-xs font-medium text-muted-foreground ml-1">API Provider</span>
        <div className="bg-muted/50 p-1 rounded-lg flex flex-wrap sm:flex-nowrap gap-1 w-full sm:w-auto">
          {PROVIDERS.map(p => (
            <Button
              key={p}
              type="button"
              variant="ghost"
              onClick={() => handleSelectProvider(p)}
              className={`relative h-11 sm:h-8 text-sm px-3 sm:px-4 min-w-fit flex-1 sm:flex-none whitespace-nowrap ${!showFavorites && !showHistory && booruProvider === p ? "text-foreground hover:bg-transparent" : "text-muted-foreground hover:text-foreground"}`}
            >
              {!showFavorites && !showHistory && booruProvider === p && (
                <motion.div
                  layoutId="activeProvider"
                  className="absolute inset-0 bg-background shadow-sm rounded-md"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                />
              )}
              <span className="relative z-10 capitalize">{PROVIDER_LABELS[p]}</span>
            </Button>
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex flex-col gap-1.5 w-full lg:w-auto" data-tour="modes">
        <span className="text-xs font-medium text-muted-foreground ml-1">Options</span>
        <div className="flex items-center gap-2 w-full lg:w-auto justify-start flex-wrap">

          <InfoTooltip
            hideIcon
            side="bottom"
            title="Favorites Gallery"
            description="Access your personalized collection of saved prompts. You can organize your favorite posts into custom folders, making it easier to manage and retrieve distinct styles or characters for your AI art workflow."
          >
            <Button
              asChild
              variant="secondary"
              className={`h-11 sm:h-9 px-3 gap-1 transition-colors duration-200 cursor-pointer ${showFavorites
                ? "bg-red-200 text-red-800 hover:bg-red-300 dark:bg-red-800 dark:text-red-100 dark:hover:bg-red-700 shadow-inner"
                : "bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40"
                }`}
            >
              <motion.button
                type="button"
                onClick={() => {
                  if (isMergeMode) disableMergeMode()
                  if (showHistory) toggleShowHistory()
                  toggleShowFavorites()
                  posthog.capture('favorites_panel_toggled', { action: showFavorites ? 'close' : 'open' })
                }}
                whileHover={lowMotion ? undefined : { scale: 1.02 }}
                whileTap={{ scale: 0.95 }}
              >
                <motion.div
                  animate={showFavorites ? { scale: [1, 1.3, 1], rotate: [0, -10, 10, -10, 0] } : { scale: 1, rotate: 0 }}
                  transition={{ duration: 0.4 }}
                >
                  <Heart className={`w-4 h-4 ${showFavorites ? "fill-current" : ""}`} />
                </motion.div>
                <span className="text-xs font-medium">Favs ({favoritesCount})</span>
              </motion.button>
            </Button>
          </InfoTooltip>

          {/* Trending Sheet */}
          <TrendSheet onSelectTag={setSearchTags} />

          {/* History Toggle — mirrors the Favorites toggle: switches the same
              masonry grid to show previously copied prompts, no navigation. */}
          <InfoTooltip
            hideIcon
            side="bottom"
            title="Prompt History"
            description="Browse the prompts you've previously copied, shown in the same gallery grid as search results and favorites — with full categories, weights and per-category copy."
          >
            <Button
              asChild
              variant="secondary"
              className={`h-11 sm:h-9 px-3 gap-1 transition-colors duration-200 cursor-pointer ${showHistory
                ? "bg-amber-200 text-amber-800 hover:bg-amber-300 dark:bg-amber-800 dark:text-amber-100 dark:hover:bg-amber-700 shadow-inner"
                : "bg-amber-50 text-amber-600 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-400 dark:hover:bg-amber-900/40"
                }`}
            >
              <motion.button
                type="button"
                onClick={() => {
                  if (isMergeMode) disableMergeMode()
                  if (showFavorites) toggleShowFavorites()
                  toggleShowHistory()
                  posthog.capture('history_panel_toggled', { action: showHistory ? 'close' : 'open' })
                }}
                whileHover={lowMotion ? undefined : { scale: 1.02 }}
                whileTap={{ scale: 0.95 }}
              >
                <History className="w-4 h-4" />
                <span className="text-xs font-medium">History ({historyCount})</span>
              </motion.button>
            </Button>
          </InfoTooltip>

          {/* Prompt Merge Button - moved from Search Bar */}
          <InfoTooltip
            hideIcon
            side="bottom"
            title="Merge Mode"
            description="Quickly combine prompts from multiple cards into a single prompt. Very useful when you want to take the character from one post, the clothing from another, and the background from a third one, merging them into one perfect prompt."
            visual={
              <div className="w-full flex flex-col gap-2 p-1.5 text-[10px] font-mono">
                <div className="flex justify-between items-center bg-muted/50 p-2 rounded-md border border-border/50">
                  <span className="text-blue-500 dark:text-blue-400">1girl, frieren</span>
                  <span className="text-muted-foreground font-bold">+</span>
                  <span className="text-green-500 dark:text-green-400">outdoors, blue sky</span>
                </div>
                <div className="flex items-center gap-2 px-1">
                  <span className="text-muted-foreground font-medium">Result:</span>
                  <span className="bg-blue-500/10 text-blue-600 dark:text-blue-400 px-2 py-1 rounded border border-blue-500/20">1girl, frieren, outdoors, blue sky</span>
                </div>
              </div>
            }
          >
            <Button
              type="button"
              onClick={() => {
                if (isMergeMode && mergeModeType === 'merge') {
                  disableMergeMode()
                  posthog.capture('merge_mode_toggled', { action: 'disable' })
                } else {
                  if (showFavorites) toggleShowFavorites()
                  if (showHistory) toggleShowHistory()
                  enableMergeMode()
                  posthog.capture('merge_mode_toggled', { action: 'enable' })
                }
              }}
              variant="secondary"
              className={`h-11 sm:h-9 px-3 gap-1 transition-colors duration-200 ${isMergeMode && mergeModeType === 'merge'
                ? "bg-blue-200 text-blue-800 hover:bg-blue-300 dark:bg-blue-800 dark:text-blue-100 dark:hover:bg-blue-700"
                : "bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/40"
                }`}
            >
              <FileCheck2 className="w-4 h-4 fill-current" />
              <span className="text-xs font-medium">Merge</span>
            </Button>
          </InfoTooltip>

          {/* Prompt Variation Button */}
          <InfoTooltip
            hideIcon
            side="bottom"
            title="Prompt Variations"
            description="Select multiple prompts and format them into Wildcard variations ({ promptA | promptB }). This ensures each generation randomly picks one of the variants, perfect for quickly creating diverse examples without copying prompts individually."
            visual={
              <div className="w-full flex flex-col gap-2 p-1.5 text-[10px] font-mono">
                <div className="bg-muted/50 p-2 rounded-md border border-border/50 flex flex-col gap-1">
                  <div><span className="text-muted-foreground font-medium w-12 inline-block">Post 1:</span> <span className="text-indigo-500 dark:text-indigo-400">1girl, sitting</span></div>
                  <div><span className="text-muted-foreground font-medium w-12 inline-block">Post 2:</span> <span className="text-purple-500 dark:text-purple-400">1girl, standing</span></div>
                </div>
                <div className="flex items-center gap-2 px-1">
                  <span className="text-muted-foreground font-medium">Result:</span>
                  <span className="bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 px-2 py-1 rounded border border-indigo-500/20">{"{ 1girl, sitting | 1girl, standing }"}</span>
                </div>
              </div>
            }
          >
            <Button
              type="button"
              onClick={() => {
                if (isMergeMode && mergeModeType === 'variations') {
                  disableMergeMode()
                  posthog.capture('variation_mode_toggled', { action: 'disable' })
                } else {
                  if (showFavorites) toggleShowFavorites()
                  if (showHistory) toggleShowHistory()
                  enableVariationMode()
                  posthog.capture('variation_mode_toggled', { action: 'enable' })
                }
              }}
              variant="secondary"
              className={`h-11 sm:h-9 px-3 gap-1 transition-colors duration-200 ${isMergeMode && mergeModeType === 'variations'
                ? "bg-indigo-200 text-indigo-800 hover:bg-indigo-300 dark:bg-indigo-800 dark:text-indigo-100 dark:hover:bg-indigo-700"
                : "bg-indigo-50 text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-900/20 dark:text-indigo-400 dark:hover:bg-indigo-900/40"
                }`}
            >
              <Dices className="w-4 h-4 fill-current" />
              <span className="text-xs font-medium">Variation</span>
            </Button>
          </InfoTooltip>

          <InfoTooltip
            hideIcon
            side="bottom"
            title="Import & Clean"
            description="Paste an existing prompt or extract one directly from an image. It will automatically be processed through our internal prompt cleaner—removing irrelevant tags, reorganizing categories, and optimizing it just like prompts fetched directly from the APIs."
          >
            <Button
              type="button"
              onClick={onOpenReverseParser}
              variant="secondary"
              className="h-11 sm:h-9 px-3 gap-1 transition-colors duration-200 bg-purple-50 text-purple-600 hover:bg-purple-100 dark:bg-purple-900/20 dark:text-purple-400 dark:hover:bg-purple-900/40"
            >
              <Sparkles className="w-4 h-4 fill-current" />
              <span className="text-xs font-medium">Import</span>
            </Button>
          </InfoTooltip>

          <div className="inline-flex" data-tour="feedback">
            <FeedbackDialog />
          </div>
        </div>
      </div>

      {/* Capa 3: Rule34 adult-only confirmation (first time only) */}
      <AlertDialog open={rule34DialogOpen} onOpenChange={setRule34DialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to Rule34?</AlertDialogTitle>
            <AlertDialogDescription>
              Rule34 hosts exclusively explicit / adult (18+) content and, unlike
              the other providers, its results cannot be filtered to Safe — the
              Safe/NSFW toggle is disabled while it&apos;s selected. Only continue
              if you are of legal age and want to see this material. You can switch
              back to another provider at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <AlertDialogAction type="button" onClick={confirmRule34}>
              Continue to Rule34
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
