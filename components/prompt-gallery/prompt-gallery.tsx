"use client"

import type React from "react"
import { useState, useEffect, useRef, useMemo, useCallback, startTransition, useDeferredValue } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DebouncedInput, DebouncedHTMLInput } from "@/components/ui/debounced-input"
import { SearchWithAutocomplete } from "@/components/prompt-gallery/search-with-autocomplete"
import { AnnouncementsCarousel } from "@/components/prompt-gallery/announcements-carousel"
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

const TeachModal = dynamic(() => import("@/components/teach-modal").then(m => m.TeachModal), { ssr: false, loading: () => null })
const TeachWelcomeModal = dynamic(() => import("@/components/teach-welcome-modal").then(m => m.TeachWelcomeModal), { ssr: false, loading: () => null })
const TrendSheet = dynamic(() => import("@/components/trends/trend-sheet").then(m => m.TrendSheet), { ssr: false, loading: () => null })
const ReversePromptParserModal = dynamic(() => import("@/components/prompt-gallery/reverse-prompt-parser-modal").then(m => m.ReversePromptParserModal), { ssr: false, loading: () => null })
const GlobalWeightsModal = dynamic(() => import("@/components/prompt-gallery/global-weights-modal").then(m => m.GlobalWeightsModal), { ssr: false, loading: () => null })
const FeedbackDialog = dynamic(() => import("@/components/feedback-dialog").then(m => m.FeedbackDialog), { ssr: false, loading: () => null })

import pkg from "@/package.json"
import { useToast } from "@/hooks/use-toast"
import { useIsMobile } from "@/hooks/use-mobile"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { InfoTooltip } from "@/components/ui/info-tooltip"
import { UserNav } from "@/components/auth/user-nav"
import Image from "next/image"
import { motion, AnimatePresence, LayoutGroup } from "framer-motion"
import { renderIcon } from "@/components/prompt-gallery/save-favorite-button"
import {
  hasMultipleTags, getFinalQueryTags, BooruPost, BooruProvider, isAibooruPost, apiUrl,
} from "@/lib/api-client"
import { favKey } from "@/lib/favorites-logic"

import { userPreferences, STORAGE_KEYS, type HistoryItem, type TagPreset } from "@/lib/storage"
import { onSettingsChange } from "@/lib/settings-bridge"
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
import { StickyMiniControlPanel } from "./sticky-mini-control-panel"
import { FileCheck2 } from "lucide-react"
import { InfiniteScrollTrigger } from "@/components/ui/infinite-scroll-trigger"
import { SaveFavoriteButton } from "./save-favorite-button"
import { useDebounce } from "@/hooks/use-debounce"

import { usePersistentState } from "@/hooks/use-persistent-state"
import { usePreferencesSync } from "@/hooks/use-preferences-sync"
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

import { useTagCounts } from "@/hooks/use-tag-counts"

