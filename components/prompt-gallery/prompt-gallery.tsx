"use client"

import type React from "react"
import { useState, useEffect, useRef, useMemo, useCallback, startTransition, useDeferredValue } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DebouncedInput, DebouncedHTMLInput } from "@/components/ui/debounced-input"
import { SearchWithAutocomplete } from "@/components/prompt-gallery/search-with-autocomplete"
import { AnnouncementsCarousel } from "@/components/prompt-gallery/announcements-carousel"
import { getDanbooruCdnUrl } from "@/lib/proxy-url"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import {
  Copy,
  Check,
  Loader2,
  RefreshCw,
  Search,
  Grid3X3,
  List,
  ExternalLink,
  Heart,
  Download,
  ZoomIn,
  ZoomOut,
  AlertTriangle,
  AlertCircle,
  Infinity as InfinityIcon,
  CheckCircle,
  X,
  ChevronUp,
  Shield,
  History,
  Trash2,
  Settings,
  Dices,
  ChevronDown,
  Save,
  Shuffle,
  Sparkles,
  BrainCircuit,
  CornerDownRight,
  Image as ImageIcon,
  ScrollText,
  Globe,
  ArrowRight,
  Github,
  Pin,
  Ban,
  Activity,
} from "lucide-react"

import dynamic from "next/dynamic"
import { getCachedTagOverrides } from "@/lib/supabase/client-queries"
import { DeploymentStatusBadges, MirrorLink } from "@/components/prompt-gallery/deployment-status"

const TrendSheet = dynamic(() => import("@/components/trends/trend-sheet").then(m => m.TrendSheet), { ssr: false, loading: () => null })
const FeedbackDialog = dynamic(() => import("@/components/feedback-dialog").then(m => m.FeedbackDialog), { ssr: false, loading: () => null })

import pkg from "@/package.json"
import { useToast } from "@/hooks/use-toast"
import { useIsMobile } from "@/hooks/use-mobile"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { InfoTooltip } from "@/components/ui/info-tooltip"
import { SmoothFilterSlider } from "@/components/ui/smooth-filter-slider"
import { UserNav } from "@/components/auth/user-nav"
import Image from "next/image"
import { motion, AnimatePresence, LayoutGroup } from "framer-motion"
import { renderIcon } from "@/components/prompt-gallery/save-favorite-button"
import {
  hasMultipleTags, getFinalQueryTagsWithMeta, getProviderTagLimit, isTagCountSupportedProvider, detectMisusedMetatags, BooruPost, BooruProvider, isAibooruPost, apiUrl,
} from "@/lib/api-client"
import { favKey } from "@/lib/favorites-logic"

import { userPreferences, STORAGE_KEYS } from "@/lib/storage"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Slider } from "@/components/ui/slider"
import { classifyTags, type ClassifiedTags } from "@/lib/tag-classifier"
import { type BackgroundMode } from "@/lib/background-detector"
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
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
import { Label } from "@/components/ui/label"
import {
  safeTrack,
  initScrollDepthTracking,
  trackTimeOnPage,
  trackExternalLink,
  trackCopy,
  trackViewMode,
  trackScaleChange,
  trackProviderChange,
} from '@/lib/analytics'
import { SOCIAL_URLS } from '@/lib/constants'

import { MasonryGrid } from "@/components/masonry-grid"
import { useBooruSearch } from "@/hooks/use-booru-search"
import { useBooruFavorites } from "@/hooks/use-booru-favorites"
import { useSavedArtists } from "@/hooks/use-saved-artists"
import { useDetailedBackgrounds } from "@/hooks/use-detailed-backgrounds"
import { cn } from "@/lib/utils"
import { MasonryItem } from "./masonry-item"
import { ArtistGrid } from "./artist-card"
import { useBlacklist } from "@/hooks/use-blacklist"
// Code-split (perf plan P2b): heavy, conditionally-shown features are loaded
// as separate chunks so they don't inflate the initial PromptGallery bundle
// that gates first render / LCP. They render null until their chunk arrives.
const BlacklistManager = dynamic(() => import("@/components/prompt-gallery/blacklist-manager").then(m => m.BlacklistManager), { ssr: false, loading: () => null })
import { NoResultsState } from "@/components/prompt-gallery/no-results-state"

import { useMergeMode } from "@/hooks/use-merge-mode"
const MergeStickyFooter = dynamic(() => import("./merge-sticky-footer").then(m => m.MergeStickyFooter), { ssr: false, loading: () => null })
const AiConvertStickyFooter = dynamic(() => import("./ai-convert-sticky-footer").then(m => m.AiConvertStickyFooter), { ssr: false, loading: () => null })
import type { ConvertMeta } from "./ai-convert-sticky-footer"
import { StickyMiniControlPanel } from "./sticky-mini-control-panel"
import { FileCheck2 } from "lucide-react"
import { InfiniteScrollTrigger } from "@/components/ui/infinite-scroll-trigger"
import { SaveFavoriteButton } from "./save-favorite-button"
import { useDebounce } from "@/hooks/use-debounce"

import { usePersistentState } from "@/hooks/use-persistent-state"
import { usePreferencesSync } from "@/hooks/use-preferences-sync"
import { GalleryModals } from "@/components/prompt-gallery/gallery-modals"
import { GalleryHeader } from "@/components/prompt-gallery/gallery-header"
import { GalleryHero } from "@/components/prompt-gallery/gallery-hero"
import { TagsManagementPanel } from "@/components/prompt-gallery/tags-management-panel"
import { PromptGenerationOptionsPanel } from "@/components/prompt-gallery/prompt-generation-options-panel"
import { QueryStatusPanel } from "@/components/prompt-gallery/query-status-panel"
import { FavoritesFolderTabs } from "@/components/prompt-gallery/favorites-folder-tabs"
import { GalleryFooter } from "@/components/prompt-gallery/gallery-footer"
import { GalleryToolbar } from "@/components/prompt-gallery/gallery-toolbar"
import { SearchBar } from "@/components/prompt-gallery/search-bar"
import { ResultsGrid } from "@/components/prompt-gallery/results-grid"
import { ResultsStates } from "@/components/prompt-gallery/results-states"
import { FloatingActionButtons } from "@/components/prompt-gallery/floating-action-buttons"
import { ArtistGridSection } from "@/components/prompt-gallery/artist-grid-section"

import { useTagCounts } from "@/hooks/use-tag-counts"
import { usePromptOptions } from "@/hooks/use-prompt-options"
import { useBackgroundSettings } from "@/hooks/use-background-settings"
import { useGalleryViewState, type CardScale } from "@/hooks/use-gallery-view-state"
import { useGlobalWeights } from "@/hooks/use-global-weights"
import { usePresetsAndHistory } from "@/hooks/use-presets-and-history"

// ─────────────────────────────────────────────────────────────────────────────
// UnavailablePostsNotice
// Shows AFTER the folderMismatch detection confirms posts are not in favoritePosts
// post-fetch. Has a two-step flow to avoid false positives from code bugs:
//   Step 1 — neutral notice + "Check availability" button (no destructive action yet)
//   Step 2 — actively re-queries /api/favorites for the missing post IDs. Only posts
//             that return empty/404 from the booru are marked as confirmed-deleted and
//             shown with a "Remove" button. Posts that DO load on re-check are silently
//             dropped from the list (they were a loading bug, not a deletion).
// ─────────────────────────────────────────────────────────────────────────────
type VerificationState =
  | { phase: 'idle' }
  | { phase: 'checking'; checked: number; total: number }
  | { phase: 'done'; confirmed: string[]; recovered: number }

