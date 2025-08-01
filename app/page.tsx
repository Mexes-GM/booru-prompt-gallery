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
  Eye,
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
import { useInfinitePosts, hasMultipleTags, getFinalQueryTags } from "@/lib/api-client"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Slider } from "@/components/ui/slider"
import { cleanPrompt } from "@/lib/cleanPrompt"

interface DanbooruPost {
  id: number
  file_url: string
  large_file_url: string
  preview_file_url: string
  tag_string: string
  tag_string_artist: string
  tag_string_character: string
  tag_string_copyright: string
  rating: string
  score: number
}

type CardScale = "small" | "medium" | "large"

export default function DanbooruPromptGenerator() {
  const [searchTags, setSearchTags] = useState("")
  const [debouncedSearchTags, setDebouncedSearchTags] = useState("")
  const [ratingFilter, setRatingFilter] = useState("rating:general")
  const [order, setOrder] = useState<"popular" | "recent">("popular")
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [cardScale, setCardScale] = useState<CardScale>("medium")
  const [scaleValue, setScaleValue] = useState([2]) // 1=small, 2=medium, 3=large
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [favorites, setFavorites] = useState<Set<number>>(new Set())
  const [showFavorites, setShowFavorites] = useState(false)
  const [showBackToTop, setShowBackToTop] = useState(false)
  const [noMoreResults, setNoMoreResults] = useState(false)
  const [lastLoadAttempt, setLastLoadAttempt] = useState(0)
  const { toast } = useToast()

  const {
    data: pages,
    error,
    isLoading,
    isValidating,
    size,
    setSize,
    mutate,
  } = useInfinitePosts(searchTags, ratingFilter, order)

  // Ensure initial load
  useEffect(() => {
    if (size === 0 && !isLoading) {
      setSize(1)
    }
  }, [size, isLoading, setSize])

  const allPosts = pages ? pages.flat() : []
  const posts = showFavorites ? allPosts.filter(post => favorites.has(post.id)) : allPosts
  const isLoadingMore = isValidating && size > 1
  
  // Enhanced loadMore function with feedback
  const loadMore = () => {
    const currentPostCount = posts.length
    setLastLoadAttempt(currentPostCount)
    setSize(size + 1)
  }
  
  const refresh = () => {
    // Force revalidation of current data
    mutate(undefined, { revalidate: true })
  }

  // Check if no new results were loaded after attempting to load more
  useEffect(() => {
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
      // New results were loaded, reset the no more results state
      setNoMoreResults(false)
      setLastLoadAttempt(0)
    }
  }, [posts.length, isLoadingMore, lastLoadAttempt, order, toast])

  // Reset noMoreResults when search parameters change
  useEffect(() => {
    setNoMoreResults(false)
    setLastLoadAttempt(0)
  }, [searchTags, ratingFilter, order])

  // Update card scale based on slider value
  useEffect(() => {
    const scale = scaleValue[0]
    if (scale === 1) setCardScale("small")
    else if (scale === 2) setCardScale("medium")
    else setCardScale("large")
  }, [scaleValue])

  const copyToClipboard = async (prompt: string, postId: number) => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopiedId(postId)
      toast({
        title: "Copied!",
        description: "Prompt copied to clipboard",
      })
      setTimeout(() => setCopiedId(null), 2000)
    } catch (error) {
      toast({
        title: "Error",
        description: "Could not copy prompt",
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
    
    // Show toast based on the action that will be performed
    if (isCurrentlyFavorited) {
      toast({
        title: "Removed from favorites",
        description: "Image removed from your favorites",
      })
    } else {
      toast({
        title: "Added to favorites",
        description: "Image added to your favorites",
      })
    }
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSize(1)
  }

  const clearSearch = () => {
    setSearchTags("")
    setSize(1)
  }

  const toggleShowFavorites = () => {
    setShowFavorites(!showFavorites)
  }

  const clearFavorites = () => {
    setFavorites(new Set())
    toast({
      title: "Favorites cleared",
      description: "All favorites have been removed",
    })
  }

  const decreaseScale = () => {
    setScaleValue([Math.max(1, scaleValue[0] - 1)])
  }

  const increaseScale = () => {
    setScaleValue([Math.min(3, scaleValue[0] + 1)])
  }

  // Load favorites from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedFavorites = localStorage.getItem('booruFavorites')
      if (savedFavorites) {
        try {
          const favoritesArray = JSON.parse(savedFavorites)
          setFavorites(new Set(favoritesArray))
        } catch (error) {
        // Error loading favorites, continue with empty array
          setFavorites(new Set())
        }
      }
    }
  }, [])

  // Save favorites to localStorage whenever they change
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('booruFavorites', JSON.stringify(Array.from(favorites)))
      } catch (error) {
        // Error saving favorites, continue silently
      }
    }
  }, [favorites])

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

  // Handle errors
  const hasMounted = useRef(false)
  
  useEffect(() => {
    if (hasMounted.current && error) {
      toast({
        title: "Connection error",
        description: error.message || "Could not load images",
        variant: "destructive",
      })
    }
    hasMounted.current = true
  }, [error, toast])

  // Debounce search tags
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTags(searchTags)
    }, 500) // 500ms debounce delay

    return () => {
      clearTimeout(timer)
    }
  }, [searchTags])

  // Reset to first page when filters change
  useEffect(() => {
    setSize(1)
  }, [order, ratingFilter, debouncedSearchTags])

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
        {/* Header */}
        <header className="sticky top-0 z-50 w-full border-b glass-effect">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <h1 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                  Danbooru Prompt Gallery
                </h1>
              </div>

              <div className="flex items-center space-x-1 sm:space-x-2">
                {/* Card Scale Controls - Only show in grid view */}
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
                      onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")}
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
          {/* Search Section */}
          <div className="max-w-4xl mx-auto mb-8 space-y-6">
            <div className="text-center space-y-2">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Discover AI Art Prompts</h2>
                <p className="text-muted-foreground max-w-2xl mx-auto text-sm sm:text-base px-4">
                  Generate prompts from Danbooru image tags. The system of this web app extracts and formats tags from posts, removing unnecessary metadata to create clean, ready-to-use prompts for your AI art generation.
                </p>
            </div>

            {/* Search Form */}
            <Card className="glass-effect">
              <CardContent className="p-4 sm:p-6">
                <form onSubmit={handleSearch} className="space-y-4">
                  {/* API Query Tags Display */}
                  {getFinalQueryTags(searchTags, ratingFilter, order).length > 0 && (
                    <div className="mb-4">
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground mb-2">
                        <span className="font-medium">Sending to Danbooru API:</span>
                        {getFinalQueryTags(searchTags, ratingFilter, order).map((tag, index) => (
                          <Badge key={index} variant="outline" className="bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-950/50 dark:border-blue-800/50 dark:text-blue-300 text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                    <Input
                      type="text"
                      value={searchTags}
                      onChange={(e) => setSearchTags(e.target.value)}
                      placeholder={order === "recent" ? "Search by up to 2 tags (e.g., cat_girl, blue_eyes)" : "Search by one tag only (e.g., cat_girl)"}
                      className="pl-10 pr-10 focus-ring text-sm sm:text-base"
                      aria-label="Search tags"
                    />
                    {searchTags && (
                      <button
                        type="button"
                        onClick={clearSearch}
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-sm"
                        aria-label="Clear search"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {/* Warning for multiple tags */}
                  {hasMultipleTags(searchTags, order) && (
                    <Alert 
                      variant="destructive" 
                      className="mt-2 bg-red-50 border-red-200 text-red-800 dark:bg-red-950/50 dark:border-red-800/50 dark:text-red-200"
                    >
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription className="text-sm">
                        {order === "popular" 
                          ? `Danbooru API only allows 1 tag when using popularity sort. Only the first tag "${searchTags.split(',')[0].trim()}" will be used.`
                          : `Danbooru API only allows 2 tags maximum. Only the first 2 tags will be used for the search.`
                        }
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* Filters */}
                  <div className="flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Filter className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Filters:</span>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                      <Select value={ratingFilter} onValueChange={setRatingFilter}>
                        <SelectTrigger className="w-full sm:w-[140px] focus-ring">
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

                      <Select value={order} onValueChange={(value: "popular" | "recent") => setOrder(value)}>
                        <SelectTrigger className="w-full sm:w-[140px] focus-ring">
                          <SelectValue placeholder="Sort by" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="popular">Most popular</SelectItem>
                          <SelectItem value="recent">Most recent</SelectItem>
                        </SelectContent>
                      </Select>

                      <Button
                        type="button"
                        variant={showFavorites ? "default" : "outline"}
                        onClick={toggleShowFavorites}
                        className="focus-ring w-full sm:w-auto"
                      >
                        <Heart className={`w-4 h-4 mr-2 ${showFavorites ? "fill-white" : ""}`} />
                        Favorites ({favorites.size})
                      </Button>
                    </div>

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
              {posts.map((post, index) => {
                const cleanedPrompt = cleanPrompt(
                  post.tag_string,
                  post.tag_string_artist,
                  post.tag_string_character,
                  post.tag_string_copyright,
                )

                return (
                  <Card key={`${post.id}-${index}`} className="overflow-hidden card-hover group">
                    <div className="image-container-2-3">
                      {(post.large_file_url || post.file_url)?.match(/\.(jpg|jpeg|png|gif|webp|avif)$/i) ? (
                        <Image
                          src={post.large_file_url || post.file_url}
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
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-muted">
                          <div className="text-center space-y-2">
                            <div className={cardScale === "small" ? "text-2xl" : "text-4xl"}>🎬</div>
                            <p className={`text-muted-foreground ${cardScale === "small" ? "text-xs" : "text-sm"}`}>
                              Video content
                            </p>
                            <Button variant="outline" size={cardScale === "small" ? "sm" : "sm"} asChild>
                              <a href={post.file_url} target="_blank" rel="noopener noreferrer" className="focus-ring">
                                <ExternalLink className={`${getIconClass()} mr-1`} />
                                View
                              </a>
                            </Button>
                          </div>
                        </div>
                      )}

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
                        <p className="text-foreground/80 leading-relaxed">{cleanedPrompt || "No tags available"}</p>
                      </div>

                      <div className="flex button-group items-stretch">
                        <Button
                          onClick={() => copyToClipboard(cleanedPrompt, post.id)}
                          className="flex-1 focus-ring h-auto"
                          variant={copiedId === post.id ? "default" : "outline"}
                          disabled={!cleanedPrompt}
                        >
                          {copiedId === post.id ? (
                            <>
                              <Check className={`${getIconClass()} mr-1`} />
                              {cardScale === "small" ? "✓" : "Copied!"}
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
                                href={`https://danbooru.donmai.us/posts/${post.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
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
              {posts.map((post, index) => {
                const cleanedPrompt = cleanPrompt(
                  post.tag_string,
                  post.tag_string_artist,
                  post.tag_string_character,
                  post.tag_string_copyright,
                )

                return (
                  <Card key={`${post.id}-${index}`} className="overflow-hidden card-hover">
                    <CardContent className="p-4 sm:p-6">
                      <div className="flex flex-col sm:flex-row gap-4 sm:gap-6">
                        <div className="image-container-list-2-3 mx-auto sm:mx-0">
                          {(post.large_file_url || post.file_url)?.match(/\.(jpg|jpeg|png|gif|webp|avif)$/i) ? (
                            <Image
                              src={post.large_file_url || post.file_url}
                              alt={`Danbooru post ${post.id}`}
                              fill
                              className="object-cover"
                              sizes="128px"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <div className="text-2xl">🎬</div>
                            </div>
                          )}
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
                              {cleanedPrompt || "No tags available"}
                            </p>
                          </div>

                          <div className="flex flex-col sm:flex-row gap-2">
                            <Button
                              onClick={() => copyToClipboard(cleanedPrompt, post.id)}
                              variant={copiedId === post.id ? "default" : "outline"}
                              disabled={!cleanedPrompt}
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
                                href={`https://danbooru.donmai.us/posts/${post.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
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

          {/* Load More Button */}
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
                    Loading more...
                  </>
                ) : noMoreResults ? (
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
              {noMoreResults && (
                <p className="text-xs text-muted-foreground mt-2 max-w-md mx-auto">
                  {order === "popular" 
                    ? "Try switching to 'Most recent', changing the rating filter, or use different search terms"
                    : "Try changing the rating filter or use different search terms to find more content"
                  }
                </p>
              )}
            </div>
          )}

          {/* Loading State */}
          {isLoading && posts.length === 0 && (
            <div className="text-center py-12">
              <div className="space-y-4">
                <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
                <div className="space-y-2">
                  <p className="text-base sm:text-lg font-medium">Loading images...</p>
                  <p className="text-xs sm:text-sm text-muted-foreground px-4">Fetching the latest content from Danbooru</p>
                </div>
              </div>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && posts.length === 0 && (
            <div className="text-center py-12 px-4">
              <div className="space-y-4">
                <div className="text-4xl sm:text-6xl">{showFavorites ? "❤️" : "🎨"}</div>
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
              </div>
              <p className="text-xs text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                Generate prompts from Danbooru image tags. The system of this web app extracts and formats tags from posts, removing unnecessary metadata to create clean, ready-to-use prompts for AI art generation. All images are sourced from Danbooru and belong to their respective creators.
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
            aria-label="Volver al inicio"
          >
            <ChevronUp className="h-4 w-4 sm:h-5 sm:w-5 transition-transform duration-200 hover:animate-bounce" />
          </Button>
        </div>
      </div>
    </TooltipProvider>
  )
}