type CardScale = "small" | "medium" | "large"

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

  // Keep local value in sync with external value changes
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
    <div className="space-y-2">
      <label htmlFor={inputId} className="text-xs font-medium text-muted-foreground flex items-center gap-2">
        {dotColor && <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`}></span>}
        <InfoTooltip
          title={tooltipTitle}
          description={tooltipDescription}
          visual={tooltipVisual}
        >
          {labelPrefix} ({`>=`} {localValue})
        </InfoTooltip>
      </label>
      <div className="flex items-center">
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
          className={`h-8 w-16 text-xs text-center bg-background/50 ${!isInputValid ? "border-red-500 focus-visible:ring-red-500" : ""} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          aria-label={`${ariaLabel} input`}
        />
      </div>
    </div>
  )
}

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
  | { phase: 'checking' }
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
    setState({ phase: 'checking' })

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

    // Re-query /api/favorites for each provider batch
    const foundIds = new Set<string>()
    const recoveredPosts: BooruPost[] = []
    
    try {
      const entries = Object.entries(byProvider)
      await Promise.allSettled(
        entries.map(async ([provider, ids]) => {
          try {
            const res = await fetch('/api/favorites', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ favorites: ids.map(id => ({ id, provider })) }),
            })
            if (!res.ok) return
            const posts: BooruPost[] = await res.json()
            for (const p of posts) {
              if (p?.id) {
                foundIds.add(`${provider}:${p.id}`)
                recoveredPosts.push(p)
              }
            }
          } catch {
            // Network error on re-check — treat as inconclusive (don't mark as deleted)
            for (const id of ids) foundIds.add(`${provider}:${id}`)
          }
        })
      )
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
          <div className="flex items-center gap-4 py-2">
            <Loader2 className="h-5 w-5 text-destructive animate-spin shrink-0" />
            <div className="space-y-1">
              <AlertTitle className="text-destructive font-medium mb-0">Verifying on booru...</AlertTitle>
              <AlertDescription className="text-muted-foreground text-xs">
                Querying the original server to see if the posts still exist. This might take a few seconds due to rate limits.
              </AlertDescription>
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

  const [detailedBackgroundsList, setDetailedBackgroundsList] = useState<string[][]>([])
  const detailedBackgroundsLoadedRef = useRef(false)

  // 2. Local UI State & Persistence
  const [viewMode, setViewMode] = usePersistentState<"grid" | "list">(
    "grid",
    userPreferences.getViewMode,
    userPreferences.setViewMode,
    "viewMode",
    STORAGE_KEYS.VIEW_MODE
  )

  const [cardScale, setCardScale] = usePersistentState<CardScale>(
    "medium",
    userPreferences.getCardScale,
    userPreferences.setCardScale,
    "cardScale",
    STORAGE_KEYS.CARD_SCALE
  )

  // Slider state needs to stay in sync with persisted cardScale
  const [scaleValue, setScaleValue] = useState([2])



  // Reset folder filter when exiting favorites view so it doesn't linger and hide
  // the search grid (e.g. 'artists' tab would suppress masonry render on exit).
  useEffect(() => {
    if (!favs.showFavorites && activeFavoriteFolder !== 'all') {
      setActiveFavoriteFolder('all')
    }
  }, [favs.showFavorites, activeFavoriteFolder])

  // Sync slider when cardScale changes (e.g. loaded from storage)
  useEffect(() => {
    if (cardScale === 'small') setScaleValue([1])
    else if (cardScale === 'medium') setScaleValue([2])
    else if (cardScale === 'large') setScaleValue([3])
  }, [cardScale])

  // User Prefs UI state
  const [promptOptions, setPromptOptions] = usePersistentState(
    { includeCharacters: true, optimizeTags: true, smartTagExclusion: true },
    userPreferences.getPromptOptions,
    userPreferences.setPromptOptions,
    "promptOptions",
    STORAGE_KEYS.PROMPT_OPTIONS
  )

  // Destructure for easier usage, create setters that update the object
  const { includeCharacters, optimizeTags, smartTagExclusion = true } = promptOptions

  const setIncludeCharacters = (val: boolean) =>
    setPromptOptions(prev => ({ ...prev, includeCharacters: val }))

  const setOptimizeTags = (val: boolean) =>
    setPromptOptions(prev => ({ ...prev, optimizeTags: val }))

  const setSmartTagExclusion = (val: boolean) =>
    setPromptOptions(prev => ({ ...prev, smartTagExclusion: val }))

  const [showCategoryTagBadges, setShowCategoryTagBadges] = useState(true)

  const [backgroundMode, setBackgroundMode] = usePersistentState<BackgroundMode>(
    "keep",
    userPreferences.getBackgroundMode,
    userPreferences.setBackgroundMode,
    "backgroundMode",
    STORAGE_KEYS.BACKGROUND_MODE
  )
  const deferredBackgroundMode = useDeferredValue(backgroundMode)

  // Lazy-load the 188KB detailed-backgrounds.json only when the user actually
  // switches to the "random" background mode (the only consumer of the scenery
  // list). Previously this was fetched + parsed + mapped on EVERY mount, even
  // for users who never touch Random backgrounds. Idempotent via a ref.
  useEffect(() => {
    if (backgroundMode !== 'random') return
    if (detailedBackgroundsLoadedRef.current) return
    detailedBackgroundsLoadedRef.current = true
    fetch('/detailed-backgrounds.json')
      .then(res => res.json())
      .then(data => setDetailedBackgroundsList(data.map((item: any) => item.scenery)))
      .catch(err => {
        detailedBackgroundsLoadedRef.current = false // allow retry after a failure
        console.error("Failed to load detailed backgrounds:", err)
      })
  }, [backgroundMode])

  const [simpleBackgroundReplacementTags, setSimpleBackgroundReplacementTags] = usePersistentState(
    "simple background, white background",
    userPreferences.getSimpleBackgroundReplacementTags,
    userPreferences.setSimpleBackgroundReplacementTags,
    "simpleBackgroundReplacementTags",
    STORAGE_KEYS.SIMPLE_BACKGROUND_REPLACEMENT_TAGS
  )
  const debouncedSimpleBackgroundReplacementTags = useDebounce(simpleBackgroundReplacementTags, 500)

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
  const [presets, setPresets] = useState<TagPreset[]>([])
  const [isPresetDialogOpen, setIsPresetDialogOpen] = useState(false)
  const [presetName, setPresetName] = useState("")
  const [history, setHistory] = useState<HistoryItem[]>([])

  const previouslyCopiedPostIds = useMemo(() => {
    return new Set(history.map(item => item.postId).filter((id): id is number => id !== undefined))
  }, [history])

  const [tagOverrides, setTagOverrides] = useState<Record<string, string>>({})

  // Debounce expensive inputs
  const debouncedAddInput = useDebounce(addInput, 500)
  const debouncedExcludeInput = useDebounce(excludeInput, 500)

  // Global Weights State — syncs across tabs/extension via localStorage
  const [globalWeights, setGlobalWeights] = usePersistentState<Record<string, number>>(
    {},
    userPreferences.getGlobalWeights,
    userPreferences.setGlobalWeights,
    "globalWeights",
    STORAGE_KEYS.GLOBAL_WEIGHTS
  )

  const [isGlobalWeightsEnabled, setIsGlobalWeightsEnabled] = usePersistentState(
    false,
    userPreferences.getGlobalWeightsEnabled,
    userPreferences.setGlobalWeightsEnabled,
    "globalWeightsEnabled",
    STORAGE_KEYS.GLOBAL_WEIGHTS_ENABLED
  )

  const [isGlobalWeightsModalOpen, setIsGlobalWeightsModalOpen] = useState(false)
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

  // Handle sending tags to convert and auto-enable mode
  const handleSendToConvert = useCallback((tagsToSend: string, imageUrl?: string) => {
    // Disable merge mode if active
    if (mergeModeIsMergeMode) {
      mergeModeDisableMergeMode()
    }
    setAiConvertTags(tagsToSend)
    setAiConvertImage(imageUrl)
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
  const isTagCountSupported = search.booruProvider === 'danbooru' || search.booruProvider === 'e621'

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

  useEffect(() => {
    if (search.isClient) {
      setPresets(userPreferences.getAddTagsPresets())
    }
  }, [search.isClient])

  useEffect(() => {
    if (search.isClient) {
      setHistory(userPreferences.getHistory())
      // Logic for old storage keys or manual loading removed - now handled by usePersistentState
    }
  }, [search.isClient])

  // Listen for preset/history changes from extension/other tabs via BroadcastChannel
  useEffect(() => {
    return onSettingsChange((key) => {
      if (key === STORAGE_KEYS.ADD_TAGS_PRESETS) {
        setPresets(userPreferences.getAddTagsPresets())
      } else if (key === STORAGE_KEYS.HISTORY) {
        setHistory(userPreferences.getHistory())
      }
    })
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

  // Global weight handlers
  const handleGlobalWeightChange = useCallback((tag: string, weight: number) => {
    setGlobalWeights(prev => {
      const next = { ...prev }
      // We store lowercase keys for consistency
      const key = tag.toLowerCase()
      // We no longer auto-delete at 1.0, so the user can manage the tag in the list
      // Explicit removal is handled by handleRemoveGlobalWeight
      next[key] = weight
      return next
    })
  }, [setGlobalWeights])

  const handleClearGlobalWeights = useCallback(() => {
    setGlobalWeights({})
    setIsGlobalWeightsModalOpen(false)
    toast({ title: "Weights cleared", description: "All global tag weights have been reset." })
  }, [toast, setGlobalWeights])

  const handleRemoveGlobalWeight = useCallback((tag: string) => {
    setGlobalWeights(prev => {
      const next = { ...prev }
      delete next[tag] // tag from modal is already key
      return next
    })
  }, [setGlobalWeights])

  const toggleGlobalWeights = (enabled: boolean) => {
    setIsGlobalWeightsEnabled(enabled)
  }

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

      userPreferences.addToHistory({ content, postId, thumbnailUrl })
      setHistory(userPreferences.getHistory())

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
  }, [toast])

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

      let fetchUrl: string
      if (needsVercelProxy) {
        fetchUrl = apiUrl(`/api/download?url=${encodeURIComponent(imageUrl)}`)
      } else {
        // Direct fetch — Danbooru/Aibooru/E621 CDNs are permissive, no Referer needed.
        // ponytail: one less proxy hop. Add when: if a provider adds CORS restrictions.
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

  // --- Preset Handlers ---
  const savePreset = () => {
    if (!presetName.trim() || !addInput.trim()) return
    const newPresets = userPreferences.addAddTagsPreset({ name: presetName, content: addInput })
    setPresets(newPresets)
    setPresetName("")
    setIsPresetDialogOpen(false)
    toast({ title: "Preset saved", description: "Your tags preset has been saved successfully." })
  }

  const loadPreset = (preset: TagPreset) => {
    setAddInput(preset.content)
    toast({ title: "Preset loaded", description: `Loaded preset: ${preset.name}` })
  }

  const deletePreset = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const newPresets = userPreferences.removeAddTagsPreset(id)
    setPresets(newPresets)
    toast({ title: "Preset deleted", description: "Preset removed successfully." })
  }

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
        if (!post.tag_string_character) {
          const postProvider = post._provider || search.booruProvider
          if (postProvider === 'gelbooru' || postProvider === 'rule34') {
             // pass
          } else {
             return false
          }
        } else {
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
        {/* Header */}
        <header className="w-full border-b glass-effect">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 sm:space-x-4">
                <div className="flex items-center gap-2 sm:gap-3">
                  <h1 className="text-lg sm:text-2xl font-bold text-foreground leading-tight sm:leading-normal">
                    Booru<span className="hidden sm:inline"> </span><br className="sm:hidden" />Prompt Gallery
                  </h1>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-0.5 sm:gap-3">
                    <Badge variant="secondary" className="text-[10px] sm:text-xs font-medium bg-muted text-muted-foreground border-0 px-1.5 py-0 sm:px-2 sm:py-1 h-fit">
                      By Mexes
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowWelcomeModal(true)}
                      className="hidden sm:flex text-xs h-7 px-2 gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Sparkles className="h-3 w-3 text-amber-500" />
                      What&apos;s New
                    </Button>
                    
                    <Button
                      variant="ghost"
                      size="sm"
                      asChild
                      className="hidden sm:flex text-xs h-7 px-2 gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <a href={SOCIAL_URLS.CIVITAI_ARTICLE} target="_blank" rel="noopener noreferrer">
                        <ScrollText className="h-3 w-3 text-blue-500" />
                        Changelog
                      </a>
                    </Button>
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-1 sm:space-x-2">
                {viewMode === "grid" && (
                  <div className="hidden sm:flex items-center space-x-2 border-r pr-2 mr-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={decreaseScale}
                          disabled={scaleValue[0] === 1}
                          className="focus-ring h-8 w-8"
                          aria-label="Decrease card size"
                        >
                          <ZoomOut className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Decrease card size</TooltipContent>
                    </Tooltip>

                    <div className="w-16 px-1">
                      <Slider
                        value={scaleValue}
                        onValueChange={setScaleValue}
                        max={3}
                        min={1}
                        step={1}
                        className="w-full"
                        aria-label="Card scale"
                      />
                    </div>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={increaseScale}
                          disabled={scaleValue[0] === 3}
                          className="focus-ring h-8 w-8"
                          aria-label="Increase card size"
                        >
                          <ZoomIn className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Increase card size</TooltipContent>
                    </Tooltip>
                  </div>
                )}

                <span className="hidden md:inline-flex">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          const next = viewMode === 'grid' ? 'list' : 'grid'
                          setViewMode(next)
                          trackViewMode(next)
                        }}
                        className="focus-ring"
                        aria-label={`Switch to ${viewMode === "grid" ? "list" : "grid"} view`}
                      >
                        {viewMode === "grid" ? <List className="h-4 w-4" /> : <Grid3X3 className="h-4 w-4" />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Switch to {viewMode === "grid" ? "list" : "grid"} view</TooltipContent>
                  </Tooltip>
                </span>



                <span className="hidden md:inline-flex">
                  <ThemeToggle />
                </span>

                <UserNav />

                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="focus-ring gap-1.5 px-2" aria-label="More options and information">
                          <AlertTriangle className="h-4 w-4 rotate-180" />
                          More
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent>Help & Info</TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="end" className="glass-effect">
                    {/* Merged from the former mobile "More" button to free up header space (mobile only) */}
                    <DropdownMenuItem onClick={() => setShowWelcomeModal(true)} className="sm:hidden">
                      <Sparkles className="mr-2 h-4 w-4 text-amber-500" />
                      <span>What&apos;s New</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild className="sm:hidden">
                      <a href={SOCIAL_URLS.CIVITAI_ARTICLE} target="_blank" rel="noopener noreferrer">
                        <ScrollText className="mr-2 h-4 w-4 text-blue-500" />
                        <span>Changelog</span>
                      </a>
                    </DropdownMenuItem>
                    {viewMode === "grid" && (
                      <>
                        <DropdownMenuSeparator className="sm:hidden" />
                        <DropdownMenuLabel className="sm:hidden">Card Size</DropdownMenuLabel>
                        <DropdownMenuItem onClick={decreaseScale} disabled={scaleValue[0] === 1} className="sm:hidden">
                          <ZoomOut className="mr-2 h-4 w-4" />
                          <span>Smaller</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={increaseScale} disabled={scaleValue[0] === 3} className="sm:hidden">
                          <ZoomIn className="mr-2 h-4 w-4" />
                          <span>Larger</span>
                        </DropdownMenuItem>
                      </>
                    )}
                    <DropdownMenuSeparator className="sm:hidden" />
                    <DropdownMenuLabel>Information</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <a href="/about" className="cursor-pointer w-full flex items-center">
                        <Sparkles className="mr-2 h-4 w-4" />
                        <span>About Project</span>
                      </a>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <a href="/privacy" className="cursor-pointer w-full flex items-center">
                        <Shield className="mr-2 h-4 w-4" />
                        <span>Privacy Policy</span>
                      </a>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <a
                        href="https://stats.uptimerobot.com/YcL3JPgshk"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="cursor-pointer w-full flex items-center"
                      >
                        <Activity className="mr-2 h-4 w-4" />
                        <span>Service Status</span>
                      </a>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </header>

        <main id="main-content" className={`container mx-auto px-4 py-4 sm:py-8 ${mergeMode.isMergeMode ? 'pb-[340px] sm:pb-[220px]' : isAiConvertMode ? 'pb-[220px] sm:pb-[200px]' : ''}`}>
          {/* Hero */}
          <div className="w-full max-w-6xl mx-auto mb-4 sm:mb-8 space-y-4 sm:space-y-6">
            <div className="text-center space-y-2">
              <h2 className="text-xl sm:text-3xl font-bold tracking-tight">Discover AI Art Prompts</h2>
              <p className="text-muted-foreground max-w-2xl mx-auto text-sm sm:text-base px-4">
                Generate prompts from Danbooru, Aibooru, Rule34, Gelbooru and e621 image collections.
                Extract and format tags from posts or access AI-generated prompts directly,
                creating clean, ready-to-use prompts for your AI art generation.
              </p>

              {/* Social Links Section */}
              <div className="pt-2 sm:pt-4 space-y-3">
                <p className="text-muted-foreground text-sm">
                  More of my work here
                </p>
                <div className="flex items-center justify-center space-x-4">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <a
                        id="social-civitai"
                        href={SOCIAL_URLS.CIVITAI_PROFILE}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => trackExternalLink(SOCIAL_URLS.CIVITAI_PROFILE, 'social')}
                        className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-muted/50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                        aria-label="Visit Mexes on CivitAI"
                      >
                        <Image
                          src="https://www.google.com/s2/favicons?domain=civitai.com&sz=64"
                          alt="CivitAI"
                          width={24}
                          height={24}
                          className="w-6 h-6 filter grayscale hover:grayscale-0 transition-all duration-200"
                        />
                      </a>
                    </TooltipTrigger>
                    <TooltipContent>Visit Mexes on CivitAI</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <a
                        id="social-tensor"
                        href={SOCIAL_URLS.TENSOR_ART}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => trackExternalLink(SOCIAL_URLS.TENSOR_ART, 'social')}
                        className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-muted/50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                        aria-label="Visit Mexes on Tensor.Art"
                      >
                        <Image
                          src="https://www.google.com/s2/favicons?domain=tensor.art&sz=64"
                          alt="Tensor.Art"
                          width={24}
                          height={24}
                          className="w-6 h-6 filter grayscale hover:grayscale-0 transition-all duration-200"
                        />
                      </a>
                    </TooltipTrigger>
                    <TooltipContent>Visit Mexes on Tensor.Art</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <a
                        id="social-seaart"
                        href={SOCIAL_URLS.SEAART}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => trackExternalLink(SOCIAL_URLS.SEAART, 'social')}
                        className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-muted/50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                        aria-label="Visit Mexes on SeaArt AI"
                      >
                        <Image
                          src="https://www.google.com/s2/favicons?domain=seaart.ai&sz=64"
                          alt="SeaArt AI"
                          width={24}
                          height={24}
                          className="w-6 h-6 filter grayscale hover:grayscale-0 transition-all duration-200"
                        />
                      </a>
                    </TooltipTrigger>
                    <TooltipContent>Visit Mexes on SeaArt AI</TooltipContent>
                  </Tooltip>
                </div>

                {/* Social Links - Horizontal */}
                <div className="flex items-center justify-center gap-3 mt-3 flex-wrap w-full">
                  <a
                    id="support-kofi"
                    href={SOCIAL_URLS.KO_FI}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => trackExternalLink(SOCIAL_URLS.KO_FI, 'support')}
                    className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600 text-white text-sm font-medium rounded-full transition-all duration-200 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 shadow-lg hover:shadow-xl"
                  >
                    <Image
                      src="https://www.google.com/s2/favicons?domain=ko-fi.com&sz=64"
                      alt="Ko-fi"
                      width={16}
                      height={16}
                      className="w-4 h-4 mr-2"
                    />
                    Support me on Ko-fi
                  </a>

                  <a
                    id="github-repo"
                    href={SOCIAL_URLS.GITHUB}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => trackExternalLink(SOCIAL_URLS.GITHUB, 'github')}
                    className="inline-flex items-center px-4 py-2 bg-gray-800 hover:bg-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 text-white text-sm font-medium rounded-full transition-all duration-200 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 shadow-lg hover:shadow-xl"
                  >
                    <Github className="w-4 h-4 mr-2" />
                    View on GitHub
                  </a>

                  <a
                    id="netlify-alt"
                    href={SOCIAL_URLS.NETLIFY}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => trackExternalLink(SOCIAL_URLS.NETLIFY, 'netlify')}
                    className="inline-flex items-center px-4 py-2 bg-teal-600 hover:bg-teal-500 dark:bg-teal-700 dark:hover:bg-teal-600 text-white text-sm font-medium rounded-full transition-all duration-200 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 shadow-lg hover:shadow-xl"
                  >
                    <Globe className="w-4 h-4 mr-2" />
                    Netlify Mirror
                  </a>
                </div>

                {/* Announcements Panel */}
                {isAnnouncementsOpen && (
                  <AnnouncementsCarousel
                    version={pkg.version}
                    onDismiss={() => { setIsAnnouncementsOpen(false); localStorage.setItem('announcements_state', JSON.stringify({ collapsed: true, version: pkg.version })) }}
                  />
                )}
              </div>
            </div>

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
                  <div className="flex flex-col lg:flex-row gap-8 justify-start items-start lg:items-center">
                    {/* API Provider Selector */}
                    <div className="flex flex-col gap-1.5 w-full lg:w-auto">
                      <span className="text-xs font-medium text-muted-foreground ml-1">API Provider</span>
                      <div className="bg-muted/50 p-1 rounded-lg flex flex-wrap sm:flex-nowrap gap-1 w-full sm:w-auto">
                        {(['danbooru', 'gelbooru', 'aibooru', 'rule34', 'e621'] as const).map(p => (
                          <Button
                            key={p}
                            type="button"
                            variant="ghost"
                            onClick={() => {
                              search.setBooruProvider(p)
                              if (favs.showFavorites) {
                                favs.toggleShowFavorites()
                              }
                              trackProviderChange(p)
                            }}
                            className={`relative h-11 sm:h-8 text-sm px-3 sm:px-4 min-w-fit flex-1 sm:flex-none whitespace-nowrap ${!favs.showFavorites && search.booruProvider === p ? "text-foreground hover:bg-transparent" : "text-muted-foreground hover:text-foreground"}`}
                          >
                            {!favs.showFavorites && search.booruProvider === p && (
                              <motion.div
                                layoutId="activeProvider"
                                className="absolute inset-0 bg-background shadow-sm rounded-md"
                                transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                              />
                            )}
                            <span className="relative z-10 capitalize">{p === 'aibooru' ? 'Aibooru' : p === 'danbooru' ? 'Danbooru' : p === 'rule34' ? 'Rule34' : p === 'gelbooru' ? 'Gelbooru' : 'e621'}</span>
                          </Button>
                        ))}
                      </div>
                    </div>

                    {/* Quick Actions */}
                    <div className="flex flex-col gap-1.5 w-full lg:w-auto">
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
                            className={`h-11 sm:h-9 px-3 gap-1 transition-colors duration-200 cursor-pointer ${favs.showFavorites
                              ? "bg-red-200 text-red-800 hover:bg-red-300 dark:bg-red-800 dark:text-red-100 dark:hover:bg-red-700 shadow-inner"
                              : "bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40"
                              }`}
                          >
                            <motion.button
                              type="button"
                              onClick={() => {
                                if (mergeMode.isMergeMode) mergeMode.disableMergeMode()
                                favs.toggleShowFavorites()
                              }}
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.95 }}
                            >
                              <motion.div
                                animate={favs.showFavorites ? { scale: [1, 1.3, 1], rotate: [0, -10, 10, -10, 0] } : { scale: 1, rotate: 0 }}
                                transition={{ duration: 0.4 }}
                              >
                                <Heart className={`w-4 h-4 ${favs.showFavorites ? "fill-current" : ""}`} />
                              </motion.div>
                              <span className="text-xs font-medium">Favs ({favs.favorites.size})</span>
                            </motion.button>
                          </Button>
                        </InfoTooltip>

                        {/* Trending Sheet */}
                        <TrendSheet onSelectTag={search.setSearchTags} />

                        {/* History Sheet */}
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
                              if (mergeMode.isMergeMode && mergeMode.mergeModeType === 'merge') {
                                mergeMode.disableMergeMode()
                              } else {
                                if (favs.showFavorites) favs.toggleShowFavorites()
                                mergeMode.enableMergeMode()
                              }
                            }}
                            variant="secondary"
                            className={`h-11 sm:h-9 px-3 gap-1 transition-colors duration-200 ${mergeMode.isMergeMode && mergeMode.mergeModeType === 'merge'
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
                                <span className="bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 px-2 py-1 rounded border border-indigo-500/20">{ "{ 1girl, sitting | 1girl, standing }" }</span>
                              </div>
                            </div>
                          }
                        >
                          <Button
                            type="button"
                            onClick={() => {
                              if (mergeMode.isMergeMode && mergeMode.mergeModeType === 'variations') {
                                  mergeMode.disableMergeMode()
                              } else {
                                  if (favs.showFavorites) favs.toggleShowFavorites()
                                  mergeMode.enableVariationMode()
                              }
                            }}
                            variant="secondary"
                            className={`h-11 sm:h-9 px-3 gap-1 transition-colors duration-200 ${mergeMode.isMergeMode && mergeMode.mergeModeType === 'variations'
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
                            onClick={() => setIsReverseParserModalOpen(true)}
                            variant="secondary"
                            className="h-11 sm:h-9 px-3 gap-1 transition-colors duration-200 bg-purple-50 text-purple-600 hover:bg-purple-100 dark:bg-purple-900/20 dark:text-purple-400 dark:hover:bg-purple-900/40"
                          >
                            <Sparkles className="w-4 h-4 fill-current" />
                            <span className="text-xs font-medium">Import</span>
                          </Button>
                        </InfoTooltip>

                        <FeedbackDialog />
                      </div>
                    </div>
                  </div>

                  {/* Search Bar Section */}
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex flex-1 group gap-0">
                      <div className="relative flex-1">
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center justify-center w-5 h-5 text-muted-foreground pointer-events-none z-20">
                          <Search className="h-5 w-5" />
                        </div>
                        <SearchWithAutocomplete
                          placeholders={placeholders}
                          value={search.searchTags}
                          setValue={search.setSearchTags}
                          onSearch={() => search.handleSearch({ preventDefault: () => { } } as React.FormEvent)}
                          className="pl-10 pr-10 h-11 text-base shadow-sm rounded-r-none border-r-0 z-10 relative bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
                          aria-label="Search tags input"
                        />
                        {search.searchTags && (
                          <button
                            type="button"
                            onClick={search.clearSearch}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1 z-20"
                            aria-label="Clear search"
                          >
                            <X className="h-4 w-4" />
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
                        />
                      )}

                      {/* NSFW Toggle - Attached to Input */}
                      {search.isClient && (
                        <Button
                          type="button"
                          disabled={search.booruProvider === 'rule34'}
                          variant="outline"
                          onClick={() => {
                            const newRating = search.ratingFilter === "rating:general" ? "all" : "rating:general"
                            search.setRatingFilter(newRating)
                          }}
                          className={`h-11 px-4 rounded-l-none border-l-0 shadow-sm transition-all z-0 ${search.booruProvider === 'rule34'
                            ? "opacity-50 cursor-not-allowed bg-muted"
                            : search.ratingFilter === "rating:general"
                              ? "bg-green-50 text-green-700 hover:bg-green-100 hover:text-green-800 border-green-200/50 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30 dark:border-green-800/50"
                              : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                            }`}
                          title={search.booruProvider === 'rule34' ? "NSFW is always enabled for Rule34" : "Toggle NSFW content"}
                          aria-label={search.ratingFilter === "rating:general" ? "Current filter: Safe content. Click to show all." : "Current filter: All content. Click to show safe only."}
                        >
                          <Shield className="w-4 h-4 sm:mr-2" />
                          <span className="text-xs font-semibold hidden sm:inline">
                            {search.ratingFilter === "rating:general" ? "Safe" : "NSFW"}
                          </span>
                        </Button>
                      )}
                    </div>
                    <div className="flex gap-2 flex-wrap">

                      <Button
                        type="button"
                        variant={search.isShuffle ? "default" : "outline"}
                        onClick={search.toggleShuffle}
                        className="h-11 w-11 p-0 shadow-sm"
                        title={search.isShuffle ? "Disable shuffle" : "Enable shuffle"}
                        aria-label={search.isShuffle ? "Disable shuffle" : "Enable shuffle"}
                      >
                        <Shuffle className="w-4 h-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={search.refresh}
                        disabled={search.isValidating}
                        className="h-11 w-11 p-0 shadow-sm"
                        title="Refresh results"
                        aria-label="Refresh results"
                      >
                        <RefreshCw className={`w-4 h-4 ${search.isValidating ? "animate-spin" : ""}`} />
                      </Button>
                      <Sheet>
                        <SheetTrigger asChild>
                          <Button type="button" variant="outline" size="icon" className="h-11 w-11 shadow-sm" aria-label="View history">
                            <History className="w-4 h-4" />
                          </Button>
                        </SheetTrigger>
                        <SheetContent className="w-full sm:w-[400px] md:w-[540px]">
                          <SheetHeader>
                            <SheetTitle>Prompt History</SheetTitle>
                            <SheetDescription>Your recently copied prompts.</SheetDescription>
                          </SheetHeader>
                          <div className="mt-4 overflow-y-auto max-h-[calc(100vh-120px)] pr-2 space-y-4">
                            {history.length === 0 ? (
                              <p className="text-center text-muted-foreground py-8">No history yet</p>
                            ) : (
                              <>
                                {history.map((item) => (
                                  <div key={item.id} className="border rounded-lg p-3 space-y-2 relative group">
                                    <div className="flex gap-3">
                                      {item.thumbnailUrl && (
                                        <div className="relative w-16 h-16 flex-shrink-0 rounded overflow-hidden bg-muted">
                                          <Image
                                            src={item.thumbnailUrl}
                                            alt={`History item: ${item.content.slice(0, 50)}...`}
                                            fill
                                            className="object-cover"
                                            unoptimized
                                          />
                                        </div>
                                      )}
                                      <div className="flex-1 min-w-0">
                                        <p className="text-xs text-muted-foreground mb-1">{new Date(item.timestamp).toLocaleString()}</p>
                                        <p className="text-sm line-clamp-3 break-words font-mono bg-muted/50 p-1 rounded">{item.content}</p>
                                      </div>
                                    </div>
                                    <div className="flex justify-end gap-2 mt-2">
                                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => { userPreferences.removeFromHistory(item.id); setHistory(userPreferences.getHistory()) }} aria-label="Delete history item">
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                      <Button size="sm" variant="secondary" className="h-8" onClick={() => copyToClipboard(item.content, item.postId || 0, true, item.thumbnailUrl)}>
                                        <Copy className="h-3 w-3 mr-1" /> Copy
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                                <Button variant="outline" className="w-full text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => { userPreferences.clearHistory(); setHistory([]) }}>
                                  Clear History
                                </Button>
                              </>
                            )}
                          </div>
                        </SheetContent>
                      </Sheet>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setShowSettings(!showSettings)}
                        className={`h-11 w-11 p-0 shadow-sm ${showSettings ? "bg-muted" : ""}`}
                        title="Toggle settings"
                        aria-label={showSettings ? "Hide settings" : "Show settings"}
                      >
                        <Settings className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Advanced Filters & Options */}
                  <Collapsible open={showSettings} onOpenChange={setShowSettings}>
                    <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                      <div className="bg-muted/30 border rounded-xl p-4 space-y-4">
                        <div className="grid grid-cols-1 gap-4">
                          {/* Tags Management */}
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <label htmlFor="add-tags" className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                                <InfoTooltip
                                  title="Tags to Add"
                                  description="An option to add whatever tags you want to all prompts. Useful if you use LoRAs with trigger words or want to apply styles (realistic, photorealistic, sketch, etc.)."
                                  visual={
                                    <div className="w-full flex flex-col gap-2 p-1.5 text-[10px]">
                                      <div className="flex flex-col gap-1.5 bg-muted/40 p-2 rounded-lg border border-border/50">
                                        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                                          <span className="text-muted-foreground font-medium min-w-[70px]">Input:</span>
                                          <span className="bg-green-500/10 text-green-500 border border-green-500/20 px-1.5 py-0.5 rounded">masterpiece, best quality</span>
                                        </div>
                                        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                                          <span className="text-muted-foreground font-medium min-w-[70px]">Original:</span>
                                          <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">1girl, solo, looking at viewer</span>
                                        </div>
                                      </div>
                                      
                                      <div className="flex items-center gap-2 mt-1 px-1">
                                        <span className="text-muted-foreground font-medium min-w-[70px]">Result:</span>
                                        <div className="flex flex-wrap gap-1">
                                          <span className="bg-green-500/10 border border-green-500/20 text-green-500 px-1.5 py-0.5 rounded flex items-center gap-0.5"><Check className="w-3 h-3" /> masterpiece, best quality</span>
                                          <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">1girl, solo, looking at viewer</span>
                                        </div>
                                      </div>
                                    </div>
                                  }
                                >
                                  Tags to Add
                                </InfoTooltip>
                                <span className="text-[10px] font-normal text-muted-foreground/70">(Only modify final prompt)</span>
                              </label>
                              <div className="flex h-9 w-full items-center rounded-md border border-input bg-background/50 pl-3 pr-1 text-sm shadow-sm transition-colors focus-within:outline-none focus-within:ring-1 focus-within:ring-ring">
                                <DebouncedHTMLInput id="add-tags" value={addInput} onChange={setAddInput} debounceTime={400} placeholder="masterpiece, best quality..." aria-label="Tags to include input" className="flex-1 bg-transparent border-none p-0 placeholder:text-muted-foreground focus:outline-none h-full min-w-0" />
                                <div className="flex items-center gap-0.5 ml-1.5 shrink-0">
                                  {addInput && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => setAddInput("")}
                                      className="h-6 w-6 text-muted-foreground hover:text-foreground rounded-full"
                                      aria-label="Clear added tags"
                                    >
                                      <X className="h-3 w-3" />
                                    </Button>
                                  )}

                                  <div className="h-4 w-px bg-border mx-1" />
                                  <div className="flex items-center">
                                    <Dialog open={isPresetDialogOpen} onOpenChange={setIsPresetDialogOpen}>
                                      <DialogTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground rounded-r-none" title="Save Preset" aria-label="Save current tags as preset">
                                          <Save className="h-3.5 w-3.5" />
                                        </Button>
                                      </DialogTrigger>
                                      <DialogContent>
                                        <DialogHeader>
                                          <DialogTitle>Save Preset</DialogTitle>
                                          <DialogDescription>
                                            Enter a name for your tags preset.
                                          </DialogDescription>
                                        </DialogHeader>
                                        <div className="space-y-4 py-4">
                                          <div className="space-y-2">
                                            <Label>Preset Name</Label>
                                            <DebouncedInput value={presetName} onChange={setPresetName} debounceTime={300} placeholder="My awesome preset" />
                                          </div>
                                          <div className="space-y-2">
                                            <Label>Tags</Label>
                                            <div className="p-2 bg-muted rounded-md text-sm font-mono break-all max-h-32 overflow-y-auto">
                                              {addInput || <span className="text-muted-foreground italic">No tags entered</span>}
                                            </div>
                                          </div>
                                        </div>
                                        <DialogFooter>
                                          <Button variant="outline" onClick={() => setIsPresetDialogOpen(false)}>Cancel</Button>
                                          <Button onClick={savePreset} disabled={!presetName.trim() || !addInput.trim()}>Save</Button>
                                        </DialogFooter>
                                      </DialogContent>
                                    </Dialog>

                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-7 w-6 min-w-[1.5rem] text-muted-foreground hover:text-foreground rounded-l-none" title="Select Preset" aria-label="Select a saved tags preset">
                                          <ChevronDown className="h-3.5 w-3.5" />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end" className="w-[240px]">
                                        <DropdownMenuLabel>Saved Presets</DropdownMenuLabel>
                                        <DropdownMenuSeparator />
                                        {presets.length === 0 ? (
                                          <div className="p-2 text-sm text-center text-muted-foreground">
                                            No presets saved
                                          </div>
                                        ) : (
                                          presets.map(preset => (
                                            <DropdownMenuItem key={preset.id} className="justify-between group cursor-pointer" onClick={() => loadPreset(preset)}>
                                              <span className="truncate mr-2">{preset.name}</span>
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10"
                                                onClick={(e) => deletePreset(preset.id, e)}
                                                aria-label={`Delete preset ${preset.name}`}
                                              >
                                                <Trash2 className="h-4 w-4" />
                                              </Button>
                                            </DropdownMenuItem>
                                          ))
                                        )}
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div className="space-y-2">
                              <label htmlFor="exclude-tags" className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                                <InfoTooltip
                                  title="Tags to Exclude"
                                  description="Removes tags from the final prompt on all cards. For example, tags like 'solo' or 'realistic' which are sometimes found in prompts and might not be desired."
                                  visual={
                                    <div className="w-full flex flex-col gap-2 p-1.5 text-[10px]">
                                      <div className="flex flex-col gap-1.5 bg-muted/40 p-2 rounded-lg border border-border/50">
                                        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                                          <span className="text-muted-foreground font-medium min-w-[70px]">Input:</span>
                                          <span className="bg-red-500/10 text-red-500 border border-red-500/20 px-1.5 py-0.5 rounded">realistic, 3d</span>
                                        </div>
                                        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                                          <span className="text-muted-foreground font-medium min-w-[70px]">Original:</span>
                                          <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">1girl, solo, realistic, 3d, hat</span>
                                        </div>
                                      </div>
                                      
                                      <div className="flex items-center gap-2 mt-1 px-1">
                                        <span className="text-muted-foreground font-medium min-w-[70px]">Result:</span>
                                        <div className="flex flex-wrap gap-1">
                                          <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">1girl, solo, hat</span>
                                          <span className="bg-destructive/10 border border-destructive/20 text-destructive line-through px-1.5 py-0.5 rounded"><X className="w-2.5 h-2.5 inline mr-0.5" />realistic, 3d</span>
                                        </div>
                                      </div>
                                    </div>
                                  }
                                >
                                  Tags to Exclude
                                </InfoTooltip>
                                <span className="text-[10px] font-normal text-muted-foreground/70">(Only modify final prompt)</span>
                              </label>
                              <div className="relative">
                                <DebouncedInput id="exclude-tags" value={excludeInput} onChange={setExcludeInput} debounceTime={400} placeholder="bad quality, watermark..." className="h-9 text-sm bg-background/50" aria-label="Tags to exclude input" />
                                {excludeInput && (
                                  <button type="button" onClick={() => setExcludeInput("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground flex items-center justify-center h-6 w-6 rounded-full hover:bg-muted" aria-label="Clear excluded tags">
                                    <X className="h-3 w-3" />
                                  </button>
                                )}
                              </div>
                            </div>
                            <SmoothFilterSlider
                              min={5}
                              max={100}
                              step={1}
                              value={search.tagCountFilter}
                              onChange={search.setTagCountFilter}
                              onCommit={search.setAppliedTagCountFilter}
                              disabled={!isTagCountSupported}
                              labelPrefix="Minimum Tag Count"
                              tooltipTitle="Minimum Tag Count"
                              tooltipDescription="This option ensures that only prompts with more than a certain amount of tags appear. The higher the number, the more detailed prompts you get; recommended around 20-30."
                              tooltipVisual={
                                <div className="w-full flex flex-col gap-2 p-1.5 text-[10px]">
                                  <div className="flex flex-col gap-1.5 bg-muted/40 p-2 rounded-lg border border-border/50">
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                                      <span className="text-muted-foreground font-medium min-w-[70px]">Config:</span>
                                      <span className="bg-blue-500/10 text-blue-500 border border-blue-500/20 px-1.5 py-0.5 rounded font-mono">{">"} 20 Tags</span>
                                    </div>
                                  </div>
                                  
                                  <div className="flex flex-col gap-2 mt-1 px-1">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-2 bg-primary/5 rounded border border-border gap-2">
                                      <span className="text-foreground line-clamp-1 flex-1">1girl, solo, short hair...</span>
                                      <Badge variant="destructive" className="shrink-0 whitespace-nowrap">15 Tags (Hidden)</Badge>
                                    </div>
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-2 bg-primary/10 rounded border border-primary/20 gap-2">
                                      <span className="text-foreground line-clamp-1 flex-1 font-medium">1girl, solo, detailed face, green eyes...</span>
                                      <Badge className="bg-blue-500 hover:bg-blue-500 text-white shrink-0 whitespace-nowrap">42 Tags (Visible)</Badge>
                                    </div>
                                  </div>
                                </div>
                              }
                              inputId="tag-count"
                              isInputValid={isTagCountValid}
                              maxInput={1000}
                              ariaLabel="Minimum tag count"
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
                              labelPrefix="Minimum Character Post Count"
                              tooltipTitle="Minimum Character Post Count"
                              tooltipDescription="This option ensures that only posts containing characters with a minimum amount of booru posts appear. Useful for filtering out obscure characters."
                              inputId="character-count"
                              isInputValid={!!search.characterCountFilter && /^\d+$/.test(search.characterCountFilter)}
                              maxInput={1000000}
                              ariaLabel="Minimum character post count"
                              dotColor={includeCharacters ? "bg-blue-500" : "bg-gray-400"}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Prompt Generation Options — right column of the 2-col panel */}
                      <div className="space-y-4 rounded-xl border border-border/60 bg-muted/30 p-4">
                        <button
                          type="button"
                          onClick={() => setIsPromptOptionsExpanded((v) => !v)}
                          aria-expanded={isPromptOptionsExpanded}
                          className="w-full flex items-center justify-between gap-2 cursor-pointer sm:cursor-default sm:pointer-events-none"
                        >
                          <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                            <Settings className="h-4 w-4 text-primary" />
                            {search.booruProvider === 'aibooru' ? 'Aibooru Options' : 'Prompt Generation Options'}
                          </span>
                              <ChevronDown
                                className={cn(
                                  "w-4 h-4 shrink-0 transition-transform duration-200 sm:hidden",
                                  isPromptOptionsExpanded && "rotate-180"
                                )}
                              />
                            </button>
                            <div
                              className={cn(
                                "grid grid-cols-1 sm:grid-cols-2 gap-3",
                                !isPromptOptionsExpanded && "hidden sm:grid"
                              )}
                            >
                              {search.booruProvider !== 'aibooru' ? (
                                <>
                                  <div className="flex items-center justify-between sm:justify-start gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors border border-transparent hover:border-border/50 sm:col-span-2">
                                    <InfoTooltip
                                      title="Include Characters"
                                      description="Does exactly that: includes character tags in the prompt. You can turn this off if you don't want character names."
                                      visual={
                                        <div className="w-full flex flex-col gap-2 p-1.5 text-[10px]">
                                          <div className="flex flex-col gap-1.5 bg-muted/40 p-2 rounded-lg border border-border/50">
                                            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                                              <span className="text-muted-foreground font-medium min-w-[70px]">Toggle:</span>
                                              <span className="bg-destructive/10 text-destructive border border-destructive/20 px-1.5 py-0.5 rounded font-mono font-medium">Off/False</span>
                                            </div>
                                            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                                              <span className="text-muted-foreground font-medium min-w-[70px]">Original:</span>
                                              <span className="px-1.5 py-0.5 rounded text-foreground font-mono bg-primary/5">hatsune miku, 1girl, solo</span>
                                            </div>
                                          </div>
                                          
                                          <div className="flex items-center gap-2 mt-1 px-1">
                                            <span className="text-muted-foreground font-medium min-w-[70px]">Result:</span>
                                            <div className="flex flex-wrap gap-1">
                                              <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">1girl, solo</span>
                                              <span className="bg-destructive/10 border border-destructive/20 text-destructive line-through px-1.5 py-0.5 rounded"><X className="w-2.5 h-2.5 inline mr-0.5" />hatsune miku</span>
                                            </div>
                                          </div>
                                        </div>
                                      }
                                    >
                                      <Label htmlFor="include-characters" className="text-sm select-none cursor-pointer flex-1 sm:flex-none">Include Characters</Label>
                                    </InfoTooltip>
                                    <Switch
                                      id="include-characters"
                                      checked={includeCharacters}
                                      onCheckedChange={setIncludeCharacters}
                                      className="scale-90"
                                      aria-label="Include characters in prompts"
                                    />
                                  </div>
                                  <div className="flex items-center justify-between sm:justify-start gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors border border-transparent hover:border-border/50 sm:col-span-2">
                                    <InfoTooltip
                                      title="Smart Tag Combination"
                                      description="If the prompt has, for example, 'hair, long hair, white hair', this function combines them into a single tag: 'white long hair'. Useful to avoid redundancy and not saturate the tokenizer."
                                      visual={
                                        <div className="w-full flex flex-col gap-2 p-1">
                                          <div className="flex justify-between items-center text-[10px] text-muted-foreground w-full px-1">
                                            <span>Before</span>
                                            <span>After</span>
                                          </div>
                                          <div className="flex justify-between items-center gap-2 w-full">
                                            <span className="bg-muted text-muted-foreground px-2 py-1 rounded text-[10px] whitespace-nowrap">hair, long hair, white hair</span>
                                            <span className="text-muted-foreground">→</span>
                                            <span className="bg-primary/10 border border-primary/20 text-primary px-2 py-1 rounded text-[10px] whitespace-nowrap">white long hair</span>
                                          </div>
                                        </div>
                                      }
                                    >
                                      <Label htmlFor="smart-tag" className="text-sm select-none cursor-pointer flex-1 sm:flex-none">Smart Tag Combination</Label>
                                    </InfoTooltip>
                                    <Switch
                                      id="smart-tag"
                                      checked={optimizeTags}
                                      onCheckedChange={setOptimizeTags}
                                      className="scale-90"
                                      aria-label="Enable smart tag combination"
                                    />
                                  </div>
                                  <div className="flex items-center justify-between sm:justify-start gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors border border-transparent hover:border-border/50 sm:col-span-2">
                                    <div className="flex items-center gap-2">
                                      <InfoTooltip
                                        title="Smart Tag Exclusion"
                                        description="Makes added tags work smartly. For example, if the original prompt implies a back view without a face, and your 'Tags to add' contains facial features like 'lips, nose, blue eyes', it automatically disables them for that specific card to keep the generated result faithful. WARNING: This is a beta feature and is still being polished."
                                        visual={
                                          <div className="w-full flex flex-col gap-2 p-1.5 text-[10px]">
                                            <div className="flex flex-col gap-1.5 bg-muted/40 p-2 rounded-lg border border-border/50">
                                              <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                                                <span className="text-muted-foreground font-medium min-w-[70px]">Prompt:</span>
                                                <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">1girl, from behind</span>
                                              </div>
                                              <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                                                <span className="text-muted-foreground font-medium min-w-[70px]">Tags to Add:</span>
                                                <span className="bg-green-500/10 text-green-500 border border-green-500/20 px-1.5 py-0.5 rounded">blue eyes, lips</span>
                                              </div>
                                            </div>
                                            
                                            <div className="flex items-center gap-2 mt-1 px-1">
                                              <span className="text-muted-foreground font-medium min-w-[70px]">Result:</span>
                                              <div className="flex flex-wrap gap-1">
                                                <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">from behind</span>
                                                <span className="bg-destructive/10 border border-destructive/20 text-destructive line-through px-1.5 py-0.5 rounded">blue eyes, lips</span>
                                              </div>
                                            </div>
                                          </div>
                                        }
                                      >
                                        <Label htmlFor="smart-exclusion" className="text-sm select-none cursor-pointer">Smart Tag Exclusion</Label>
                                      </InfoTooltip>
                                      <Badge variant="default" className="text-xs py-0 px-2 !rounded-lg">Beta</Badge>
                                    </div>
                                    <Switch
                                      id="smart-exclusion"
                                      checked={smartTagExclusion}
                                      onCheckedChange={setSmartTagExclusion}
                                      className="scale-90"
                                      aria-label="Enable smart tag exclusion"
                                    />
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="flex items-center justify-between sm:justify-start gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors border border-transparent hover:border-border/50 sm:col-span-2">
                                    <Label htmlFor="remove-lora" className="text-sm select-none cursor-pointer flex-1 sm:flex-none">Remove LoRa Tags</Label>
                                    <Switch
                                      id="remove-lora"
                                      checked={search.removeLoRaTags}
                                      onCheckedChange={search.setRemoveLoRaTags}
                                      className="scale-90"
                                      aria-label="Remove LoRa tags from Aibooru prompts"
                                    />
                                  </div>
                                  <div className="flex items-center justify-between sm:justify-start gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors border border-transparent hover:border-border/50 sm:col-span-2">
                                    <Label htmlFor="remove-quality" className="text-sm select-none cursor-pointer flex-1 sm:flex-none">Remove Quality Tags</Label>
                                    <Switch
                                      id="remove-quality"
                                      checked={search.removeQualityTags}
                                      onCheckedChange={search.setRemoveQualityTags}
                                      className="scale-90"
                                      aria-label="Remove quality tags from Aibooru prompts"
                                    />
                                  </div>
                                </>
                              )}


                              <div className="sm:col-span-2 flex items-center justify-between sm:justify-start gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors border border-transparent hover:border-border/50">
                                <div className="flex flex-col gap-0.5 flex-1 sm:flex-none">
                                  <InfoTooltip
                                    title="Global Tag Weights"
                                    description="All tags are clickable. If you click a tag, you can adjust its weight (e.g., 1.5). If 'Global Tag Weights' is enabled and you click the Globe icon, that weight will automatically be applied to all cards containing said tag."
                                    visual={
                                      <div className="w-full flex gap-3 text-[10px] items-center p-3 bg-slate-950 rounded-lg overflow-hidden relative">
                                        
                                        {/* Popover mock */}
                                        <div className="flex flex-col w-[130px] bg-slate-800 rounded-lg border border-slate-700 shadow-xl overflow-hidden shrink-0 text-slate-200 z-10">
                                          <div className="p-2 flex items-center justify-between">
                                            <div className="flex items-center gap-2.5 text-slate-400">
                                              <span>—</span> <span className="font-bold text-slate-100 text-[11px]">1.5</span> <span>+</span>
                                            </div>
                                            <Globe className="w-3.5 h-3.5 text-[#a855f7]" />
                                          </div>
                                          <div className="p-1.5 px-2 border-y border-slate-700 flex items-center gap-1.5 text-slate-400">
                                            <Search className="w-3 h-3" /> <span>Search Tag</span>
                                          </div>
                                          <div className="p-2 flex flex-wrap gap-1 items-center">
                                            <span className="bg-[#a855f7]/20 text-[#d8b4fe] px-1.5 py-0.5 rounded-md font-medium">
                                              (frieren:1.5)
                                            </span>
                                            <span className="text-slate-300 leading-tight">1girl, elf...</span>
                                          </div>
                                        </div>

                                        <ArrowRight className="w-4 h-4 text-slate-500 shrink-0 z-10" />

                                        {/* Affected cards mock */}
                                        <div className="flex flex-col gap-2 flex-1 w-full text-slate-200 z-10">
                                          <div className="bg-slate-800 rounded-lg border border-slate-700 p-2 flex flex-col gap-1.5 shadow-sm">
                                            <div className="flex">
                                              <span className="bg-[#a855f7]/20 text-[#d8b4fe] rounded-md px-1.5 py-0.5 font-medium relative">
                                                (frieren:1.5)
                                                <span className="absolute -top-0.5 -right-0.5 w-[5px] h-[5px] rounded-full bg-[#a855f7] shadow-[0_0_6px_#c084fc]" />
                                              </span>
                                            </div>
                                            <span className="text-slate-300">elf, sitting</span>
                                          </div>
                                          <div className="bg-slate-800 rounded-lg border border-slate-700 p-2 flex flex-col gap-1.5 shadow-sm">
                                            <div className="flex">
                                              <span className="bg-[#a855f7]/20 text-[#d8b4fe] rounded-md px-1.5 py-0.5 font-medium relative">
                                                (frieren:1.5)
                                                <span className="absolute -top-0.5 -right-0.5 w-[5px] h-[5px] rounded-full bg-[#a855f7] shadow-[0_0_6px_#c084fc]" />
                                              </span>
                                            </div>
                                            <span className="text-slate-300">long_hair</span>
                                          </div>
                                        </div>
                                      </div>
                                    }
                                  >
                                    <Label htmlFor="global-weights-toggle" className="text-sm select-none cursor-pointer">Global Tag Weights</Label>
                                  </InfoTooltip>
                                  <span className="text-[10px] text-muted-foreground">Propagate changes to all cards</span>
                                </div>
                                <div className="flex items-center gap-2 ml-auto sm:ml-0">
                                  <Switch
                                    id="global-weights-toggle"
                                    checked={isGlobalWeightsEnabled}
                                    onCheckedChange={toggleGlobalWeights}
                                    className="scale-90"
                                    aria-label="Toggle global tag weights"
                                  />
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 px-3 text-xs"
                                    onClick={(e) => {
                                      e.preventDefault()
                                      setIsGlobalWeightsModalOpen(true)
                                    }}
                                  >
                                    Manage
                                  </Button>
                                </div>
                              </div>

                              <div className="sm:col-span-2 flex flex-col gap-2 p-3 mt-1 rounded-xl bg-muted/40 border border-border/50 shadow-sm transition-colors hover:border-border/80">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                  <div className="flex items-center">     
                                    <div className="flex flex-col gap-0.5">
                                      <div className="flex items-center gap-2">
                                        <InfoTooltip
                                          title="Background Options"
                                          description="This option allows you to modify background-related tags for greater control. You can leave them as is, remove them completely, or more importantly, replace them with one of your liking. Useful for getting results with the same background or simply adding a white background to all your generations. WARNING: This is a beta feature and is still being polished."
                                          visual={
                                            <div className="w-full flex flex-col gap-2 p-1.5 text-[10px]">
                                              <div className="flex flex-col gap-1.5 bg-muted/40 p-2 rounded-lg border border-border/50">
                                                <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                                                  <span className="text-muted-foreground font-medium min-w-[70px]">Original:</span>
                                                  <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">1girl, outdoors, blue sky</span>
                                                </div>
                                                <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                                                  <span className="text-muted-foreground font-medium min-w-[70px]">Option:</span>
                                                  <span className="bg-yellow-500/10 text-yellow-600 border border-yellow-500/20 px-1.5 py-0.5 rounded flex items-center gap-1">Replace: <span>white background</span></span>
                                                </div>
                                              </div>
                                              
                                              <div className="flex items-center gap-2 mt-1 px-1">
                                                <span className="text-muted-foreground font-medium min-w-[70px]">Result:</span>
                                                <div className="flex flex-wrap gap-1">
                                                  <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">1girl</span>
                                                  <span className="bg-green-500/10 border border-green-500/20 text-green-500 px-1.5 py-0.5 rounded flex items-center gap-0.5"><Check className="w-3 h-3" /> white background</span>
                                                </div>
                                              </div>
                                            </div>
                                          }
                                        >
                                          <Label htmlFor="background-handling-select" className="text-sm font-medium cursor-pointer">Background Options</Label>
                                        </InfoTooltip>
                                        <Badge variant="default" className="text-xs py-0 px-2 !rounded-lg">Beta</Badge>
                                      </div>
                                      <span className="text-[10px] text-muted-foreground leading-tight">Modify scenery tags</span>
                                    </div>
                                  </div>
                                  <div className="w-full sm:w-auto sm:min-w-[160px]">
                                    <Select
                                      value={backgroundMode}
                                      onValueChange={(val: any) => {
                                        setBackgroundMode(val);
                                        userPreferences.setBackgroundMode(val);
                                      }}
                                    >
                                      <SelectTrigger id="background-handling-select" className="h-8 text-xs bg-background">
                                        <SelectValue placeholder="Keep Original" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="keep">Keep Original</SelectItem>
                                        <SelectItem value="remove_all">Remove All</SelectItem>
                                        <SelectItem value="force_simple">Replace</SelectItem>
                                        <SelectItem value="random">Simple Random</SelectItem>
                                        <SelectItem value="detailed_random">Detailed Random</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>
                                  <AnimatePresence>
                                    {backgroundMode === 'force_simple' && (
                                    <motion.div
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: "auto", opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      transition={{ duration: 0.2, ease: "easeInOut" }}
                                      className="overflow-hidden"
                                    >
                                      <div className="pt-2 pl-0 sm:pl-[3.25rem] flex items-center gap-2">
                                        <CornerDownRight className="w-3.5 h-3.5 text-muted-foreground hidden sm:block shrink-0" />
                                        <DebouncedInput value={simpleBackgroundReplacementTags} onChange={(val) => {
                                          setSimpleBackgroundReplacementTags(val);
                                          userPreferences.setSimpleBackgroundReplacementTags(val);
                                        }} debounceTime={400} placeholder="e.g. simple background, white background" className="h-8 text-xs bg-background focus-visible:ring-1 min-w-0 flex-1" aria-label="Tags to replace background with" />
                                      </div>
                                    </motion.div>
                                  )}
                                  {backgroundMode === 'random' && (
                                    <motion.div
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: "auto", opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      transition={{ duration: 0.2, ease: "easeInOut" }}
                                      className="overflow-hidden"
                                    >
                                      <div className="pt-3 pl-0 sm:pl-[3.25rem] flex flex-col gap-3">
                                        <div className="flex items-center justify-between">
                                          <div className="flex flex-col gap-1">
                                            <span className="text-xs font-medium text-foreground">Include Patterns</span>
                                            <span className="text-[10px] text-muted-foreground leading-tight">Allow generation of patterned backgrounds.</span>
                                          </div>
                                          <Switch checked={randomBackgroundPatterns} onCheckedChange={(val) => { setRandomBackgroundPatterns(val); userPreferences.setRandomBackgroundPatterns(val); }} className="scale-75 origin-right" />
                                        </div>
                                        <div className="flex items-center justify-between">
                                          <div className="flex flex-col gap-1">
                                            <span className="text-xs font-medium text-foreground">Include Gradients</span>
                                            <span className="text-[10px] text-muted-foreground leading-tight">Add two-tone and gradient backgrounds.</span>
                                          </div>
                                          <Switch checked={randomBackgroundIncludeGradients} onCheckedChange={setRandomBackgroundIncludeGradients} className="scale-75 origin-right" />
                                        </div>
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            </div>
                      </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  {/* Status & Alerts */}
                  <div className="space-y-2">
                    {/* Active Query Display */}
                    {getFinalQueryTags(search.searchTags, search.ratingFilter, search.order, search.appliedTagCountFilter, search.booruProvider).length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 text-xs text-foreground/80 bg-muted/30 p-2 rounded-md border border-border/30">
                        <span className="font-medium">Active Query:</span>
                        {getFinalQueryTags(search.searchTags, search.ratingFilter, search.order, search.appliedTagCountFilter, search.booruProvider).map((tag, index) => (
                          <Badge key={index} variant="secondary" className="text-[10px] px-1.5 py-0 h-5 font-mono">
                            {tag}
                          </Badge>
                        ))}
                        {search.booruProvider === "aibooru" && search.searchTags.includes("has:prompt") && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 text-green-600 border-green-200 bg-green-50 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400">
                            has:prompt
                          </Badge>
                        )}
                      </div>
                    )}

                    {/* Simplified status display logic */}
                    {search.booruProvider === 'danbooru' && hasMultipleTags(search.searchTags, search.order, 0) && (
                      <Alert variant="destructive" className="py-2">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription className="text-xs">
                          Danbooru API limit: Only first 2 user tags will be used.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>

          {/* Gallery Grid */}
          <AnimatePresence>
            {favs.showFavorites && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: "auto", marginBottom: 24 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                className="flex flex-col gap-3 overflow-hidden"
              >
                <div className="flex items-center justify-between px-2 pt-2">
                  <h2 className="text-lg font-semibold tracking-tight">Your Favorites</h2>
                </div>
                <ScrollArea className="w-full whitespace-nowrap pb-2 pt-1">
                  <div className="flex w-max space-x-2 px-2">
                    <LayoutGroup id="favoritesTabs">
                      {(() => {
                        // Calculate counts from core state (source of truth), NOT from loaded posts
                        const folderMap = favs.favoriteFolderMap || {};
                        const folderEntries = Object.entries(folderMap);

                        const allCount = favs.favorites.size;
                        
                        const uncategorizedCount = folderEntries.filter(([_, ids]) => ids.length === 0).length;

                        return [
                          { id: 'all', name: 'All Favorites', count: allCount, icon: null, isArtists: false },
                          // Reserved virtual folder for saved artists — always pinned
                          // right after "All Favorites" for discoverability.
                          { id: 'artists', name: 'Artists', count: savedArtists.savedArtists.length, icon: 'Palette', isArtists: true },
                          { id: null, name: 'Uncategorized', count: uncategorizedCount, icon: 'Folder', isArtists: false },
                          ...favs.folders.map(f => ({
                            id: f.id as string | null | 'all' | 'artists',
                            name: f.name,
                            count: folderEntries.filter(([_, ids]) => ids.includes(f.id)).length,
                            icon: f.icon,
                            isArtists: false,
                          }))
                        ].map((tab, i) => {
                          const isActive = activeFavoriteFolder === tab.id;
                          const isArtistsTab = tab.isArtists;
                          return (
                            <motion.button
                              key={String(tab.id)}
                              initial={{ opacity: 0, x: -20 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: i * 0.05, type: "spring", stiffness: 300, damping: 20 }}
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => setActiveFavoriteFolder(tab.id as any)}
                              className={cn(
                                "relative px-4 py-1.5 rounded-full text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 flex items-center gap-2",
                                isActive
                                  ? "text-primary-foreground shadow-sm"
                                  : isArtistsTab
                                    ? "text-purple-700 dark:text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/40 ring-1 ring-purple-500/20 shadow-[0_0_10px_rgba(168,85,247,0.15)]"
                                    : "text-muted-foreground hover:text-foreground bg-secondary/50 hover:bg-secondary border border-border/50",
                              )}
                            >
                              {isActive && (
                                <motion.div
                                  layoutId="activeFavoriteFolderBubble"
                                  className={cn(
                                    "absolute inset-0 rounded-full shadow-sm",
                                    isArtistsTab
                                      ? "bg-gradient-to-r from-purple-500 to-fuchsia-500 shadow-[0_0_16px_rgba(168,85,247,0.45)]"
                                      : "bg-red-500",
                                  )}
                                  transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                                />
                              )}
                              <span className="relative z-10 flex items-center gap-2">
                                {tab.icon && renderIcon(tab.icon, { className: `w-3.5 h-3.5 ${isActive ? "text-primary-foreground" : isArtistsTab ? "text-purple-500" : "opacity-80"}` })}
                                <span>{tab.name}</span>
                                <span className={cn(
                                  "text-[10px] px-1.5 py-0.5 rounded-full font-mono",
                                  isActive ? "bg-black/20" : isArtistsTab ? "bg-purple-500/15 text-purple-700 dark:text-purple-200" : "bg-background/80",
                                )}>{tab.count}</span>
                                {tab.id !== 'all' && tab.id !== null && tab.id !== 'artists' && (
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    title="Delete Folder"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setFolderToDelete({ id: tab.id as string, name: tab.name })
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault()
                                        e.stopPropagation()
                                        setFolderToDelete({ id: tab.id as string, name: tab.name })
                                      }
                                    }}
                                    className={`ml-1 rounded-full p-1.5 min-w-[32px] min-h-[32px] flex items-center justify-center transition-colors cursor-pointer ${isActive ? "hover:bg-black/20 text-primary-foreground" : "hover:bg-secondary-foreground/20 text-muted-foreground hover:text-foreground"}`}
                                    aria-label={`Delete folder ${tab.name}`}
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </span>
                                )}
                              </span>
                            </motion.button>
                          )
                        });
                      })()}
                    </LayoutGroup>
                  </div>
                  <ScrollBar orientation="horizontal" className="h-2.5" />
                </ScrollArea>
              </motion.div>
            )}
          </AnimatePresence>

          {favs.showFavorites && activeFavoriteFolder === 'artists' && (
            <div className="mb-8 min-h-[500px] mt-4">
              <ArtistGrid
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
            </div>
          )}

          {folderMismatch.loading > 0 && (
            <p className="text-sm text-muted-foreground text-center py-2 animate-pulse">
              Loading {folderMismatch.loading} more {folderMismatch.loading === 1 ? 'post' : 'posts'}…
            </p>
          )}

          {folderMismatch.unavailable > 0 && (
            <UnavailablePostsNotice
              unavailableKeys={folderMismatch.unavailableKeys}
              activeFolderId={activeFavoriteFolder === 'all' ? 'all' : activeFavoriteFolder}
              toggleFavorite={favs.toggleFavorite}
              injectRecoveredPosts={favs.injectRecoveredPosts}
            />
          )}

          {filteredPosts.length > 0 && activeFavoriteFolder !== 'artists' && (
            viewMode === "grid" ? (
              <div id="results-anchor" className="mb-8 min-h-[500px] scroll-mt-20">
                <MasonryGrid
                  items={filteredPosts}
                  scale={effectiveScale}
                  renderItem={renderMasonryItem}
                />
              </div>
            ) : (
              <div className="space-y-4 mb-8">
                {filteredPosts.map((post, index) => {
                  return (
                    <div key={`${post.id}`}>
                      {renderMasonryItem(post, 800, 600, index)}
                    </div>
                  )
                })}
              </div>
            )
          )}

          {/* Load More / States */}
          {filteredPosts.length > 0 && !favs.showFavorites && activeFavoriteFolder !== 'artists' && (
            <div className="text-center pb-8">
              {!search.loadMoreError && !imageRateLimited ? (
 <InfiniteScrollTrigger
 onIntersect={search.loadMore}
 hasNextPage={!search.noMoreResults && !imageRateLimited}
 isLoading={search.isLoadingMore}
 error={search.loadMoreError}
 loadedCount={filteredPosts.length}

                />
              ) : imageRateLimited ? (
                <div className="space-y-2">
                  <p className="text-sm text-amber-600 dark:text-amber-400">Slow down! Too many requests at once.</p>
                  <Button
                    onClick={() => {
                      setImageRateLimited(false)
                      imageErrorCountRef.current = 0
                    }}
                    variant="outline"
                    className="gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Resume Scroll
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-destructive">Failed to load more posts.</p>
                  <Button
                    onClick={search.loadMore}
                    variant="outline"
                    className="gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Retry
                  </Button>
                </div>
              )}

              {search.noMoreResults && !search.loadMoreError && !imageRateLimited && (
                <p className="text-muted-foreground text-sm py-4">
                  --- End of results ---
                </p>
              )}
            </div>
          )}

          {/* Loading / Empty States */}
          {/* Show progress bar only on initial load (no posts visible yet).
              During Load More, the button handles its own loading state. */}
          {((search.isLoading && filteredPosts.length === 0 && !favs.showFavorites) || (favs.showFavorites && (favs.isLoading || favs.isRefreshing) && filteredPosts.length === 0 && activeFavoriteFolder !== 'artists')) && (
            <div className="text-center py-12">
              {favs.showFavorites && favs.favoritesProgress.total > 0 ? (
                <>
                  {/* Progress bar */}
                  <div className="w-full max-w-xs mx-auto mb-3">
                    <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${Math.round((favs.favoritesProgress.loaded / favs.favoritesProgress.total) * 100)}%` }}
                      />
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Loading favorites...{" "}
                    <span className="font-medium text-foreground">
                      {favs.favoritesProgress.loaded}
                    </span>
                    {" / "}
                    {favs.favoritesProgress.total}
                    {favs.favoritesProgress.loaded > 0 && (
                      <span className="text-xs ml-1">
                        ({Math.round((favs.favoritesProgress.loaded / favs.favoritesProgress.total) * 100)}%)
                      </span>
                    )}
                  </p>
                </>
              ) : (
                <>
                  <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
                  <p className="mt-4">Loading...</p>
                </>
              )}
            </div>
          )}

          {/* Favorites error states */}
          {favs.showFavorites && filteredPosts.length === 0 && activeFavoriteFolder !== 'artists' && !favs.isLoading && !favs.isRefreshing && (favs.favoritesError || favs.postsError) && (
            <div className="text-center py-12 px-4">
              <AlertTriangle className="w-10 h-10 mx-auto text-amber-500 mb-3" />
              {favs.favoritesError ? (
                <>
                  <p className="text-lg font-medium mb-1">Could not load favorites from cloud</p>
                  <p className="text-sm text-muted-foreground mb-4">Check your connection and try again.</p>
                </>
              ) : (
                <>
                  <p className="text-lg font-medium mb-1">Failed to load favorites</p>
                  <p className="text-sm text-muted-foreground mb-4">The post data could not be retrieved. Please try again.</p>
                </>
              )}
              <Button onClick={favs.retryLoadFavorites} variant="outline" className="gap-2">
                <RefreshCw className="w-4 h-4" />
                Retry
              </Button>
            </div>
          )}

          {!search.isLoading && (!favs.isLoading && !favs.isRefreshing) && filteredPosts.length === 0 && activeFavoriteFolder !== 'artists' && !favs.favoritesError && !favs.postsError && (
            <>
              {favs.showFavorites ? (
                <div className="text-center py-12 px-4">
                  <p className="text-lg font-medium">No favorites yet</p>
                </div>
              ) : (
                <NoResultsState />
              )}
            </>
          )}

          {/* Footer Links for E-E-A-T and Legal */}
          <footer className="mt-12 py-8 border-t border-border/40">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8 text-sm text-muted-foreground">
              <a href="/about" className="hover:text-primary transition-colors">About</a>
              <a href="/privacy" className="hover:text-primary transition-colors">Privacy Policy</a>
              <span>&copy; {new Date().getFullYear()} Booru Prompt Gallery</span>
            </div>
          </footer>
        </main>

        <div className={`fixed ${mergeMode.isMergeMode ? 'bottom-[220px] sm:bottom-[200px]' : isAiConvertMode ? 'bottom-[200px] sm:bottom-[180px]' : 'bottom-4 sm:bottom-6'} right-4 sm:right-6 z-50 transition-all duration-500 flex flex-col gap-3 ${showBackToTop ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-75 pointer-events-none hidden'
          }`}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={toggleAiConvertMode}
                variant={isAiConvertMode ? "default" : "secondary"}
                className={`rounded-full shadow-lg h-10 w-10 p-0 ${isAiConvertMode ? "" : "bg-background/80 backdrop-blur border"}`}
                aria-label={isAiConvertMode ? "Disable AI Mode" : "Enable AI Mode"}
              >
                <Sparkles className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {isAiConvertMode ? "Disable AI Mode" : "Enable AI Mode"}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={handleToggleMergeMode}
                variant={mergeMode.isMergeMode ? "default" : "secondary"}
                className={`rounded-full shadow-lg h-10 w-10 p-0 ${mergeMode.isMergeMode ? "" : "bg-background/80 backdrop-blur border"}`}
                aria-label={mergeMode.isMergeMode ? "Disable Merge Mode" : "Enable Merge Mode"}
              >
                <FileCheck2 className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {mergeMode.isMergeMode ? "Disable Merge Mode" : "Enable Merge Mode"}
            </TooltipContent>
          </Tooltip>

          <Button onClick={scrollToTop} className="rounded-full shadow-lg h-10 w-10 p-0" variant="secondary" aria-label="Scroll to top">
            <ChevronUp className="h-5 w-5" />
          </Button>
        </div>

      </div>

      {teachModalData.tags && (
        <TeachModal
          open={teachModalData.open}
          onOpenChange={(open) => setTeachModalData(prev => ({ ...prev, open }))}
          initialClassifiedTags={teachModalData.tags}
          onSuccess={refreshOverrides}
        />
      )}
      < TeachWelcomeModal triggerOpen={showWelcomeModal} onOpenChange={setShowWelcomeModal} />
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
        onExit={() => setIsAiConvertMode(false)}
      />

      <GlobalWeightsModal
        open={isGlobalWeightsModalOpen}
        onOpenChange={setIsGlobalWeightsModalOpen}
        weights={globalWeights}
        onRemoveWeight={handleRemoveGlobalWeight}
        onClearWeights={handleClearGlobalWeights}
        onSaveWeight={handleGlobalWeightChange}
      />

      <ReversePromptParserModal
        open={isReverseParserModalOpen}
        onOpenChange={setIsReverseParserModalOpen}
        onImport={handleImportRawPrompt}
      />

      <AlertDialog open={!!folderToDelete} onOpenChange={(open) => !open && setFolderToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the folder &quot;{folderToDelete?.name}&quot;. Any favorited post within this folder will be moved back to the &quot;Uncategorized&quot; section if they are not part of any other folder.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (folderToDelete) {
                  favs.deleteFolder(folderToDelete.id)
                  if (activeFavoriteFolder === folderToDelete.id) {
                    setActiveFavoriteFolder('all')
                  }
                }
              }}
            >
              Delete Folder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  )
}












