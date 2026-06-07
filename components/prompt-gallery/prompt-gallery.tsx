"use client"

import type React from "react"
import { useState, useEffect, useRef, useMemo, useCallback, startTransition, useDeferredValue } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DebouncedInput, DebouncedHTMLInput } from "@/components/ui/debounced-input"
import { SearchWithAutocomplete } from "@/components/prompt-gallery/search-with-autocomplete"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
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
} from "lucide-react"

import dynamic from "next/dynamic"
import { getAllTagOverrides } from "@/app/actions/tags"

const TeachModal = dynamic(() => import("@/components/teach-modal").then(m => m.TeachModal))
const TeachWelcomeModal = dynamic(() => import("@/components/teach-welcome-modal").then(m => m.TeachWelcomeModal))
const TrendSheet = dynamic(() => import("@/components/trends/trend-sheet").then(m => m.TrendSheet))
const ReversePromptParserModal = dynamic(() => import("@/components/prompt-gallery/reverse-prompt-parser-modal").then(m => m.ReversePromptParserModal))
const GlobalWeightsModal = dynamic(() => import("@/components/prompt-gallery/global-weights-modal").then(m => m.GlobalWeightsModal))
const FeedbackDialog = dynamic(() => import("@/components/feedback-dialog").then(m => m.FeedbackDialog))

import { VersionDisplay } from "@/components/version-display"
import versionInfo from "@/version.json"
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

import { userPreferences, STORAGE_KEYS, type HistoryItem, type TagPreset } from "@/lib/storage"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Slider } from "@/components/ui/slider"
import { classifyTags, type ClassifiedTags } from "@/lib/tag-classifier"
import { type BackgroundMode, type BackgroundRemoveMode } from "@/lib/background-detector"
import { getDanbooruProxyUrl } from "@/lib/proxy-url"
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
import { BlacklistManager } from "@/components/prompt-gallery/blacklist-manager"
import { NoResultsState } from "@/components/prompt-gallery/no-results-state"

import { useMergeMode } from "@/hooks/use-merge-mode"
import { MergeStickyFooter } from "./merge-sticky-footer"
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

