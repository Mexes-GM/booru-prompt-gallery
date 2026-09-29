"use client"

import type React from "react"
import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, startTransition, useDeferredValue } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DebouncedInput, DebouncedHTMLInput } from "@/components/ui/debounced-input"
import { SearchWithAutocomplete } from "@/components/prompt-gallery/search-with-autocomplete"
import { UpdateNotesTab } from "@/components/prompt-gallery/update-notes-tab"
import { PanelLinkTabs } from "@/components/prompt-gallery/panel-link-tabs"
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
  Pin,
  Ban,
  Activity,
} from "lucide-react"

import dynamic from "next/dynamic"
import { getCachedTagOverrides } from "@/lib/supabase/client-queries"
import { DeploymentStatusBadges, MirrorLink } from "@/components/prompt-gallery/deployment-status"

const FeedbackDialog = dynamic(() => import("@/components/feedback-dialog").then(m => m.FeedbackDialog), { ssr: false, loading: () => null })

import pkg from "@/package.json"
import { useToast } from "@/hooks/use-toast"
import { toastError } from "@/lib/toast-error"
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
import { urlHasHost } from "@/lib/booru/urls"
import { favKey } from "@/lib/favorites-logic"

import { userPreferences, STORAGE_KEYS } from "@/lib/storage"
import { SAFE_RATING, ALL_RATING } from "@/lib/nsfw-consent"
import type { TagAppendRule } from "@/lib/cleanPrompt"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Slider } from "@/components/ui/slider"
import { classifyTags, type ClassifiedTags, type TagCategory } from "@/lib/tag-classifier"
import { splitCommaSeparatedTags } from "@/lib/utils/tag-utils"
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
import { usePackMode } from "@/hooks/use-pack-mode"
import { usePackSeed, PACK_SEED_TARGET_POSTS, PACK_ENRICH_POSTS } from "@/hooks/use-pack-seed"
import { poolCacheKey, loadPoolCache, savePoolCache, clearPoolCache, mergePostLists } from "@/lib/pack/pool-cache"
import { usePackAxisFallbacks } from "@/hooks/use-pack-axis-fallbacks"
import { usePackSeedSearch, type UsePackSeedSearchResult } from "@/hooks/use-pack-seed-search"
import { PackSourceModal, type PackSourceAnswers } from "./pack-source-modal"
import { PackEntryModal } from "./pack-entry-modal"
const PackBuilderStickyFooter = dynamic(() => import("./pack-builder-sticky-footer").then(m => m.PackBuilderStickyFooter), { ssr: false, loading: () => null })
import { StickyMiniControlPanel } from "./sticky-mini-control-panel"
import { FileCheck2, PenLine, SlidersHorizontal } from "lucide-react"
import { ControlSection } from "@/components/prompt-gallery/control-section"
import { ProviderSelect } from "@/components/prompt-gallery/provider-select"
import { InfiniteScrollTrigger } from "@/components/ui/infinite-scroll-trigger"
import { SaveFavoriteButton } from "./save-favorite-button"
import { useDebounce } from "@/hooks/use-debounce"

import { usePersistentState } from "@/hooks/use-persistent-state"
import { usePreferencesSync } from "@/hooks/use-preferences-sync"
import { GalleryModals } from "@/components/prompt-gallery/gallery-modals"
import { SiteCornerMenu } from "@/components/prompt-gallery/site-corner-menu"
import { MainTour } from "@/components/prompt-gallery/main-tour"
import { recordPromptCopy } from "@/lib/support-prompt"
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
import { useGalleryViewState } from "@/hooks/use-gallery-view-state"
import { useGlobalWeights } from "@/hooks/use-global-weights"
import { usePresetsAndHistory } from "@/hooks/use-presets-and-history"
import { useHistoryPosts } from "@/hooks/use-history-posts"
import { useFilteredPosts } from "@/hooks/use-filtered-posts"
import { usePostHog } from 'posthog-js/react'

