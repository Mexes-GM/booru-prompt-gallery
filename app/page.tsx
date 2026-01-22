"use client"

import type React from "react"
import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Copy,
  Check,
  Loader2,
  RefreshCw,
  Search,
  Filter,
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
  ChevronDown,
  Shirt,
  User,
  Mountain,
  Smile,
  GraduationCap,
} from "lucide-react"
import { TeachModal } from "@/components/teach-modal"
import { TeachWelcomeModal } from "@/components/teach-welcome-modal"
import { getAllTagOverrides } from "@/app/actions/tags"
import { VersionDisplay } from "@/components/version-display"
import { useToast } from "@/hooks/use-toast"
import { useIsMobile } from "@/hooks/use-mobile"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import Image from "next/image"
import { motion } from "framer-motion"
import { useInfinitePosts, useFavoritePosts, hasMultipleTags, getFinalQueryTags, BooruPost, BooruProvider, isAibooruPost, getPromptFromPost, removeLoRaTags as removeLoRaTagsUtil, removeQualityTags as removeQualityTagsUtil, type FavoriteItem } from "@/lib/api-client"

import { userPreferences, type HistoryItem } from "@/lib/storage"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Slider } from "@/components/ui/slider"
import { cleanPrompt } from "@/lib/cleanPrompt"
import { classifyTags, type TagCategory, type ClassifiedTags } from "@/lib/tag-classifier"
import { Switch } from "@/components/ui/switch"
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
  safeTrack,
  initScrollDepthTracking,
  trackTimeOnPage,
  trackExternalLink,
  trackFavorite,
  trackCopy,
  trackSearch,
  trackLoadMore,
  trackViewMode,
  trackScaleChange,
  trackRefresh,
  trackProviderChange,
  trackAibooruOption,
  trackRatingChange,
  trackDanbooruOption,
  trackRule34Option,
  trackE621Option,
} from '@/lib/analytics'

// Using BooruPost from api-client instead of local interface

import { MasonryGrid, SCALE_CONFIG } from "@/components/masonry-grid"

type CardScale = "small" | "medium" | "large"