export function PromptGallery() {
  // 1. Core Logic Hooks
  const search = useBooruSearch()
  const { blacklist, addTag, removeTag, resetBlacklist } = useBlacklist()
  const favs = useBooruFavorites(search.booruProvider)
  const savedArtists = useSavedArtists()
  const tagCounts = useTagCounts(search.allPosts, search.booruProvider)
  const { toast } = useToast()
  const isMobile = useIsMobile()

  // Sync preferences with cloud
  usePreferencesSync()

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

  // Folder filter state ('artists' is a reserved virtual folder for saved artists)
  const [activeFavoriteFolder, setActiveFavoriteFolder] = useState<string | null | 'all' | 'artists'>('all')

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

  const [backgroundMode, setBackgroundMode] = usePersistentState<BackgroundMode>(
    "keep",
    userPreferences.getBackgroundMode,
    userPreferences.setBackgroundMode,
    "backgroundMode",
    STORAGE_KEYS.BACKGROUND_MODE
  )
  const deferredBackgroundMode = useDeferredValue(backgroundMode)

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

  const [backgroundRemoveMode, setBackgroundRemoveMode] = useState<BackgroundRemoveMode>('all')

  const [randomBackgroundIncludeGradients, setRandomBackgroundIncludeGradients] = useState(true)

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

  // Global Weights State
  const [globalWeights, setGlobalWeights] = useState<Record<string, number>>({})

  const [isGlobalWeightsEnabled, setIsGlobalWeightsEnabled] = usePersistentState(
    false,
    userPreferences.getGlobalWeightsEnabled,
    userPreferences.setGlobalWeightsEnabled,
    "globalWeightsEnabled",
    STORAGE_KEYS.GLOBAL_WEIGHTS_ENABLED
  )

  const [isGlobalWeightsModalOpen, setIsGlobalWeightsModalOpen] = useState(false)
  const [weightsLoaded, setWeightsLoaded] = useState(false)
  const [isReverseParserModalOpen, setIsReverseParserModalOpen] = useState(false)

  // Announcements Panel state: auto-expand on new version
  const [isAnnouncementsOpen, setIsAnnouncementsOpen] = useState(true)

  useEffect(() => {
    try {
      const raw = localStorage.getItem('announcements_state')
      const parsed = raw ? JSON.parse(raw) : null
      if (parsed && parsed.version === versionInfo.version) {
        setIsAnnouncementsOpen(!parsed.collapsed)
      } else {
        setIsAnnouncementsOpen(true)
        localStorage.setItem('announcements_state', JSON.stringify({ collapsed: false, version: versionInfo.version }))
      }
    } catch {
      setIsAnnouncementsOpen(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Merge Mode Hook
  const mergeMode = useMergeMode(globalWeights, isGlobalWeightsEnabled, debouncedAddInput, tagOverrides, deferredBackgroundMode, debouncedSimpleBackgroundReplacementTags)

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
      const overrides = await getAllTagOverrides()
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

  // Load global weights separately
  useEffect(() => {
    if (search.isClient) {
      setGlobalWeights(userPreferences.getGlobalWeights())
      // isGlobalWeightsEnabled loaded via hook
      setWeightsLoaded(true)
    }
  }, [search.isClient])

  useEffect(() => {
    if (search.isClient) {
      setHistory(userPreferences.getHistory())
      // Logic for old storage keys or manual loading removed - now handled by usePersistentState
    }
  }, [search.isClient])

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
    window.addEventListener('scroll', handleScroll)

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
  }, [])

  const handleClearGlobalWeights = useCallback(() => {
    setGlobalWeights({})
    setIsGlobalWeightsModalOpen(false)
    toast({ title: "Weights cleared", description: "All global tag weights have been reset." })
  }, [toast])

  const handleRemoveGlobalWeight = useCallback((tag: string) => {
    setGlobalWeights(prev => {
      const next = { ...prev }
      delete next[tag] // tag from modal is already key
      return next
    })
  }, [])

  const toggleGlobalWeights = (enabled: boolean) => {
    setIsGlobalWeightsEnabled(enabled)
  }

  const handleImportRawPrompt = useCallback((prompt: string) => {
    // Set the imported prompt as search tag
    search.setSearchTags(prompt)
    setIsReverseParserModalOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [search])

  // Persist Global Weights state changes
  useEffect(() => {
    if (search.isClient && weightsLoaded) {
      userPreferences.setGlobalWeights(globalWeights)
    }
  }, [globalWeights, search.isClient, weightsLoaded])

  // Tag Search Handler (from MasonryItem)
  const handleTagSearch = useCallback((tag: string) => {
    // Unescape parentheses for search (kashima \(kancolle\) -> kashima (kancolle))
    const cleanTag = tag.replace(/\\([()])/g, '$1')
    window.open(`/?tags=${encodeURIComponent(cleanTag)}`, '_blank')
  }, [])

  // --- Helpers ---
  // Ref-stabilized callbacks: las referencias no cambian, pero siempre llaman a la versión más reciente.
  // Esto evita que renderMasonryItem se recree cuando toast u otras deps cambian.
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
      // Danbooru: use Cloudflare Worker (same as image display, has auth headers)
      // Rule34/e621/Gelbooru: use Vercel proxy (they block cross-origin)
      const needsVercelProxy = imageUrl.includes('rule34.xxx') ||
        imageUrl.includes('e621.net') ||
        imageUrl.includes('gelbooru.com')
      const isDanbooru = imageUrl.includes('donmai.us')

      let fetchUrl: string
      if (needsVercelProxy) {
        fetchUrl = apiUrl(`/api/download?url=${encodeURIComponent(imageUrl)}`)
      } else if (isDanbooru) {
        fetchUrl = getDanbooruProxyUrl(imageUrl)
      } else {
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
      if (activeFavoriteFolder !== 'all') {
        if (activeFavoriteFolder === 'artists') return []
        source = source.filter(post => {
          const itemProvider = post._provider || search.booruProvider
          const uniqueKey = `${itemProvider}:${post.id}`
          const postFolderIds = favs.favoriteFolderMap[uniqueKey] || []

          if (activeFavoriteFolder === null) {
            // Uncategorized mode: show items that belong to no folders
            return postFolderIds.length === 0
          }

          return postFolderIds.includes(activeFavoriteFolder)
        })
      }
    }

    return source.filter(post => {
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
          return false // If the filter is active, it must have a character tag
        }
        
        const charTags = post.tag_string_character.split(' ').filter(Boolean)
        let hasValidCount = false
        
        for (const tag of charTags) {
          const count = tagCounts[tag]
          if (count === undefined) {
            // Count not loaded yet — give benefit of the doubt, keep the post.
            // This prevents posts from appearing/disappearing as tag counts
            // resolve asynchronously in batches.
            hasValidCount = true
            break
          } else if (count >= minCharPostCount) {
            hasValidCount = true
            break
          }
        }
        
        if (!hasValidCount) {
          return false
        }
      }

      const fileUrl = post.large_file_url || post.file_url
      return fileUrl?.match(/\.(jpg|jpeg|png|gif|webp|avif)$/i)
    })
  }, [favs.showFavorites, favs.favoritePosts, favs.favoriteFolderMap, search.allPosts, activeFavoriteFolder, search.booruProvider, blacklist, includeCharacters, search.appliedCharacterCountFilter])
  // NOTE: tagCounts intentionally NOT in deps — prevents progressive re-filtering
  // as tag counts resolve. Unknown counts are treated as passing (optimistic).

  // Constant empty array reference for memoization
  const EMPTY_ARRAY = useRef<string[]>([]).current

  const renderMasonryItem = useCallback((post: BooruPost, width: number, height: number, index: number) => {
    const itemProvider = post._provider || search.booruProvider
    const uniqueKey = `${itemProvider}:${post.id}`
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
      backgroundRemoveMode={backgroundRemoveMode}
      randomBackgroundIncludeGradients={randomBackgroundIncludeGradients}
      tagOverrides={tagOverrides}
      copiedId={copiedId}
      setTeachModalData={setTeachModalData}
      isMergeMode={mergeMode.isMergeMode}
      isSelected={mergeMode.selectedPosts.has(post.id)}
      selectedParts={mergeMode.selectedPosts.get(post.id)?.parts}
      onTogglePart={mergeMode.togglePostPart}
      onMergeSelect={() => { }}
      onSkipAnimation={() => setCopiedId(null)}
      globalWeights={globalWeights}
      isGlobalWeightsEnabled={isGlobalWeightsEnabled}
      onGlobalWeightChange={handleGlobalWeightChange}
      onSearch={handleTagSearch}
    />
  }, [viewMode, effectiveScale, search.booruProvider, favs.favorites, favs.folders, favs.favoriteFolderMap, favs.toggleFavorite, favs.createFolder, stableDownloadImage, stableCopyToClipboard, debouncedExcludeInput, debouncedAddInput, includeCharacters, optimizeTags, smartTagExclusion, search.removeLoRaTags, search.removeQualityTags, deferredBackgroundMode, debouncedSimpleBackgroundReplacementTags, randomBackgroundPatterns, backgroundRemoveMode, randomBackgroundIncludeGradients, tagOverrides, copiedId, mergeMode, globalWeights, isGlobalWeightsEnabled, handleGlobalWeightChange, handleTagSearch, previouslyCopiedPostIds, EMPTY_ARRAY, tagCounts])

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
                  <h1 className="text-lg sm:text-2xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent leading-tight sm:leading-normal">
                    Booru<span className="hidden sm:inline"> </span><br className="sm:hidden" />Prompt Gallery
                  </h1>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-0.5 sm:gap-3">
                    <Badge variant="secondary" className="text-[10px] sm:text-xs font-medium bg-muted text-muted-foreground border-0 px-1.5 py-0 sm:px-2 sm:py-1 h-fit">
                      By Mexes
                    </Badge>
                    <button
                      onClick={() => setShowWelcomeModal(true)}
                      className="focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full scale-90 sm:scale-100 origin-left"
                      title="Show Teach System Info"
                      aria-label="Show system information and version"
                    >
                      <VersionDisplay />
                    </button>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="sm:hidden text-xs h-7 px-2 gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
                          aria-label="More options"
                        >
                          <Sparkles className="h-3 w-3 text-amber-500" />
                          More
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-48">
                        <DropdownMenuItem onClick={() => setShowWelcomeModal(true)}>
                          <Sparkles className="mr-2 h-4 w-4 text-amber-500" />
                          What&apos;s New
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <a href={SOCIAL_URLS.CIVITAI_ARTICLE} target="_blank" rel="noopener noreferrer">
                            <ScrollText className="mr-2 h-4 w-4 text-blue-500" />
                            Changelog
                          </a>
                        </DropdownMenuItem>
                        {viewMode === "grid" && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel>Card Size</DropdownMenuLabel>
                            <DropdownMenuItem onClick={decreaseScale} disabled={scaleValue[0] === 1}>
                              <ZoomOut className="mr-2 h-4 w-4" />
                              Smaller
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={increaseScale} disabled={scaleValue[0] === 3}>
                              <ZoomIn className="mr-2 h-4 w-4" />
                              Larger
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>

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



                <ThemeToggle />

                <UserNav />

                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="focus-ring" aria-label="Help and information">
                          <AlertTriangle className="h-4 w-4 rotate-180" />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent>Help & Info</TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="end" className="glass-effect">
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
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </header>

        <main id="main-content" className="container mx-auto px-4 py-8">
          {/* Hero */}
          <div className="w-full max-w-6xl mx-auto mb-8 space-y-6">
            <div className="text-center space-y-2">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Discover AI Art Prompts</h2>
              <p className="text-muted-foreground max-w-2xl mx-auto text-sm sm:text-base px-4">
                Generate prompts from Danbooru, Aibooru, Rule34, Gelbooru and e621 image collections.
                Extract and format tags from posts or access AI-generated prompts directly,
                creating clean, ready-to-use prompts for your AI art generation.
              </p>

              {/* Social Links Section */}
              <div className="pt-4 space-y-3">
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
                          src="https://www.google.com/s2/favicons?domain=civitai.com&sz=32"
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
                          src="https://www.google.com/s2/favicons?domain=tensor.art&sz=32"
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
                          src="https://www.google.com/s2/favicons?domain=seaart.ai&sz=32"
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
                    aria-label="Support me on Ko-fi"
                  >
                    <Image
                      src="https://www.google.com/s2/favicons?domain=ko-fi.com&sz=32"
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
                    aria-label="View source code on GitHub"
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
                    aria-label="Open alternative version hosted on Netlify"
                  >
                    <Globe className="w-4 h-4 mr-2" />
                    Netlify Mirror
                  </a>
                </div>

                {/* Announcements Panel */}
                {isAnnouncementsOpen && (
                <Card className="mt-4 glass-effect overflow-hidden min-w-[280px] mx-auto">
                  <CardContent className="p-3.5">
                    <div className="relative flex items-center justify-center gap-2 mb-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10">
                          <Sparkles className="h-3.5 w-3.5 text-primary" />
                        </div>
                        <h3 className="text-sm font-semibold text-foreground tracking-tight">Update Notes: v{versionInfo.version}</h3>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setIsAnnouncementsOpen(false)
                          localStorage.setItem('announcements_state', JSON.stringify({ collapsed: true, version: versionInfo.version }))
                        }}
                        className="absolute right-0 h-7 w-7 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                        aria-label="Dismiss update notes"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
<div className="space-y-0">
{/* Newest first — reverse chronological order */}

{/* Item 2: Migration Planning */}
<div className="border-l-4 border-amber-500 bg-amber-500/10 hover:bg-amber-500/15 transition-colors p-4 rounded-r-lg">
<div className="flex items-start gap-3">
<div className="flex-shrink-0 mt-0.5">
<div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/20">
<AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
</div>
</div>
<div className="flex-1">
<div className="flex items-center gap-2 mb-2">
<p className="text-sm font-semibold text-foreground leading-snug">Migration Planning</p>
<Badge className="text-[10px] px-1.5 py-0 h-4 font-medium border-0 bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20">Important</Badge>
</div>
<p className="text-xs text-muted-foreground leading-relaxed">
The app has grown quite a bit, and I'm glad many people have found it useful! However, the free hosting plans are starting to fall short and Vercel (the main link) is constantly hitting its usage limits. I'm running some tests and experimenting with changes to see if things improve — a full migration to Netlify might happen if needed, but nothing is set in stone yet. I wanted to give you a heads up in advance so you know there's an alternative link available just in case.
</p>
</div>
</div>
</div>
<div className="h-px bg-border/60 mx-3" />

{/* Item 1: Welcome to Open Source */}
<div className="border-l-2 border-green-500 bg-green-500/5 hover:bg-green-500/10 transition-colors p-3">
<div className="flex items-center justify-center gap-2 mb-1.5">
<p className="text-xs font-semibold text-foreground leading-snug">Welcome to Open Source!</p>
<Badge className="text-[10px] px-1.5 py-0 h-4 font-medium border-0 bg-green-500/15 text-green-600 dark:text-green-400 hover:bg-green-500/20">New</Badge>
</div>
<p className="text-[11px] text-muted-foreground leading-relaxed text-center">
I've cleaned up and modified the project to make it fully open source. This means the complete code is now available for anyone to download, explore, and run on their own computer. Whether you want to use it as-is, customize it for your own needs, or even contribute improvements, everything is now out in the open.
</p>
</div>
<div className="h-px bg-border/60 mx-3" />

{/* Item 3: Meta Tag Leakage Fix */}
<div className="border-l-2 border-blue-500 bg-blue-500/5 hover:bg-blue-500/10 transition-colors p-3">
<div className="flex items-center justify-center gap-2 mb-1.5">
<p className="text-xs font-semibold text-foreground leading-snug">Meta Tag Leakage Fix</p>
<Badge className="text-[10px] px-1.5 py-0 h-4 font-medium border-0 bg-blue-500/15 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20">Fix</Badge>
</div>
<p className="text-[11px] text-muted-foreground leading-relaxed text-center">
Fixed an issue where commentary tags were leaking into cleaned prompts. The tag cleaner now properly filters out meta commentary tags so your prompts stay clean and accurate.
</p>
</div>
                    </div>
                  </CardContent>
                </Card>
                )}
              </div>
            </div>

            <Card className="glass-effect">
              <CardContent className="p-4 sm:p-6">
                <form onSubmit={search.handleSearch} className="space-y-6">

                  {/* Top Bar: Provider Selection & Quick Actions */}
                  <div className="flex flex-col lg:flex-row gap-8 justify-start items-start lg:items-center">
                    {/* API Provider Selector */}
                    <div className="flex flex-col gap-1.5 w-full lg:w-auto">
                      <span className="text-xs font-medium text-muted-foreground ml-1">API Provider</span>
                      <div className="bg-muted/50 p-1 rounded-lg flex gap-1 w-full sm:w-auto overflow-x-auto"
                        style={{ WebkitOverflowScrolling: 'touch' }}
                      >
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
                            className={`relative h-8 text-sm px-3 sm:px-4 min-w-fit flex-1 sm:flex-none whitespace-nowrap ${!favs.showFavorites && search.booruProvider === p ? "text-foreground hover:bg-transparent" : "text-muted-foreground hover:text-foreground"}`}
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
                            className={`h-9 px-3 gap-1 transition-colors duration-200 cursor-pointer ${favs.showFavorites
                              ? "bg-red-200 text-red-800 hover:bg-red-300 dark:bg-red-800 dark:text-red-100 dark:hover:bg-red-700 shadow-inner"
                              : "bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40"
                              }`}
                          >
                            <motion.button
                              type="button"
                              onClick={favs.toggleShowFavorites}
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
                                mergeMode.enableMergeMode()
                              }
                            }}
                            variant="secondary"
                            className={`h-9 px-3 gap-1 transition-colors duration-200 ${mergeMode.isMergeMode && mergeMode.mergeModeType === 'merge'
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
                                  mergeMode.enableVariationMode()
                              }
                            }}
                            variant="secondary"
                            className={`h-9 px-3 gap-1 transition-colors duration-200 ${mergeMode.isMergeMode && mergeMode.mergeModeType === 'variations'
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
                            className="h-9 px-3 gap-1 transition-colors duration-200 bg-purple-50 text-purple-600 hover:bg-purple-100 dark:bg-purple-900/20 dark:text-purple-400 dark:hover:bg-purple-900/40"
                            aria-label="Open Reverse Prompt Parser"
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
                      <div className="bg-muted/30 border rounded-xl p-4 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-8">
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
                                        <Button variant="ghost" size="icon" className="h-7 w-5 min-w-[1.25rem] text-muted-foreground hover:text-foreground rounded-l-none" title="Select Preset" aria-label="Select a saved tags preset">
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
                            <div className="space-y-2">
                              <label htmlFor="tag-count" className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                                <span className={`w-1.5 h-1.5 rounded-full ${isTagCountSupported ? "bg-blue-500" : "bg-gray-400"}`}></span>
                                <InfoTooltip
                                  title="Minimum Tag Count"
                                  description="This option ensures that only prompts with more than a certain amount of tags appear. The higher the number, the more detailed prompts you get; recommended around 20-30."
                                  visual={
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
                                >
                                  Minimum Tag Count ({`>=`} {search.tagCountFilter})
                                </InfoTooltip>
                              </label>
                              <div className="flex items-center">
                                <Slider
                                  min={5}
                                  max={100}
                                  step={1}
                                  value={[parseInt(search.tagCountFilter) || 5]}
                                  onValueChange={(val) => search.setTagCountFilter(val[0].toString())}
                                  onValueCommit={(val) => search.setAppliedTagCountFilter(val[0].toString())}
                                  disabled={!isTagCountSupported}
                                  className={`flex-1 ${!isTagCountSupported ? "opacity-50 cursor-not-allowed" : ""}`}
                                  aria-label="Minimum tag count"
                                />
                                <DebouncedInput
                                  id="tag-count"
                                  type="number"
                                  min={5}
                                  max={1000}
                                  value={search.tagCountFilter}
                                  onChange={search.setTagCountFilter}
                                  debounceTime={500}
                                  onBlur={() => search.setAppliedTagCountFilter(search.tagCountFilter)}
                                  disabled={!isTagCountSupported}
                                  className={`h-8 w-16 text-xs text-center bg-background/50 ${!isTagCountValid ? "border-red-500 focus-visible:ring-red-500" : ""} ${!isTagCountSupported ? "opacity-50 cursor-not-allowed" : ""}`}
                                  aria-label="Minimum tag count input"
                                />
                              </div>
                            </div>
                            <div className="space-y-2">
                              <label htmlFor="character-count" className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                                <InfoTooltip
                                  title="Minimum Character Post Count"
                                  description="This option ensures that only posts containing characters with a minimum amount of booru posts appear. Useful for filtering out obscure characters."
                                >
                                  Minimum Character Post Count ({`>=`} {search.characterCountFilter})
                                </InfoTooltip>
                              </label>
                              <div className="flex items-center">
                                <Slider
                                  min={0}
                                  max={10000}
                                  step={100}
                                  value={[parseInt(search.characterCountFilter) || 0]}
                                  onValueChange={(val) => search.setCharacterCountFilter(val[0].toString())}
                                  onValueCommit={(val) => search.setAppliedCharacterCountFilter(val[0].toString())}
                                  disabled={!includeCharacters}
                                  className={`flex-1 ${!includeCharacters ? "opacity-50 cursor-not-allowed" : ""}`}
                                  aria-label="Minimum character post count"
                                />
                                <DebouncedInput
                                  id="character-count"
                                  type="number"
                                  min={0}
                                  max={1000000}
                                  value={search.characterCountFilter}
                                  onChange={search.setCharacterCountFilter}
                                  debounceTime={500}
                                  onBlur={() => search.setAppliedCharacterCountFilter(search.characterCountFilter)}
                                  disabled={!includeCharacters}
                                  className={`h-8 w-16 text-xs text-center bg-background/50 ${(!search.characterCountFilter || !/^\d+$/.test(search.characterCountFilter)) ? "border-red-500 focus-visible:ring-red-500" : ""} ${!includeCharacters ? "opacity-50 cursor-not-allowed" : ""}`}
                                  aria-label="Minimum character post count input"
                                />
                              </div>
                            </div>
                          </div>

                          {/* Options & Switches */}
                          <div className="space-y-4">
                            <span className="text-xs font-medium text-muted-foreground block">
                              {search.booruProvider === 'aibooru' ? 'Aibooru Options' : 'Prompt Generation Options'}
                            </span>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                                        <SelectItem value="random">Random</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>
                                <AnimatePresence>
                                  {backgroundMode === 'remove_all' && (
                                    <motion.div
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: "auto", opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      transition={{ duration: 0.2, ease: "easeInOut" }}
                                      className="overflow-hidden"
                                    >
                                      <div className="pt-3 pl-0 sm:pl-[3.25rem] flex flex-col gap-3">
                                        <div className="flex items-center justify-between gap-2">
                                          <span className="text-xs font-medium text-foreground">Scope</span>
                                          <Select value={backgroundRemoveMode} onValueChange={(val: BackgroundRemoveMode) => setBackgroundRemoveMode(val)}>
                                            <SelectTrigger className="h-7 text-[11px] w-[130px] bg-background">
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="all">Everything</SelectItem>
                                              <SelectItem value="simple_only">Simple Only</SelectItem>
                                              <SelectItem value="detailed_only">Detailed Only</SelectItem>
                                            </SelectContent>
                                          </Select>
                                        </div>
                                      </div>
                                    </motion.div>
                                  )}
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
                        // Calculate counts based on *loaded* posts to ensure consistency with the grid
                        const loadedPosts = favs.favoritePosts || [];
                        
                        // Helper to get folder IDs for a post
                        const getPostFolders = (post: any) => {
                          const key = `${post._provider || post.provider}:${post.id}`;
                          return favs.favoriteFolderMap[key] || [];
                        };

                        const allCount = loadedPosts.length;
                        
                        const uncategorizedCount = loadedPosts.filter(post => {
                            return getPostFolders(post).length === 0;
                        }).length;

                        return [
                          { id: 'all', name: 'All Favorites', count: allCount, icon: null, isArtists: false },
                          // Reserved virtual folder for saved artists — always pinned
                          // right after "All Favorites" for discoverability.
                          { id: 'artists', name: 'Artists', count: savedArtists.savedArtists.length, icon: 'Palette', isArtists: true },
                          { id: null, name: 'Uncategorized', count: uncategorizedCount, icon: 'Folder', isArtists: false },
                          ...favs.folders.map(f => ({
                            id: f.id as string | null | 'all' | 'artists',
                            name: f.name,
                            count: loadedPosts.filter(post => getPostFolders(post).includes(f.id)).length,
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

          {filteredPosts.length > 0 && activeFavoriteFolder !== 'artists' && (
            viewMode === "grid" ? (
              <div className="mb-8 min-h-[500px]">
                <MasonryGrid
                  items={filteredPosts}
                  scale={effectiveScale}
                  renderItem={renderMasonryItem}
                />
              </div>
            ) : (
              <div className="space-y-4 mb-8">
                {filteredPosts.map((post) => {
                  const itemProvider = post._provider || search.booruProvider
                  const uniqueKey = `${itemProvider}:${post.id}`
                  const isFavorited = favs.favorites.has(uniqueKey)
                  const currentFolderIds = favs.favoriteFolderMap[uniqueKey] || EMPTY_ARRAY
                  const isPreviouslyCopied = previouslyCopiedPostIds.has(post.id)

                  return (
                    <div key={`${post.id}`}>
                      <MasonryItem
                        post={post}
                        tagCounts={tagCounts}
                        isPreviouslyCopied={isPreviouslyCopied}
                        width={800} // Dummy width for list view
                        height={600} // Dummy height
                        viewMode="list"
                        effectiveScale="medium" // Fixed for list
                        booruProvider={search.booruProvider}
                        isFavorited={isFavorited}
                        folders={favs.folders}
                        currentFolderIds={currentFolderIds}
                        toggleFavorite={favs.toggleFavorite}
                        createFolder={favs.createFolder}
                        downloadImage={downloadImage}
                        copyToClipboard={copyToClipboard}
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
      backgroundRemoveMode={backgroundRemoveMode}
      randomBackgroundIncludeGradients={randomBackgroundIncludeGradients}
      tagOverrides={tagOverrides}
                        copiedId={copiedId}
                        setTeachModalData={setTeachModalData}
                        isMergeMode={mergeMode.isMergeMode}
                        isSelected={mergeMode.selectedPosts.has(post.id)}
                        selectedParts={mergeMode.selectedPosts.get(post.id)?.parts}
                        onTogglePart={mergeMode.togglePostPart}
                        onMergeSelect={() => { }}
                      />
                    </div>
                  )
                })}
              </div>
            )
          )}

          {/* Load More / States */}
          {filteredPosts.length > 0 && !favs.showFavorites && activeFavoriteFolder !== 'artists' && (
            <div className="text-center pb-8">
              {!search.loadMoreError ? (
 <InfiniteScrollTrigger
 onIntersect={search.loadMore}
 hasNextPage={!search.noMoreResults}
 isLoading={search.isLoadingMore}
 error={search.loadMoreError}
 loadedCount={filteredPosts.length}

                />
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

              {search.noMoreResults && !search.loadMoreError && (
                <p className="text-muted-foreground text-sm py-4">
                  --- End of results ---
                </p>
              )}
            </div>
          )}

          {/* Loading / Empty States */}
          {((search.isLoading && filteredPosts.length === 0 && !favs.showFavorites) || (favs.showFavorites && (favs.isLoading || favs.isRefreshing) && activeFavoriteFolder !== 'artists')) && (
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
                  {favs.favoritesProgress.total > 20 && (
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      Danbooru rate limiting in effect, loading progressively...
                    </p>
                  )}
                </>
              ) : (
                <>
                  <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
                  <p className="mt-4">Loading...</p>
                </>
              )}
            </div>
          )}

          {!search.isLoading && (!favs.isLoading && !favs.isRefreshing) && filteredPosts.length === 0 && activeFavoriteFolder !== 'artists' && (
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

        <div className={`fixed ${mergeMode.isMergeMode ? 'bottom-[220px] sm:bottom-[200px]' : 'bottom-4 sm:bottom-6'} right-4 sm:right-6 z-50 transition-all duration-500 flex flex-col gap-3 ${showBackToTop ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-75 pointer-events-none hidden'
          }`}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={mergeMode.toggleMergeMode}
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
      <MergeStickyFooter
        isOpen={mergeMode.isMergeMode}
        selectedPosts={mergeMode.selectedPosts}
        mergedPrompt={mergeMode.mergedPrompt}
        mergedPromptSegments={mergeMode.mergedPromptSegments}
        onRemovePost={mergeMode.removePost}
        onClearAll={mergeMode.clearAll}
        onExit={mergeMode.toggleMergeMode}
        onCopy={(text) => copyToClipboard(text, 0, true)}
        onRemoveTag={mergeMode.excludeTag}
        mergeModeType={mergeMode.mergeModeType}
        onToggleMergeModeType={mergeMode.toggleVariationsMode}
        onRandomize={() => mergeMode.setRandomSelection(finalPosts)}
        randomSettings={mergeMode.randomSettings}
        setRandomSettings={mergeMode.setRandomSettings}
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