function UnavailablePostsNotice({
  unavailableKeys,
  activeFolderId,
  toggleFavorite,
  injectRecoveredPosts,
}: {
  unavailableKeys: string[]
  activeFolderId: string | null
  toggleFavorite: (id: number, provider?: string) => Promise<void>
  injectRecoveredPosts: (posts: BooruPost[]) => Promise<void>
}) {
  const [state, setState] = useState<VerificationState>({ phase: 'idle' })
  const [removing, setRemoving] = useState(false)

  // Reset ONLY when the user navigates to a different folder.
  // Do NOT reset based on unavailableKeys, otherwise a successful recovery
  // shrinking the list will instantly reset the UI back to the 'idle' Check button.
  useEffect(() => {
    setState({ phase: 'idle' })
  }, [activeFolderId])

  const handleCheck = async () => {
    // Group unavailable keys by provider for a batched re-fetch
    const byProvider: Record<string, number[]> = {}
    for (const key of unavailableKeys) {
      const colonIdx = key.indexOf(':')
      if (colonIdx === -1) continue
      const provider = key.slice(0, colonIdx)
      const id = parseInt(key.slice(colonIdx + 1), 10)
      if (isNaN(id)) continue
      ;(byProvider[provider] ??= []).push(id)
    }

    const totalToCheck = Object.values(byProvider).reduce((n, ids) => n + ids.length, 0)
    setState({ phase: 'checking', checked: 0, total: totalToCheck })

    // Re-query /api/favorites for each provider batch
    const foundIds = new Set<string>()
    const recoveredPosts: BooruPost[] = []
    let checkedCount = 0

    // Batch client-side (like the main favorites loader) so we can report live
    // progress. Danbooru is rate-limited, so its batches run sequentially with a
    // delay; other providers run in parallel.
    const BATCH = 20
    const DANBOORU_DELAY = 1100

    const bumpProgress = (n: number) => {
      checkedCount += n
      setState({ phase: 'checking', checked: checkedCount, total: totalToCheck })
    }

    const fetchBatch = async (provider: string, ids: number[]) => {
      try {
        const res = await fetch('/api/favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ favorites: ids.map(id => ({ id, provider })) }),
        })
        // Non-OK (rate limit / server error) → inconclusive for this batch:
        // leave these ids out of foundIds so the original delete semantics are
        // preserved (still counted as missing), but never crash the flow.
        if (!res.ok) return
        const posts: BooruPost[] = await res.json()
        for (const p of posts) {
          if (p?.id) {
            foundIds.add(`${provider}:${p.id}`)
            recoveredPosts.push(p)
          }
        }
      } catch {
        // Network error on re-check — treat as inconclusive (don't mark deleted)
        for (const id of ids) foundIds.add(`${provider}:${id}`)
      } finally {
        bumpProgress(ids.length)
      }
    }

    try {
      for (const [provider, ids] of Object.entries(byProvider)) {
        const batches: number[][] = []
        for (let i = 0; i < ids.length; i += BATCH) batches.push(ids.slice(i, i + BATCH))

        if (provider === 'danbooru') {
          for (let i = 0; i < batches.length; i++) {
            await fetchBatch(provider, batches[i])
            if (i < batches.length - 1) {
              await new Promise(r => setTimeout(r, DANBOORU_DELAY))
            }
          }
        } else {
          await Promise.allSettled(batches.map(b => fetchBatch(provider, b)))
        }
      }
    } catch {
      // Complete failure — treat all as inconclusive, show no delete buttons
      setState({ phase: 'done', confirmed: [], recovered: unavailableKeys.length })
      return
    }

    // Posts that are STILL not found after the active re-check → confirmed deleted
    const confirmed = unavailableKeys.filter(k => !foundIds.has(k))
    const recoveredCount = unavailableKeys.length - confirmed.length

    if (recoveredPosts.length > 0) {
      await injectRecoveredPosts(recoveredPosts)
    }

    setState({ phase: 'done', confirmed, recovered: recoveredCount })
  }

  const handleRemove = async () => {
    if (state.phase !== 'done') return
    setRemoving(true)
    
    // Run removals in parallel so React batches the optimistic updates
    // into a single render, preventing the Masonry Grid from jumping
    // upwards multiple times during the process.
    await Promise.all(state.confirmed.map(key => {
      const colonIdx = key.indexOf(':')
      if (colonIdx === -1) return Promise.resolve()
      const provider = key.slice(0, colonIdx)
      const id = parseInt(key.slice(colonIdx + 1), 10)
      if (isNaN(id)) return Promise.resolve()
      return toggleFavorite(id, provider)
    }))
    
    setRemoving(false)
  }

  // Define a stable container class with a min-height to prevent layout jumps
  // when swapping between states (checking, done, removing).
  return (
    <div className="mb-6 flex justify-center w-full px-4 animate-in fade-in slide-in-from-top-4 duration-500">
      <Alert variant="destructive" className="max-w-2xl bg-destructive/5 border-destructive/20 shadow-sm relative overflow-hidden transition-all duration-300">
        <div className="absolute top-0 left-0 w-1 h-full bg-destructive/50" />
        
        {state.phase === 'idle' && (
          <div className="flex flex-col sm:flex-row items-center gap-4 py-1">
            <div className="flex items-center gap-3 flex-1">
              <div className="bg-destructive/10 p-2 rounded-full">
                <AlertCircle className="h-5 w-5 text-destructive" />
              </div>
              <div className="space-y-1">
                <AlertTitle className="text-destructive font-medium mb-0">Missing Favorites</AlertTitle>
                <AlertDescription className="text-muted-foreground text-xs leading-relaxed">
                  <strong className="text-foreground">{unavailableKeys.length}</strong> posts couldn&apos;t be loaded from the original booru server. They might be temporarily down or deleted by the author.
                </AlertDescription>
              </div>
            </div>
            <Button 
              onClick={handleCheck} 
              variant="outline" 
              size="sm"
              className="w-full sm:w-auto shrink-0 border-destructive/20 hover:bg-destructive/10 hover:text-destructive transition-colors"
            >
              <Search className="h-4 w-4 mr-2" />
              Check availability
            </Button>
          </div>
        )}

        {state.phase === 'checking' && (
          <div className="flex flex-col gap-2 py-2">
            <div className="flex items-center gap-4">
              <Loader2 className="h-5 w-5 text-destructive animate-spin shrink-0" />
              <div className="space-y-1 flex-1">
                <AlertTitle className="text-destructive font-medium mb-0">Verifying on booru...</AlertTitle>
                <AlertDescription className="text-muted-foreground text-xs">
                  Querying the original server to see if the posts still exist. This might take a few seconds due to rate limits.
                </AlertDescription>
              </div>
            </div>
            <div className="w-full pl-9">
              <div className="w-full bg-destructive/10 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-destructive/60 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${state.total > 0 ? Math.round((state.checked / state.total) * 100) : 0}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground text-right tabular-nums">
                {Math.min(state.checked, state.total)} / {state.total}
              </p>
            </div>
          </div>
        )}

        {state.phase === 'done' && (
          <div className="flex flex-col gap-3 py-1 animate-in fade-in duration-300">
            {state.recovered > 0 && (
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 p-2 rounded-md border border-emerald-200 dark:border-emerald-500/20">
                <CheckCircle className="h-4 w-4 shrink-0" />
                <span className="text-sm font-medium">
                  Success! {state.recovered} {state.recovered === 1 ? 'post was' : 'posts were'} recovered and permanently restored to your gallery.
                </span>
              </div>
            )}
            
            {state.confirmed.length > 0 ? (
              <div className="flex flex-col sm:flex-row items-center gap-4 mt-1">
                <div className="flex items-center gap-3 flex-1">
                  <div className="bg-destructive/10 p-2 rounded-full shrink-0">
                    <Trash2 className="h-5 w-5 text-destructive" />
                  </div>
                  <div className="space-y-1">
                    <AlertTitle className="text-destructive font-medium mb-0">Posts Deleted</AlertTitle>
                    <AlertDescription className="text-muted-foreground text-xs">
                      <strong className="text-foreground">{state.confirmed.length}</strong> posts have been permanently removed from the booru source and cannot be recovered.
                    </AlertDescription>
                  </div>
                </div>
                
                <Button 
                  onClick={handleRemove} 
                  disabled={removing} 
                  variant="destructive"
                  size="sm"
                  className="w-full sm:w-auto shrink-0 shadow-sm"
                >
                  {removing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Removing...
                    </>
                  ) : (
                    <>
                      <Trash2 className="h-4 w-4 mr-2" />
                      Remove from gallery
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-muted-foreground py-2">
                <CheckCircle className="h-5 w-5" />
                <span className="text-sm">All posts are available. The grid will update shortly.</span>
              </div>
            )}
          </div>
        )}
      </Alert>
    </div>
  )
}

