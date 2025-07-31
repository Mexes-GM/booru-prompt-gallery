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
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import Image from "next/image"
import { useInfinitePosts, hasMultipleTags } from "@/lib/api-client"
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
  const loadMore = () => setSize(size + 1)
  const refresh = () => {
    // Force revalidation of current data
    mutate(undefined, { revalidate: true })
  }

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
          console.error('Error loading favorites:', error)
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
        console.error('Error saving favorites:', error)
      }
    }
  }, [favorites])

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
                <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                  Danbooru Prompt Gallery
                </h1>
                <Badge variant="secondary" className="hidden sm:inline-flex">
                  AI Prompt Generator
                </Badge>
              </div>

              <div className="flex items-center space-x-2">
                {/* Card Scale Controls - Only show in grid view */}
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
              <h2 className="text-3xl font-bold tracking-tight">Discover AI Art Prompts</h2>
                <p className="text-muted-foreground max-w-2xl mx-auto">
                  Generate prompts from Danbooru image tags. Our system extracts and formats tags from posts, removing unnecessary metadata to create clean, ready-to-use prompts for your AI art generation.
                </p>
            </div>

            {/* Search Form */}
            <Card className="glass-effect">
              <CardContent className="p-6">
                <form onSubmit={handleSearch} className="space-y-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                    <Input
                      type="text"
                      value={searchTags}
                      onChange={(e) => setSearchTags(e.target.value)}
                      placeholder="Search by one tag only (e.g., cat_girl)"
                      className="pl-10 focus-ring"
                      aria-label="Search tags"
                    />
                  </div>

                  {/* Warning for multiple tags */}
                  {hasMultipleTags(searchTags) && (
                    <Alert 
                      variant="destructive" 
                      className="mt-2 bg-red-50 border-red-200 text-red-800 dark:bg-red-950/50 dark:border-red-800/50 dark:text-red-200"
                    >
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        Danbooru API only allows searching by 1 tag. Only the first tag "{searchTags.split(',')[0].trim()}" will be used for the search.
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* Filters */}
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Filter className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Filters:</span>
                    </div>

                    <Select value={ratingFilter} onValueChange={setRatingFilter}>
                      <SelectTrigger className="w-[140px] focus-ring">
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
                      <SelectTrigger className="w-[140px] focus-ring">
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
                      className="focus-ring"
                    >
                      <Heart className={`w-4 h-4 mr-2 ${showFavorites ? "fill-white" : ""}`} />
                      Favorites ({favorites.size})
                    </Button>

                    <div className="flex gap-2 ml-auto">
                      <Button type="submit" disabled={isLoading} className="focus-ring">
                        {isLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        ) : (
                          <Search className="w-4 h-4 mr-2" />
                        )}
                        Search
                      </Button>

                      {searchTags && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={clearSearch}
                          className="focus-ring bg-transparent"
                        >
                          Clear
                        </Button>
                      )}

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

                {/* Active filters display */}
                {(searchTags || ratingFilter !== "rating:general" || showFavorites) && (
                  <div className="mt-4 pt-4 border-t border-border/50">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <span>Active filters:</span>
                      {searchTags && <Badge variant="secondary">Tags: {searchTags}</Badge>}
                      {ratingFilter && ratingFilter !== "rating:general" && ratingFilter !== "all" && (
                        <Badge variant="secondary">Rating: {ratingFilter.replace("rating:", "")}</Badge>
                      )}
                      {ratingFilter === "all" && (
                        <Badge variant="secondary">No rating filter</Badge>
                      )}
                      <Badge variant="secondary">Sort: {order === "popular" ? "Most popular" : "Most recent"}</Badge>
                      {showFavorites && (
                        <Badge variant="secondary" className="bg-red-500/20 text-red-500">
                          Favorites Only ({favorites.size})
                        </Badge>
                      )}
                      {favorites.size > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={clearFavorites}
                          className="text-xs h-6 px-2"
                        >
                          Clear Favorites
                        </Button>
                      )}
                    </div>
                  </div>
                )}
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
                              className={`glass-effect ${cardScale === "small" ? "h-6 w-6" : "h-8 w-8"}`}
                              onClick={() => toggleFavorite(post.id)}
                              aria-label={favorites.has(post.id) ? "Remove from favorites" : "Add to favorites"}
                            >
                              <Heart
                                className={`${getIconClass()} ${favorites.has(post.id) ? "fill-red-500 text-red-500" : ""}`}
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

                      <div className="flex button-group">
                        <Button
                          onClick={() => copyToClipboard(cleanedPrompt, post.id)}
                          className="flex-1 focus-ring"
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
                              className={`focus-ring bg-transparent ${cardScale === "small" ? "h-7 w-7" : ""}`}
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
                    <CardContent className="p-6">
                      <div className="flex gap-6">
                        <div className="image-container-list-2-3">
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
                                <Badge variant="outline">ID: {post.id}</Badge>
                              </div>
                            </div>

                            <div className="flex gap-2">
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => toggleFavorite(post.id)}
                                className="focus-ring"
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

                          <div className="flex gap-2">
                            <Button
                              onClick={() => copyToClipboard(cleanedPrompt, post.id)}
                              variant={copiedId === post.id ? "default" : "outline"}
                              disabled={!cleanedPrompt}
                              className="focus-ring"
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

                            <Button variant="outline" asChild className="focus-ring bg-transparent">
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
              <Button onClick={loadMore} disabled={isLoadingMore} size="lg" className="px-8 focus-ring">
                {isLoadingMore ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Loading more...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-2" />
                    Load More
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Loading State */}
          {isLoading && posts.length === 0 && (
            <div className="text-center py-12">
              <div className="space-y-4">
                <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
                <div className="space-y-2">
                  <p className="text-lg font-medium">Loading images...</p>
                  <p className="text-sm text-muted-foreground">Fetching the latest content from Danbooru</p>
                </div>
              </div>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && posts.length === 0 && (
            <div className="text-center py-12">
              <div className="space-y-4">
                <div className="text-6xl">{showFavorites ? "❤️" : "🎨"}</div>
                <div className="space-y-2">
                  <p className="text-lg font-medium">
                    {showFavorites ? "No favorites yet" : "No images found"}
                  </p>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto">
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
          <div className="container mx-auto px-4 py-8">
            <div className="text-center space-y-4">
              <div className="flex items-center justify-center space-x-2">
                <span className="text-sm text-muted-foreground">Powered by</span>
                <Badge variant="outline">Danbooru API</Badge>
              </div>
              <p className="text-xs text-muted-foreground max-w-2xl mx-auto">
                Generate prompts from Danbooru image tags. Our system extracts and formats tags from posts, removing unnecessary metadata to create clean, ready-to-use prompts for AI art generation. All images are sourced from Danbooru and belong to their respective creators.
              </p>
            </div>
          </div>
        </footer>
      </div>
    </TooltipProvider>
  )
}