// ─────────────────────────────────────────────────────────────────────────────
// PackSeedFetcher
// Thin bridge component whose ONLY job is to own the usePackSeedSearch call
// so it mounts/unmounts under PromptGallery's control instead of always
// running. usePackSeedSearch has no internal "enabled" flag — useSWRInfinite
// always fetches its first page on mount, with no built-in way to suppress
// that from the outside — so the only way to truly defer its first fetch
// until the Pack Setup modal is confirmed is to not mount the component that
// calls it at all until then. Reports its live result up via onReady on every
// render (cheap: PromptGallery only stores it in a ref, no state churn).
// ─────────────────────────────────────────────────────────────────────────────
function PackSeedFetcher({
  answers,
  booruProvider,
  onReady,
}: {
  answers: PackSourceAnswers
  booruProvider: BooruProvider
  onReady: (result: UsePackSeedSearchResult) => void
}) {
  const result = usePackSeedSearch({
    searchTags: answers.searchTags,
    ratingMode: answers.ratingMode,
    booruProvider,
  })
  // Effect, not a direct render-body call: onReady eventually triggers state
  // updates in the parent (reseeding axis pools), which must not happen
  // during this child's render.
  useEffect(() => {
    onReady(result)
  }, [result, onReady])
  return null
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
    // progress. Batches run sequentially with a delay for every provider: the
    // Worker meters favorites per upstream call, so firing them in parallel
    // only turns into 429s.
    const BATCH = 20
    const BATCH_DELAY = 1100

    const bumpProgress = (n: number) => {
      checkedCount += n
      setState({ phase: 'checking', checked: checkedCount, total: totalToCheck })
    }

    const fetchBatch = async (provider: string, ids: number[]) => {
      try {
        const res = await fetch(apiUrl('/api/favorites'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ favorites: ids.map(id => ({ id, provider })) }),
        })
        // Any non-OK response (rate limit, server error, provider refusing the
        // Worker) is inconclusive: count these ids as found so a failed
        // re-check can never offer to delete favorites that still exist.
        if (!res.ok) {
          for (const id of ids) foundIds.add(`${provider}:${id}`)
          return
        }
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

        for (let i = 0; i < batches.length; i++) {
          await fetchBatch(provider, batches[i])
          if (i < batches.length - 1) {
            await new Promise(r => setTimeout(r, BATCH_DELAY))
          }
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
                <AlertCircle className="h-5 w-5 text-destructive-text" />
              </div>
              <div className="space-y-1">
                <AlertTitle className="text-destructive-text font-medium mb-0">Missing Favorites</AlertTitle>
                <AlertDescription className="text-muted-foreground text-xs leading-relaxed">
                  <strong className="text-foreground">{unavailableKeys.length}</strong> posts couldn&apos;t be loaded from the original booru server. They might be temporarily down or deleted by the author.
                </AlertDescription>
              </div>
            </div>
            <Button 
              onClick={handleCheck} 
              variant="outline" 
              size="sm"
              className="w-full sm:w-auto shrink-0 border-destructive/20 hover:bg-destructive/10 hover:text-destructive-text transition-colors"
            >
              <Search className="h-4 w-4 mr-2" />
              Check availability
            </Button>
          </div>
        )}

        {state.phase === 'checking' && (
          <div className="flex flex-col gap-2 py-2">
            <div className="flex items-center gap-4">
              <Loader2 className="h-5 w-5 text-destructive-text animate-spin shrink-0" />
              <div className="space-y-1 flex-1">
                <AlertTitle className="text-destructive-text font-medium mb-0">Verifying on booru...</AlertTitle>
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
              <div className="flex items-center gap-2 text-success-text bg-success-soft p-2 rounded-md border border-success-border">
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
                    <Trash2 className="h-5 w-5 text-destructive-text" />
                  </div>
                  <div className="space-y-1">
                    <AlertTitle className="text-destructive-text font-medium mb-0">Posts Deleted</AlertTitle>
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
  const { blacklist, addTag, removeTag, resetBlacklist, clearBlacklist } = useBlacklist()
  // Folder filter state ('artists' is a reserved virtual folder for saved artists)
  const [activeFavoriteFolder, setActiveFavoriteFolder] = useState<string | null | 'all' | 'artists'>('all')
  const favs = useBooruFavorites(search.booruProvider)
  const savedArtists = useSavedArtists()
  const tagCounts = useTagCounts(search.allPosts, search.booruProvider)
  const { toast } = useToast()
  const isMobile = useIsMobile()
  const posthog = usePostHog()

  // History toggle — mirrors Favorites: switches the SAME masonry grid to show
  // previously copied prompts instead of navigating to a separate page/route.
  const [showHistory, setShowHistory] = useState(false)
  const toggleShowHistory = useCallback(() => setShowHistory(prev => !prev), [])

  // Pause infinite scroll only on a BURST of image failures (the provider or
  // our proxy is shedding load), not on the lifetime total: a plain counter
  // meant a handful of deleted/broken files spread over a long session paused
  // scrolling even though nothing was being rate-limited.
  const [imageRateLimited, setImageRateLimited] = useState(false)
  const imageErrorTimesRef = useRef<number[]>([])
  const IMAGE_ERROR_THRESHOLD = 8
  const IMAGE_ERROR_WINDOW_MS = 30_000

  const handleImageError = useCallback(() => {
    const now = Date.now()
    const recent = imageErrorTimesRef.current.filter(t => now - t < IMAGE_ERROR_WINDOW_MS)
    recent.push(now)
    imageErrorTimesRef.current = recent
    if (recent.length >= IMAGE_ERROR_THRESHOLD && !imageRateLimited) {
      setImageRateLimited(true)
    }
  }, [imageRateLimited])

  // Reset rate limiting when search query or provider changes
  useEffect(() => {
    setImageRateLimited(false)
    imageErrorTimesRef.current = []
  }, [search.booruProvider, search.debouncedSearchTags])

  // Sync preferences with cloud
  usePreferencesSync()

  // 2. Local UI State & Persistence
  const {
    cardScale,
    scaleValue, setScaleValue,
  } = useGalleryViewState()



  // Reset folder filter when exiting favorites view so it doesn't linger and hide
  // the search grid (e.g. 'artists' tab would suppress masonry render on exit).
  useEffect(() => {
    if (!favs.showFavorites && activeFavoriteFolder !== 'all') {
      setActiveFavoriteFolder('all')
    }
  }, [favs.showFavorites, activeFavoriteFolder])

  // History and Favorites are mutually exclusive views over the same masonry
  // grid — enabling one turns the other off (toolbar already does this on
  // click, this is a safety net for any other place either toggle changes).
  useEffect(() => {
    if (showHistory && favs.showFavorites) {
      favs.toggleShowFavorites()
    }
    // Deliberately depend on individual `favs` members, not the whole object
    // (same pattern as the favorites-folder-reset effect above) — `favs` is a
    // fresh object every render, so depending on it directly would re-run this
    // effect on every render instead of only when the relevant fields change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHistory, favs.showFavorites, favs.toggleShowFavorites])

  // User Prefs UI state
  const {
    promptOptions, setPromptOptions,
    includeCharacters, optimizeTags, smartTagExclusion, prependAnimaArtist,
    autoAppendSearchTags,
    setIncludeCharacters, setOptimizeTags, setSmartTagExclusion, setPrependAnimaArtist,
    setAutoAppendSearchTags,
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
    backgroundMatchStrictness, setBackgroundMatchStrictness,
  } = useBackgroundSettings()

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

  const [addInput, setAddInput] = usePersistentState(
    "",
    userPreferences.getAddTagsInput,
    userPreferences.setAddTagsInput,
    "addTags",
    STORAGE_KEYS.ADD_TAGS
  )

  // The two option groups of the control panel ("Search filters" /
  // "Customize prompt"). They open as dropdowns over the page (bottom sheets
  // on mobile), so they always start closed instead of being remembered.
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [promptOptionsOpen, setPromptOptionsOpen] = useState(false)
  const [tourRunSignal, setTourRunSignal] = useState(0)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  // In-place card expansion: id of the single card currently expanded to reveal
  // its full prompt inline (no modal). Only one card expands at a time so the
  // grid stays tidy; clicking another card swaps the expansion.
  const [expandedPostId, setExpandedPostId] = useState<number | null>(null)
  const handleToggleExpand = useCallback((postId: number) => {
    setExpandedPostId(prev => (prev === postId ? null : postId))
  }, [])
  const [showBackToTop, setShowBackToTop] = useState(false)
  const [showStickyPanel, setShowStickyPanel] = useState(false)
  const controlPanelRef = useRef<HTMLDivElement>(null)

  // Folder Delete State
  const [folderToDelete, setFolderToDelete] = useState<{ id: string, name: string } | null>(null)

  // Modals
  const [isQuickTeachOpen, setIsQuickTeachOpen] = useState(false)

  const {
    presets, setPresets,
    history,
    previouslyCopiedPostIds,
    isPresetDialogOpen, setIsPresetDialogOpen,
    presetName, setPresetName,
    savePreset, loadPreset, deletePreset,
    addToHistory,
  } = usePresetsAndHistory({ isClient: search.isClient, addInput, setAddInput, toast })

  // History shows copies from ALL providers at once (NOT scoped to the current
  // toolbar provider). Each card renders from its own post data / _provider, so
  // mixed providers coexist safely in one grid — this avoids the confusion of a
  // copied prompt "disappearing" just because the user switched provider tabs.
  const { posts: historyPosts, total: historyTotal, isLoading: isHistoryLoading, isValidating: isHistoryValidating, error: historyError, mutate: retryHistoryPosts } = useHistoryPosts(history)

  const [tagOverrides, setTagOverrides] = useState<Record<string, string>>({})

  // Debounce expensive inputs
  const debouncedAddInput = useDebounce(addInput, 500)
  const debouncedExcludeInput = useDebounce(excludeInput, 500)
  const debouncedFindInput = useDebounce(findInput, 500)
  const debouncedReplaceInput = useDebounce(replaceInput, 500)

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

  // Merge Mode Hook
  // Find & Replace pairs (find[i] -> replace[i]), same pairing rule as useCardPrompt.
  const mergeModeWordReplacements = useMemo(() => {
    const finds = splitCommaSeparatedTags(debouncedFindInput)
    const replaces = splitCommaSeparatedTags(debouncedReplaceInput)
    const pairCount = Math.min(finds.length, replaces.length)
    const rules: { find: string; replace: string }[] = []
    for (let i = 0; i < pairCount; i++) {
      rules.push({ find: finds[i], replace: replaces[i] })
    }
    return rules
  }, [debouncedFindInput, debouncedReplaceInput])

  const mergeMode = useMergeMode(globalWeights, isGlobalWeightsEnabled, debouncedAddInput, tagOverrides, deferredBackgroundMode, debouncedSimpleBackgroundReplacementTags, mergeModeWordReplacements, detailedBackgroundsList, backgroundMatchStrictness)

  // Extract stable mergeMode pieces to avoid dependency churn
  const mergeModeIsMergeMode = mergeMode.isMergeMode
  const mergeModeDisableMergeMode = mergeMode.disableMergeMode
  const mergeModeToggleMergeMode = mergeMode.toggleMergeMode
  const mergeModeSelectedPosts = mergeMode.selectedPosts
  const mergeModeTogglePostPart = mergeMode.togglePostPart

  // Pack Mode Hook — "batch of prompts sharing a base" workflow (see
  // docs/image-pack-builder-plan.md). Mirrors useMergeMode's shape.
  // cleanOptions mirrors the exact prompt settings every real card uses, so
  // generated pack prompts go through the same cleanPrompt pipeline (Exclude,
  // Find & Replace, Optimize Tags, Include Characters, Smart Tag Exclusion)
  // instead of a parallel, simpler path.
  const packCleanOptions = useMemo(() => ({
    excludeInput: debouncedExcludeInput,
    addInput: debouncedAddInput,
    findInput: debouncedFindInput,
    replaceInput: debouncedReplaceInput,
    includeCharacters,
    optimizeTags,
    smartTagExclusion,
  }), [debouncedExcludeInput, debouncedAddInput, debouncedFindInput, debouncedReplaceInput, includeCharacters, optimizeTags, smartTagExclusion])
  const packMode = usePackMode(tagOverrides, globalWeights, isGlobalWeightsEnabled, packCleanOptions, search.booruProvider)
  const packSeed = usePackSeed()

  // Extract stable packMode pieces to avoid dependency churn
  const packModeIsPackMode = packMode.isPackMode
  const packModeSetBaseCard = packMode.setBaseCard
  const packModeReseedAllAxes = packMode.reseedAllAxes

  // Pack entry modal (design spec §2.1) — replaces the old mandatory Pack
  // Setup questionnaire. `packEntryOpen` shows the "From a card"/"From my
  // prompt" choice; `packSourceAnswers` (always populated, unlike the old
  // nullable packSetupAnswers) is what <PackSeedFetcher> below seeds from.
  // `sourceStep` drives the "Source of variations" modal: "setup" is the
  // step shown right after picking a new base (builder and seeding wait for
  // it), "edit" is reopening it from the builder header's chip.
  const [packEntryOpen, setPackEntryOpen] = useState(false)
  // True when the entry modal should open straight into the prompt-editing
  // view (the builder's "Edit" button on an existing prompt base) instead of
  // the "From a card"/"From my prompt" choice screen.
  const [packEntryStartInPrompt, setPackEntryStartInPrompt] = useState(false)
  const [packSourceAnswers, setPackSourceAnswers] = useState<PackSourceAnswers>(() => {
    const stored = userPreferences.getPackSourceAnswers()
    if (stored) return stored
    return {
      ratingMode: 'sfw',
      tagsSource: 'current',
      searchTags: search.searchTags,
      booruProvider: search.booruProvider,
    }
  })
  const [sourceStep, setSourceStep] = useState<'setup' | 'edit' | null>(null)
  // Curated per-slot vocabulary that tops up sparse pools (rating-aware).
  const packAxisFallbacks = usePackAxisFallbacks(packMode.isPackMode, packSourceAnswers.ratingMode)

  // Where Pack Mode's posts come from (provider + rating + tags) — also the
  // key of the persistent pool cache (lib/pack/pool-cache.ts).
  const packSourceKey = useMemo(
    () => poolCacheKey(packSourceAnswers.booruProvider, packSourceAnswers.ratingMode, packSourceAnswers.searchTags),
    [packSourceAnswers]
  )
  const packSourceKeyRef = useRef(packSourceKey)
  useEffect(() => { packSourceKeyRef.current = packSourceKey }, [packSourceKey])

  // Latest usePackSeedSearch result (freshly fetched posts), reported up by
  // <PackSeedFetcher>, plus the posts saved for this source in earlier
  // sessions. Pools are always sampled from both, merged. A small state
  // snapshot carries what the UI shows (counts, load-more availability) so
  // PromptGallery doesn't re-render from the full result on every page.
  const packSeedSearchRef = useRef<UsePackSeedSearchResult | null>(null)
  const packCachedRef = useRef<{ key: string; posts: BooruPost[] } | null>(null)
  const [packSeedSnapshot, setPackSeedSnapshot] = useState<{ postCount: number; savedCount: number; canLoadMore: boolean } | null>(null)
  // Only seeds pools ONCE per base — re-running it on every incidental result
  // update would fight the user's own edits.
  const hasSeededRef = useRef(false)
  // Sources that already fetched fresh posts this session: picking another
  // base on the same source reuses what's in memory instead of refetching.
  const enrichedSourcesRef = useRef<Set<string>>(new Set())
  const [seedRequest, setSeedRequest] = useState(0)
  // The fetcher mounts once the first source is confirmed and stays mounted
  // for the rest of the Pack Mode session (unmounting it drops its posts).
  const [packFetcherActive, setPackFetcherActive] = useState(false)

  const packPoolPosts = useCallback((): BooruPost[] => {
    const cached = packCachedRef.current?.key === packSourceKeyRef.current ? packCachedRef.current.posts : []
    return mergePostLists(packSeedSearchRef.current?.allPosts ?? [], cached)
  }, [])

  const updatePackSnapshot = useCallback(() => {
    const search = packSeedSearchRef.current
    const saved = packCachedRef.current?.key === packSourceKeyRef.current ? packCachedRef.current.posts.length : 0
    setPackSeedSnapshot({
      postCount: packPoolPosts().length,
      savedCount: saved,
      canLoadMore: search ? !search.noMoreResults && !search.sessionCapReached : true,
    })
  }, [packPoolPosts])

  /** Base changed, same source: re-seed pools from the posts already at hand. */
  const rebasePackSeeding = useCallback(() => {
    hasSeededRef.current = false
    setSeedRequest((n) => n + 1)
  }, [])

  /** Source changed or Pack Mode left: forget the fetched posts entirely. */
  const resetPackSeeding = useCallback(() => {
    hasSeededRef.current = false
    packSeedSearchRef.current = null
    setPackSeedSnapshot(null)
  }, [])

  // Picking a new base (card or pasted prompt) always goes through the
  // "Source of variations" step before the builder opens. Editing an
  // existing prompt base skips it — the source is already chosen.
  const handleSetAsPackBase = useCallback((post: BooruPost) => {
    packModeSetBaseCard(post)
    rebasePackSeeding()
    setPackEntryOpen(false)
    setPackEntryStartInPrompt(false)
    setSourceStep('setup')
  }, [packModeSetBaseCard, rebasePackSeeding])

  const packModeSetBasePrompt = packMode.setBasePrompt
  const handleSubmitPackPrompt = useCallback((text: string) => {
    packModeSetBasePrompt(text)
    rebasePackSeeding()
    setPackEntryOpen(false)
    if (!packEntryStartInPrompt) setSourceStep('setup')
    setPackEntryStartInPrompt(false)
  }, [packModeSetBasePrompt, rebasePackSeeding, packEntryStartInPrompt])

  const handlePackEntryCancel = useCallback(() => {
    setPackEntryOpen(false)
    setPackEntryStartInPrompt(false)
  }, [])

  const handleEditBasePrompt = useCallback(() => {
    setPackEntryStartInPrompt(true)
    setPackEntryOpen(true)
  }, [])

  const handleApplyPackSourceAnswers = useCallback((answers: PackSourceAnswers) => {
    const nextKey = poolCacheKey(answers.booruProvider, answers.ratingMode, answers.searchTags)
    setPackSourceAnswers(answers)
    try {
      userPreferences.setPackSourceAnswers(answers)
    } catch {
      // Non-fatal: best-effort, same as every other localStorage write here.
    }
    setSourceStep(null)
    setPackFetcherActive(true)
    // A different source remounts <PackSeedFetcher> (keyed by the answers);
    // the same one keeps its posts and only needs the pools re-seeded.
    if (nextKey !== packSourceKeyRef.current) resetPackSeeding()
    else rebasePackSeeding()
  }, [resetPackSeeding, rebasePackSeeding])

  // Cancelling the setup step abandons the freshly-picked base (back to
  // picking one); cancelling an edit just closes the modal.
  const handleCancelPackSource = useCallback(() => {
    if (sourceStep === 'setup') {
      packModeSetBaseCard(null)
      packModeSetBasePrompt('')
      hasSeededRef.current = false
    }
    setSourceStep(null)
  }, [sourceStep, packModeSetBaseCard, packModeSetBasePrompt])

  // Refills the pools while pages are still landing (not just once at the
  // end), so chips visibly appear as posts arrive. Throttled by post count:
  // ensureSeeded reports every poll tick, most of which bring nothing new.
  const makeLiveReseed = useCallback((startCount: number) => {
    let lastCount = startCount
    return (posts: BooruPost[]) => {
      if (posts.length - lastCount < 15) return
      lastCount = posts.length
      packModeReseedAllAxes(packPoolPosts(), packAxisFallbacks)
      updatePackSnapshot()
    }
  }, [packModeReseedAllAxes, packAxisFallbacks, packPoolPosts, updatePackSnapshot])

  /** Saves this session's fetched posts into the source's persistent cache. */
  const persistPackPool = useCallback(async (key: string) => {
    const fetched = packSeedSearchRef.current?.allPosts ?? []
    if (fetched.length === 0) return
    await savePoolCache(key, fetched)
    const posts = await loadPoolCache(key)
    if (packSourceKeyRef.current !== key) return
    packCachedRef.current = { key, posts }
    updatePackSnapshot()
  }, [updatePackSnapshot])

  // Seeds the pools for the current base: saved posts first (instant), then —
  // once per source per session — a batch of fresh posts on top, growing the cache.
  const seedPackPools = useCallback(async () => {
    const search = packSeedSearchRef.current
    if (!search || hasSeededRef.current) return
    hasSeededRef.current = true
    const key = packSourceKeyRef.current

    if (packCachedRef.current?.key !== key) {
      const posts = await loadPoolCache(key)
      if (packSourceKeyRef.current !== key) return
      packCachedRef.current = { key, posts }
    }
    packModeReseedAllAxes(packPoolPosts(), packAxisFallbacks)
    updatePackSnapshot()

    if (enrichedSourcesRef.current.has(key)) {
      void persistPackPool(key)
      return
    }
    enrichedSourcesRef.current.add(key)
    const saved = packCachedRef.current?.posts.length ?? 0
    const fetchedNow = packSeedSearchRef.current?.allPosts.length ?? 0
    // Plenty saved already: just add one batch of new posts. Otherwise fill up to the target.
    const target = saved >= PACK_SEED_TARGET_POSTS
      ? Math.max(fetchedNow, PACK_ENRICH_POSTS)
      : Math.max(PACK_ENRICH_POSTS, PACK_SEED_TARGET_POSTS - saved)
    await packSeed.ensureSeeded(() => packSeedSearchRef.current ?? search, target, makeLiveReseed(fetchedNow))
    if (packSourceKeyRef.current !== key) return
    packModeReseedAllAxes(packPoolPosts(), packAxisFallbacks)
    await persistPackPool(key)
  }, [packModeReseedAllAxes, packAxisFallbacks, packSeed, makeLiveReseed, packPoolPosts, updatePackSnapshot, persistPackPool])

  // Runs a pending seed once a base, a confirmed source and fetched results all exist.
  const packHasBase = packMode.hasBase
  useEffect(() => {
    if (hasSeededRef.current || !packSeedSearchRef.current || !packHasBase || sourceStep === 'setup') return
    void seedPackPools()
  }, [seedRequest, packHasBase, sourceStep, seedPackPools])

  const handlePackSeedSearchReady = useCallback((seedSearch: UsePackSeedSearchResult) => {
    packSeedSearchRef.current = seedSearch
    updatePackSnapshot()
    if (!hasSeededRef.current) setSeedRequest((n) => n + 1)
  }, [updatePackSnapshot])

  // Manual "Collect more" — another batch of fresh posts for the same source.
  const handleLoadMorePacks = useCallback(async () => {
    if (!packSeedSearchRef.current) return
    const key = packSourceKeyRef.current
    const start = packSeedSearchRef.current.allPosts.length
    await packSeed.ensureSeeded(
      () => packSeedSearchRef.current!,
      start + PACK_SEED_TARGET_POSTS,
      makeLiveReseed(start)
    )
    if (packSourceKeyRef.current !== key) return
    packModeReseedAllAxes(packPoolPosts(), packAxisFallbacks)
    await persistPackPool(key)
  }, [packSeed, packModeReseedAllAxes, packAxisFallbacks, makeLiveReseed, packPoolPosts, persistPackPool])

  /** Forgets the posts saved for the current source (fresh ones stay). */
  const handleClearSavedPackPosts = useCallback(async () => {
    const key = packSourceKeyRef.current
    await clearPoolCache(key)
    packCachedRef.current = { key, posts: [] }
    packModeReseedAllAxes(packPoolPosts(), packAxisFallbacks)
    updatePackSnapshot()
  }, [packModeReseedAllAxes, packAxisFallbacks, packPoolPosts, updatePackSnapshot])

  // Stable "Re-sample" handler for a single axis category — MUST be memoized:
  // PackBuilderStickyFooter passes this straight through to each AxisEditor
  // (a React.memo component), so a fresh inline arrow here on every
  // PromptGallery render would defeat that memo and re-render/re-animate
  // every category's chip list whenever any single one was re-sampled.
  const packModeReseedAxis = packMode.reseedAxis
  const handleReseedAxis = useCallback((category: TagCategory) => {
    if (!packSeedSearchRef.current) return
    packModeReseedAxis(category, packPoolPosts(), packAxisFallbacks[category])
  }, [packModeReseedAxis, packAxisFallbacks, packPoolPosts])

  // Pack Mode learning instrumentation (docs/pack-mode-learning-plan.md §7.7,
  // last bullet) — aggregate product events only, so the A/B/T/EPSILON
  // constants in lib/pack/pack-learning.ts can eventually be calibrated
  // against real usage instead of guessed. Never carries prompt text or raw
  // tag values, only category names/counts/provider — same privacy bar as
  // every other posthog.capture() call in this file.
  const packModeRemoveAxisValue = packMode.removeAxisValue
  const handlePackRemoveAxisValue = useCallback((category: TagCategory, value: string) => {
    packModeRemoveAxisValue(category, value)
    posthog.capture('pack_axis_value_removed', {
      category,
      booru_source: search.booruProvider,
      variety_level: packMode.varietyLevel,
    })
  }, [packModeRemoveAxisValue, posthog, search.booruProvider, packMode.varietyLevel])

  const packModeRegenerate = packMode.regenerate
  const handlePackRegenerate = useCallback(() => {
    packModeRegenerate()
    posthog.capture('pack_generated', {
      booru_source: search.booruProvider,
      variety_level: packMode.varietyLevel,
      locked_categories: Array.from(packMode.lockedCategories).join(','),
      prompt_count: packMode.promptCount,
      locked_category_count: packMode.lockedCategories.size,
      active_axis_count: packMode.activeAxisCategories.length,
    })
  }, [packModeRegenerate, posthog, search.booruProvider, packMode.varietyLevel, packMode.promptCount, packMode.lockedCategories, packMode.activeAxisCategories])

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
    if (packModeIsPackMode) {
      packMode.disablePackMode()
    }
    setAiConvertTags(tagsToSend)
    setAiConvertImage(imageUrl)
    setAiConvertMeta(meta)
    setIsAiConvertMode(true)
  }, [mergeModeIsMergeMode, mergeModeDisableMergeMode, packModeIsPackMode, packMode])

  // Custom wrapper to enable/disable modes mutually exclusively
  const toggleAiConvertMode = useCallback(() => {
    setIsAiConvertMode(prev => {
      const next = !prev
      if (next && mergeModeIsMergeMode) {
        mergeModeDisableMergeMode()
      }
      if (next && packModeIsPackMode) {
        packMode.disablePackMode()
      }
      return next
    })
  }, [mergeModeIsMergeMode, mergeModeDisableMergeMode, packModeIsPackMode, packMode])

  // Wrapper for toggling merge mode to automatically disable AI mode + Pack mode
  const handleToggleMergeMode = useCallback(() => {
    setIsAiConvertMode(false)
    if (packModeIsPackMode) {
      packMode.disablePackMode()
    }
    mergeModeToggleMergeMode()
  }, [mergeModeToggleMergeMode, packModeIsPackMode, packMode])

  // Wrapper for toggling pack mode to automatically disable Merge + AI Convert
  const handleTogglePackMode = useCallback(() => {
    setIsAiConvertMode(false)
    if (mergeModeIsMergeMode) {
      mergeModeDisableMergeMode()
    }
    packMode.togglePackMode()
  }, [mergeModeIsMergeMode, mergeModeDisableMergeMode, packMode])

  // "Make pack" card shortcut (task 8) — activates Pack Mode with this post as
  // the base directly, skipping the entry modal entirely.
  const handleMakePack = useCallback((post: BooruPost) => {
    setIsAiConvertMode(false)
    if (mergeModeIsMergeMode) mergeModeDisableMergeMode()
    packMode.enablePackMode()
    handleSetAsPackBase(post)
  }, [mergeModeIsMergeMode, mergeModeDisableMergeMode, packMode, handleSetAsPackBase])

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

  // NOTE: the slider<->scale sync used to live here as a second effect writing
  // cardScale from scaleValue. It has been removed: `setScaleValue` now writes
  // `cardScale` directly (single source of truth in useGalleryViewState), which
  // eliminates the bidirectional ping-pong that caused the React #185 render
  // loop. See docs/SENTRY-FULVOUS-ANCHOR-11-render-loop.md.

  // We will render <title> directly in the JSX instead of useEffect
  
  // Scroll tracking
  useEffect(() => {
    // On phones the button sits over the right column's card controls, so it
    // only shows while scrolling UP (the moment someone wants to go back) and
    // hides again as soon as they scroll down through the cards.
    let lastY = window.scrollY
    const handleScroll = () => {
      const y = window.scrollY
      const scrollingUp = y < lastY
      if (Math.abs(y - lastY) < 8) return
      lastY = y
      const narrow = window.matchMedia('(max-width: 639px)').matches
      setShowBackToTop(y > 400 && (!narrow || scrollingUp))
    }
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

      toastError({
        title: isAibooruError ? "Aibooru Access Blocked" : "Connection error",
        description: isAibooruError
          ? "Aibooru is blocking server requests. Try Danbooru or Rule34 instead."
          : (search.error.message || "Could not load images"),
        errorSource: "booru_search",
        context: { provider: search.booruProvider, status: search.error.status ?? search.error.statusCode },
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

      // PostHog Tracking
      posthog.capture('prompt_copied', {
        copy_type: isPrompt ? 'ai_text' : 'tags',
        booru_source: search.booruProvider,
        has_translated_tags: isAiConvertMode || content.includes('Masterpiece')
      })

      setCopiedId(postId)

      // Merge mode's combined prompt calls copyToClipboard with postId=0 (no
      // single real post backs it) — skip history in that case since
      // useHistoryPosts needs a real (provider, postId) pair to hydrate later.
      if (postId) {
        // Snapshot the post the user just copied so History can render it later
        // with ZERO network hydration (immune to transient booru/API failures).
        // The copied card is always present in one of the currently-visible,
        // provider-scoped lists — find it there. If somehow absent, we still
        // store the {postId, provider} pointer and fall back to network fetch.
        const snapshot =
          search.allPosts?.find(p => p.id === postId) ||
          favs.favoritePosts?.find(p => p.id === postId) ||
          historyPosts?.find(p => p.id === postId)
        // Use the snapshot's OWN provider, not the currently-selected provider
        // tab. They can differ (favorites/history views, merge mode, etc.), and
        // getting this wrong permanently mislabels the post — e.g. a Gelbooru
        // post copied while the AIbooru tab is active would otherwise be stored
        // as an AIbooru post, so "View original post" later builds an
        // aibooru.com/<gelbooru-id> link instead of the real gelbooru.com one.
        addToHistory({ postId, provider: (snapshot?._provider as BooruProvider) || search.booruProvider, post: snapshot })
      }

      // On touch screens the card's own "Copied" overlay is the feedback; the
      // top toast only covered the next row of cards. A short buzz replaces it.
      if (window.matchMedia("(pointer: coarse)").matches) {
        navigator.vibrate?.(10)
      } else {
        toast({
          title: "Copied!",
          description: isPrompt ? "Prompt copied to clipboard" : "Tags copied to clipboard",
        })
      }
      setTimeout(() => setCopiedId(null), 2000)
      recordPromptCopy()
    } catch (error) {
      toastError({
        title: "Error",
        description: isPrompt ? "Could not copy prompt" : "Could not copy tags",
        errorSource: "copy_to_clipboard",
        context: { provider: search.booruProvider, postId, isPrompt },
      })
    }
  }, [toast, addToHistory, posthog, search.booruProvider, search.allPosts, favs.favoritePosts, historyPosts, isAiConvertMode])

  const downloadImage = useCallback(async (post: BooruPost) => {
    try {
      posthog.capture('image_downloaded', {
        booru_source: search.booruProvider,
        resolution_type: 'full'
      })

      const imageUrl = post.file_url || post.large_file_url

      if (!imageUrl) {
        toastError({
          title: "Download failed",
          description: "No image URL available",
          errorSource: "download_image",
          context: { provider: post._provider || search.booruProvider, postId: post.id },
        })
        return
      }

      const urlPath = imageUrl.split('?')[0]
      const extension = urlPath.split('.').pop() || 'jpg'
      const itemProvider = post._provider || search.booruProvider
      const filename = `${itemProvider}_${post.id}.${extension}`

      // Providers that need a proxy due to CORS/referrer restrictions.
      // ponytail: Danbooru CDN blocks cross-origin browser requests (Cloudflare WAF
      // triggers on sec-fetch-site: cross-site without Referer). Gelbooru has explicit
      // anti-hotlink. Rule34 is auth-walled. E621's static*.e621.net CDN does NOT send
      // Access-Control-Allow-Origin (verified live: mode:'cors' -> TypeError: Failed to
      // fetch, mode:'no-cors' -> opaque 200), so it needs the proxy too despite being
      // viewable directly via <img> (which ignores CORS). Only Aibooru works direct.
      const needsVercelProxy = urlHasHost(imageUrl, 'donmai.us') ||
        urlHasHost(imageUrl, 'rule34.xxx') ||
        urlHasHost(imageUrl, 'gelbooru.com') ||
        urlHasHost(imageUrl, 'e621.net')

      // Danbooru: prefer the CloudFront proxy (edge cache + CORS) when configured.
      const cdnUrl = getDanbooruCdnUrl(imageUrl)

      let fetchUrl: string
      if (cdnUrl) {
        fetchUrl = cdnUrl
      } else if (needsVercelProxy) {
        fetchUrl = apiUrl(`/api/download?url=${encodeURIComponent(imageUrl)}`)
      } else {
        // Direct fetch — Aibooru's CDN is the only one that's actually CORS-permissive.
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
      // A bare "TypeError: Failed to fetch" means the request never completed
      // at the network level (CORS rejection, ad blocker, DNS/TLS failure, or
      // the proxy being unreachable) — the browser gives no status code here.
      // Distinguish it from HTTP-level failures so users get an actionable
      // message instead of a generic one, and open the image directly as a
      // fallback so they can still save it manually (e.g. right-click > Save).
      const isNetworkFailure = error instanceof TypeError && /failed to fetch/i.test(error.message)

      console.error('Download error:', error)
      toastError({
        title: "Download failed",
        description: isNetworkFailure
          ? "Could not reach the image server. It may be blocked by an ad blocker/extension, or temporarily unreachable. Opening the image in a new tab instead."
          : error instanceof Error ? error.message : "Error downloading image",
        errorSource: "download_image",
        context: { provider: post._provider || search.booruProvider, postId: post.id, networkFailure: isNetworkFailure },
      })

      if (isNetworkFailure) {
        const fallbackUrl = post.file_url || post.large_file_url
        if (fallbackUrl) window.open(fallbackUrl, '_blank', 'noopener,noreferrer')
      }
    }
  }, [search.booruProvider, toast, posthog])

  // Sincronizar refs con los callbacks reales (asignación barata, sin efecto)
  useLayoutEffect(() => {
    copyToClipboardRef.current = copyToClipboard
    downloadImageRef.current = downloadImage
  })

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

  // Card-facing copies of the prompt options. Toggling one of these re-derives
  // the prompt of EVERY mounted card (~12ms each), so the cards read deferred
  // values: the panel control repaints immediately in the urgent render, and
  // the card recompute runs afterwards as an interruptible background render
  // (same approach as deferredBackgroundMode) instead of freezing the toggle.
  const cardIncludeCharacters = useDeferredValue(includeCharacters)
  const cardOptimizeTags = useDeferredValue(optimizeTags)
  const cardSmartTagExclusion = useDeferredValue(smartTagExclusion)
  const cardPrependAnimaArtist = useDeferredValue(prependAnimaArtist)
  const cardAutoAppendSearchTags = useDeferredValue(autoAppendSearchTags)
  const cardRemoveLoRaTags = useDeferredValue(search.removeLoRaTags)
  const cardRemoveQualityTags = useDeferredValue(search.removeQualityTags)
  const cardIsGlobalWeightsEnabled = useDeferredValue(isGlobalWeightsEnabled)
  const cardShowCategoryTagBadges = useDeferredValue(showCategoryTagBadges)

  const filteredPosts = useFilteredPosts({
    allPosts: search.allPosts,
    booruProvider: search.booruProvider,
    blacklist,
    includeCharacters: cardIncludeCharacters,
    appliedCharacterCountFilter: search.appliedCharacterCountFilter,
    tagCounts,
    favorites: {
      showFavorites: favs.showFavorites,
      favoritePosts: favs.favoritePosts,
      favoriteFolderMap: favs.favoriteFolderMap,
    },
    activeFavoriteFolder,
    history: {
      showHistory,
      historyPosts,
    },
  })

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
      searchTags={search.debouncedSearchTags}
      autoAppendSearchTags={cardAutoAppendSearchTags}
      findInput={debouncedFindInput}
      replaceInput={debouncedReplaceInput}
      tagAppendRules={tagAppendRules}
      includeCharacters={cardIncludeCharacters}
      optimizeTags={cardOptimizeTags}
      smartTagExclusion={cardSmartTagExclusion}
      prependAnimaArtist={cardPrependAnimaArtist}
      removeLoRaTags={cardRemoveLoRaTags}
      removeQualityTags={cardRemoveQualityTags}
      backgroundMode={deferredBackgroundMode}
      simpleBackgroundReplacementTags={debouncedSimpleBackgroundReplacementTags}
      randomBackgroundPatterns={randomBackgroundPatterns}

      randomBackgroundIncludeGradients={randomBackgroundIncludeGradients}
      detailedBackgroundsList={detailedBackgroundsList}
      backgroundMatchStrictness={backgroundMatchStrictness}
      tagOverrides={tagOverrides}
      copiedId={copiedId}
      isExpanded={expandedPostId === post.id}
      onToggleExpand={handleToggleExpand}
      isMergeMode={mergeModeIsMergeMode}
      isSelected={mergeModeSelectedPosts.has(post.id)}
      selectedParts={mergeModeSelectedPosts.get(post.id)?.parts}
      onTogglePart={mergeModeTogglePostPart}
      onMergeSelect={() => { }}
      isPackMode={packModeIsPackMode}
      isPackBase={packMode.baseCard?.id === post.id}
      onSetAsPackBase={handleSetAsPackBase}
      onMakePack={handleMakePack}
      onSkipAnimation={() => setCopiedId(null)}
      globalWeights={globalWeights}
      isGlobalWeightsEnabled={cardIsGlobalWeightsEnabled}
      onGlobalWeightChange={handleGlobalWeightChange}
      onSearch={handleTagSearch}
      onImageError={handleImageError}
      isNaturalLanguageMode={isAiConvertMode}
      onSendToConvert={handleSendToConvert}
      showCategoryTagBadges={cardShowCategoryTagBadges}
    />
  }, [effectiveScale, search.booruProvider, search.debouncedSearchTags, cardAutoAppendSearchTags, favs.favorites, favs.folders, favs.favoriteFolderMap, favs.toggleFavorite, favs.createFolder, stableDownloadImage, stableCopyToClipboard, debouncedExcludeInput, debouncedAddInput, debouncedFindInput, debouncedReplaceInput, tagAppendRules, cardIncludeCharacters, cardOptimizeTags, cardSmartTagExclusion, cardPrependAnimaArtist, cardRemoveLoRaTags, cardRemoveQualityTags, deferredBackgroundMode, debouncedSimpleBackgroundReplacementTags, randomBackgroundPatterns, randomBackgroundIncludeGradients, detailedBackgroundsList, backgroundMatchStrictness, tagOverrides, copiedId, expandedPostId, handleToggleExpand, mergeModeIsMergeMode, mergeModeSelectedPosts, mergeModeTogglePostPart, globalWeights, cardIsGlobalWeightsEnabled, handleGlobalWeightChange, handleTagSearch, handleImageError, previouslyCopiedPostIds, EMPTY_ARRAY, tagCounts, isAiConvertMode, handleSendToConvert, cardShowCategoryTagBadges, packModeIsPackMode, packMode.baseCard, handleSetAsPackBase, handleMakePack])

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
      <div className="relative min-h-screen bg-background">
        <SiteCornerMenu
          scaleValue={scaleValue}
          setScaleValue={setScaleValue}
          onOpenTour={() => setTourRunSignal((n) => n + 1)}
        />

        <MainTour
          runSignal={tourRunSignal}
          onStart={() => {
            // Tour steps point at the section headers, which are always
            // visible — no need to expand (or, on mobile, open sheets).
            setIsPromptOptionsExpanded(true)
          }}
        />

        <main id="main-content" className={`container mx-auto px-4 py-4 sm:py-8 ${mergeMode.isMergeMode ? 'pb-[340px] sm:pb-[220px]' : isAiConvertMode ? 'pb-[220px] sm:pb-[200px]' : ''}`}>
          {/* Hero */}
          <div className="w-full max-w-6xl mx-auto mb-4 sm:mb-8 space-y-4 sm:space-y-6">
            <GalleryHero />

            {/* mt-* leaves room above the card for the folder tabs docked on
                its top edge (and the mascot standing on Update Notes). */}
            <Card ref={controlPanelRef} className="glass-effect relative z-20 !mt-14">
              {/* Ends exactly at the card's top edge so the card's border runs
                  in front of the tabs, making them read as tucked behind it.
                  bottom-full is measured from inside the card's 1px border,
                  hence mb-px to clear it. */}
              <div className="absolute bottom-full inset-x-3 sm:inset-x-6 mb-px flex items-end justify-between gap-2">
                <UpdateNotesTab version={pkg.version} />
                <PanelLinkTabs />
              </div>
              <CardContent className="p-4 sm:p-6">
                <form onSubmit={(e) => {
                  search.handleSearch(e)
                  // On mobile the control panel is tall; bring results into view after searching.
                  if (typeof window !== 'undefined' && window.innerWidth < 1024) {
                    setTimeout(() => {
                      document.getElementById('results-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }, 150)
                  }
                }} className="space-y-5">

                  {/* Search row: provider picker docked to the input, NSFW, Shuffle */}
                  <div className="space-y-2">
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
                      leading={
                        <ProviderSelect
                          booruProvider={search.booruProvider}
                          setBooruProvider={search.setBooruProvider}
                          onProviderChange={(p) => {
                            // Switching source leaves the Favorites/History views.
                            if (favs.showFavorites) favs.toggleShowFavorites()
                            if (showHistory) toggleShowHistory()
                            trackProviderChange(p)
                          }}
                        />
                      }
                    />

                    {/* What's actually sent to the booru, right under the input it describes */}
                    <QueryStatusPanel
                      variant="inline"
                      blacklistCount={blacklist.length}
                      searchTags={search.searchTags}
                      ratingFilter={search.ratingFilter}
                      order={search.order}
                      appliedTagCountFilter={search.appliedTagCountFilter}
                      appliedScoreTier={search.appliedScoreTier}
                      booruProvider={search.booruProvider}
                    />
                  </div>

                  {/* Mode bar: Browse / Merge / Pack + Favorites, History, Tools */}
                  <GalleryToolbar
                    showFavorites={favs.showFavorites}
                    toggleFavorites={favs.toggleShowFavorites}
                    favoritesCount={favs.favorites.size}
                    showHistory={showHistory}
                    toggleHistory={toggleShowHistory}
                    historyCount={historyTotal}
                    isMergeMode={mergeMode.isMergeMode}
                    disableMergeMode={mergeMode.disableMergeMode}
                    enableMergeMode={() => {
                      setIsAiConvertMode(false)
                      if (packModeIsPackMode) packMode.disablePackMode()
                      mergeMode.enableMergeMode()
                    }}
                    isPackMode={packModeIsPackMode}
                    disablePackMode={packMode.disablePackMode}
                    enablePackMode={() => {
                      setIsAiConvertMode(false)
                      if (mergeModeIsMergeMode) mergeModeDisableMergeMode()
                      packMode.enablePackMode()
                      if (!packMode.hasBase) {
                        setPackEntryStartInPrompt(false)
                        setPackEntryOpen(true)
                      }
                    }}
                    onOpenReverseParser={() => setIsReverseParserModalOpen(true)}
                    onOpenQuickTeach={() => setIsQuickTeachOpen(true)}
                    scaleValue={scaleValue}
                    setScaleValue={setScaleValue}
                  />

                  {/* The two option groups: what gets fetched / how the prompt comes out */}
                  {(() => {
                    const tagCount = parseInt(search.tagCountFilter) || 5
                    const scoreLabel = search.scoreTier === "off" ? "Any score" : `${search.scoreTier.charAt(0).toUpperCase()}${search.scoreTier.slice(1)}+ score`
                    const filtersSummary = [
                      isTagCountSupported ? `Min. ${tagCount} tags` : null,
                      scoreLabel,
                      includeCharacters && (parseInt(search.characterCountFilter) || 0) > 0 ? `Characters ${search.characterCountFilter}+` : null,
                      blacklist.length > 0 ? `${blacklist.length} blacklisted` : null,
                    ].filter(Boolean).join(" · ")

                    const addedTagCount = splitCommaSeparatedTags(addInput).length
                    const outputFlags = search.booruProvider === 'aibooru'
                      ? [search.removeLoRaTags, search.removeQualityTags, autoAppendSearchTags, isGlobalWeightsEnabled]
                      : [includeCharacters, optimizeTags, autoAppendSearchTags, prependAnimaArtist, isGlobalWeightsEnabled]
                    const promptSummary = [
                      addedTagCount > 0 ? `+${addedTagCount} tag${addedTagCount === 1 ? '' : 's'} added` : "No tags added",
                      excludeInput.trim() ? `${splitCommaSeparatedTags(excludeInput).length} removed` : null,
                      `${outputFlags.filter(Boolean).length} of ${outputFlags.length} options on`,
                      backgroundMode !== 'keep' ? "custom background" : null,
                    ].filter(Boolean).join(" · ")

                    return (
                      <div className="relative grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-start" data-tour="controls">
                        <ControlSection
                          title="Search filters"
                          summary={filtersSummary}
                          icon={<SlidersHorizontal />}
                          open={filtersOpen}
                          onOpenChange={setFiltersOpen}
                          data-tour="search-filters"
                        >
                          <TagsManagementPanel
                            embedded
                            section="filters"
                            blacklistCount={blacklist.length}
                            blacklistSlot={search.isClient ? (
                              <BlacklistManager
                                triggerVariant="edit"
                                blacklist={blacklist}
                                onAdd={addTag}
                                onRemove={removeTag}
                                onReset={resetBlacklist}
                              />
                            ) : null}
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
                        </ControlSection>

                        <ControlSection
                          title="Customize prompt"
                          summary={promptSummary}
                          icon={<PenLine />}
                          accent
                          wide
                          open={promptOptionsOpen}
                          onOpenChange={setPromptOptionsOpen}
                          data-tour="customize-prompt"
                        >
                          {/* Two columns on desktop (Tags | Output) so the whole
                              section fits on screen without an inner scroll. */}
                          <div className="grid grid-cols-1 gap-x-8 gap-y-5 lg:grid-cols-2">
                            <div className="flex flex-col gap-3">
                            <span className="text-xs font-semibold text-muted-foreground">Tags</span>
                            <div>
                              <TagsManagementPanel
                                embedded
                                section="edits"
                                smartTagExclusion={smartTagExclusion}
                                setSmartTagExclusion={setSmartTagExclusion}
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
                            </div>
                            </div>
                            <div className="flex flex-col gap-1 border-t border-border/60 pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
                            <span className="text-xs font-semibold text-muted-foreground">Output</span>
                            <div>
                              <PromptGenerationOptionsPanel
                                variant="embedded"
                                isPromptOptionsExpanded={isPromptOptionsExpanded}
                                setIsPromptOptionsExpanded={setIsPromptOptionsExpanded}
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
                            </div>
                            </div>
                          </div>
                        </ControlSection>
                      </div>
                    )
                  })()}
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

          {showHistory && history.length === 0 && (
            <div className="text-center text-muted-foreground py-16">
              No history yet. Copy a prompt from the gallery to see it here.
            </div>
          )}

          {showHistory && historyTotal > 0 && (isHistoryLoading || isHistoryValidating) && (historyPosts?.length ?? 0) < historyTotal && (
            <div className="w-full max-w-xs mx-auto py-3">
              <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${historyTotal > 0 ? Math.round(((historyPosts?.length ?? 0) / historyTotal) * 100) : 0}%` }}
                />
              </div>
              <p className="mt-2 text-sm text-muted-foreground text-center">
                Loading history…{" "}
                <span className="font-medium text-foreground">{historyPosts?.length ?? 0}</span>
                {" / "}{historyTotal}
              </p>
            </div>
          )}

          {showHistory && historyTotal > 0 && !isHistoryLoading && !isHistoryValidating && (historyPosts?.length ?? 0) < historyTotal && (() => {
            const missing = historyTotal - (historyPosts?.length ?? 0)
            // If the fetch errored, or NOTHING hydrated at all, the cause is almost
            // always transient (rate limit / 5xx / network) rather than the posts
            // being genuinely gone — so lead with a retry-first message. A partial
            // load (some succeeded) is more consistent with deleted/removed posts.
            const likelyTransient = !!historyError || (historyPosts?.length ?? 0) === 0
            return (
              <div className="text-center text-muted-foreground py-8 px-4 space-y-3">
                <p>
                  {likelyTransient ? (
                    <>
                      Couldn&apos;t load {missing} of your history{" "}
                      {missing === 1 ? "prompt" : "prompts"} — the booru may be rate-limiting or
                      temporarily unavailable. Try again in a moment.
                    </>
                  ) : (
                    <>
                      {missing} of your history {missing === 1 ? "prompt" : "prompts"} could not be
                      loaded — the source {missing === 1 ? "post" : "posts"} may have been deleted, or
                      the booru is temporarily unavailable.
                    </>
                  )}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => retryHistoryPosts()}
                  className="gap-1.5"
                >
                  <RefreshCw className="h-4 w-4" />
                  Retry
                </Button>
              </div>
            )
          })()}

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
              effectiveScale={effectiveScale}
              renderItem={renderMasonryItem}
              expandedItemId={expandedPostId}
            />
          )}

          {/* Load More / States */}
          {/* Load More / States */}
          <ResultsStates
            filteredPostsLength={filteredPosts.length}
            showFavorites={favs.showFavorites}
            showHistory={showHistory}
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
              imageErrorTimesRef.current = []
            }}
            // One-click "Show all content" is only offered once the user has
            // already confirmed NSFW via the SearchBar age dialog — otherwise
            // the card falls back to "try changing the rating filter", so the
            // consent gate is never bypassed.
            isSafeFilterActive={search.ratingFilter === SAFE_RATING && userPreferences.getNsfwAcknowledged()}
            onToggleRatingFilter={() => {
              posthog.capture('nsfw_preference_changed', { rating_filter: ALL_RATING, source: 'no_results' })
              search.setRatingFilter(ALL_RATING)
            }}
            blacklistCount={blacklist.length}
            onClearBlacklist={clearBlacklist}
            onRetrySearch={search.refresh}
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
        onTeachSuccess={refreshOverrides}
        isQuickTeachOpen={isQuickTeachOpen}
        setIsQuickTeachOpen={setIsQuickTeachOpen}
        isGlobalWeightsEnabled={isGlobalWeightsEnabled}
        tagOverrides={tagOverrides}
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
        isMergeMode={mergeMode.isMergeMode}
        isAiConvertMode={isAiConvertMode}
        onToggleAiConvertMode={toggleAiConvertMode}
        onToggleMergeMode={() => {
          if (mergeMode.isMergeMode && mergeMode.mergeModeType === 'merge') {
            mergeMode.disableMergeMode()
          } else {
            setIsAiConvertMode(false)
            mergeMode.enableMergeMode()
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
      {packModeIsPackMode && packFetcherActive && (
        <PackSeedFetcher
          key={JSON.stringify(packSourceAnswers)}
          answers={packSourceAnswers}
          booruProvider={packSourceAnswers.booruProvider}
          onReady={handlePackSeedSearchReady}
        />
      )}
      <PackEntryModal
        isOpen={packEntryOpen}
        initialPrompt={packMode.basePrompt || userPreferences.getLastPackBasePrompt()}
        startInPromptView={packEntryStartInPrompt}
        onChooseCard={() => setPackEntryOpen(false)}
        onSubmitPrompt={handleSubmitPackPrompt}
        onCancel={handlePackEntryCancel}
      />
      <PackSourceModal
        open={packModeIsPackMode && packMode.hasBase && sourceStep !== null}
        answers={packSourceAnswers}
        onApply={handleApplyPackSourceAnswers}
        onCancel={handleCancelPackSource}
        currentSearchTags={search.searchTags}
        postCount={sourceStep === 'edit' ? (packSeedSnapshot?.postCount ?? 0) : null}
        confirmLabel={sourceStep === 'setup' ? 'Continue' : 'Apply'}
      />
      <PackBuilderStickyFooter
        isOpen={packModeIsPackMode}
        baseCard={packMode.baseCard}
        basePrompt={packMode.basePrompt}
        onEditBasePrompt={handleEditBasePrompt}
        hasMultipleCharacters={packMode.hasMultipleCharacters}
        hasSetupAnswers={packMode.hasBase && sourceStep !== 'setup'}
        categoryStates={packMode.categoryStates}
        onSetCategoryState={packMode.setCategoryState}
        slotStateOf={packMode.slotStateOf}
        onSetSlotState={packMode.setSlotState}
        excludedBaseTags={packMode.excludedBaseTags}
        onToggleExcludedBaseTag={packMode.toggleExcludedBaseTag}
        onRestoreExcludedBaseTags={packMode.restoreExcludedBaseTags}
        axisSlotGroups={packMode.axisSlotGroups}
        axisSlotCounts={packMode.axisSlotCounts}
        axisMaxPerPrompt={packMode.axisMaxPerPrompt}
        tagOverrides={packMode.effectiveTagOverrides}
        baseClassified={packMode.baseClassified}
        lockedTags={packMode.lockedTags}
        axisValues={packMode.axisValues}
        onAddAxisValue={packMode.addAxisValue}
        onRemoveAxisValue={handlePackRemoveAxisValue}
        onReseedAxis={handleReseedAxis}
        axisTagModes={packMode.axisTagModes}
        onSetAxisTagMode={packMode.setAxisTagMode}
        onSetAllAxisTagModes={packMode.setAllAxisTagModes}
        axisMinCounts={packMode.axisMinCounts}
        onSetAxisMinCount={packMode.setAxisMinCount}
        customBaseText={packMode.customBaseText}
        onCustomBaseTextChange={packMode.setCustomBaseText}
        isSeeding={packSeed.isSeeding}
        seedProgress={packSeed.seedProgress}
        loadedPostCount={packSeedSnapshot?.postCount ?? 0}
        // No snapshot yet = the first page is still on its way, so more can load.
        canLoadMorePosts={packSeedSnapshot?.canLoadMore ?? true}
        onLoadMorePosts={handleLoadMorePacks}
        sourceAnswers={packSourceAnswers}
        onOpenSource={() => setSourceStep('edit')}
        varietyLevel={packMode.varietyLevel}
        onVarietyLevelChange={packMode.setVarietyLevel}
        minTotalTags={packMode.minTotalTags}
        onMinTotalTagsChange={packMode.setMinTotalTags}
        estimatedTagsPerPrompt={packMode.estimatedTagsPerPrompt}
        minSetTags={packMode.minSetTags}
        onSetMinSetTags={packMode.setMinSetTags}
        hiddenThinSets={packMode.hiddenThinSets}
        promptCount={packMode.promptCount}
        setPromptCount={packMode.setPromptCount}
        onRegenerate={handlePackRegenerate}
        onRerollPrompt={packMode.rerollPrompt}
        onClearBase={() => {
          packMode.setBaseCard(null)
          packMode.setBasePrompt('')
          // Keep the fetched posts: the next base on this source reuses them.
          hasSeededRef.current = false
        }}
        onExit={() => {
          packMode.disablePackMode()
          packMode.setBaseCard(null)
          packMode.setBasePrompt('')
          resetPackSeeding()
          setPackFetcherActive(false)
        }}
        savedPostCount={packSeedSnapshot?.savedCount ?? 0}
        onClearSavedPosts={handleClearSavedPackPosts}
        prompts={packMode.generatedPrompts}
        onCopyPrompt={(prompt) => {
          copyToClipboard(prompt.prompt, 0, true)
          packMode.recordPromptCopied(prompt)
        }}
        onCopyAll={(text) => copyToClipboard(text, 0, true)}
        onResetLearning={packMode.resetLearning}
      />

      <GalleryModals
        onTeachSuccess={refreshOverrides}
        isQuickTeachOpen={isQuickTeachOpen}
        setIsQuickTeachOpen={setIsQuickTeachOpen}
        isGlobalWeightsEnabled={isGlobalWeightsEnabled}
        tagOverrides={tagOverrides}
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