export function PromptGallery() {
  // 1. Core Logic Hooks
  const search = useBooruSearch()
  const { blacklist, addTag, removeTag, resetBlacklist } = useBlacklist()
  // Folder filter state ('artists' is a reserved virtual folder for saved artists)
  const [activeFavoriteFolder, setActiveFavoriteFolder] = useState<string | null | 'all' | 'artists'>('all')
  const favs = useBooruFavorites(search.booruProvider, activeFavoriteFolder)
  const savedArtists = useSavedArtists()
  const tagCounts = useTagCounts(search.allPosts, search.booruProvider)
  const { toast } = useToast()
  const isMobile = useIsMobile()

  const [imageRateLimited, setImageRateLimited] = useState(false)
  const imageErrorCountRef = useRef(0)
  const IMAGE_ERROR_THRESHOLD = 8

  const handleImageError = useCallback(() => {
    imageErrorCountRef.current++
    if (imageErrorCountRef.current >= IMAGE_ERROR_THRESHOLD && !imageRateLimited) {
      setImageRateLimited(true)
    }
  }, [imageRateLimited])

  // Reset rate limiting when search query or provider changes
  useEffect(() => {
    setImageRateLimited(false)
    imageErrorCountRef.current = 0
  }, [search.booruProvider, search.debouncedSearchTags])

  // Sync preferences with cloud
  usePreferencesSync()

  // 2. Local UI State & Persistence
  const {
    viewMode, setViewMode,
    cardScale, setCardScale,
    scaleValue, setScaleValue,
  } = useGalleryViewState()



  // Reset folder filter when exiting favorites view so it doesn't linger and hide
  // the search grid (e.g. 'artists' tab would suppress masonry render on exit).
  useEffect(() => {
    if (!favs.showFavorites && activeFavoriteFolder !== 'all') {
      setActiveFavoriteFolder('all')
    }
  }, [favs.showFavorites, activeFavoriteFolder])

  // User Prefs UI state
  const {
    promptOptions, setPromptOptions,
    includeCharacters, optimizeTags, smartTagExclusion,
    setIncludeCharacters, setOptimizeTags, setSmartTagExclusion,
  } = usePromptOptions()

  const [showCategoryTagBadges, setShowCategoryTagBadges] = useState(true)

  const {
    backgroundMode, setBackgroundMode,
    deferredBackgroundMode,
    detailedBackgroundsList,
    simpleBackgroundReplacementTags, setSimpleBackgroundReplacementTags,
    debouncedSimpleBackgroundReplacementTags,
    randomBackgroundPatterns, setRandomBackgroundPatterns,
    randomBackgroundIncludeGradients, setRandomBackgroundIncludeGradients,
  } = useBackgroundSettings()

  const [excludeInput, setExcludeInput] = usePersistentState(
    "",
    userPreferences.getExcludeTagsInput,
    userPreferences.setExcludeTagsInput,
    "excludeTags",
    STORAGE_KEYS.EXCLUDE_TAGS
  )

  const [addInput, setAddInput] = usePersistentState(
    "",
    userPreferences.getAddTagsInput,
    userPreferences.setAddTagsInput,
    "addTags",
    STORAGE_KEYS.ADD_TAGS
  )

  const [showSettings, setShowSettings] = useState(true)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [showBackToTop, setShowBackToTop] = useState(false)
  const [showStickyPanel, setShowStickyPanel] = useState(false)
  const controlPanelRef = useRef<HTMLDivElement>(null)

  // Folder Delete State
  const [folderToDelete, setFolderToDelete] = useState<{ id: string, name: string } | null>(null)

  // Modals
  const [teachModalData, setTeachModalData] = useState<{ open: boolean, tags: ClassifiedTags | null }>({ open: false, tags: null })
  const [showWelcomeModal, setShowWelcomeModal] = useState(false)

  const {
    presets, setPresets,
    history, setHistory,
    previouslyCopiedPostIds,
    isPresetDialogOpen, setIsPresetDialogOpen,
    presetName, setPresetName,
    savePreset, loadPreset, deletePreset,
    addToHistory, removeHistoryItem, clearHistory,
  } = usePresetsAndHistory({ isClient: search.isClient, addInput, setAddInput, toast })

  const [tagOverrides, setTagOverrides] = useState<Record<string, string>>({})

  // Debounce expensive inputs
  const debouncedAddInput = useDebounce(addInput, 500)
  const debouncedExcludeInput = useDebounce(excludeInput, 500)

  // Global Weights State — syncs across tabs/extension via localStorage
  const {
    globalWeights, setGlobalWeights,
    isGlobalWeightsEnabled, setIsGlobalWeightsEnabled,
    isGlobalWeightsModalOpen, setIsGlobalWeightsModalOpen,
    handleGlobalWeightChange, handleClearGlobalWeights, handleRemoveGlobalWeight,
    toggleGlobalWeights,
  } = useGlobalWeights(toast)

  const [isReverseParserModalOpen, setIsReverseParserModalOpen] = useState(false)

  // Prompt Generation Options: collapsible on mobile only (always expanded on
  // desktop, where it lives in the right column). Mobile choice persisted.
  const [isPromptOptionsExpanded, setIsPromptOptionsExpanded] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try {
      return localStorage.getItem('prompt_options_expanded') === 'true'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem('prompt_options_expanded', String(isPromptOptionsExpanded))
    } catch {
      // Storage may be unavailable (private mode); non-fatal.
    }
  }, [isPromptOptionsExpanded])

  // Announcements Panel state: auto-expand on new version
  const [isAnnouncementsOpen, setIsAnnouncementsOpen] = useState(true)

  useEffect(() => {
    try {
      const raw = localStorage.getItem('announcements_state')
      const parsed = raw ? JSON.parse(raw) : null
      if (parsed && parsed.version === pkg.version) {
        setIsAnnouncementsOpen(!parsed.collapsed)
      } else {
        setIsAnnouncementsOpen(true)
        localStorage.setItem('announcements_state', JSON.stringify({ collapsed: false, version: pkg.version }))
      }
    } catch {
      setIsAnnouncementsOpen(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Merge Mode Hook
  const mergeMode = useMergeMode(globalWeights, isGlobalWeightsEnabled, debouncedAddInput, tagOverrides, deferredBackgroundMode, debouncedSimpleBackgroundReplacementTags)

  // Extract stable mergeMode pieces to avoid dependency churn
  const mergeModeIsMergeMode = mergeMode.isMergeMode
  const mergeModeDisableMergeMode = mergeMode.disableMergeMode
  const mergeModeToggleMergeMode = mergeMode.toggleMergeMode
  const mergeModeSelectedPosts = mergeMode.selectedPosts
  const mergeModeTogglePostPart = mergeMode.togglePostPart

  // Natural Language AI Mode State
  const [isAiConvertMode, setIsAiConvertMode] = useState(false)
  const [aiConvertTags, setAiConvertTags] = useState("")
  const [aiConvertImage, setAiConvertImage] = useState<string | undefined>(undefined)
  const [aiConvertMeta, setAiConvertMeta] = useState<ConvertMeta | undefined>(undefined)

  // Handle sending tags to convert and auto-enable mode
  const handleSendToConvert = useCallback((tagsToSend: string, imageUrl?: string, meta?: ConvertMeta) => {
    // Disable merge mode if active
    if (mergeModeIsMergeMode) {
      mergeModeDisableMergeMode()
    }
    setAiConvertTags(tagsToSend)
    setAiConvertImage(imageUrl)
    setAiConvertMeta(meta)
    setIsAiConvertMode(true)
  }, [mergeModeIsMergeMode, mergeModeDisableMergeMode])

  // Custom wrapper to enable/disable modes mutually exclusively
  const toggleAiConvertMode = useCallback(() => {
    setIsAiConvertMode(prev => {
      const next = !prev
      if (next && mergeModeIsMergeMode) {
        mergeModeDisableMergeMode()
      }
      return next
    })
  }, [mergeModeIsMergeMode, mergeModeDisableMergeMode])

  // Wrapper for toggling merge mode to automatically disable AI mode
  const handleToggleMergeMode = useCallback(() => {
    setIsAiConvertMode(false)
    mergeModeToggleMergeMode()
  }, [mergeModeToggleMergeMode])

  const effectiveScale = useMemo(() => {
    if (isMobile) {
      if (cardScale === 'small') return 'large'
      if (cardScale === 'large') return 'small'
    }
    return cardScale
  }, [cardScale, isMobile])

  const isTagCountValid = !search.tagCountFilter || /^\d+$/.test(search.tagCountFilter)
  // Disabled for Gelbooru/Rule34: confirmed empirically that they have no tagcount: metatag
  // (or any equivalent). A client-side post-fetch filter would be possible but was deliberately
  // not implemented — see the TAGCOUNT_SUPPORTED_PROVIDERS comment in lib/booru/tag-limits.ts.
  const isTagCountSupported = isTagCountSupportedProvider(search.booruProvider)

  // --- Side Effects ---

  const refreshOverrides = useCallback(async () => {
    try {
      const overrides = await getCachedTagOverrides()
      setTagOverrides(overrides)
    } catch (error) {
      console.error("Failed to refresh tag overrides:", error)
    }
  }, [])

  // Load tag overrides on mount - no circular dependency
  useEffect(() => {
    refreshOverrides()
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Scale effect - Slider drives persistence
  useEffect(() => {
    const scale = scaleValue[0]
    let val: CardScale = 'medium'
    if (scale === 1) val = 'small'
    else if (scale === 2) val = 'medium'
    else val = 'large'

    // Only update if different to avoid loops (though usePersistentState setter might trigger re-render)
    if (val !== cardScale) {
      setCardScale(val)
      trackScaleChange(val)
    }
  }, [scaleValue, cardScale, setCardScale])

  // We will render <title> directly in the JSX instead of useEffect
  
  // Scroll tracking
  useEffect(() => {
    const handleScroll = () => setShowBackToTop(window.scrollY > 400)
    window.addEventListener('scroll', handleScroll, { passive: true })

    const start = Date.now()
    safeTrack('app_open', {
      ua: typeof navigator !== 'undefined' ? navigator.userAgent : 'na',
      w: typeof window !== 'undefined' ? window.innerWidth : 0,
    })
    const cleanupScroll = initScrollDepthTracking()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') trackTimeOnPage(start)
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.removeEventListener('scroll', handleScroll)
      document.removeEventListener('visibilitychange', onVisibility)
      trackTimeOnPage(start)
      if (cleanupScroll) cleanupScroll()
    }
  }, [])

  // Intersection Observer for Main Control Panel to show Sticky Mini Panel
  useEffect(() => {
    const element = controlPanelRef.current
    if (!element) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        // Show only if the control panel's top has gone above the viewport top
        // and it is not intersecting.
        setShowStickyPanel(!entry.isIntersecting && entry.boundingClientRect.top < 0)
      },
      { threshold: 0 }
    )

    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [])

  const hasMounted = useRef(false)
  useEffect(() => {
    if (hasMounted.current && search.error) {
      // Error handling toast
      const is403 = search.error.status === 403 || search.error.statusCode === 403
      const isAibooruError = search.booruProvider === 'aibooru' && is403

      toast({
        title: isAibooruError ? "Aibooru Access Blocked" : "Connection error",
        description: isAibooruError
          ? "Aibooru is blocking server requests. Try Danbooru or Rule34 instead."
          : (search.error.message || "Could not load images"),
        variant: "destructive",
      })
    }
    hasMounted.current = true
  }, [search.error, search.booruProvider, toast])

  // Global weight handlers now live in useGlobalWeights()

  const handleImportRawPrompt = useCallback((prompt: string) => {
    // Set the imported prompt as search tag
    search.setSearchTags(prompt)
    setIsReverseParserModalOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [search])

  // Tag Search Handler (from MasonryItem)
  const handleTagSearch = useCallback((tag: string) => {
    // Unescape parentheses for search (kashima \(kancolle\) -> kashima (kancolle))
    const cleanTag = tag.replace(/\\([()])/g, '$1')
    window.open(`/?tags=${encodeURIComponent(cleanTag)}`, '_blank')
  }, [])

  // --- Helpers ---
  // Ref-stabilized callbacks: stable references that always call the latest version.
  // Prevents renderMasonryItem from recreating when toast or other deps change.
  const copyToClipboardRef = useRef<(content: string, postId: number, isPrompt?: boolean, thumbnailUrl?: string) => Promise<void>>(async () => {})
  const downloadImageRef = useRef<(post: BooruPost) => Promise<void>>(async () => {})

  const stableCopyToClipboard = useCallback(async (content: string, postId: number, isPrompt?: boolean, thumbnailUrl?: string) => {
    return copyToClipboardRef.current(content, postId, isPrompt, thumbnailUrl)
  }, [])

  const stableDownloadImage = useCallback(async (post: BooruPost) => {
    return downloadImageRef.current(post)
  }, [])

  const copyToClipboard = useCallback(async (content: string, postId: number, isPrompt: boolean = false, thumbnailUrl?: string) => {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedId(postId)

      addToHistory({ content, postId, thumbnailUrl })

      toast({
        title: "Copied!",
        description: isPrompt ? "Prompt copied to clipboard" : "Tags copied to clipboard",
      })
      setTimeout(() => setCopiedId(null), 2000)
      trackCopy(postId)
    } catch (error) {
      toast({
        title: "Error",
        description: isPrompt ? "Could not copy prompt" : "Could not copy tags",
        variant: "destructive",
      })
    }
  }, [toast, addToHistory])

  const downloadImage = useCallback(async (post: BooruPost) => {
    try {
      const imageUrl = post.file_url || post.large_file_url

      if (!imageUrl) {
        toast({ title: "Download failed", description: "No image URL available", variant: "destructive" })
        return
      }

      const urlPath = imageUrl.split('?')[0]
      const extension = urlPath.split('.').pop() || 'jpg'
      const itemProvider = post._provider || search.booruProvider
      const filename = `${itemProvider}_${post.id}.${extension}`

      // Providers that need a proxy due to CORS/referrer restrictions.
      // ponytail: Danbooru CDN blocks cross-origin browser requests (Cloudflare WAF
      // triggers on sec-fetch-site: cross-site without Referer). Gelbooru has explicit
      // anti-hotlink. Rule34 is auth-walled. E621 and Aibooru work direct.
      const needsVercelProxy = imageUrl.includes('donmai.us') ||
        imageUrl.includes('rule34.xxx') ||
        imageUrl.includes('gelbooru.com')

      // Danbooru: prefer the CloudFront proxy (edge cache + CORS) when configured.
      const cdnUrl = getDanbooruCdnUrl(imageUrl)

      let fetchUrl: string
      if (cdnUrl) {
        fetchUrl = cdnUrl
      } else if (needsVercelProxy) {
        fetchUrl = apiUrl(`/api/download?url=${encodeURIComponent(imageUrl)}`)
      } else {
        // Direct fetch — Aibooru/E621 CDNs are permissive, no Referer needed.
        fetchUrl = imageUrl
      }

      const response = await fetch(fetchUrl)

      if (!response.ok) {
        let errorMessage = `Failed to fetch image: ${response.status}`
        try {
          const errorData = await response.json()
          if (errorData.error) errorMessage = errorData.error
        } catch { }
        throw new Error(errorMessage)
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)

      toast({ title: "Download started", description: `Downloading ${filename}` })
    } catch (error) {
      console.error('Download error:', error)
      toast({
        title: "Download failed",
        description: error instanceof Error ? error.message : "Error downloading image",
        variant: "destructive",
      })
    }
  }, [search.booruProvider, toast])

  // Sincronizar refs con los callbacks reales (asignación barata, sin efecto)
  copyToClipboardRef.current = copyToClipboard
  downloadImageRef.current = downloadImage

  // --- Preset Handlers now live in usePresetsAndHistory() ---

  // --- Rendering Helpers ---

  const placeholders = useMemo(() => search.isShuffle ? ["Search tag (e.g., cat_girl)..."] : [
    "Search tags (e.g., cat girl, blue eyes)...",
    "Try 'frieren, solo'",
    "eyeshadows, makeup",
    "disgust, standing",
    "crossed arms, from below",
    "large breasts, swimsuit",
  ], [search.isShuffle])

  const filteredPosts = useMemo(() => {
    let source = search.allPosts
    if (favs.showFavorites) {
      source = favs.favoritePosts || []
    }

    // Visual-only folder filter — applied at render, not in the hook.
    // useFavoritePosts always receives ALL favorites so SWR cache stays stable.
    const filterByFolder =
      favs.showFavorites &&
      activeFavoriteFolder !== "all" &&
      activeFavoriteFolder !== "artists"

    return source.filter(post => {
      // Folder filter (render-level, not in hook)
      if (filterByFolder) {
        const key = favKey(post._provider || search.booruProvider, post.id)
        const postFolders = favs.favoriteFolderMap[key] || []
        if (activeFavoriteFolder === null) {
          if (postFolders.length !== 0) return false
        } else {
          if (!postFolders.includes(activeFavoriteFolder)) return false
        }
      }

      // Blacklist filter
      if (post.tag_string) {
        const postTags = post.tag_string.split(' ')
        const normalizedBlacklist = blacklist.map(tag => tag.replace(/\s+/g, '_'))
        if (postTags.some(tag => normalizedBlacklist.includes(tag))) {
          return false
        }
      }

      // Character count filter
      const minCharPostCount = (includeCharacters && parseInt(search.appliedCharacterCountFilter)) || 0
      if (minCharPostCount > 0) {
        // The "Minimum Character Post Count" filter needs per-tag booru post counts,
        // which are only available for Danbooru/Aibooru (fetchBatchTagCounts / the
        // /api/booru/tags route). For every other provider (e621, gelbooru, rule34)
        // `tagCounts` is always empty, so evaluating the filter there would drop EVERY
        // post — that was the e621 "only 1-3 results" bug. Treat the filter as a no-op
        // (pass-through) on providers without count support instead of silently
        // filtering everything out.
        const postProvider = post._provider || search.booruProvider
        const supportsCharCounts = postProvider === 'danbooru' || postProvider === 'aibooru'

        if (supportsCharCounts) {
          if (!post.tag_string_character) {
            return false
          }
          const charTags = post.tag_string_character.split(' ').filter(Boolean)
          let hasValidCount = false

          for (const tag of charTags) {
            const count = tagCounts[tag]
            if (count === undefined) {
              continue
            } else if (count >= minCharPostCount) {
              hasValidCount = true
              break
            }
          }

          if (!hasValidCount) {
            return false
          }
        }
        // else: provider has no per-tag counts — skip this filter entirely.
      }

      if (favs.showFavorites) return true
      const fileUrl = post.large_file_url || post.file_url
      const match = fileUrl?.match(/\.(jpg|jpeg|png|gif|webp|avif)$/i)
      return !!match
    })
  }, [favs.showFavorites, favs.favoritePosts, search.allPosts, search.booruProvider, blacklist, includeCharacters, search.appliedCharacterCountFilter, tagCounts, activeFavoriteFolder, favs.favoriteFolderMap])

  // Constant empty array reference for memoization
  const EMPTY_ARRAY = useRef<string[]>([]).current

  const initialFetchDoneRef = useRef(false)

  const folderMismatch = useMemo(() => {
    const empty = { loading: 0, unavailable: 0, unavailableKeys: [] as string[] }
    if (!favs.showFavorites || activeFavoriteFolder === 'artists') {
      return empty
    }

    // ── Step 1: expected keys for this folder ──
    let expectedKeys: string[]
    if (activeFavoriteFolder === 'all') {
      expectedKeys = favs.favoriteItems.map(fi => favKey(fi.provider, fi.id))
    } else {
      expectedKeys = Object.entries(favs.favoriteFolderMap)
        .filter(([_, ids]) =>
          activeFavoriteFolder === null ? ids.length === 0 : ids.includes(activeFavoriteFolder as string)
        )
        .map(([key]) => key)
    }

    if (expectedKeys.length === 0) return empty

    // ── Step 2: build loaded key set using favoriteItems as canonical provider source ──
    // We do NOT use post._provider here because it can be stale (from old SWR cache
    // or wrongly persisted Supabase cache). favoriteItems is derived directly from
    // core.favorites (the Set populated from the DB), so provider is always correct.
    //
    // Cross-reference: a post is "loaded" if its numeric id appears in favoritePosts
    // AND favoriteItems contains a matching (provider, id) pair for a key in folderMap.
    const loadedPostIdSet = new Set((favs.favoritePosts || []).map(p => p.id))

    // Build a Set of "provider:id" keys we KNOW are loaded, using canonical providers
    const loadedCanonicalKeys = new Set(
      favs.favoriteItems
        .filter(fi => loadedPostIdSet.has(fi.id))
        .map(fi => favKey(fi.provider, fi.id))
    )

    const missingKeys = expectedKeys.filter(k => !loadedCanonicalKeys.has(k))

    if (missingKeys.length === 0) return empty

    // ── Step 3: only flag as "unavailable" when the fetch is genuinely complete ──
    // Guard against all three false positive scenarios:
    //   FP-1 (_provider mismatch): eliminated above by using favoriteItems keys
    //   FP-2 (addProgress counts errors as loaded): isValidating catches in-flight fetchers
    //   FP-3 (isLoading=false while fallbackData active): isValidating is true during fetch
    //
    // A post is only "unavailable" if:
    //   - The favorites system has finished its initial load
    //   - The post count reporting says everything was attempted
    const progressComplete =
      favs.favoritesProgress.total > 0 &&
      favs.favoritesProgress.loaded >= favs.favoritesProgress.total

    if (progressComplete && favs.favoritesLoaded) {
      initialFetchDoneRef.current = true
    }

    const fetchDone = initialFetchDoneRef.current

    return {
      loading: fetchDone ? 0 : missingKeys.length,
      unavailable: fetchDone ? missingKeys.length : 0,
      unavailableKeys: fetchDone ? missingKeys : [],
    }
  }, [
    favs.showFavorites, favs.favoriteFolderMap, favs.favoritePosts, favs.favoriteItems,
    favs.favoritesProgress, favs.favoritesLoaded,
    activeFavoriteFolder,
  ])

  const renderMasonryItem = useCallback((post: BooruPost, width: number, height: number, index: number) => {
    const itemProvider = post._provider || search.booruProvider
    const uniqueKey = favKey(itemProvider, post.id)
    const isFavorited = favs.favorites.has(uniqueKey)
    const currentFolderIds = favs.favoriteFolderMap[uniqueKey] || EMPTY_ARRAY
    const isPreviouslyCopied = previouslyCopiedPostIds.has(post.id)

    return <MasonryItem
      post={post}
      tagCounts={tagCounts}
      isPreviouslyCopied={isPreviouslyCopied}
      width={width}
      height={height}
      viewMode={viewMode}
      effectiveScale={effectiveScale}
      index={index}
      booruProvider={search.booruProvider}
      isFavorited={isFavorited}
      folders={favs.folders}
      currentFolderIds={currentFolderIds}
      toggleFavorite={favs.toggleFavorite}
      createFolder={favs.createFolder}
      downloadImage={stableDownloadImage}
      copyToClipboard={stableCopyToClipboard}
      excludeInput={debouncedExcludeInput}
      addInput={debouncedAddInput}
      includeCharacters={includeCharacters}
      optimizeTags={optimizeTags}
      smartTagExclusion={smartTagExclusion}
      removeLoRaTags={search.removeLoRaTags}
      removeQualityTags={search.removeQualityTags}
      backgroundMode={deferredBackgroundMode}
      simpleBackgroundReplacementTags={debouncedSimpleBackgroundReplacementTags}
      randomBackgroundPatterns={randomBackgroundPatterns}

      randomBackgroundIncludeGradients={randomBackgroundIncludeGradients}
      detailedBackgroundsList={detailedBackgroundsList}
      tagOverrides={tagOverrides}
      copiedId={copiedId}
      setTeachModalData={setTeachModalData}
      isMergeMode={mergeModeIsMergeMode}
      isSelected={mergeModeSelectedPosts.has(post.id)}
      selectedParts={mergeModeSelectedPosts.get(post.id)?.parts}
      onTogglePart={mergeModeTogglePostPart}
      onMergeSelect={() => { }}
      onSkipAnimation={() => setCopiedId(null)}
      globalWeights={globalWeights}
      isGlobalWeightsEnabled={isGlobalWeightsEnabled}
      onGlobalWeightChange={handleGlobalWeightChange}
      onSearch={handleTagSearch}
      onImageError={handleImageError}
      isNaturalLanguageMode={isAiConvertMode}
      onSendToConvert={handleSendToConvert}
      showCategoryTagBadges={showCategoryTagBadges}
    />
  }, [viewMode, effectiveScale, search.booruProvider, favs.favorites, favs.folders, favs.favoriteFolderMap, favs.toggleFavorite, favs.createFolder, stableDownloadImage, stableCopyToClipboard, debouncedExcludeInput, debouncedAddInput, includeCharacters, optimizeTags, smartTagExclusion, search.removeLoRaTags, search.removeQualityTags, deferredBackgroundMode, debouncedSimpleBackgroundReplacementTags, randomBackgroundPatterns, randomBackgroundIncludeGradients, detailedBackgroundsList, tagOverrides, copiedId, mergeModeIsMergeMode, mergeModeSelectedPosts, mergeModeTogglePostPart, globalWeights, isGlobalWeightsEnabled, handleGlobalWeightChange, handleTagSearch, handleImageError, previouslyCopiedPostIds, EMPTY_ARRAY, tagCounts, isAiConvertMode, handleSendToConvert, showCategoryTagBadges])

  const decreaseScale = () => setScaleValue([Math.max(1, scaleValue[0] - 1)])
  const increaseScale = () => setScaleValue([Math.min(3, scaleValue[0] + 1)])
  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' })

  const finalPosts = filteredPosts

 // Progressive image loading removed — the CF Worker already has rate limiting
 // and aggressive cache, so throttling on the frontend only caused visible
 // "dripping" (3-6 posts appearing every 2s) and blocked infinite scroll
 // (forceStop={isRevealing} disconnected the IntersectionObserver).

  return (
    <TooltipProvider>
      {search.searchTags?.trim() ? (
        <title>{`${search.searchTags.trim()} | Booru Prompt Gallery`}</title>
      ) : null}
      <div className="min-h-screen bg-background">
        <GalleryHeader
          viewMode={viewMode}
          setViewMode={setViewMode}
          scaleValue={scaleValue}
          setScaleValue={setScaleValue}
          decreaseScale={decreaseScale}
          increaseScale={increaseScale}
          setShowWelcomeModal={setShowWelcomeModal}
        />

        <main id="main-content" className={`container mx-auto px-4 py-4 sm:py-8 ${mergeMode.isMergeMode ? 'pb-[340px] sm:pb-[220px]' : isAiConvertMode ? 'pb-[220px] sm:pb-[200px]' : ''}`}>
          {/* Hero */}
          <div className="w-full max-w-6xl mx-auto mb-4 sm:mb-8 space-y-4 sm:space-y-6">
            <GalleryHero
              isAnnouncementsOpen={isAnnouncementsOpen}
              onDismissAnnouncements={() => { setIsAnnouncementsOpen(false); localStorage.setItem('announcements_state', JSON.stringify({ collapsed: true, version: pkg.version })) }}
            />

            <Card ref={controlPanelRef} className="glass-effect">
              <CardContent className="p-4 sm:p-6">
                <form onSubmit={(e) => {
                  search.handleSearch(e)
                  // On mobile the control panel is tall; bring results into view after searching.
                  if (typeof window !== 'undefined' && window.innerWidth < 1024) {
                    setTimeout(() => {
                      document.getElementById('results-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }, 150)
                  }
                }} className="space-y-6">

                  {/* Top Bar: Provider Selection & Quick Actions */}
                  <GalleryToolbar
                    booruProvider={search.booruProvider}
                    setBooruProvider={search.setBooruProvider}
                    showFavorites={favs.showFavorites}
                    toggleShowFavorites={favs.toggleShowFavorites}
                    favoritesCount={favs.favorites.size}
                    isMergeMode={mergeMode.isMergeMode}
                    mergeModeType={mergeMode.mergeModeType}
                    disableMergeMode={mergeMode.disableMergeMode}
                    enableMergeMode={mergeMode.enableMergeMode}
                    enableVariationMode={mergeMode.enableVariationMode}
                    setSearchTags={search.setSearchTags}
                    onOpenReverseParser={() => setIsReverseParserModalOpen(true)}
                    onProviderChange={trackProviderChange}
                  />

                  {/* Search Bar Section */}
                  <SearchBar
                    placeholders={placeholders}
                    searchTags={search.searchTags}
                    setSearchTags={search.setSearchTags}
                    handleSearch={search.handleSearch}
                    clearSearch={search.clearSearch}
                    isClient={search.isClient}
                    booruProvider={search.booruProvider}
                    ratingFilter={search.ratingFilter}
                    setRatingFilter={search.setRatingFilter}
                    isShuffle={search.isShuffle}
                    toggleShuffle={search.toggleShuffle}
                    refresh={search.refresh}
                    isValidating={search.isValidating}
                    blacklist={blacklist}
                    addTag={addTag}
                    removeTag={removeTag}
                    resetBlacklist={resetBlacklist}
                    history={history}
                    removeHistoryItem={removeHistoryItem}
                    copyToClipboard={copyToClipboard}
                    clearHistory={clearHistory}
                    showSettings={showSettings}
                    setShowSettings={setShowSettings}
                  />

                  {/* Advanced Filters & Options */}
                  <Collapsible open={showSettings} onOpenChange={setShowSettings}>
                    <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                      <TagsManagementPanel
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
                        tagCountFilter={search.tagCountFilter}
                        setTagCountFilter={search.setTagCountFilter}
                        setAppliedTagCountFilter={search.setAppliedTagCountFilter}
                        isTagCountSupported={isTagCountSupported}
                        isTagCountValid={isTagCountValid}
                        characterCountFilter={search.characterCountFilter}
                        setCharacterCountFilter={search.setCharacterCountFilter}
                        setAppliedCharacterCountFilter={search.setAppliedCharacterCountFilter}
                        includeCharacters={includeCharacters}
                      />

                      {/* Prompt Generation Options — right column of the 2-col panel */}
                      <PromptGenerationOptionsPanel
                        isPromptOptionsExpanded={isPromptOptionsExpanded}
                        setIsPromptOptionsExpanded={setIsPromptOptionsExpanded}
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
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  {/* Status & Alerts */}
                  <QueryStatusPanel
                    searchTags={search.searchTags}
                    ratingFilter={search.ratingFilter}
                    order={search.order}
                    appliedTagCountFilter={search.appliedTagCountFilter}
                    booruProvider={search.booruProvider}
                  />
                </form>
              </CardContent>
            </Card>
          </div>

          {/* Gallery Grid */}
          <FavoritesFolderTabs
            showFavorites={favs.showFavorites}
            favoriteFolderMap={favs.favoriteFolderMap}
            favoritesCount={favs.favorites.size}
            savedArtistsCount={savedArtists.savedArtists.length}
            folders={favs.folders}
            activeFavoriteFolder={activeFavoriteFolder}
            setActiveFavoriteFolder={setActiveFavoriteFolder}
            setFolderToDelete={setFolderToDelete}
          />

          <ArtistGridSection
            show={favs.showFavorites && activeFavoriteFolder === 'artists'}
            artists={savedArtists.savedArtists}
            onSearch={(tag, provider) => {
              // Switch to the provider the artist was originally saved from
              // so results come from the correct source.
              if (provider) {
                const normalized = provider.toLowerCase() as BooruProvider
                if (normalized !== search.booruProvider) {
                  search.setBooruProvider(normalized)
                  trackProviderChange(normalized)
                }
              }
              search.setSearchTags(tag)
              // Exit favorites view so the user sees the fresh search results
              if (favs.showFavorites) favs.toggleShowFavorites()
              setActiveFavoriteFolder('all')
            }}
            onRemove={savedArtists.removeArtist}
          />

          {folderMismatch.loading > 0 && filteredPosts.length > 0 && (() => {
            // Loading feedback while remaining favorites stream in (batched,
            // rate-limited Danbooru fetches can take 10-20s). Without a live
            // progress bar this looked frozen. Prefer the fetcher's real
            // loaded/total counter; fall back to the folder-mismatch count.
            const prog = favs.favoritesProgress
            const total = prog.total > 0 ? prog.total : folderMismatch.loading
            const loaded = prog.total > 0 ? Math.min(prog.loaded, total) : 0
            const pct = total > 0 ? Math.round((loaded / total) * 100) : 0
            return (
              <div className="w-full max-w-xs mx-auto py-3">
                <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="mt-2 text-sm text-muted-foreground text-center">
                  Loading favorites…{" "}
                  <span className="font-medium text-foreground">{loaded}</span>
                  {" / "}{total}
                  <span className="text-xs ml-1">({pct}%)</span>
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground/70 text-center">
                  Fetching from the booru — this can take a moment due to rate limits.
                </p>
              </div>
            )
          })()}

          {folderMismatch.unavailable > 0 && (
            <UnavailablePostsNotice
              unavailableKeys={folderMismatch.unavailableKeys}
              activeFolderId={activeFavoriteFolder === 'all' ? 'all' : activeFavoriteFolder}
              toggleFavorite={favs.toggleFavorite}
              injectRecoveredPosts={favs.injectRecoveredPosts}
            />
          )}

          {filteredPosts.length > 0 && activeFavoriteFolder !== 'artists' && (
            <ResultsGrid
              posts={filteredPosts}
              viewMode={viewMode}
              effectiveScale={effectiveScale}
              renderItem={renderMasonryItem}
            />
          )}

          {/* Load More / States */}
          {/* Load More / States */}
          <ResultsStates
            filteredPostsLength={filteredPosts.length}
            showFavorites={favs.showFavorites}
            activeFavoriteFolder={activeFavoriteFolder}
            isLoading={search.isLoading}
            isLoadingMore={search.isLoadingMore}
            noMoreResults={search.noMoreResults}
            loadMoreError={search.loadMoreError}
            loadMore={search.loadMore}
            scrollLimited={search.scrollLimited}
            sessionCapReached={search.sessionCapReached}
            favsIsLoading={favs.isLoading}
            favsIsRefreshing={favs.isRefreshing}
            favoritesError={favs.favoritesError}
            postsError={favs.postsError}
            favoritesProgress={favs.favoritesProgress}
            retryLoadFavorites={favs.retryLoadFavorites}
            imageRateLimited={imageRateLimited}
            onResumeScroll={() => {
              setImageRateLimited(false)
              imageErrorCountRef.current = 0
            }}
          />

          {/* Footer Links for E-E-A-T and Legal */}
          <GalleryFooter />
        </main>

        <FloatingActionButtons
          isMergeMode={mergeMode.isMergeMode}
          isAiConvertMode={isAiConvertMode}
          showBackToTop={showBackToTop}
          toggleAiConvertMode={toggleAiConvertMode}
          handleToggleMergeMode={handleToggleMergeMode}
          scrollToTop={scrollToTop}
        />

      </div>

      <GalleryModals
        teachModalData={teachModalData}
        setTeachModalData={setTeachModalData}
        onTeachSuccess={refreshOverrides}
        showWelcomeModal={showWelcomeModal}
        setShowWelcomeModal={setShowWelcomeModal}
        isGlobalWeightsModalOpen={isGlobalWeightsModalOpen}
        setIsGlobalWeightsModalOpen={setIsGlobalWeightsModalOpen}
        globalWeights={globalWeights}
        onRemoveGlobalWeight={handleRemoveGlobalWeight}
        onClearGlobalWeights={handleClearGlobalWeights}
        onGlobalWeightChange={handleGlobalWeightChange}
        isReverseParserModalOpen={isReverseParserModalOpen}
        setIsReverseParserModalOpen={setIsReverseParserModalOpen}
        onImportRawPrompt={handleImportRawPrompt}
        folderToDelete={folderToDelete}
        setFolderToDelete={setFolderToDelete}
        onConfirmDeleteFolder={() => {
          if (folderToDelete) {
            favs.deleteFolder(folderToDelete.id)
            if (activeFavoriteFolder === folderToDelete.id) {
              setActiveFavoriteFolder('all')
            }
          }
        }}
      />
      <StickyMiniControlPanel
        isVisible={showStickyPanel}
        addInput={addInput}
        setAddInput={setAddInput}
        includeCharacters={includeCharacters}
        setIncludeCharacters={setIncludeCharacters}
        optimizeTags={optimizeTags}
        setOptimizeTags={setOptimizeTags}
        smartTagExclusion={smartTagExclusion}
        setSmartTagExclusion={setSmartTagExclusion}
        backgroundMode={backgroundMode}
        setBackgroundMode={setBackgroundMode}
        simpleBackgroundReplacementTags={simpleBackgroundReplacementTags}
        setSimpleBackgroundReplacementTags={setSimpleBackgroundReplacementTags}
        randomBackgroundPatterns={randomBackgroundPatterns}
        setRandomBackgroundPatterns={setRandomBackgroundPatterns}
        randomBackgroundIncludeGradients={randomBackgroundIncludeGradients}
        setRandomBackgroundIncludeGradients={setRandomBackgroundIncludeGradients}
        isMergeMode={mergeMode.isMergeMode}
        mergeModeType={mergeMode.mergeModeType}
        isAiConvertMode={isAiConvertMode}
        onToggleAiConvertMode={toggleAiConvertMode}
        onToggleMergeMode={() => {
          if (mergeMode.isMergeMode && mergeMode.mergeModeType === 'merge') {
            mergeMode.disableMergeMode()
          } else {
            mergeMode.enableMergeMode()
          }
        }}
        onToggleVariationMode={() => {
          if (mergeMode.isMergeMode && mergeMode.mergeModeType === 'variations') {
            mergeMode.disableMergeMode()
          } else {
            mergeMode.enableVariationMode()
          }
        }}
      />
      <MergeStickyFooter
        isOpen={mergeMode.isMergeMode}
        selectedPosts={mergeMode.selectedPosts}
        mergedPrompt={mergeMode.mergedPrompt}
        mergedPromptSegments={mergeMode.mergedPromptSegments}
        onRemovePost={mergeMode.removePost}
        onClearAll={mergeMode.clearAll}
        onExit={handleToggleMergeMode}
        onCopy={(text) => copyToClipboard(text, 0, true)}
        onRemoveTag={mergeMode.excludeTag}
        mergeModeType={mergeMode.mergeModeType}
        onToggleMergeModeType={mergeMode.toggleVariationsMode}
        onRandomize={() => mergeMode.setRandomSelection(finalPosts)}
        randomSettings={mergeMode.randomSettings}
        setRandomSettings={mergeMode.setRandomSettings}
      />
      <AiConvertStickyFooter
        isOpen={isAiConvertMode}
        tags={aiConvertTags}
        image={aiConvertImage}
        meta={aiConvertMeta}
        onExit={() => setIsAiConvertMode(false)}
      />

      <GalleryModals
        teachModalData={teachModalData}
        setTeachModalData={setTeachModalData}
        onTeachSuccess={refreshOverrides}
        showWelcomeModal={showWelcomeModal}
        setShowWelcomeModal={setShowWelcomeModal}
        isGlobalWeightsModalOpen={isGlobalWeightsModalOpen}
        setIsGlobalWeightsModalOpen={setIsGlobalWeightsModalOpen}
        globalWeights={globalWeights}
        onRemoveGlobalWeight={handleRemoveGlobalWeight}
        onClearGlobalWeights={handleClearGlobalWeights}
        onGlobalWeightChange={handleGlobalWeightChange}
        isReverseParserModalOpen={isReverseParserModalOpen}
        setIsReverseParserModalOpen={setIsReverseParserModalOpen}
        onImportRawPrompt={handleImportRawPrompt}
        folderToDelete={folderToDelete}
        setFolderToDelete={setFolderToDelete}
        onConfirmDeleteFolder={() => {
          if (folderToDelete) {
            favs.deleteFolder(folderToDelete.id)
            if (activeFavoriteFolder === folderToDelete.id) {
              setActiveFavoriteFolder('all')
            }
          }
        }}
      />
    </TooltipProvider>
  )
}












