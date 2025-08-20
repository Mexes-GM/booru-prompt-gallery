"use client"

import type React from "react"
import { useState, useEffect, useRef } from "react"
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
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import Image from "next/image"
import { useInfinitePosts, useFavoritePosts, hasMultipleTags, getFinalQueryTags, BooruPost, BooruProvider, isAibooruPost, getPromptFromPost, removeLoRaTags as removeLoRaTagsUtil, removeQualityTags as removeQualityTagsUtil } from "@/lib/api-client"
import { userPreferences } from "@/lib/storage"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Slider } from "@/components/ui/slider"
import { cleanPrompt } from "@/lib/cleanPrompt"
import { Switch } from "@/components/ui/switch"
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
  trackFilterChange,
  trackRefresh,
} from '@/lib/analytics'

// Using BooruPost from api-client instead of local interface

type CardScale = "small" | "medium" | "large"

export default function DanbooruPromptGenerator() {
  const [searchTags, setSearchTags] = useState("")
  const [debouncedSearchTags, setDebouncedSearchTags] = useState("")
  const [ratingFilter, setRatingFilter] = useState("rating:general")
  const [order, setOrder] = useState<"popular" | "recent" | "random">("popular")
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [cardScale, setCardScale] = useState<CardScale>("medium")
  const [scaleValue, setScaleValue] = useState([2])
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [favorites, setFavorites] = useState<Set<number>>(new Set())
  const [favoritesLoaded, setFavoritesLoaded] = useState(false)
  const [showFavorites, setShowFavorites] = useState(false)
  const [showBackToTop, setShowBackToTop] = useState(false)
  const [noMoreResults, setNoMoreResults] = useState(false)
  const [lastLoadAttempt, setLastLoadAttempt] = useState(0)
  const [randomSeed, setRandomSeed] = useState<number>(Date.now())
  const [includeCharacters, setIncludeCharacters] = useState(true)
  const [includeCopyrights, setIncludeCopyrights] = useState(true)
  const [optimizeTags, setOptimizeTags] = useState(true) // UI toggle para combinacion/optimizacion de tags
  const [excludeInput, setExcludeInput] = useState("") // entrada de tags a excluir
  const [booruProvider, setBooruProvider] = useState<BooruProvider>('aibooru')
  const [hasPromptFilter, setHasPromptFilter] = useState(false)
  const [removeLoRaTags, setRemoveLoRaTags] = useState(false)
  const [removeQualityTags, setRemoveQualityTags] = useState(false)
  const [isClient, setIsClient] = useState(false)
  const { toast } = useToast()

  // Load user preferences from localStorage on client mount
  useEffect(() => {
    setIsClient(true)
    const savedProvider = userPreferences.getBooruProvider()
    const savedRemoveLoRa = userPreferences.getRemoveLoRaTags()
    const savedRemoveQuality = userPreferences.getRemoveQualityTags()
    const savedRatingFilter = userPreferences.getRatingFilter()
    const savedOrder = userPreferences.getOrder()
    
    setBooruProvider(savedProvider)
    setRemoveLoRaTags(savedRemoveLoRa)
    setRemoveQualityTags(savedRemoveQuality)
    setRatingFilter(savedRatingFilter)
    setOrder(savedOrder)
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

  // Save order preference
  useEffect(() => {
    if (isClient) {
      userPreferences.setOrder(order)
    }
  }, [order, isClient])

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
  } = useInfinitePosts(debouncedSearchTags, ratingFilter, order, randomSeed, booruProvider, hasPromptFilter)

  // Fetch favorite posts separately
  const {
    posts: favoritePosts,
    error: favoritesError,
    isLoading: favoritesLoading,
    mutate: mutateFavorites,
  } = useFavoritePosts(Array.from(favorites))



  // Ensure initial load
  useEffect(() => {
    if (size === 0 && !isLoading) {
      setSize(1)
    }
  }, [size, isLoading, setSize])

  const allPosts = pages ? pages.flat() : []
  // Use dedicated favorites API when showing favorites
  const posts = showFavorites ? (favoritePosts || []) : allPosts
  

  const isLoadingMore = isValidating && size > 1
  
  const loadMore = () => {
    const currentPostCount = posts.length
    setLastLoadAttempt(currentPostCount)
    
  if (order === 'random') {
      // Generate new random seed to force new results
      setRandomSeed(Date.now())
      setSize(1)
      mutate(undefined, { revalidate: true })
    } else {
      setSize(size + 1)
    }
  trackLoadMore({ order, nextPage: order === 'random' ? 1 : size + 1, currentCount: currentPostCount })
  }
  
  const refresh = () => {
    mutate(undefined, { revalidate: true })
    trackRefresh(order)
  }

  useEffect(() => {
    if (order === 'random') return
    
    if (lastLoadAttempt > 0 && !isLoadingMore && posts.length === lastLoadAttempt) {
      setNoMoreResults(true)
      toast({
        title: "No more results",
        description: order === "popular" 
          ? "No more popular posts found for this search. Try different search terms, switch to 'Most recent', or change the rating filter."
          : "No more recent posts found for this search. Try different search terms or change the rating filter.",
        variant: "default",
      })
      setLastLoadAttempt(0)
    } else if (lastLoadAttempt > 0 && posts.length > lastLoadAttempt) {
      setNoMoreResults(false)
      setLastLoadAttempt(0)
    }
  }, [posts.length, isLoadingMore, lastLoadAttempt, order, toast])

  useEffect(() => {
    setNoMoreResults(false)
    setLastLoadAttempt(0)
    // Reset random seed when search parameters change
    if (order === 'random') {
      setRandomSeed(Date.now())
    }
  }, [searchTags, ratingFilter, order])

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

  const copyToClipboard = async (content: string, postId: number, isPrompt: boolean = false) => {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedId(postId)
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

  const toggleFavorite = (postId: number) => {
    const isCurrentlyFavorited = favorites.has(postId)
    
    setFavorites((prev) => {
      const newFavorites = new Set(prev)
      if (newFavorites.has(postId)) {
        newFavorites.delete(postId)
      } else {
        newFavorites.add(postId)
      }
      return newFavorites
    })
    
    if (isCurrentlyFavorited) {
      toast({
        title: "Removed from favorites",
        description: "Image removed from your favorites",
      })
      trackFavorite(postId, 'remove')
    } else {
      toast({
        title: "Added to favorites",
        description: "Image added to your favorites",
      })
      trackFavorite(postId, 'add')
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
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('booruFavorites')
      } catch (error) {
        console.warn('Error clearing favorites from localStorage:', error)
      }
    }
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

  // Load favorites from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedFavorites = localStorage.getItem('booruFavorites')
      
      if (savedFavorites) {
        try {
          const favoritesArray = JSON.parse(savedFavorites)
          
          if (Array.isArray(favoritesArray)) {
            const favoritesSet = new Set(favoritesArray)
            setFavorites(favoritesSet)
          }
        } catch (error) {
          setFavorites(new Set())
        }
      }
      setFavoritesLoaded(true)
    }
  }, [])

  // Save favorites to localStorage whenever they change (only after initial load)
  useEffect(() => {
    if (typeof window !== 'undefined' && favoritesLoaded) {
      try {
        const favoritesArray = Array.from(favorites)
        localStorage.setItem('booruFavorites', JSON.stringify(favoritesArray))
      } catch (error) {
        console.warn('Error saving favorites to localStorage:', error)
      }
    }
  }, [favorites, favoritesLoaded])

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
      if (error.status === 422 && order === "random") {
        toast({
          title: "Random search timeout",
          description: "Random searches can be slow. Try using more specific tags or switch to 'Most recent' for faster results.",
          variant: "destructive",
        })
      } else {
        toast({
          title: "Connection error",
          description: error.message || "Could not load images",
          variant: "destructive",
        })
      }
    }
    hasMounted.current = true
  }, [error, toast, order])

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTags(searchTags)
    }, 500)

    return () => {
      clearTimeout(timer)
    }
  }, [searchTags])

  useEffect(() => {
    setSize(1)
  }, [order, ratingFilter, debouncedSearchTags])

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

  // Load persisted prompt option switches (includeCharacters, includeCopyrights, optimizeTags)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('promptOptions')
        if (saved) {
          const parsed = JSON.parse(saved)
            || {}
          if (typeof parsed.includeCharacters === 'boolean') setIncludeCharacters(parsed.includeCharacters)
          if (typeof parsed.includeCopyrights === 'boolean') setIncludeCopyrights(parsed.includeCopyrights)
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
          includeCopyrights,
            optimizeTags,
        }))
      } catch {
        // ignore
      }
    }
  }, [includeCharacters, includeCopyrights, optimizeTags])

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

  // Track filter changes
  useEffect(() => { trackFilterChange('rating', ratingFilter) }, [ratingFilter])
  useEffect(() => { trackFilterChange('order', order) }, [order])
  useEffect(() => { trackFilterChange('include_characters', String(includeCharacters)) }, [includeCharacters])
  useEffect(() => { trackFilterChange('include_copyrights', String(includeCopyrights)) }, [includeCopyrights])
  useEffect(() => { trackFilterChange('optimize_tags', String(optimizeTags)) }, [optimizeTags])

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

  const getGridClass = () => {
    switch (cardScale) {
      case "small":
        return "grid-small"
      case "medium":
        return "grid-medium"
      case "large":
        return "grid-large"
      default:
        return "grid-medium"
    }
  }

  const getCardContentClass = () => {
    switch (cardScale) {
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

  const getBadgeClass = () => {
    switch (cardScale) {
      case "small":
        return "badge-small"
      case "medium":
        return "badge-medium"
      case "large":
        return "badge-large"
      default:
        return "badge-medium"
    }
  }

  const getIconClass = () => {
    switch (cardScale) {
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

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-50 w-full border-b glass-effect">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-3">
                  <h1 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                    Booru Prompt Gallery
                  </h1>
                  <Badge variant="secondary" className="text-xs font-medium bg-muted/50 text-muted-foreground border-0 px-2 py-1">
                    By Mexes
                  </Badge>
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
              </div>
            </div>
          </div>
        </header>

        <main className="container mx-auto px-4 py-8">
          <div className="max-w-4xl mx-auto mb-8 space-y-6">
            <div className="text-center space-y-2">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Discover AI Art Prompts</h2>
                <p className="text-muted-foreground max-w-2xl mx-auto text-sm sm:text-base px-4">
                  Generate prompts from Danbooru and Aibooru image collections. Extract and format tags from posts or access AI-generated prompts directly, creating clean, ready-to-use prompts for your AI art generation.
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
                <form onSubmit={handleSearch} className="space-y-4">

                  {getFinalQueryTags(searchTags, ratingFilter, order).length > 0 && (
                    <div className="mb-4">
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground mb-2">
                        <span className="font-medium">Sending to {booruProvider === "danbooru" ? "Danbooru" : "Aibooru"} API:</span>
                        {getFinalQueryTags(searchTags, ratingFilter, order).map((tag, index) => (
                          <Badge key={index} variant="outline" className="bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-950/50 dark:border-blue-800/50 dark:text-blue-300 text-xs">
                            {tag}
                          </Badge>
                        ))}
                        {booruProvider === "aibooru" && hasPromptFilter && (
                          <Badge variant="outline" className="bg-green-50 border-green-200 text-green-700 dark:bg-green-950/50 dark:border-green-800/50 dark:text-green-300 text-xs">
                            has:prompt
                          </Badge>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Search bar with rating/order/favorites aligned to the right */}
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col lg:flex-row gap-3 items-stretch">
                      {/* Search input */}
                      <div className="relative flex-1 min-w-[220px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
                        <Input
                          type="text"
                          value={searchTags}
                          onChange={(e) => setSearchTags(e.target.value)}
                          placeholder={order === "recent" ? "Search by up to 2 tags (e.g., cat_girl, blue_eyes)" : order === "random" ? "Search by one tag only (e.g., cat_girl)" : "Search by one tag only (e.g., cat_girl)"}
                          className="pl-10 pr-10 focus-ring text-sm sm:text-base h-10"
                          aria-label="Search tags"
                        />
                        {searchTags && (
                          <button
                            type="button"
                            onClick={clearSearch}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-sm"
                            aria-label="Clear search"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>

                      {/* Controls to the right of search */}
                      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 w-full lg:w-auto">
                        <div className="flex flex-col xs:flex-row sm:flex-row gap-2 sm:gap-3 w-full lg:w-auto">
                          {isClient ? (
                            <Select value={ratingFilter} onValueChange={setRatingFilter}>
                              <SelectTrigger className="w-full sm:w-[130px] focus-ring h-10">
                                <SelectValue placeholder="Content rating" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="rating:general">General</SelectItem>
                                <SelectItem value="rating:sensitive">Sensitive</SelectItem>
                                <SelectItem value="rating:questionable">Questionable</SelectItem>
                                <SelectItem value="rating:explicit">Explicit</SelectItem>
                                <SelectItem value="all">No filter (All)</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <div className="w-full sm:w-[130px] h-10 bg-muted animate-pulse rounded-md" />
                          )}
                          {isClient ? (
                            <Select value={order} onValueChange={(value: "popular" | "recent" | "random") => setOrder(value)}>
                              <SelectTrigger className="w-full sm:w-[130px] focus-ring h-10">
                                <SelectValue placeholder="Sort by" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="popular">Most popular</SelectItem>
                                <SelectItem value="recent">Most recent</SelectItem>
                                <SelectItem value="random">Random</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <div className="w-full sm:w-[130px] h-10 bg-muted animate-pulse rounded-md" />
                          )}
                          <Button
                            type="button"
                            variant={showFavorites ? "default" : "outline"}
                            onClick={toggleShowFavorites}
                            className="focus-ring w-full sm:w-auto h-10"
                            aria-label="Toggle favorites"
                          >
                            <Heart className={`w-4 h-4 mr-2 ${showFavorites ? "fill-white" : ""}`} />
                            <span className="whitespace-nowrap">Favs ({favorites.size})</span>
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Exclude Tags Input + Prompt Options (label + input wrapped) */}
                  <div className="space-y-2">
                    <div className="flex flex-col lg:flex-row gap-4 items-start">
                      {/* Left column: label + input constrained together */}
                      <div className="flex-1 min-w-[240px] w-full">
                        <div className="w-full">
                          <label htmlFor="exclude-tags" className="block text-xs font-medium text-muted-foreground mb-2">
                            Tags to remove (comma separated)
                          </label>
                          <div className="relative">
                            <Input
                              id="exclude-tags"
                              type="text"
                              value={excludeInput}
                              onChange={(e) => setExcludeInput(e.target.value)}
                              placeholder="1girl, full body"
                              className="focus-ring text-xs sm:text-sm pr-10 h-10"
                              aria-label="Tags to exclude"
                            />
                            {excludeInput && (
                              <button
                                type="button"
                                onClick={() => setExcludeInput("")}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-sm"
                                aria-label="Clear exclusions"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                      {/* Right column: Options */}
                      <div className="flex flex-col gap-2 lg:min-w-[340px] w-full lg:w-auto">
                        <span className="text-xs font-medium text-muted-foreground">
                          {booruProvider === 'aibooru' ? 'Aibooru Options' : 'Prompt Options'}
                        </span>
                        <div className="flex items-center gap-4 flex-wrap px-3 py-2 rounded-md border border-border/50 bg-muted/30">
                          {booruProvider === 'danbooru' ? (
                            <>
                              <label className="flex items-center gap-2 cursor-pointer text-[11px] sm:text-xs">
                                <Switch
                                  checked={includeCharacters}
                                  onCheckedChange={(v) => setIncludeCharacters(!!v)}
                                  aria-label="Toggle character tags"
                                />
                                <span className="select-none">Characters</span>
                              </label>
                              <label className="flex items-center gap-2 cursor-pointer text-[11px] sm:text-xs">
                                <Switch
                                  checked={includeCopyrights}
                                  onCheckedChange={(v) => setIncludeCopyrights(!!v)}
                                  aria-label="Toggle copyright tags"
                                />
                                <span className="select-none">Copyrights</span>
                              </label>
                              <label className="flex items-center gap-2 cursor-pointer text-[11px] sm:text-xs">
                                <Switch
                                  checked={optimizeTags}
                                  onCheckedChange={(v) => setOptimizeTags(!!v)}
                                  aria-label="Toggle combine tags"
                                />
                                <span className="select-none">Combine Tags</span>
                              </label>
                            </>
                          ) : (
                            <>
                              <label className="flex items-center gap-2 cursor-pointer text-[11px] sm:text-xs">
                                <Switch
                                  checked={removeLoRaTags}
                                  onCheckedChange={(v) => setRemoveLoRaTags(!!v)}
                                  aria-label="Remove LoRa tags from prompts"
                                />
                                <span className="select-none">Remove LoRa Tags</span>
                              </label>
                              <label className="flex items-center gap-2 cursor-pointer text-[11px] sm:text-xs">
                                <Switch
                                  checked={removeQualityTags}
                                  onCheckedChange={(v) => setRemoveQualityTags(!!v)}
                                  aria-label="Remove quality tags from prompts"
                                />
                                <span className="select-none">Remove Quality Tags</span>
                              </label>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    {excludeInput && null /* Preview badges removed per user request */}
                  </div>

                  {/* API Provider Selection */}
                  <div className="space-y-2">
                    <span className="text-xs font-medium text-muted-foreground">API Provider</span>
                    <div className="flex flex-col sm:flex-row gap-3 items-start">
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant={booruProvider === "danbooru" ? "default" : "outline"}
                          onClick={() => setBooruProvider("danbooru")}
                          className="focus-ring text-sm"
                          size="sm"
                        >
                          Danbooru
                        </Button>
                        <Button
                          type="button"
                          variant={booruProvider === "aibooru" ? "default" : "outline"}
                          onClick={() => setBooruProvider("aibooru")}
                          className="focus-ring text-sm"
                          size="sm"
                        >
                          Aibooru
                        </Button>
                      </div>
                      

                    </div>
                  </div>

                  {/* Filters */}
                  {hasMultipleTags(searchTags, order) && (
                    <Alert 
                      variant="destructive" 
                      className="mt-2 bg-red-50 border-red-200 text-red-800 dark:bg-red-950/50 dark:border-red-800/50 dark:text-red-200"
                    >
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription className="text-sm">
                        {order === "popular" 
                          ? `Danbooru API only allows 1 tag when using popularity sort. Only the first tag "${searchTags.split(',')[0].trim()}" will be used.`
                          : order === "random"
                          ? `Danbooru API only allows 1 tag when using random sort. Only the first tag "${searchTags.split(',')[0].trim()}" will be used.`
                          : `Danbooru API only allows 2 tags maximum. Only the first 2 tags will be used for the search.`
                        }
                      </AlertDescription>
                    </Alert>
                  )}

                  <div className="flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center gap-4">
                    <div className="flex gap-2 w-full sm:w-auto sm:ml-auto">
                      <Button type="submit" disabled={isLoading} className="focus-ring flex-1 sm:flex-none">
                        {isLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        ) : (
                          <Search className="w-4 h-4 mr-2" />
                        )}
                        Search
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        onClick={refresh}
                        disabled={isValidating}
                        className="focus-ring bg-transparent"
                      >
                        <RefreshCw className={`w-4 h-4 ${isValidating ? "animate-spin" : ""}`} />
                      </Button>
                    </div>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>

          {/* Gallery */}
          {viewMode === "grid" ? (
            <div className={`${getGridClass()} mb-8`}>
              {posts.map((post: BooruPost, index: number) => {
                const excludeList = excludeInput.split(',').map(t => t.trim()).filter(Boolean)
                
                // Check if this is an Aibooru post with prompt
                const isAiPost = isAibooruPost(post)
                let aiPrompt = isAiPost ? getPromptFromPost(post) : null
                
                // Apply LoRa tag removal if option is enabled
                if (aiPrompt && removeLoRaTags) {
                  aiPrompt = removeLoRaTagsUtil(aiPrompt)
                }
                
                // Apply quality tag removal if option is enabled
                if (aiPrompt && removeQualityTags) {
                  aiPrompt = removeQualityTagsUtil(aiPrompt)
                }
                
                // Apply quality tag removal if option is enabled
                if (aiPrompt && removeQualityTags) {
                  aiPrompt = removeQualityTagsUtil(aiPrompt)
                }
                
                // Use AI prompt if available, otherwise use cleaned tags
                let displayContent = aiPrompt || cleanPrompt(
                  post.tag_string,
                  post.tag_string_artist,
                  post.tag_string_character,
                  post.tag_string_copyright,
                  { includeCharacters, includeCopyrights, optimizeTags, exclude: excludeList },
                )
                
                // Apply exclude list to AI prompts as well
                if (aiPrompt && excludeList.length > 0) {
                  const excludeSet = new Set(excludeList.map(tag => tag.toLowerCase().trim()))
                  displayContent = aiPrompt.split(',').map(tag => tag.trim()).filter(tag => {
                    const normalizedTag = tag.toLowerCase().replace(/_/g, ' ').trim()
                    return !excludeSet.has(normalizedTag) && !excludeSet.has(tag.toLowerCase().trim())
                  }).join(', ')
                }
                
                const fileUrl = post.large_file_url || post.file_url
                const isImage = fileUrl?.match(/\.(jpg|jpeg|png|gif|webp|avif)$/i)
                if (!isImage) return null // Skip non-image (e.g., video) posts entirely

                return (
                  <Card key={`${post.id}-${index}`} className="overflow-hidden card-hover group">
                    <div className="image-container-2-3">
                      <Image
                        src={fileUrl}
                        alt={`Danbooru post ${post.id}`}
                        fill
                        className="object-cover transition-transform duration-300 group-hover:scale-105"
                        sizes={
                          cardScale === "small"
                            ? "(max-width: 640px) 50vw, 20vw"
                            : cardScale === "medium"
                              ? "(max-width: 640px) 50vw, 25vw"
                              : "(max-width: 640px) 100vw, 33vw"
                        }
                        priority={index < 8}
                      />

                      {/* Overlay actions */}
                      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="secondary"
                              className={`glass-effect ${cardScale === "small" ? "h-7 w-7" : "h-8 w-8"}`}
                              onClick={() => toggleFavorite(post.id)}
                              aria-label={favorites.has(post.id) ? "Remove from favorites" : "Add to favorites"}
                            >
                              <Heart
                                className={`${cardScale === "small" ? "w-3 h-3" : "w-3.5 h-3.5"} ${favorites.has(post.id) ? "fill-red-500 text-red-500" : ""}`}
                              />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {favorites.has(post.id) ? "Remove from favorites" : "Add to favorites"}
                          </TooltipContent>
                        </Tooltip>
                      </div>


                    </div>

                    <CardContent className={getCardContentClass()}>
                      <div className="bg-muted/50 rounded-lg overflow-y-auto prompt-container">
                        <p className="text-foreground/80 leading-relaxed">{displayContent || "No content available"}</p>
                      </div>

                      <div className="flex button-group items-stretch">
                        <Button
                          onClick={() => copyToClipboard(displayContent, post.id, !!aiPrompt)}
                          className="flex-1 focus-ring h-auto"
                          variant={copiedId === post.id ? "default" : "outline"}
                          disabled={!displayContent}
                        >
                          {copiedId === post.id ? (
                            <>
                              <Check className={`${getIconClass()} mr-1`} />
                              {cardScale === "small" ? "OK" : "Copied!"}
                            </>
                          ) : (
                            <>
                              <Copy className={`${getIconClass()} mr-1`} />
                              {cardScale === "small" ? "Copy" : "Copy"}
                            </>
                          )}
                        </Button>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              size="icon"
                              asChild
                              className={`focus-ring bg-transparent h-auto ${cardScale === "small" ? "w-7" : ""}`}
                            >
                              <a
                                href={isAiPost ? `https://aibooru.online/posts/${post.id}` : `https://danbooru.donmai.us/posts/${post.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => trackExternalLink(isAiPost ? `https://aibooru.online/posts/${post.id}` : `https://danbooru.donmai.us/posts/${post.id}`,'post')}
                                aria-label="View original post"
                              >
                                <ExternalLink className={getIconClass()} />
                              </a>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>View original post</TooltipContent>
                        </Tooltip>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          ) : (
            /* List View */
            <div className="space-y-4 mb-8">
              {posts.map((post: BooruPost, index: number) => {
                const excludeList = excludeInput.split(',').map(t => t.trim()).filter(Boolean)
                
                // Check if this is an Aibooru post with prompt
                const isAiPost = isAibooruPost(post)
                let aiPrompt = isAiPost ? getPromptFromPost(post) : null
                
                // Apply LoRa tag removal if option is enabled
                if (aiPrompt && removeLoRaTags) {
                  aiPrompt = removeLoRaTagsUtil(aiPrompt)
                }
                
                // Use AI prompt if available, otherwise use cleaned tags
                let displayContent = aiPrompt || cleanPrompt(
                  post.tag_string,
                  post.tag_string_artist,
                  post.tag_string_character,
                  post.tag_string_copyright,
                  { includeCharacters, includeCopyrights, optimizeTags, exclude: excludeList },
                )
                
                // Apply exclude list to AI prompts as well
                if (aiPrompt && excludeList.length > 0) {
                  const excludeSet = new Set(excludeList.map(tag => tag.toLowerCase().trim()))
                  displayContent = aiPrompt.split(',').map(tag => tag.trim()).filter(tag => {
                    const normalizedTag = tag.toLowerCase().replace(/_/g, ' ').trim()
                    return !excludeSet.has(normalizedTag) && !excludeSet.has(tag.toLowerCase().trim())
                  }).join(', ')
                }
                
                const fileUrl = post.large_file_url || post.file_url
                const isImage = fileUrl?.match(/\.(jpg|jpeg|png|gif|webp|avif)$/i)
                if (!isImage) return null

                return (
                  <Card key={`${post.id}-${index}`} className="overflow-hidden card-hover">
                    <CardContent className="p-4 sm:p-6">
                      <div className="flex flex-col sm:flex-row gap-4 sm:gap-6">
                        <div className="image-container-list-2-3 mx-auto sm:mx-0">
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
                            </div>
                          </div>

                          <div className="bg-muted/50 p-3 rounded-lg max-h-20 overflow-y-auto">
                            <p className="text-sm text-foreground/80 leading-relaxed">
                              {displayContent || "No content available"}
                            </p>
                          </div>

                          <div className="flex flex-col sm:flex-row gap-2">
                            <Button
                              onClick={() => copyToClipboard(displayContent, post.id, !!aiPrompt)}
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

                            <Button variant="outline" asChild className="focus-ring bg-transparent flex-1 sm:flex-none">
                              <a
                                href={isAiPost ? `https://aibooru.online/posts/${post.id}` : `https://danbooru.donmai.us/posts/${post.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => trackExternalLink(isAiPost ? `https://aibooru.online/posts/${post.id}` : `https://danbooru.donmai.us/posts/${post.id}`,'post')}
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
                disabled={isLoadingMore || noMoreResults} 
                size="lg" 
                className="px-8 focus-ring"
                variant={noMoreResults ? "outline" : "default"}
              >
                {isLoadingMore ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {order === "random" ? "Getting new results..." : "Loading more..."}
                  </>
                ) : noMoreResults ? (
                  <>
                    <AlertTriangle className="w-4 h-4 mr-2" />
                    No more results
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-2" />
                    {order === "random" ? "Get New Results" : "Load More"}
                  </>
                )}
              </Button>
              {noMoreResults && (
                <p className="text-xs text-muted-foreground mt-2 max-w-md mx-auto">
                  {order === "popular" 
                    ? "Try switching to 'Most recent', changing the rating filter, or use different search terms"
                    : order === "random"
                    ? "Try changing the rating filter or use different search terms to find more content"
                    : "Try changing the rating filter or use different search terms to find more content"
                  }
                </p>
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
                ) : (
                  <Button onClick={clearSearch} variant="outline" className="focus-ring bg-transparent">
                    Clear Search
                  </Button>
                )}
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
    </TooltipProvider>
  )
}