export default function DanbooruPromptGenerator() {
  const [searchTags, setSearchTags] = useState("")
  const [debouncedSearchTags, setDebouncedSearchTags] = useState("")
  const [ratingFilter, setRatingFilter] = useState("rating:general")
  const order = "recent" // Always use recent order
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [cardScale, setCardScale] = useState<CardScale>("medium")
  const [scaleValue, setScaleValue] = useState([2])
  const [copiedId, setCopiedId] = useState<number | null>(null)
  // Store favorites as a Set of strings "provider:id"
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const [favoritesLoaded, setFavoritesLoaded] = useState(false)
  const [showFavorites, setShowFavorites] = useState(false)
  const [showBackToTop, setShowBackToTop] = useState(false)
  const [noMoreResults, setNoMoreResults] = useState(false)
  const [lastLoadAttempt, setLastLoadAttempt] = useState(0)
  const [randomSeed, setRandomSeed] = useState<number>(0)
  const [includeCharacters, setIncludeCharacters] = useState(true)
  const [optimizeTags, setOptimizeTags] = useState(true) // UI toggle para combinacion/optimizacion de tags
  const [showSettings, setShowSettings] = useState(true)
  const [excludeInput, setExcludeInput] = useState("") // entrada de tags a excluir
  const [addInput, setAddInput] = useState("") // entrada de tags a agregar
  const [booruProvider, setBooruProvider] = useState<BooruProvider>('danbooru')
  const [hasPromptFilter, setHasPromptFilter] = useState(false)
  const [removeLoRaTags, setRemoveLoRaTags] = useState(false)
  const [removeQualityTags, setRemoveQualityTags] = useState(false)
  const [tagCountFilter, setTagCountFilter] = useState("5") // Default to >5 tags
  const [isClient, setIsClient] = useState(false)
  const [previousRatingFilter, setPreviousRatingFilter] = useState<string>("rating:general") // Store rating before switching to Rule34
  const [isLoadingLock, setIsLoadingLock] = useState(false) // Prevent race conditions on "Load More"
  const [loadMoreError, setLoadMoreError] = useState(false) // Track if last load attempt failed
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [tagOverrides, setTagOverrides] = useState<Record<string, string>>({})
  const [teachModalData, setTeachModalData] = useState<{ open: boolean, tags: ClassifiedTags | null }>({ open: false, tags: null })
  const [showWelcomeModal, setShowWelcomeModal] = useState(false)
  const isMobile = useIsMobile()
  
  const effectiveScale = useMemo(() => {
    if (isMobile) {
      if (cardScale === 'small') return 'large'
      if (cardScale === 'large') return 'small'
    }
    return cardScale
  }, [cardScale, isMobile])
  
  const isTagCountValid = !tagCountFilter || /^\d+$/.test(tagCountFilter)
  const isTagCountSupported = booruProvider === 'danbooru' || booruProvider === 'e621'

  // Fetch tag overrides on mount
  useEffect(() => {
    getAllTagOverrides().then(overrides => {
      setTagOverrides(overrides)
    })
  }, [])

  const { toast } = useToast()
  


  // Load user preferences from localStorage on client mount
  useEffect(() => {
    setIsClient(true)
    setRandomSeed(Date.now()) // Initialize random seed on client
    const savedProvider = userPreferences.getBooruProvider()
    const savedRemoveLoRa = userPreferences.getRemoveLoRaTags()
    const savedRemoveQuality = userPreferences.getRemoveQualityTags()
    const savedRatingFilter = userPreferences.getRatingFilter()
    const savedHistory = userPreferences.getHistory()
    
    // Force switch from Aibooru if it was saved (TEMPORARILY DISABLED)
    if (savedProvider === 'aibooru') {
      setBooruProvider('danbooru')
    } else {
      setBooruProvider(savedProvider)
    }
    setRemoveLoRaTags(savedRemoveLoRa)
    setRemoveQualityTags(savedRemoveQuality)
    setRatingFilter(savedRatingFilter)
    setHistory(savedHistory)
  }, [])

  // Save booru provider preference
  useEffect(() => {
    if (isClient) {
      userPreferences.setBooruProvider(booruProvider)
    }
  }, [booruProvider, isClient])

  // Save LoRa tags removal preference
  useEffect(() => {
    if (isClient) {
      userPreferences.setRemoveLoRaTags(removeLoRaTags)
    }
  }, [removeLoRaTags, isClient])

  // Save quality tags removal preference
  useEffect(() => {
    if (isClient) {
      userPreferences.setRemoveQualityTags(removeQualityTags)
    }
  }, [removeQualityTags, isClient])

  // Save rating filter preference
  useEffect(() => {
    if (isClient) {
      userPreferences.setRatingFilter(ratingFilter)
    }
  }, [ratingFilter, isClient])

  // Auto-activate prompt filter when Aibooru is selected
  useEffect(() => {
    if (booruProvider === 'aibooru') {
      setHasPromptFilter(true)
    } else {
      setHasPromptFilter(false)
    }
  }, [booruProvider])

  const {
    data: pages,
    error,
    isLoading,
    isValidating,
    size,
    setSize,
    mutate,
  } = useInfinitePosts(debouncedSearchTags, ratingFilter, order, randomSeed, booruProvider, hasPromptFilter, tagCountFilter)

  // Prepare favorites list for hook
  const favoriteItems: FavoriteItem[] = useMemo(() => {
    return Array.from(favorites).map(key => {
      const [p, idStr] = key.split(':')
      // Handle legacy format (id only -> assume danbooru) or malformed keys
      if (!idStr) {
        return { provider: 'danbooru', id: parseInt(key, 10) }
      }
      return { provider: p as BooruProvider, id: parseInt(idStr, 10) }
    }).filter(item => !isNaN(item.id))
  }, [favorites])

  // Fetch favorite posts separately
  const {
    posts: favoritePosts,
    error: favoritesError,
    isLoading: favoritesLoading,
    mutate: mutateFavorites,
  } = useFavoritePosts(favoriteItems)





  // Ensure initial load
  useEffect(() => {
    if (size === 0 && !isLoading) {
      setSize(1)
    }
  }, [size, isLoading, setSize])

  // CRITICAL FIX: Deduplicate posts by ID to prevent duplicate rendering
  // This handles the case where the API returns overlapping results between pages
  // LOGIC: Keep FIRST occurrence of each unique ID, remove all subsequent duplicates
  const allPosts = useMemo(() => {
    if (!pages) return []

    const flatPosts = pages.flat()
    const seenIds = new Set<number>()
    const keptPosts: BooruPost[] = []
    
    // Single pass through all posts - O(n) time complexity
    for (let i = 0; i < flatPosts.length; i++) {
      const post = flatPosts[i]
      
      if (seenIds.has(post.id)) {
        continue
      }
      
      // First time seeing this ID - keep it
      seenIds.add(post.id)
      keptPosts.push(post)
    }
    
    return keptPosts
  }, [pages])
  
  // Use dedicated favorites API when showing favorites
  const posts = showFavorites ? (favoritePosts || []) : allPosts
  


  const isLoadingMore = isValidating && size > 0
  const isEmpty = !isLoading && pages?.[0]?.length === 0
  // Check if the last API response was empty (not the filtered posts count)
  const lastPageFromAPI = pages && pages.length > 0 ? pages[pages.length - 1] : null
  const isReachingEnd = isEmpty || (lastPageFromAPI !== null && lastPageFromAPI.length === 0)
  
  const loadMore = () => {
    // CRITICAL: Prevent race conditions with multiple rapid clicks
    if (isLoadingLock || isLoadingMore) {
      return
    }
    
    setIsLoadingLock(true) // Lock to prevent double-clicks
    setLoadMoreError(false) // Reset error state on new attempt
    
    // Store the current raw API data length, not filtered posts length
    const currentRawPostCount = pages ? pages.flat().length : 0
    setLastLoadAttempt(currentRawPostCount)
    
    // If using random order, update seed to force new results
    if (order === 'random' || /order:random|random:\d+/i.test(searchTags)) {
      setRandomSeed(Date.now())
    }
    
    // CRITICAL FIX: Increment size to load next page
    // SWR will use the getKey function with pageIndex = size (0-based)
    // which will request page = size + 1 (1-based) from the API
    setSize(size + 1)
    trackLoadMore({ order, nextPage: size + 1, currentCount: posts.length })
  }
  
  // Release loading lock when loading completes
  useEffect(() => {
    if (!isLoadingMore && isLoadingLock) {
      setIsLoadingLock(false)
    }
  }, [isLoadingMore, isLoadingLock, posts.length, size])
  
  const refresh = () => {
    // If using random order, update seed to force new results
    if (order === 'random' || /order:random|random:\d+/i.test(searchTags)) {
      setRandomSeed(Date.now())
    }
    mutate(undefined, { revalidate: true })
    trackRefresh(order)
  }

  useEffect(() => {
    // Check if we attempted to load more but got no new posts or if there was an error
    if (lastLoadAttempt > 0 && !isLoadingMore) {
      // Get current raw API data length
      const currentRawPostCount = pages ? pages.flat().length : 0
      
      if (error) {
        // API returned an error
        setLoadMoreError(true)
        setNoMoreResults(false)
        toast({
          title: "Error loading more posts",
          description: "There was an error loading more posts. Click 'Retry' to try again.",
          variant: "destructive",
        })
        setLastLoadAttempt(0)
      } else if (currentRawPostCount === lastLoadAttempt || isReachingEnd) {
        // No new posts received from API (before filtering)
        setNoMoreResults(true)
        setLoadMoreError(false)
        toast({
          title: "No more results",
          description: "No more recent posts found for this search. Try different search terms or change the rating filter.",
          variant: "default",
        })
        setLastLoadAttempt(0)
      } else if (currentRawPostCount > lastLoadAttempt) {
        // Successfully loaded new posts from API
        setNoMoreResults(false)
        setLoadMoreError(false)
        setLastLoadAttempt(0)
      }
    }
  }, [pages, isLoadingMore, lastLoadAttempt, isReachingEnd, error, toast])

  useEffect(() => {
    setNoMoreResults(false)
    setLoadMoreError(false)
    setLastLoadAttempt(0)
  }, [searchTags, ratingFilter])

  useEffect(() => {
    const scale = scaleValue[0]
    let val: CardScale = 'medium'
    if (scale === 1) val = 'small'
    else if (scale === 2) val = 'medium'
    else val = 'large'
    if (val !== cardScale) {
      setCardScale(val)
      trackScaleChange(val)
    }
  }, [scaleValue, cardScale])

  const copyToClipboard = async (content: string, postId: number, isPrompt: boolean = false, thumbnailUrl?: string) => {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedId(postId)
      
      // Add to history
      userPreferences.addToHistory({
        content,
        postId,
        thumbnailUrl
      })
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
  }

  const toggleFavorite = (postId: number, providerOverride?: string) => {
    // Construct unique key, using override if provided (for favorites view logic), else current provider
    const targetProvider = providerOverride || booruProvider
    const uniqueKey = `${targetProvider}:${postId}`
    
    // Determine new state based on current state (not using functional update to ensure sync with save)
    const isCurrentlyFavorited = favorites.has(uniqueKey)
    const newFavorites = new Set(favorites)
    
    if (isCurrentlyFavorited) {
      newFavorites.delete(uniqueKey)
      toast({
        title: "Removed from favorites",
        description: "Image removed from your favorites",
      })
      trackFavorite(postId, 'remove')
    } else {
      newFavorites.add(uniqueKey)
      toast({
        title: "Added to favorites",
        description: "Image added to your favorites",
      })
      trackFavorite(postId, 'add')
    }
    
    setFavorites(newFavorites)
    saveFavoritesToStorage(newFavorites)
  }

  const downloadImage = async (post: BooruPost) => {
    try {
      // Use file_url first (original quality), fallback to large_file_url
      // This is because:
      // - Danbooru: large_file_url is high quality, file_url is original (prefer original)
      // - Rule34: file_url is original, large_file_url is sample/compressed (prefer original)
      // - Aibooru: same as Danbooru
      const imageUrl = post.file_url || post.large_file_url
      
      if (!imageUrl) {
        toast({
          title: "Download failed",
          description: "No image URL available",
          variant: "destructive",
        })
        return
      }

      // Extract file extension from URL
      const urlPath = imageUrl.split('?')[0] // Remove query params
      const extension = urlPath.split('.').pop() || 'jpg'
      
      // Determine provider to prefix filename
      // This ensures unique filenames when downloading from different sources
      const itemProvider = post._provider || booruProvider
      const filename = `${itemProvider}_${post.id}.${extension}`

      // Check if the image URL requires a proxy (CORS or hotlink protection)
      // Rule34 strictly blocks direct cross-origin fetches
      // Aibooru often returns 403s without proper Referer
      // e621 also requires CORS handling
      const needsProxy = imageUrl.includes('rule34.xxx') || imageUrl.includes('aibooru.online') || imageUrl.includes('e621.net')
      
      let fetchUrl = imageUrl
      if (needsProxy) {
        // Use our proxy endpoint to bypass CORS
        fetchUrl = `/api/download?url=${encodeURIComponent(imageUrl)}`
      }

      // Fetch the image
      const response = await fetch(fetchUrl)
      if (!response.ok) throw new Error('Failed to fetch image')
      
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      
      // Create a temporary link and trigger download
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      
      // Clean up the URL object
      window.URL.revokeObjectURL(url)
      
      toast({
        title: "Download started",
        description: `Downloading ${filename}`,
      })
    } catch (error) {
      console.error('Download error:', error)
      toast({
        title: "Download failed",
        description: "There was an error downloading the image. Try again or visit the original post.",
        variant: "destructive",
      })
    }
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSize(1)
    const query = searchTags.trim()
    const tagCount = query ? query.split(',').map(t => t.trim()).filter(Boolean).length : 0
    trackSearch({ query: query || '(empty)', rating: ratingFilter, order, tagCount })
  }

  const clearSearch = () => {
    setSearchTags("")
    setSize(1)
  }

  const toggleShowFavorites = () => {
    const next = !showFavorites
    setShowFavorites(next)
    safeTrack('toggle_favorites_view', { show: next, count: favorites.size })
  }

  const clearFavorites = () => {
    setFavorites(new Set())
    saveFavoritesToStorage(new Set())
    
    toast({
      title: "Favorites cleared",
      description: "All favorites have been removed",
    })
  }

  const decreaseScale = () => {
    const next = Math.max(1, scaleValue[0] - 1)
    setScaleValue([next])
  }

  const increaseScale = () => {
    const next = Math.min(3, scaleValue[0] + 1)
    setScaleValue([next])
  }

  // Load favorites from localStorage on mount (Unified Storage)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedFavorites = localStorage.getItem('globalBooruFavorites')
      let migrated = false
      
      const newSet = new Set<string>()

      // 1. Load Unified Format if exists
      if (savedFavorites) {
        try {
          const arr = JSON.parse(savedFavorites)
          if (Array.isArray(arr)) {
            arr.forEach(k => newSet.add(k))
          }
        } catch (e) { console.error(e) }
      }

      // 2. Migrate Legacy Danbooru (booruFavorites)
      const legacyDanbooru = localStorage.getItem('booruFavorites')
      if (legacyDanbooru) {
        try {
          const arr = JSON.parse(legacyDanbooru)
          if (Array.isArray(arr) && arr.length > 0) {
            arr.forEach(id => newSet.add(`danbooru:${id}`))
            localStorage.removeItem('booruFavorites')
            migrated = true
          }
        } catch (e) {}
      }

      // 3. Migrate Segregated Providers (e.g. booruFavorites-e621)
      const providers = ['e621', 'rule34', 'aibooru']
      providers.forEach(p => {
        const key = `booruFavorites-${p}`
        const raw = localStorage.getItem(key)
        if (raw) {
          try {
            const arr = JSON.parse(raw)
            if (Array.isArray(arr) && arr.length > 0) {
               arr.forEach(id => newSet.add(`${p}:${id}`))
               localStorage.removeItem(key)
               migrated = true
            }
          } catch(e) {}
        }
      })

      setFavorites(newSet)
      if (migrated) {
        saveFavoritesToStorage(newSet)
      }
      setFavoritesLoaded(true)
    }
  }, []) // Run only once on mount

  // Helper to save favorites
  const saveFavoritesToStorage = (newFavorites: Set<string>) => {
    if (typeof window !== 'undefined') {
      try {
        const favoritesArray = Array.from(newFavorites)
        localStorage.setItem('globalBooruFavorites', JSON.stringify(favoritesArray))
      } catch (error) {
        console.warn('Error saving favorites to localStorage:', error)
      }
    }
  }

  // Handle scroll for back to top button
  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 400)
    }

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    })
  }

  const hasMounted = useRef(false)
  
  useEffect(() => {
    if (hasMounted.current && error) {
      // Check if it's a 403 error from Aibooru
      const is403 = error.status === 403 || error.statusCode === 403
      const isAibooruError = booruProvider === 'aibooru' && is403
      
      toast({
        title: isAibooruError ? "Aibooru Access Blocked" : "Connection error",
        description: isAibooruError 
          ? "Aibooru is blocking server requests. Try Danbooru or Rule34 instead."
          : (error.message || "Could not load images"),
        variant: "destructive",
      })
    }
    hasMounted.current = true
  }, [error, toast, booruProvider])

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTags(searchTags)
    }, 500)

    return () => {
      clearTimeout(timer)
    }
  }, [searchTags])

  useEffect(() => {
    // CRITICAL FIX: Reset pagination when search parameters change
    // This ensures we start from page 1 with new search criteria
    setSize(1)
    setNoMoreResults(false)
    setLoadMoreError(false)
    setLastLoadAttempt(0)
  }, [order, ratingFilter, debouncedSearchTags, tagCountFilter, setSize])

  // Load persisted exclude tags on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('excludeTags')
        if (saved !== null) setExcludeInput(saved)
      } catch {
        // ignore
      }
    }
  }, [])

  // Load persisted add tags on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('addTags')
        if (saved !== null) setAddInput(saved)
      } catch {
        // ignore
      }
    }
  }, [])

  // Load persisted tag count filter on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('tagCountFilter')
        if (saved !== null) {
          // Strip any non-digit characters to handle migration from old format
          const cleanSaved = saved.replace(/\D/g, '')
          // Ensure minimum is 5
          const val = parseInt(cleanSaved)
          if (!isNaN(val) && val >= 5) {
            setTagCountFilter(cleanSaved)
          } else {
            setTagCountFilter("5")
          }
        }
      } catch {
        // ignore
      }
    }
  }, [])

  // Load persisted prompt option switches (includeCharacters, optimizeTags)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('promptOptions')
        if (saved) {
          const parsed = JSON.parse(saved)
            || {}
          if (typeof parsed.includeCharacters === 'boolean') setIncludeCharacters(parsed.includeCharacters)
          if (typeof parsed.optimizeTags === 'boolean') setOptimizeTags(parsed.optimizeTags)
        }
      } catch {
        // ignore parse errors
      }
    }
  }, [])

  // Persist prompt option switches whenever they change
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('promptOptions', JSON.stringify({
          includeCharacters,
            optimizeTags,
        }))
      } catch {
        // ignore
      }
    }
  }, [includeCharacters, optimizeTags])

  // Persist exclude tags whenever they change
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('excludeTags', excludeInput)
      } catch {
        // ignore
      }
    }
  }, [excludeInput])

  // Persist add tags whenever they change
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('addTags', addInput)
      } catch {
        // ignore
      }
    }
  }, [addInput])

  // Persist tag count filter whenever it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('tagCountFilter', tagCountFilter)
      } catch {
        // ignore
      }
    }
  }, [tagCountFilter])

  // Note: Filter changes are now tracked directly in the UI event handlers

  // Session & scroll tracking
  useEffect(() => {
    const start = Date.now()
    safeTrack('app_open', {
      ua: typeof navigator !== 'undefined' ? navigator.userAgent : 'na',
      w: typeof window !== 'undefined' ? window.innerWidth : 0,
    })
    const cleanupScroll = initScrollDepthTracking()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        trackTimeOnPage(start)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      trackTimeOnPage(start)
      if (cleanupScroll) cleanupScroll()
    }
  }, [])

  const getCardContentClass = () => {
    switch (effectiveScale) {
      case "small":
        return "card-content-small"
      case "medium":
        return "card-content-medium"
      case "large":
        return "card-content-large"
      default:
        return "card-content-medium"
    }
  }

  const getIconClass = () => {
    switch (effectiveScale) {
      case "small":
        return "icon-small"
      case "medium":
        return "icon-medium"
      case "large":
        return "icon-large"
      default:
        return "icon-medium"
    }
  }

  // Filter non-image posts for Masonry
  const filteredPosts = useMemo(() => {
    return posts.filter(post => {
      const fileUrl = post.large_file_url || post.file_url
      return fileUrl?.match(/\.(jpg|jpeg|png|gif|webp|avif)$/i)
    })
  }, [posts])

  const renderMasonryItem = useCallback((post: BooruPost, width: number, height: number) => {
    const excludeList = excludeInput.split(',').map(t => t.trim()).filter(Boolean)
    const addList = addInput.split(',').map(t => t.trim()).filter(Boolean)
    
    // Check if this is an Aibooru post with prompt
    const isAiPost = isAibooruPost(post)
    let aiPrompt = isAiPost ? getPromptFromPost(post) : null
    
    // Apply LoRa tag removal if option is enabled (only to original prompt)
    if (aiPrompt && removeLoRaTags) {
      aiPrompt = removeLoRaTagsUtil(aiPrompt)
    }
    
    // Apply quality tag removal if option is enabled (only to original prompt)
    if (aiPrompt && removeQualityTags) {
      aiPrompt = removeQualityTagsUtil(aiPrompt)
    }
    
    // Use AI prompt if available, but still pass through cleanPrompt to remove meta/unwanted tags
    const displayContent = aiPrompt
      ? cleanPrompt(
          aiPrompt,
          "",
          "",
          "",
          { includeCharacters, includeCopyrights: false, optimizeTags, exclude: excludeList, addedTags: addList, tagOverrides },
        )
      : cleanPrompt(
          post.tag_string,
          post.tag_string_artist,
          post.tag_string_character,
          post.tag_string_copyright,
          { includeCharacters, includeCopyrights: false, optimizeTags, exclude: excludeList, addedTags: addList, tagOverrides },
        )
    
    // Create a raw (unoptimized) version for Teach modal classification
    // This ensures we classify atomic tags (e.g. "shirt", "white shirt") instead of combined ones
    const teachContent = aiPrompt
      ? cleanPrompt(
          aiPrompt,
          "",
          "",
          "",
          { includeCharacters, includeCopyrights: false, optimizeTags: false, exclude: excludeList, tagOverrides },
        )
      : cleanPrompt(
          post.tag_string,
          post.tag_string_artist,
          post.tag_string_character,
          post.tag_string_copyright,
          { includeCharacters, includeCopyrights: false, optimizeTags: false, exclude: excludeList, tagOverrides },
        )


    // Pre-classify tags for the dropdown counts (using displayContent - respects user preference)
    const tagsForClassification = displayContent ? displayContent.split(',').map(t => t.trim()) : []
    
    // Prepare tags for Teach Modal (using teachContent - always raw/unoptimized)
    const teachTagsForClassification = teachContent ? teachContent.split(',').map(t => t.trim()) : []
    
    // Filter out character tags from classification (Teach modal)
    // We normalize both sets to lowercase spaces for comparison
    const characterTagsSet = new Set(
        (post.tag_string_character ? post.tag_string_character.split(' ') : [])
        .map(t => t.replace(/_/g, ' ').toLowerCase())
    )

    const filteredTagsForClassification = tagsForClassification.filter(t => {
        // Unescape parentheses from displayContent (e.g. "name \(source\)") to match raw tag "name (source)"
        const normalized = t.replace(/\\\(/g, "(").replace(/\\\)/g, ")").toLowerCase()
        return !characterTagsSet.has(normalized)
    })
    
    const filteredTeachTags = teachTagsForClassification.filter(t => {
        const normalized = t.replace(/\\\(/g, "(").replace(/\\\)/g, ")").toLowerCase()
        return !characterTagsSet.has(normalized)
    })

    const classifiedTags = classifyTags(filteredTagsForClassification, tagOverrides)
    const classifiedTeachTags = classifyTags(filteredTeachTags, tagOverrides)

    const copyCategory = async (category: TagCategory) => {
      if (!displayContent) return
      const subset = classifiedTags[category]
      
      if (subset.length > 0) {
        await copyToClipboard(subset.join(', '), post.id, false, post.preview_file_url)
      } else {
        toast({
           description: `No ${category} tags found`,
           variant: "destructive",
           duration: 2000
        })
      }
    }
    
    const fileUrl = post.large_file_url || post.file_url
    
    const footerHeight = SCALE_CONFIG[effectiveScale].footerHeight
    const imageHeight = height - footerHeight

    // Determine correct URL based on provider
    const itemProvider = post._provider || booruProvider
    let postUrl = `https://danbooru.donmai.us/posts/${post.id}`
    
    if (isAiPost || itemProvider === 'aibooru') {
       postUrl = `https://aibooru.online/posts/${post.id}`
    } else if (itemProvider === 'rule34') {
       postUrl = `https://rule34.xxx/index.php?page=post&s=view&id=${post.id}`
    } else if (itemProvider === 'e621') {
       postUrl = `https://e621.net/posts/${post.id}`
    }

    return (
      <Card className="w-full h-full overflow-hidden card-hover group flex flex-col">
        <div className="relative bg-muted overflow-hidden" style={{ height: imageHeight }}>
          <Image
            src={fileUrl}
            alt={`Danbooru post ${post.id}`}
            fill
            className="object-cover object-top transition-transform duration-300 group-hover:scale-105"
            sizes={`${width}px`}
            priority={false}
          />

          {/* Overlay actions */}
          <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="secondary"
                  className={`glass-effect ${effectiveScale === "small" ? "h-7 w-7" : "h-8 w-8"}`}
                  onClick={() => toggleFavorite(post.id, post._provider)}
                  aria-label={favorites.has(`${post._provider || booruProvider}:${post.id}`) ? "Remove from favorites" : "Add to favorites"}
                >
                  <Heart
                    className={`${effectiveScale === "small" ? "w-3 h-3" : "w-3.5 h-3.5"} ${favorites.has(`${post._provider || booruProvider}:${post.id}`) ? "fill-red-500 text-red-500" : ""}`}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {favorites.has(`${(post as any)._provider || booruProvider}:${post.id}`) ? "Remove from favorites" : "Add to favorites"}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="secondary"
                  className={`glass-effect ${effectiveScale === "small" ? "h-7 w-7" : "h-8 w-8"}`}
                  onClick={() => downloadImage(post)}
                  aria-label="Download image"
                >
                  <Download
                    className={`${effectiveScale === "small" ? "w-3 h-3" : "w-3.5 h-3.5"}`}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Download image (best quality)
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className={getCardContentClass()} style={{ height: footerHeight }}>
          <div className="bg-muted/50 rounded-lg overflow-y-auto prompt-container">
            <p className="text-foreground/80 leading-relaxed">{displayContent || "No content available"}</p>
          </div>

          <div className="flex button-group items-stretch isolate">
            <Button
              onClick={() => copyToClipboard(displayContent, post.id, !!aiPrompt, post.preview_file_url)}
              className="flex-1 focus-ring h-auto rounded-r-none border-r-0"
              variant={copiedId === post.id ? "default" : "outline"}
              disabled={!displayContent}
            >
              {copiedId === post.id ? (
                <>
                  <Check className={`${getIconClass()} mr-1`} />
                  {effectiveScale === "small" ? "OK" : "Copied!"}
                </>
              ) : (
                <>
                  <Copy className={`${getIconClass()} mr-1`} />
                  {effectiveScale === "small" ? "Copy" : "Copy"}
                </>
              )}
            </Button>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={copiedId === post.id ? "default" : "outline"}
                  className="px-2 focus-ring h-auto rounded-l-none"
                  disabled={!displayContent}
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Copy Options</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => copyCategory('scenery')}>
                  <Mountain className="mr-2 h-4 w-4" /> 
                  <span className="flex-1">Scenery</span>
                  <span className="ml-2 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full min-w-[1.5rem] text-center">
                    {classifiedTags.scenery.length}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => copyCategory('pose')}>
                  <User className="mr-2 h-4 w-4" /> 
                  <span className="flex-1">Pose</span>
                  <span className="ml-2 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full min-w-[1.5rem] text-center">
                    {classifiedTags.pose.length}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => copyCategory('clothing')}>
                  <Shirt className="mr-2 h-4 w-4" /> 
                  <span className="flex-1">Clothing</span>
                  <span className="ml-2 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full min-w-[1.5rem] text-center">
                    {classifiedTags.clothing.length}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => copyCategory('appearance')}>
                  <Smile className="mr-2 h-4 w-4" /> 
                  <span className="flex-1">Appearance</span>
                  <span className="ml-2 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full min-w-[1.5rem] text-center">
                    {classifiedTags.appearance.length}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  onSelect={(e) => {
                    e.preventDefault()
                    setTeachModalData({ open: true, tags: classifiedTeachTags })
                  }}
                >
                  <GraduationCap className="mr-2 h-4 w-4" />
                  Teach
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  asChild
                  className={`focus-ring bg-transparent h-auto ${effectiveScale === "small" ? "w-7" : ""}`}
                >
                  <a
                    href={postUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => trackExternalLink(postUrl,'post')}
                    aria-label="View original post"
                  >
                    <ExternalLink className={getIconClass()} />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>View original post</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </Card>
    )
  }, [effectiveScale, favorites, copiedId, excludeInput, addInput, includeCharacters, optimizeTags, removeLoRaTags, removeQualityTags, copyToClipboard, toggleFavorite, tagOverrides])

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        {/* ... existing header ... */}
        <header className="sticky top-0 z-50 w-full border-b glass-effect">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 sm:space-x-4">
                <div className="flex items-center gap-2 sm:gap-3">
                  <h1 className="text-lg sm:text-2xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent leading-tight sm:leading-normal">
                    Booru<span className="hidden sm:inline"> </span><br className="sm:hidden" />Prompt Gallery
                  </h1>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-0.5 sm:gap-3">
                    <Badge variant="secondary" className="text-[10px] sm:text-xs font-medium bg-muted/50 text-muted-foreground border-0 px-1.5 py-0 sm:px-2 sm:py-1 h-fit">
                      By Mexes
                    </Badge>
                    <button 
                      onClick={() => setShowWelcomeModal(true)}
                      className="focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full scale-90 sm:scale-100 origin-left"
                      title="Show Teach System Info"
                    >
                      <VersionDisplay />
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-1 sm:space-x-2">
                {viewMode === "grid" && (
                  <div className="flex items-center space-x-2 border-r pr-2 mr-2">
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
              </div>
            </div>
          </div>
        </header>

        <main className="container mx-auto px-4 py-8">
          <div className="max-w-4xl mx-auto mb-8 space-y-6">
            <div className="text-center space-y-2">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Discover AI Art Prompts</h2>
                <p className="text-muted-foreground max-w-2xl mx-auto text-sm sm:text-base px-4">
                  Generate prompts from Danbooru, Aibooru, and Rule34 image collections. Extract and format tags from posts or access AI-generated prompts directly, creating clean, ready-to-use prompts for your AI art generation.
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
                          href="https://civitai.com/user/Mexes"
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => trackExternalLink('https://civitai.com/user/Mexes','social')}
                          className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-muted/50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                          aria-label="Visit Mexes on CivitAI"
                        >
                          <img
                            src="https://www.google.com/s2/favicons?domain=civitai.com&sz=32"
                            alt="CivitAI"
                            className="w-6 h-6 filter grayscale hover:grayscale-0 transition-all duration-200"
                          />
                        </a>
                      </TooltipTrigger>
                      <TooltipContent>Visit Mexes on CivitAI</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <a
                          href="https://tensor.art/u/616420638671868313"
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => trackExternalLink('https://tensor.art/u/616420638671868313','social')}
                          className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-muted/50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                          aria-label="Visit Mexes on Tensor.Art"
                        >
                          <img
                            src="https://www.google.com/s2/favicons?domain=tensor.art&sz=32"
                            alt="Tensor.Art"
                            className="w-6 h-6 filter grayscale hover:grayscale-0 transition-all duration-200"
                          />
                        </a>
                      </TooltipTrigger>
                      <TooltipContent>Visit Mexes on Tensor.Art</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <a
                          href="https://www.seaart.ai/user/e9f2dc73eaf4495fce59838fea87187c?u_code=EUY1AJ3T"
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => trackExternalLink('https://www.seaart.ai/user/e9f2dc73eaf4495fce59838fea87187c?u_code=EUY1AJ3T','social')}
                          className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-muted/50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                          aria-label="Visit Mexes on SeaArt AI"
                        >
                          <img
                            src="https://www.google.com/s2/favicons?domain=seaart.ai&sz=32"
                            alt="SeaArt AI"
                            className="w-6 h-6 filter grayscale hover:grayscale-0 transition-all duration-200"
                          />
                        </a>
                      </TooltipTrigger>
                      <TooltipContent>Visit Mexes on SeaArt AI</TooltipContent>
                    </Tooltip>
                  </div>
                  
                  {/* Ko-fi Support Button */}
                  <div className="flex items-center justify-center mt-3">
                    <a
                      href="https://ko-fi.com/mexes"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => trackExternalLink('https://ko-fi.com/mexes','support')}
                      className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600 text-white text-sm font-medium rounded-full transition-all duration-200 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 shadow-lg hover:shadow-xl"
                      aria-label="Support Mexes on Ko-fi"
                    >
                      <img
                        src="https://www.google.com/s2/favicons?domain=ko-fi.com&sz=32"
                        alt="Ko-fi"
                        className="w-4 h-4 mr-2"
                      />
                      Support me on Ko-fi
                    </a>
                  </div>
                </div>
            </div>

            <Card className="glass-effect">
              <CardContent className="p-4 sm:p-6">
                <form onSubmit={handleSearch} className="space-y-6">
                  
                  {/* Top Bar: Provider Selection & Quick Actions */}
                  <div className="flex flex-col lg:flex-row gap-4 justify-between items-start lg:items-center">
                    {/* API Provider Selector */}
                    <div className="flex flex-col gap-1.5 w-full lg:w-auto">
                      <span className="text-xs font-medium text-muted-foreground ml-1">API Provider</span>
                      <div className="bg-muted/50 p-1 rounded-lg flex gap-1 w-full sm:w-auto overflow-x-auto">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            if (booruProvider === "rule34" && ratingFilter === "all") {
                              setRatingFilter(previousRatingFilter)
                              trackRatingChange(previousRatingFilter)
                            }
                            setBooruProvider("danbooru")
                            setShowFavorites(false)
                            trackProviderChange("danbooru")
                          }}
                          className={`relative h-8 text-sm px-4 flex-1 sm:flex-none ${!showFavorites && booruProvider === "danbooru" ? "text-foreground hover:bg-transparent" : "text-muted-foreground hover:text-foreground"}`}
                        >
                          {!showFavorites && booruProvider === "danbooru" && (
                            <motion.div
                              layoutId="activeProvider"
                              className="absolute inset-0 bg-background shadow-sm rounded-md"
                              transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                            />
                          )}
                          <span className="relative z-10">Danbooru</span>
                        </Button>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span tabIndex={0}> {/* Wrap in span to allow tooltip on disabled button */}
                              <Button
                                type="button"
                                variant={!showFavorites && booruProvider === "aibooru" ? "secondary" : "ghost"}
                                disabled={true}
                                onClick={() => {
                                  // Disabled
                                  /*
                                  if (booruProvider === "rule34" && ratingFilter === "all") {
                                    setRatingFilter(previousRatingFilter)
                                    trackRatingChange(previousRatingFilter)
                                  }
                                  setBooruProvider("aibooru")
                                  setShowFavorites(false)
                                  trackProviderChange("aibooru")
                                  */
                                }}
                                className={`relative h-8 text-sm px-4 flex-1 sm:flex-none opacity-50 cursor-not-allowed ${!showFavorites && booruProvider === "aibooru" ? "text-foreground" : "text-muted-foreground"}`}
                              >
                                {!showFavorites && booruProvider === "aibooru" && (
                                   <motion.div
                                     layoutId="activeProvider"
                                     className="absolute inset-0 bg-background shadow-sm rounded-md"
                                   />
                                )}
                                <span className="relative z-10">Aibooru</span>
                              </Button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Temporarily disabled due to provider issues</p>
                          </TooltipContent>
                        </Tooltip>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            if (booruProvider !== "rule34") {
                              setPreviousRatingFilter(ratingFilter)
                            }
                            setBooruProvider("rule34")
                            setRatingFilter("all")
                            setShowFavorites(false)
                            trackProviderChange("rule34")
                            trackRatingChange("all")
                          }}
                          className={`relative h-8 text-sm px-4 flex-1 sm:flex-none ${!showFavorites && booruProvider === "rule34" ? "text-foreground hover:bg-transparent" : "text-muted-foreground hover:text-foreground"}`}
                        >
                          {!showFavorites && booruProvider === "rule34" && (
                            <motion.div
                              layoutId="activeProvider"
                              className="absolute inset-0 bg-background shadow-sm rounded-md"
                              transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                            />
                          )}
                          <span className="relative z-10">Rule34</span>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            if (booruProvider === "rule34" && ratingFilter === "all") {
                              setRatingFilter(previousRatingFilter)
                              trackRatingChange(previousRatingFilter)
                            }
                            setBooruProvider("e621")
                            setShowFavorites(false)
                            trackProviderChange("e621")
                          }}
                          className={`relative h-8 text-sm px-4 flex-1 sm:flex-none ${!showFavorites && booruProvider === "e621" ? "text-foreground hover:bg-transparent" : "text-muted-foreground hover:text-foreground"}`}
                        >
                          {!showFavorites && booruProvider === "e621" && (
                            <motion.div
                              layoutId="activeProvider"
                              className="absolute inset-0 bg-background shadow-sm rounded-md"
                              transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                            />
                          )}
                          <span className="relative z-10">e621</span>
                        </Button>
                      </div>
                    </div>

                    {/* Quick Actions */}
                    <div className="flex flex-col gap-1.5 w-full lg:w-auto">
                      <span className="text-xs font-medium text-muted-foreground ml-1 lg:text-right">Settings</span>
                      <div className="flex items-center gap-2 w-full lg:w-auto justify-start lg:justify-end">
                        {isClient ? (
                          <Button
                            type="button"
                            variant={ratingFilter === "rating:general" ? "secondary" : "outline"}
                            onClick={() => {
                              const newRating = ratingFilter === "rating:general" ? "all" : "rating:general"
                              setRatingFilter(newRating)
                              trackRatingChange(newRating)
                            }}
                            className={`h-9 px-3 ${ratingFilter === "rating:general" ? "bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/50" : ""}`}
                            title="Toggle NSFW content"
                          >
                            <Shield className="w-4 h-4 mr-2" />
                            <span className="text-xs font-medium">
                              {ratingFilter === "rating:general" ? "Safe Mode" : "NSFW Allowed"}
                            </span>
                          </Button>
                        ) : (
                          <div className="w-[120px] h-9 bg-muted animate-pulse rounded-md" />
                        )}
                        
                        <Button
                          type="button"
                          variant={showFavorites ? "secondary" : "outline"}
                          onClick={toggleShowFavorites}
                          className={`h-9 px-3 ${showFavorites ? "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50" : ""}`}
                        >
                          <Heart className={`w-4 h-4 mr-2 ${showFavorites ? "fill-current" : ""}`} />
                          <span className="text-xs font-medium">Favs ({favorites.size})</span>
                        </Button>

                        <Sheet>
                          <SheetTrigger asChild>
                            <Button type="button" variant="outline" size="icon" className="h-9 w-9">
                              <History className="w-4 h-4" />
                            </Button>
                          </SheetTrigger>
                          <SheetContent className="w-[400px] sm:w-[540px]">
                            <SheetHeader>
                              <SheetTitle>Prompt History</SheetTitle>
                              <SheetDescription>Your recently copied prompts.</SheetDescription>
                            </SheetHeader>
                            <div className="mt-4 space-y-4 overflow-y-auto max-h-[calc(100vh-120px)] pr-2">
                              {history.length === 0 ? (
                                <p className="text-center text-muted-foreground py-8">No history yet</p>
                              ) : (
                                <>
                                  {history.map((item) => (
                                    <div key={item.id} className="border rounded-lg p-3 space-y-2 relative group">
                                      <div className="flex gap-3">
                                        {item.thumbnailUrl && (
                                          <div className="relative w-16 h-16 flex-shrink-0 rounded overflow-hidden bg-muted">
                                            <Image src={item.thumbnailUrl} alt="Thumbnail" fill className="object-cover" unoptimized />
                                          </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                          <p className="text-xs text-muted-foreground mb-1">{new Date(item.timestamp).toLocaleString()}</p>
                                          <p className="text-sm line-clamp-3 break-words font-mono bg-muted/50 p-1 rounded">{item.content}</p>
                                        </div>
                                      </div>
                                      <div className="flex justify-end gap-2 mt-2">
                                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => { userPreferences.removeFromHistory(item.id); setHistory(userPreferences.getHistory()) }}>
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
                      </div>
                    </div>
                  </div>

                  {/* Search Bar Section */}
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                      <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center justify-center w-5 h-5 text-muted-foreground pointer-events-none">
                        <Search className="h-5 w-5" />
                      </div>
                      <Input
                        type="text"
                        value={searchTags}
                        onChange={(e) => setSearchTags(e.target.value)}
                        placeholder={order === "recent" ? "Search tags (e.g., cat_girl, blue_eyes)..." : "Search tag..."}
                        className="pl-10 pr-10 h-11 text-base shadow-sm focus-visible:ring-offset-0"
                        aria-label="Search tags"
                        translate="no"
                      />
                      {searchTags && (
                        <button
                          type="button"
                          onClick={clearSearch}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                          aria-label="Clear search"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button type="submit" disabled={isLoading} size="lg" className="h-11 px-6 shadow-sm min-w-[100px]">
                        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Search"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={refresh}
                        disabled={isValidating}
                        className="h-11 w-11 p-0 shadow-sm"
                        title="Refresh results"
                      >
                        <RefreshCw className={`w-4 h-4 ${isValidating ? "animate-spin" : ""}`} />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setShowSettings(!showSettings)}
                        className={`h-11 w-11 p-0 shadow-sm ${showSettings ? "bg-muted" : ""}`}
                        title="Toggle settings"
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
                                Tags to Add
                              </label>
                              <div className="relative">
                                <Input
                                  id="add-tags"
                                  value={addInput}
                                  onChange={(e) => setAddInput(e.target.value)}
                                  placeholder="masterpiece, best quality..."
                                  className="h-9 text-sm bg-background/50"
                                />
                                {addInput && (
                                  <button type="button" onClick={() => setAddInput("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1">
                                    <X className="h-3 w-3" />
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="space-y-2">
                              <label htmlFor="exclude-tags" className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                                Tags to Exclude
                              </label>
                              <div className="relative">
                                <Input
                                  id="exclude-tags"
                                  value={excludeInput}
                                  onChange={(e) => setExcludeInput(e.target.value)}
                                  placeholder="bad quality, watermark..."
                                  className="h-9 text-sm bg-background/50"
                                />
                                {excludeInput && (
                                  <button type="button" onClick={() => setExcludeInput("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1">
                                    <X className="h-3 w-3" />
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="space-y-2">
                              <label htmlFor="tag-count" className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                                <span className={`w-1.5 h-1.5 rounded-full ${isTagCountSupported ? "bg-blue-500" : "bg-gray-400"}`}></span>
                                Minimum Tag Count ({`>`} X)
                              </label>
                              <div className="relative">
                                <Input
                                  id="tag-count"
                                  type="number"
                                  min={5}
                                  value={tagCountFilter}
                                  onChange={(e) => setTagCountFilter(e.target.value)}
                                  onBlur={() => {
                                    const val = parseInt(tagCountFilter)
                                    if (!tagCountFilter || isNaN(val) || val < 5) {
                                      setTagCountFilter("5")
                                    }
                                  }}
                                  placeholder="e.g. 5"
                                  disabled={!isTagCountSupported}
                                  className={`h-9 text-sm bg-background/50 ${!isTagCountValid ? "border-red-500 focus-visible:ring-red-500" : ""} ${!isTagCountSupported ? "opacity-50 cursor-not-allowed" : ""}`}
                                />
                                {tagCountFilter && tagCountFilter !== "5" && isTagCountSupported && (
                                  <button type="button" onClick={() => setTagCountFilter("5")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1">
                                    <X className="h-3 w-3" />
                                  </button>
                                )}
                              </div>
                              {!isTagCountSupported ? (
                                <p className="text-[10px] text-muted-foreground italic">
                                  Only supported on Danbooru
                                </p>
                              ) : !isTagCountValid ? (
                                <p className="text-[10px] text-red-500">
                                  Invalid format. Use numbers only (minimum 5).
                                </p>
                              ) : (
                                <p className="text-[10px] text-muted-foreground">
                                  Shows posts with more than X tags (min 5).
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Options & Switches */}
                          <div className="space-y-4">
                            <span className="text-xs font-medium text-muted-foreground block">
                              {booruProvider === 'aibooru' ? 'Aibooru Options' : 'Prompt Generation Options'}
                            </span>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {booruProvider === 'danbooru' || booruProvider === 'rule34' || booruProvider === 'e621' ? (
                                <>
                                  <label className="flex items-center justify-between sm:justify-start gap-3 cursor-pointer p-2 rounded-md hover:bg-muted/50 transition-colors border border-transparent hover:border-border/50 sm:col-span-2">
                                    <span className="text-sm select-none">Include Characters</span>
                                    <Switch
                                      checked={includeCharacters}
                                      onCheckedChange={(v) => {
                                        setIncludeCharacters(v)
                                        if (booruProvider === 'rule34') trackRule34Option('include_characters', v)
                                        else if (booruProvider === 'e621') trackE621Option('include_characters', v)
                                        else trackDanbooruOption('include_characters', v)
                                      }}
                                      className="scale-90"
                                    />
                                  </label>
                                  <label className="flex items-center justify-between sm:justify-start gap-3 cursor-pointer p-2 rounded-md hover:bg-muted/50 transition-colors border border-transparent hover:border-border/50 sm:col-span-2">
                                    <span className="text-sm select-none">Smart Tag Combination</span>
                                    <Switch
                                      checked={optimizeTags}
                                      onCheckedChange={(v) => {
                                        setOptimizeTags(v)
                                        if (booruProvider === 'rule34') trackRule34Option('optimize_tags', v)
                                        else if (booruProvider === 'e621') trackE621Option('optimize_tags', v)
                                        else trackDanbooruOption('optimize_tags', v)
                                      }}
                                      className="scale-90"
                                    />
                                  </label>
                                </>
                              ) : (
                                <>
                                  <label className="flex items-center justify-between sm:justify-start gap-3 cursor-pointer p-2 rounded-md hover:bg-muted/50 transition-colors border border-transparent hover:border-border/50 sm:col-span-2">
                                    <span className="text-sm select-none">Remove LoRa Tags</span>
                                    <Switch
                                      checked={removeLoRaTags}
                                      onCheckedChange={(v) => {
                                        setRemoveLoRaTags(v)
                                        trackAibooruOption('remove_lora_tags', v)
                                      }}
                                      className="scale-90"
                                    />
                                  </label>
                                  <label className="flex items-center justify-between sm:justify-start gap-3 cursor-pointer p-2 rounded-md hover:bg-muted/50 transition-colors border border-transparent hover:border-border/50 sm:col-span-2">
                                    <span className="text-sm select-none">Remove Quality Tags</span>
                                    <Switch
                                      checked={removeQualityTags}
                                      onCheckedChange={(v) => {
                                        setRemoveQualityTags(v)
                                        trackAibooruOption('remove_quality_tags', v)
                                      }}
                                      className="scale-90"
                                    />
                                  </label>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  {/* Status & Alerts */}
                  <div className="space-y-2">
                    {getFinalQueryTags(searchTags, ratingFilter, order, tagCountFilter, booruProvider).length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground bg-muted/20 p-2 rounded-md border border-border/30">
                        <span className="font-medium">Active Query:</span>
                        {getFinalQueryTags(searchTags, ratingFilter, order, tagCountFilter, booruProvider).map((tag, index) => (
                          <Badge key={index} variant="secondary" className="text-[10px] px-1.5 py-0 h-5 font-mono">
                            {tag}
                          </Badge>
                        ))}
                        {booruProvider === "aibooru" && hasPromptFilter && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 text-green-600 border-green-200 bg-green-50 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400">
                            has:prompt
                          </Badge>
                        )}
                      </div>
                    )}
                    
                    {hasMultipleTags(searchTags, order, 0) && (
                      <Alert variant="destructive" className="py-2">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription className="text-xs">
                          Danbooru API limit: Only first {(order === 'recent' && !/order:|random:/i.test(searchTags)) ? 2 : 1} user tags will be used.
                        </AlertDescription>
                      </Alert>
                    )}
                    
                    {/* Warning for order:random timeouts */}
                    {/order:random|random:\d+/i.test(searchTags) && (
                      <Alert className="py-2 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
                        <RefreshCw className="h-4 w-4 text-blue-500" />
                        <AlertDescription className="text-xs text-blue-700 dark:text-blue-300">
                          Random mode active: Fetching 20 random posts. Refresh to get new ones.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>

          {/* Gallery */}
          {viewMode === "grid" ? (
            <div className="mb-8 min-h-[500px]">
              <MasonryGrid
                items={filteredPosts}
                scale={effectiveScale}
                renderItem={renderMasonryItem}
              />
            </div>
          ) : (
            /* List View */
            <div className="space-y-4 mb-8">
              {posts.map((post: BooruPost, index: number) => {
                const excludeList = excludeInput.split(',').map(t => t.trim()).filter(Boolean)
                const addList = addInput.split(',').map(t => t.trim()).filter(Boolean)
                
                // Check if this is an Aibooru post with prompt
                const isAiPost = isAibooruPost(post)
                let aiPrompt = isAiPost ? getPromptFromPost(post) : null
                
                // Apply LoRa tag removal if option is enabled (only to original prompt)
                if (aiPrompt && removeLoRaTags) {
                  aiPrompt = removeLoRaTagsUtil(aiPrompt)
                }
                
                // Apply quality tag removal if option is enabled (only to original prompt)
                if (aiPrompt && removeQualityTags) {
                  aiPrompt = removeQualityTagsUtil(aiPrompt)
                }
                
                // Use AI prompt if available, but still pass through cleanPrompt to remove meta/unwanted tags
    const displayContent = aiPrompt
      ? cleanPrompt(
          aiPrompt,
          "",
          "",
          "",
          { includeCharacters, includeCopyrights: false, optimizeTags, exclude: excludeList, addedTags: addList, tagOverrides },
        )
      : cleanPrompt(
          post.tag_string,
          post.tag_string_artist,
          post.tag_string_character,
          post.tag_string_copyright,
          { includeCharacters, includeCopyrights: false, optimizeTags, exclude: excludeList, addedTags: addList, tagOverrides },
        )
                
                // Exclusions are already applied via cleanPrompt
                
                // Create a raw (unoptimized) version for Teach modal classification
                const teachContent = aiPrompt
                  ? cleanPrompt(
                      aiPrompt,
                      "",
                      "",
                      "",
                      { includeCharacters, includeCopyrights: false, optimizeTags: false, exclude: excludeList, tagOverrides },
                    )
                  : cleanPrompt(
                      post.tag_string,
                      post.tag_string_artist,
                      post.tag_string_character,
                      post.tag_string_copyright,
                      { includeCharacters, includeCopyrights: false, optimizeTags: false, exclude: excludeList, tagOverrides },
                    )

                
                // Pre-classify tags for the dropdown counts
                const tagsForClassification = displayContent ? displayContent.split(',').map(t => t.trim()) : []
                const teachTagsForClassification = teachContent ? teachContent.split(',').map(t => t.trim()) : []

                // Filter out character tags from classification (Teach modal)
                // We normalize both sets to lowercase spaces for comparison
                const characterTagsSet = new Set(
                    (post.tag_string_character ? post.tag_string_character.split(' ') : [])
                    .map(t => t.replace(/_/g, ' ').toLowerCase())
                )

                const filteredTagsForClassification = tagsForClassification.filter(t => {
                    // Unescape parentheses from displayContent (e.g. "name \(source\)") to match raw tag "name (source)"
                    const normalized = t.replace(/\\\(/g, "(").replace(/\\\)/g, ")").toLowerCase()
                    return !characterTagsSet.has(normalized)
                })

                const filteredTeachTags = teachTagsForClassification.filter(t => {
                    const normalized = t.replace(/\\\(/g, "(").replace(/\\\)/g, ")").toLowerCase()
                    return !characterTagsSet.has(normalized)
                })

                const classifiedTags = classifyTags(filteredTagsForClassification, tagOverrides)
                const classifiedTeachTags = classifyTags(filteredTeachTags, tagOverrides)
                
                const fileUrl = post.large_file_url || post.file_url
                const isImage = fileUrl?.match(/\.(jpg|jpeg|png|gif|webp|avif)$/i)
                if (!isImage) return null

                // If viewing favorites, allow any provider's favorite to be toggled
                // If browsing search results, assume current provider
                // However, our favorite toggle logic now uses provider prefix: "provider:id"
                const itemProvider = showFavorites && post._provider ? post._provider : booruProvider 
                const isFavorited = favorites.has(`${itemProvider}:${post.id}`)

                // Determine correct URL based on provider
                let postUrl = `https://danbooru.donmai.us/posts/${post.id}`
                if (isAiPost || itemProvider === 'aibooru') {
                   postUrl = `https://aibooru.online/posts/${post.id}`
                } else if (itemProvider === 'rule34') {
                   postUrl = `https://rule34.xxx/index.php?page=post&s=view&id=${post.id}`
                } else if (itemProvider === 'e621') {
                   postUrl = `https://e621.net/posts/${post.id}`
                }

                return (
                  <Card key={`${post.id}-${index}`} className="overflow-hidden card-hover">
                    <CardContent className="p-4 sm:p-6">
                      <div className="flex flex-col sm:flex-row gap-4 sm:gap-6">
                        <div 
                           className="image-container-list-2-3 mx-auto sm:mx-0 relative group cursor-pointer"
                           onDoubleClick={() => toggleFavorite(post.id, itemProvider)}
                        >
                          <div className="absolute top-1 right-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                             <Button
                              size="icon"
                              variant="secondary"
                              className={`h-6 w-6 rounded-full shadow-sm ${isFavorited ? 'text-red-500 bg-white' : 'text-muted-foreground bg-white/80'}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleFavorite(post.id, itemProvider)
                              }}
                            >
                              <Heart className={`h-3 w-3 ${isFavorited ? "fill-current" : ""}`} />
                            </Button>
                          </div>
                          <Image
                            src={fileUrl}
                            alt={`Danbooru post ${post.id}`}
                            fill
                            className="object-cover"
                            sizes="128px"
                          />
                        </div>

                        <div className="flex-1 space-y-3">
                          <div className="flex items-start justify-between">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-xs">ID: {post.id}</Badge>
                              </div>
                            </div>

                            <div className="flex gap-2">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => toggleFavorite(post.id)}
                                    className="focus-ring h-8 w-8"
                                    aria-label={favorites.has(post.id) ? "Remove from favorites" : "Add to favorites"}
                                  >
                                    <Heart
                                      className={`h-4 w-4 ${favorites.has(post.id) ? "fill-red-500 text-red-500" : ""}`}
                                    />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {favorites.has(post.id) ? "Remove from favorites" : "Add to favorites"}
                                </TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => downloadImage(post)}
                                    className="focus-ring h-8 w-8"
                                    aria-label="Download image"
                                  >
                                    <Download className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  Download image (best quality)
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          </div>

                          <div className="bg-muted/50 p-3 rounded-lg max-h-20 overflow-y-auto">
                            <p className="text-sm text-foreground/80 leading-relaxed">
                              {displayContent || "No content available"}
                            </p>
                          </div>

                          <div className="flex flex-col sm:flex-row gap-2">
                            <Button
                              onClick={() => copyToClipboard(displayContent, post.id, !!aiPrompt, post.preview_file_url)}
                              variant={copiedId === post.id ? "default" : "outline"}
                              disabled={!displayContent}
                              className="focus-ring flex-1 sm:flex-none"
                            >
                              {copiedId === post.id ? (
                                <>
                                  <Check className="w-4 h-4 mr-2" />
                                  Copied!
                                </>
                              ) : (
                                <>
                                  <Copy className="w-4 h-4 mr-2" />
                                  Copy Prompt
                                </>
                              )}
                            </Button>
                            
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="outline"
                                  className="px-3 focus-ring"
                                  disabled={!displayContent}
                                >
                                  <ChevronDown className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuLabel>Copy Options</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={async () => {
                                  if (!displayContent) return
                                  const subset = classifiedTags.scenery
                                  if (subset.length > 0) {
                                    await copyToClipboard(subset.join(', '), post.id, false, post.preview_file_url)
                                  } else {
                                    toast({ description: "No scenery tags found", variant: "destructive" })
                                  }
                                }}>
                                  <Mountain className="mr-2 h-4 w-4" /> 
                                  <span className="flex-1">Scenery</span>
                                  <span className="ml-2 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full min-w-[1.5rem] text-center">
                                    {classifiedTags.scenery.length}
                                  </span>
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={async () => {
                                  if (!displayContent) return
                                  const subset = classifiedTags.pose
                                  if (subset.length > 0) {
                                    await copyToClipboard(subset.join(', '), post.id, false, post.preview_file_url)
                                  } else {
                                    toast({ description: "No pose tags found", variant: "destructive" })
                                  }
                                }}>
                                  <User className="mr-2 h-4 w-4" /> 
                                  <span className="flex-1">Pose</span>
                                  <span className="ml-2 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full min-w-[1.5rem] text-center">
                                    {classifiedTags.pose.length}
                                  </span>
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={async () => {
                                  if (!displayContent) return
                                  const subset = classifiedTags.clothing
                                  if (subset.length > 0) {
                                    await copyToClipboard(subset.join(', '), post.id, false, post.preview_file_url)
                                  } else {
                                    toast({ description: "No clothing tags found", variant: "destructive" })
                                  }
                                }}>
                                  <Shirt className="mr-2 h-4 w-4" /> 
                                  <span className="flex-1">Clothing</span>
                                  <span className="ml-2 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full min-w-[1.5rem] text-center">
                                    {classifiedTags.clothing.length}
                                  </span>
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={async () => {
                                  if (!displayContent) return
                                  const subset = classifiedTags.appearance
                                  if (subset.length > 0) {
                                    await copyToClipboard(subset.join(', '), post.id, false, post.preview_file_url)
                                  } else {
                                    toast({ description: "No appearance tags found", variant: "destructive" })
                                  }
                                }}>
                                  <Smile className="mr-2 h-4 w-4" /> 
                                  <span className="flex-1">Appearance</span>
                                  <span className="ml-2 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full min-w-[1.5rem] text-center">
                                    {classifiedTags.appearance.length}
                                  </span>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem 
                                  onSelect={(e) => {
                                    e.preventDefault()
                                    setTeachModalData({ open: true, tags: classifiedTeachTags })
                                  }}
                                >
                                  <GraduationCap className="mr-2 h-4 w-4" />
                                  Teach
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>

                            <Button variant="outline" asChild className="focus-ring bg-transparent flex-1 sm:flex-none">
                              <a
                                href={postUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => trackExternalLink(postUrl,'post')}
                              >
                                <ExternalLink className="w-4 h-4 mr-2" />
                                View Original
                              </a>
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}

          {/* Load More / Get New Results Button */}
          {posts.length > 0 && !showFavorites && (
            <div className="text-center">
              <Button 
                onClick={loadMore} 
                disabled={isLoadingLock || isLoadingMore || (noMoreResults && !loadMoreError) || (isReachingEnd && !loadMoreError)} 
                size="lg" 
                className="px-8 focus-ring"
                variant={(noMoreResults && !loadMoreError) || (isReachingEnd && !loadMoreError) ? "outline" : loadMoreError ? "destructive" : "default"}
              >
                {isLoadingMore ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Loading more...
                  </>
                ) : loadMoreError ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Retry
                  </>
                ) : (noMoreResults || isReachingEnd) ? (
                  <>
                    <AlertTriangle className="w-4 h-4 mr-2" />
                    No more results
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-2" />
                    Load More
                  </>
                )}
              </Button>
              {(noMoreResults && !loadMoreError) && (
                <div className="mt-4 space-y-3">
                  <p className="text-xs text-muted-foreground max-w-md mx-auto">
                    Try changing the rating filter or use different search terms to find more content
                  </p>
                  {searchTags.trim() && (
                    <div className="flex flex-col sm:flex-row gap-2 justify-center">
                      <Button onClick={clearSearch} variant="outline" size="sm" className="focus-ring bg-transparent">
                        Clear Search
                      </Button>
                    </div>
                  )}
                </div>
              )}
              {loadMoreError && (
                <div className="mt-4 space-y-3">
                  <p className="text-xs text-muted-foreground max-w-md mx-auto">
                    There was a problem loading more posts. Click &apos;Retry&apos; to try again.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Loading State */}
          {((isLoading && posts.length === 0 && !showFavorites) || (showFavorites && favoritesLoading)) && (
            <div className="text-center py-12">
              <div className="space-y-4">
                <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
                <div className="space-y-2">
                  <p className="text-base sm:text-lg font-medium">
                    {showFavorites ? "Loading favorites..." : "Loading images..."}
                  </p>
                  <p className="text-xs sm:text-sm text-muted-foreground px-4">
                    {showFavorites ? "Fetching your favorite posts" : "Fetching the latest content from Danbooru"}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && !favoritesLoading && posts.length === 0 && (
            <div className="text-center py-12 px-4">
              <div className="space-y-4">
                <div className="text-4xl sm:text-6xl">{showFavorites ? "♥" : "*"}</div>
                <div className="space-y-2">
                  <p className="text-base sm:text-lg font-medium">
                    {showFavorites ? "No favorites yet" : "No images found"}
                  </p>
                  <p className="text-xs sm:text-sm text-muted-foreground max-w-md mx-auto">
                    {showFavorites 
                      ? "Add images to your favorites by clicking the heart icon on any image"
                      : "Try adjusting your search terms or filters to discover more content"
                    }
                  </p>
                </div>
                {showFavorites ? (
                  <Button onClick={() => setShowFavorites(false)} variant="outline" className="focus-ring bg-transparent">
                    Browse All Images
                  </Button>
                ) : searchTags.trim() ? (
                  <Button onClick={clearSearch} variant="outline" className="focus-ring bg-transparent">
                    Clear Search
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </main>

        {/* Footer */}
        <footer className="border-t bg-muted/30 mt-16">
          <div className="container mx-auto px-4 py-6 sm:py-8">
            <div className="text-center space-y-4">
              <div className="flex items-center justify-center space-x-2">
                <span className="text-xs sm:text-sm text-muted-foreground">Powered by</span>
                <Badge variant="outline" className="text-xs">Danbooru API</Badge>
                <Badge variant="outline" className="text-xs">Aibooru API</Badge>
              </div>
              <p className="text-xs text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                Generate clean prompts from Danbooru and Aibooru posts. Extract and format tags from images, remove unnecessary metadata, LoRa tags, and quality descriptors to create ready-to-use prompts for AI art generation. All images are sourced from their respective platforms and belong to their creators.
              </p>
            </div>
          </div>
        </footer>



        {/* Back to Top Button */}
        <div className={`fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 transition-all duration-500 ${
          showBackToTop 
            ? 'opacity-100 translate-y-0 scale-100' 
            : 'opacity-0 translate-y-4 scale-75 pointer-events-none'
        }`}>
          <Button
            onClick={scrollToTop}
            className="h-10 w-10 sm:h-12 sm:w-12 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 focus-ring hover:scale-110 active:scale-95"
            size="icon"
            aria-label="Back to top"
          >
            <ChevronUp className="h-4 w-4 sm:h-5 sm:w-5 transition-transform duration-200 hover:animate-bounce" />
          </Button>
        </div>
        

      </div>
      {/* Global Teach Modal */}
      {teachModalData.tags && (
        <TeachModal 
          open={teachModalData.open} 
          onOpenChange={(open) => setTeachModalData(prev => ({ ...prev, open }))}
          initialClassifiedTags={teachModalData.tags}
        />
      )}
      <TeachWelcomeModal triggerOpen={showWelcomeModal} />
    </TooltipProvider>
  )
}

// ... existing code ...
