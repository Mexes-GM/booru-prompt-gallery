"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
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
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import Image from "next/image"
import { useInfinitePosts } from "@/lib/api-client"
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
  const [ratingFilter, setRatingFilter] = useState("rating:safe")
  const [order, setOrder] = useState<"popular" | "recent">("popular")
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [cardScale, setCardScale] = useState<CardScale>("medium")
  const [scaleValue, setScaleValue] = useState([2]) // 1=small, 2=medium, 3=large
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [favorites, setFavorites] = useState<Set<number>>(new Set())
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

  const posts = pages ? pages.flat() : []
  const isLoadingMore = isValidating && size > 1
  const loadMore = () => setSize(size + 1)
  const refresh = () => mutate()

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
    setFavorites((prev) => {
      const newFavorites = new Set(prev)
      if (newFavorites.has(postId)) {
        newFavorites.delete(postId)
      } else {
        newFavorites.add(postId)
      }
      return newFavorites
    })
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    refresh()
  }

  const clearSearch = () => {
    setSearchTags("")
    refresh()
  }

  const decreaseScale = () => {
    setScaleValue([Math.max(1, scaleValue[0] - 1)])
  }

  const increaseScale = () => {
    setScaleValue([Math.min(3, scaleValue[0] + 1)])
  }

  // Handle errors
  useEffect(() => {
    if (error) {
      toast({
        title: "Connection error",
        description: error.message || "Could not load images",
        variant: "destructive",
      })
    }
  }, [error, toast])

  // Refresh when order or ratingFilter changes
  useEffect(() => {
    refresh()
  }, [order, ratingFilter])

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
                  Booru Gallery
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
                Explore curated image collections and generate high-quality prompts for your AI art projects
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
                      placeholder="Search by tags (e.g., cat girl, blue eyes, long hair)"
                      className="pl-10 focus-ring"
                      aria-label="Search tags"
                    />
                  </div>

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
                        <SelectItem value="rating:safe">Safe</SelectItem>
                        <SelectItem value="rating:questionable">Questionable</SelectItem>
                        <SelectItem value="rating:explicit">Explicit</SelectItem>
                        <SelectItem value="all">All ratings</SelectItem>
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
                        disabled={isLoading}
                        className="focus-ring bg-transparent"
                      >
                        <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
                      </Button>
                    </div>
                  </div>
                </form>

                {/* Active filters display */}
                {(searchTags || ratingFilter !== "rating:safe") && (
                  <div className="mt-4 pt-4 border-t border-border/50">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <span>Active filters:</span>
                      {searchTags && <Badge variant="secondary">Tags: {searchTags}</Badge>}
                      {ratingFilter && ratingFilter !== "rating:safe" && (
                        <Badge variant="secondary">Rating: {ratingFilter.replace("rating:", "")}</Badge>
                      )}
                      <Badge variant="secondary">Sort: {order === "popular" ? "Most popular" : "Most recent"}</Badge>
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

                      {/* Score badge */}
                      {post.score > 0 && (
                        <div className="absolute bottom-2 left-2">
                          <Badge variant="secondary" className={`glass-effect ${getBadgeClass()}`}>
                            <Eye className={`${getIconClass()} mr-1`} />
                            {post.score}
                          </Badge>
                        </div>
                      )}
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
                                {post.score > 0 && (
                                  <Badge variant="secondary">
                                    <Eye className="w-3 h-3 mr-1" />
                                    {post.score}
                                  </Badge>
                                )}
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
          {posts.length > 0 && (
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
                <div className="text-6xl">🎨</div>
                <div className="space-y-2">
                  <p className="text-lg font-medium">No images found</p>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    Try adjusting your search terms or filters to discover more content
                  </p>
                </div>
                <Button onClick={clearSearch} variant="outline" className="focus-ring bg-transparent">
                  Clear Search
                </Button>
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
                This tool helps generate AI art prompts from curated image collections. All images are sourced from
                Danbooru and belong to their respective creators.
              </p>
            </div>
          </div>
        </footer>
      </div>
    </TooltipProvider>
  )
}
