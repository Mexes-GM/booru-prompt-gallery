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
  Save,
  Shuffle,
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
import {
  hasMultipleTags, getFinalQueryTags, BooruPost, BooruProvider, isAibooruPost,
} from "@/lib/api-client"

import { userPreferences, type HistoryItem, type TagPreset } from "@/lib/storage"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Slider } from "@/components/ui/slider"
import { classifyTags, type ClassifiedTags } from "@/lib/tag-classifier"
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

import { MasonryGrid } from "@/components/masonry-grid"
import { useBooruSearch } from "@/hooks/use-booru-search"
import { useBooruFavorites } from "@/hooks/use-booru-favorites"
import { MasonryItem } from "./masonry-item"

import { TrendSheet } from "@/components/trends/trend-sheet"
import { useMergeMode } from "@/hooks/use-merge-mode"
import { MergeStickyFooter } from "./merge-sticky-footer"
import { FileCheck2 } from "lucide-react"
import { InfiniteScrollTrigger } from "@/components/ui/infinite-scroll-trigger"

type CardScale = "small" | "medium" | "large"

export function PromptGallery() {
  // 1. Core Logic Hooks
  const search = useBooruSearch()
  const favs = useBooruFavorites(search.booruProvider)
  const { toast } = useToast()
  const isMobile = useIsMobile()

  // 2. Local UI State
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [cardScale, setCardScale] = useState<CardScale>("medium")
  const [scaleValue, setScaleValue] = useState([2])

  // User Prefs UI state
  const [includeCharacters, setIncludeCharacters] = useState(true)
  const [optimizeTags, setOptimizeTags] = useState(true)
  const [excludeInput, setExcludeInput] = useState("")
  const [addInput, setAddInput] = useState("")

  const [showSettings, setShowSettings] = useState(true)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [showBackToTop, setShowBackToTop] = useState(false)

  // Modals
  const [teachModalData, setTeachModalData] = useState<{ open: boolean, tags: ClassifiedTags | null }>({ open: false, tags: null })
  const [showWelcomeModal, setShowWelcomeModal] = useState(false)
  const [presets, setPresets] = useState<TagPreset[]>([])
  const [isPresetDialogOpen, setIsPresetDialogOpen] = useState(false)
  const [presetName, setPresetName] = useState("")
  const [history, setHistory] = useState<HistoryItem[]>([])

  const [tagOverrides, setTagOverrides] = useState<Record<string, string>>({})

  // Merge Mode Hook
  const mergeMode = useMergeMode()

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

  useEffect(() => {
    getAllTagOverrides().then(overrides => {
      setTagOverrides(overrides)
    })
  }, [])

  useEffect(() => {
    if (search.isClient) {
      setPresets(userPreferences.getAddTagsPresets())
    }
  }, [search.isClient])

  useEffect(() => {
    if (search.isClient) {
      setHistory(userPreferences.getHistory())
      const saved = localStorage.getItem('excludeTags')
      if (saved !== null) setExcludeInput(saved)
      const savedAdd = localStorage.getItem('addTags')
      if (savedAdd !== null) setAddInput(savedAdd)

      try {
        const savedOpts = localStorage.getItem('promptOptions')
        if (savedOpts) {
          const parsed = JSON.parse(savedOpts) || {}
          if (typeof parsed.includeCharacters === 'boolean') setIncludeCharacters(parsed.includeCharacters)
          if (typeof parsed.optimizeTags === 'boolean') setOptimizeTags(parsed.optimizeTags)
        }
      } catch { }
    }
  }, [search.isClient])

  // Persist UI preferences
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('promptOptions', JSON.stringify({ includeCharacters, optimizeTags }))
      localStorage.setItem('excludeTags', excludeInput)
      localStorage.setItem('addTags', addInput)
    }
  }, [includeCharacters, optimizeTags, excludeInput, addInput])

  // Scale effect
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

  // --- Helpers ---

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

      const urlPath = imageUrl.split('?')[0] // Remove query params
      const extension = urlPath.split('.').pop() || 'jpg'
      const itemProvider = post._provider || search.booruProvider
      const filename = `${itemProvider}_${post.id}.${extension}`
      const alwaysProxy = imageUrl.includes('rule34.xxx') || imageUrl.includes('e621.net')
      let fetchUrl = alwaysProxy ? `/api/download?url=${encodeURIComponent(imageUrl)}` : imageUrl

      let response: Response
      try {
        response = await fetch(fetchUrl)
        if (!response.ok) throw new Error(`Status ${response.status}`)
      } catch (directError) {
        if (!alwaysProxy) {
          fetchUrl = `/api/download?url=${encodeURIComponent(imageUrl)}`
          response = await fetch(fetchUrl)
        } else {
          throw directError
        }
      }

      if (!response.ok) {
        let errorMessage = `Failed to fetch image: ${response.status} ${response.statusText}`
        try {
          // @ts-ignore
          const errorData = await response.json()
          if (errorData.error) errorMessage = errorData.error
        } catch (e) { }
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

  const filteredPosts = useMemo(() => {
    const source = favs.showFavorites ? (favs.favoritePosts || []) : search.allPosts
    return source.filter(post => {
      const fileUrl = post.large_file_url || post.file_url
      return fileUrl?.match(/\.(jpg|jpeg|png|gif|webp|avif)$/i)
    })
  }, [favs.showFavorites, favs.favoritePosts, search.allPosts])

  const renderMasonryItem = useCallback((post: BooruPost, width: number, height: number) => {
    return <MasonryItem
      post={post}
      width={width}
      height={height}
      viewMode={viewMode}
      effectiveScale={effectiveScale}
      booruProvider={search.booruProvider}
      favorites={favs.favorites}
      toggleFavorite={favs.toggleFavorite}
      downloadImage={downloadImage}
      copyToClipboard={copyToClipboard}
      excludeInput={excludeInput}
      addInput={addInput}
      includeCharacters={includeCharacters}
      optimizeTags={optimizeTags}
      removeLoRaTags={search.removeLoRaTags}
      removeQualityTags={search.removeQualityTags}
      tagOverrides={tagOverrides}
      copiedId={copiedId}
      setTeachModalData={setTeachModalData}
      isMergeMode={mergeMode.isMergeMode}
      isSelected={mergeMode.selectedPosts.has(post.id)}
      selectedParts={mergeMode.selectedPosts.get(post.id)?.parts}
      onTogglePart={mergeMode.togglePostPart}
      onMergeSelect={() => { }} // No longer used for card click, but keeping prop if needed or refactoring MasonryItem signature next
    />
  }, [viewMode, effectiveScale, search.booruProvider, favs.favorites, favs.toggleFavorite, downloadImage, copyToClipboard, excludeInput, addInput, includeCharacters, optimizeTags, search.removeLoRaTags, search.removeQualityTags, tagOverrides, copiedId, mergeMode])

  const decreaseScale = () => setScaleValue([Math.max(1, scaleValue[0] - 1)])
  const increaseScale = () => setScaleValue([Math.min(3, scaleValue[0] + 1)])
  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' })

  const finalPosts = filteredPosts

  return (
    <TooltipProvider>
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
          {/* Hero */}
          <div className="max-w-4xl mx-auto mb-8 space-y-6">
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
                        href="https://civitai.com/user/Mexes"
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => trackExternalLink('https://civitai.com/user/Mexes', 'social')}
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
                        onClick={() => trackExternalLink('https://tensor.art/u/616420638671868313', 'social')}
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
                        onClick={() => trackExternalLink('https://www.seaart.ai/user/e9f2dc73eaf4495fce59838fea87187c?u_code=EUY1AJ3T', 'social')}
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
                    onClick={() => trackExternalLink('https://ko-fi.com/mexes', 'support')}
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
                <form onSubmit={search.handleSearch} className="space-y-6">

                  {/* Top Bar: Provider Selection & Quick Actions */}
                  <div className="flex flex-col lg:flex-row gap-4 justify-between items-start lg:items-center">
                    {/* API Provider Selector */}
                    <div className="flex flex-col gap-1.5 w-full lg:w-auto">
                      <span className="text-xs font-medium text-muted-foreground ml-1">API Provider</span>
                      <div className="bg-muted/50 p-1 rounded-lg flex gap-1 w-full sm:w-auto overflow-x-auto">
                        {(['danbooru', 'aibooru', 'rule34', 'e621', 'gelbooru'] as const).map(p => (
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
                            className={`relative h-8 text-sm px-4 flex-1 sm:flex-none ${!favs.showFavorites && search.booruProvider === p ? "text-foreground hover:bg-transparent" : "text-muted-foreground hover:text-foreground"}`}
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
                      <span className="text-xs font-medium text-muted-foreground ml-1 lg:text-right">Settings</span>
                      <div className="flex items-center gap-2 w-full lg:w-auto justify-start lg:justify-end">
                        {search.isClient ? (
                          <Button
                            type="button"
                            disabled={search.booruProvider === 'rule34'}
                            variant={search.ratingFilter === "rating:general" ? "secondary" : "outline"}
                            onClick={() => {
                              const newRating = search.ratingFilter === "rating:general" ? "all" : "rating:general"
                              search.setRatingFilter(newRating)
                            }}
                            className={`h-9 px-3 ${search.booruProvider === 'rule34'
                              ? "opacity-50 cursor-not-allowed"
                              : search.ratingFilter === "rating:general"
                                ? "bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/50"
                                : ""
                              }`}
                            title={search.booruProvider === 'rule34' ? "NSFW is always enabled for Rule34" : "Toggle NSFW content"}
                          >
                            <Shield className="w-4 h-4 mr-2" />
                            <span className="text-xs font-medium">
                              {search.ratingFilter === "rating:general" ? "Safe Mode" : "NSFW Allowed"}
                            </span>
                          </Button>
                        ) : (
                          <div className="w-[120px] h-9 bg-muted animate-pulse rounded-md" />
                        )}

                        <Button
                          type="button"
                          variant={favs.showFavorites ? "secondary" : "outline"}
                          onClick={favs.toggleShowFavorites}
                          className={`h-9 px-3 ${favs.showFavorites ? "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50" : ""}`}
                        >
                          <Heart className={`w-4 h-4 mr-2 ${favs.showFavorites ? "fill-current" : ""}`} />
                          <span className="text-xs font-medium">Favs ({favs.favorites.size})</span>
                        </Button>

                        {/* Trending Sheet */}
                        <TrendSheet onSelectTag={search.setSearchTags} />

                        {/* History Sheet */}
                        <Sheet>
                          <SheetTrigger asChild>
                            <Button type="button" variant="outline" size="icon" className="h-9 w-9" aria-label="View history">
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
                        value={search.searchTags}
                        onChange={(e) => search.setSearchTags(e.target.value)}
                        placeholder={search.isShuffle ? "Search tag (e.g., cat_girl)..." : "Search tags (e.g., cat_girl, blue_eyes)..."}
                        className="pl-10 pr-10 h-11 text-base shadow-sm focus-visible:ring-offset-0"
                        aria-label="Search tags"
                        translate="no"
                      />
                      {search.searchTags && (
                        <button
                          type="button"
                          onClick={search.clearSearch}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                          aria-label="Clear search"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button type="submit" disabled={search.isLoading} size="lg" className="h-11 px-6 shadow-sm min-w-[100px]">
                        {search.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Search"}
                      </Button>
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
                      >
                        <RefreshCw className={`w-4 h-4 ${search.isValidating ? "animate-spin" : ""}`} />
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
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant={mergeMode.isMergeMode ? "default" : "outline"}
                            onClick={mergeMode.toggleMergeMode}
                            className={`h-11 w-11 p-0 shadow-sm ${mergeMode.isMergeMode ? "bg-primary text-primary-foreground" : ""}`}
                            aria-label={mergeMode.isMergeMode ? "Disable Merge Mode" : "Enable Merge Mode"}
                          >
                            <FileCheck2 className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          {mergeMode.isMergeMode ? "Disable Merge Mode" : "Enable Merge Prompt Mode"}
                        </TooltipContent>
                      </Tooltip>
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
                              <div className="flex h-9 w-full items-center rounded-md border border-input bg-background/50 pl-3 pr-1 text-sm shadow-sm transition-colors focus-within:outline-none focus-within:ring-1 focus-within:ring-ring">
                                <input
                                  id="add-tags"
                                  value={addInput}
                                  onChange={(e) => setAddInput(e.target.value)}
                                  placeholder="masterpiece, best quality..."
                                  className="flex-1 bg-transparent border-none p-0 placeholder:text-muted-foreground focus:outline-none h-full min-w-0"
                                />
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
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground rounded-r-none" title="Save Preset">
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
                                            <Input
                                              value={presetName}
                                              onChange={(e) => setPresetName(e.target.value)}
                                              placeholder="My awesome preset"
                                            />
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
                                        <Button variant="ghost" size="icon" className="h-7 w-5 min-w-[1.25rem] text-muted-foreground hover:text-foreground rounded-l-none" title="Select Preset">
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
                                                className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10"
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
                                  <button type="button" onClick={() => setExcludeInput("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground flex items-center justify-center h-6 w-6 rounded-full hover:bg-muted" aria-label="Clear excluded tags">
                                    <X className="h-3 w-3" />
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="space-y-2">
                              <label htmlFor="tag-count" className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                                <span className={`w-1.5 h-1.5 rounded-full ${isTagCountSupported ? "bg-blue-500" : "bg-gray-400"}`}></span>
                                Minimum Tag Count ({`>`} {search.tagCountFilter})
                              </label>
                              <div className="flex items-center gap-3">
                                <Slider
                                  min={5}
                                  max={100}
                                  step={1}
                                  value={[parseInt(search.tagCountFilter) || 5]}
                                  onValueChange={(val) => search.setTagCountFilter(val[0].toString())}
                                  onValueCommit={(val) => search.setAppliedTagCountFilter(val[0].toString())}
                                  disabled={!isTagCountSupported}
                                  className={`flex-1 ${!isTagCountSupported ? "opacity-50 cursor-not-allowed" : ""}`}
                                />
                                <Input
                                  id="tag-count"
                                  type="number"
                                  min={5}
                                  max={1000}
                                  value={search.tagCountFilter}
                                  onChange={(e) => search.setTagCountFilter(e.target.value)}
                                  // Simplified logic for brevity, the original was more verbose w.r.t blur handling
                                  onBlur={() => search.setAppliedTagCountFilter(search.tagCountFilter)}
                                  disabled={!isTagCountSupported}
                                  className={`h-8 w-16 text-xs text-center bg-background/50 ${!isTagCountValid ? "border-red-500 focus-visible:ring-red-500" : ""} ${!isTagCountSupported ? "opacity-50 cursor-not-allowed" : ""}`}
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
                                  <label className="flex items-center justify-between sm:justify-start gap-3 cursor-pointer p-2 rounded-md hover:bg-muted/50 transition-colors border border-transparent hover:border-border/50 sm:col-span-2">
                                    <span className="text-sm select-none">Include Characters</span>
                                    <Switch
                                      checked={includeCharacters}
                                      onCheckedChange={setIncludeCharacters}
                                      className="scale-90"
                                    />
                                  </label>
                                  <label className="flex items-center justify-between sm:justify-start gap-3 cursor-pointer p-2 rounded-md hover:bg-muted/50 transition-colors border border-transparent hover:border-border/50 sm:col-span-2">
                                    <span className="text-sm select-none">Smart Tag Combination</span>
                                    <Switch
                                      checked={optimizeTags}
                                      onCheckedChange={setOptimizeTags}
                                      className="scale-90"
                                    />
                                  </label>
                                </>
                              ) : (
                                <>
                                  <label className="flex items-center justify-between sm:justify-start gap-3 cursor-pointer p-2 rounded-md hover:bg-muted/50 transition-colors border border-transparent hover:border-border/50 sm:col-span-2">
                                    <span className="text-sm select-none">Remove LoRa Tags</span>
                                    <Switch
                                      checked={search.removeLoRaTags}
                                      onCheckedChange={search.setRemoveLoRaTags}
                                      className="scale-90"
                                    />
                                  </label>
                                  <label className="flex items-center justify-between sm:justify-start gap-3 cursor-pointer p-2 rounded-md hover:bg-muted/50 transition-colors border border-transparent hover:border-border/50 sm:col-span-2">
                                    <span className="text-sm select-none">Remove Quality Tags</span>
                                    <Switch
                                      checked={search.removeQualityTags}
                                      onCheckedChange={search.setRemoveQualityTags}
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
                    {/* Active Query Display */}
                    {getFinalQueryTags(search.searchTags, search.ratingFilter, search.order, search.appliedTagCountFilter, search.booruProvider).length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground bg-muted/20 p-2 rounded-md border border-border/30">
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
          {viewMode === "grid" ? (
            <div className="mb-8 min-h-[500px]">
              <MasonryGrid
                items={filteredPosts}
                scale={effectiveScale}
                renderItem={renderMasonryItem}
              />
            </div>
          ) : (
            <div className="space-y-4 mb-8">
              {finalPosts.map((post) => (
                <div key={`${post.id}`}>
                  <MasonryItem
                    post={post}
                    width={800} // Dummy width for list view
                    height={600} // Dummy height
                    viewMode="list"
                    effectiveScale="medium" // Fixed for list
                    booruProvider={search.booruProvider}
                    favorites={favs.favorites}
                    toggleFavorite={favs.toggleFavorite}
                    downloadImage={downloadImage}
                    copyToClipboard={copyToClipboard}
                    excludeInput={excludeInput}
                    addInput={addInput}
                    includeCharacters={includeCharacters}
                    optimizeTags={optimizeTags}
                    removeLoRaTags={search.removeLoRaTags}
                    removeQualityTags={search.removeQualityTags}
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
              ))}
            </div>
          )}

          {/* Load More / States */}
          {filteredPosts.length > 0 && !favs.showFavorites && (
            <div className="text-center pb-8">
              {!search.loadMoreError ? (
                <InfiniteScrollTrigger
                  onIntersect={search.loadMore}
                  hasNextPage={!search.noMoreResults}
                  isLoading={search.isLoadingMore || search.isLoadingLock}
                  error={search.loadMoreError}
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
          {((search.isLoading && filteredPosts.length === 0 && !favs.showFavorites) || (favs.showFavorites && favs.isLoading)) && (
            <div className="text-center py-12">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
              <p className="mt-4">Loading...</p>
            </div>
          )}

          {!search.isLoading && !favs.isLoading && filteredPosts.length === 0 && (
            <div className="text-center py-12 px-4">
              <p className="text-lg font-medium">{favs.showFavorites ? "No favorites yet" : "No images found"}</p>
            </div>
          )}
        </main>

        <div className={`fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 transition-all duration-500 flex flex-col gap-3 ${showBackToTop ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-75 pointer-events-none'
          }`}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={mergeMode.toggleMergeMode}
                variant={mergeMode.isMergeMode ? "default" : "secondary"}
                className={`rounded-full shadow-lg h-10 w-10 p-0 ${mergeMode.isMergeMode ? "" : "bg-background/80 backdrop-blur border"}`}
              >
                <FileCheck2 className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {mergeMode.isMergeMode ? "Disable Merge Mode" : "Enable Merge Mode"}
            </TooltipContent>
          </Tooltip>

          <Button onClick={scrollToTop} className="rounded-full shadow-lg h-10 w-10 p-0" variant="secondary">
            <ChevronUp className="h-5 w-5" />
          </Button>
        </div>

      </div>

      {teachModalData.tags && (
        <TeachModal
          open={teachModalData.open}
          onOpenChange={(open) => setTeachModalData(prev => ({ ...prev, open }))}
          initialClassifiedTags={teachModalData.tags}
        />
      )}
      <TeachWelcomeModal triggerOpen={showWelcomeModal} />
      <MergeStickyFooter
        isOpen={mergeMode.isMergeMode}
        selectedPosts={mergeMode.selectedPosts}
        mergedPrompt={mergeMode.mergedPrompt}
        mergedPromptSegments={mergeMode.mergedPromptSegments}
        onRemovePost={mergeMode.removePost}
        onClearAll={mergeMode.clearAll}
        onExit={mergeMode.toggleMergeMode}
        onCopy={(text) => copyToClipboard(text, 0, true)}
      />

    </TooltipProvider>
  )
}
