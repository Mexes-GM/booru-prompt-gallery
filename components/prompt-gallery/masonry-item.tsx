import { useCallback } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Copy,
  Check,
  ExternalLink,
  Heart,
  Download,
  ChevronDown,
  Shirt,
  User,
  Mountain,
  Smile,
  GraduationCap,
} from "lucide-react"
import Image from "next/image"
import { 
    BooruPost, 
    isAibooruPost, 
    getPromptFromPost, 
    removeLoRaTags as removeLoRaTagsUtil, 
    removeQualityTags as removeQualityTagsUtil, 
    BooruProvider 
} from "@/lib/api-client"
import { cleanPrompt } from "@/lib/cleanPrompt"
import { classifyTags, TagCategory } from "@/lib/tag-classifier"
import { 
    DropdownMenu, 
    DropdownMenuContent, 
    DropdownMenuItem, 
    DropdownMenuLabel, 
    DropdownMenuSeparator, 
    DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { trackExternalLink } from "@/lib/analytics"
import { toast } from "@/hooks/use-toast"
import { SCALE_CONFIG } from "@/components/masonry-grid"

interface MasonryItemProps {
    post: BooruPost
    width: number
    height: number
    viewMode?: "grid" | "list"
    effectiveScale: "small" | "medium" | "large"
    booruProvider: BooruProvider
    favorites: Set<string>
    toggleFavorite: (id: number, provider?: string) => void
    downloadImage: (post: BooruPost) => void
    copyToClipboard: (text: string, id: number, isPrompt: boolean, thumb?: string) => Promise<void>
    excludeInput: string
    addInput: string
    includeCharacters: boolean
    optimizeTags: boolean
    removeLoRaTags: boolean
    removeQualityTags: boolean
    tagOverrides: Record<string, string>
    copiedId: number | null
    setTeachModalData: (data: { open: boolean, tags: any }) => void
}

export function MasonryItem({
    post,
    width,
    height,
    viewMode = "grid",
    effectiveScale,
    booruProvider,
    favorites,
    toggleFavorite,
    downloadImage,
    copyToClipboard,
    excludeInput,
    addInput,
    includeCharacters,
    optimizeTags,
    removeLoRaTags,
    removeQualityTags,
    tagOverrides,
    copiedId,
    setTeachModalData
}: MasonryItemProps) {
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
    const characterTagsSet = new Set(
        (post.tag_string_character ? post.tag_string_character.split(' ') : [])
        .map(t => t.replace(/_/g, ' ').toLowerCase())
    )

    const filteredTagsForClassification = tagsForClassification.filter(t => {
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

    const itemProvider = post._provider || booruProvider
    let postUrl = `https://danbooru.donmai.us/posts/${post.id}`
    
    if (isAiPost || itemProvider === 'aibooru') {
       postUrl = `https://aibooru.online/posts/${post.id}`
    } else if (itemProvider === 'rule34') {
       postUrl = `https://rule34.xxx/index.php?page=post&s=view&id=${post.id}`
    } else if (itemProvider === 'e621') {
       postUrl = `https://e621.net/posts/${post.id}`
    }

    const isFavorited = favorites.has(`${itemProvider}:${post.id}`)

    const getCardContentClass = () => {
        switch (effectiveScale) {
          case "small": return "card-content-small"
          case "medium": return "card-content-medium"
          case "large": return "card-content-large"
          default: return "card-content-medium"
        }
    }
    
    const getIconClass = () => {
        switch (effectiveScale) {
          case "small": return "icon-small"
          case "medium": return "icon-medium"
          case "large": return "icon-large"
          default: return "icon-medium"
        }
    }

    // Grid View
    if (viewMode === "grid") {
        const footerHeight = SCALE_CONFIG[effectiveScale].footerHeight
        const imageHeight = height - footerHeight

        return (
            <Card className="w-full h-full overflow-hidden card-hover group flex flex-col">
            <div className="relative bg-muted overflow-hidden" style={{ height: imageHeight }}>
                <Image
                src={fileUrl!}
                alt={`${itemProvider} post ${post.id} - ${post.tag_string ? post.tag_string.slice(0, 150) : 'anime art'}`}
                fill
                className="object-cover object-top transition-transform duration-300 group-hover:scale-105"
                sizes={`${width}px`}
                priority={false}
                />

                {/* Overlay actions */}
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                <Tooltip>
                    <TooltipTrigger asChild>
                    <Button
                        size="icon"
                        variant="secondary"
                        className={`glass-effect ${effectiveScale === "small" ? "h-7 w-7" : "h-8 w-8"}`}
                        onClick={() => toggleFavorite(post.id, post._provider)}
                        aria-label={isFavorited ? "Remove from favorites" : "Add to favorites"}
                    >
                        <Heart
                        className={`${effectiveScale === "small" ? "w-3 h-3" : "w-3.5 h-3.5"} ${isFavorited ? "fill-red-500 text-red-500" : ""}`}
                        />
                    </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                    {isFavorited ? "Remove from favorites" : "Add to favorites"}
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
                        aria-label="Copy options"
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
    }

    // List View
    return (
        <Card className="overflow-hidden card-hover">
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
                    src={fileUrl!}
                    alt={`${itemProvider} post ${post.id}`}
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
                            aria-label={isFavorited ? "Remove from favorites" : "Add to favorites"}
                            >
                            <Heart
                                className={`h-4 w-4 ${isFavorited ? "fill-red-500 text-red-500" : ""}`}
                            />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            {isFavorited ? "Remove from favorites" : "Add to favorites"}
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
}
