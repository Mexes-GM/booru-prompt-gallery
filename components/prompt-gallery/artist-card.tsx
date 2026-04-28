"use client"

import { useState, useMemo, type MouseEvent as ReactMouseEvent } from "react"
import Image from "next/image"
import { motion, AnimatePresence } from "framer-motion"
import { Palette, Search, ExternalLink, Trash2, ImageOff } from "lucide-react"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { getProviderSearchUrl } from "@/lib/constants"
import type { SavedArtist } from "@/hooks/use-saved-artists"
import { getDanbooruProxyUrl } from "@/lib/proxy-url"

interface ArtistCardProps {
    artist: SavedArtist
    onSearch: (tag: string, provider: string) => void
    onRemove: (provider: string, artistTag: string) => void
}

const PROVIDER_LABELS: Record<string, string> = {
    danbooru: "Danbooru",
    aibooru: "Aibooru",
    rule34: "Rule34",
    gelbooru: "Gelbooru",
    e621: "e621",
}

export function ArtistCard({ artist, onSearch, onRemove }: ArtistCardProps) {
    const [imageError, setImageError] = useState(false)

    const displayName = artist.artistTag.replace(/_/g, " ")
    const providerLabel = PROVIDER_LABELS[artist.provider.toLowerCase()] || artist.provider

    const thumbnailUrl = useMemo(() => {
        if (!artist.thumbnailUrl) return artist.thumbnailUrl
        const isDanbooru = artist.provider === 'danbooru' || artist.thumbnailUrl.includes('donmai.us')
        const finalUrl = isDanbooru ? getDanbooruProxyUrl(artist.thumbnailUrl) : artist.thumbnailUrl
        return finalUrl
    }, [artist.thumbnailUrl, artist.provider])

    const handleSearch = () => onSearch(artist.artistTag, artist.provider)
    const handleOpenProvider = () => {
        const url = getProviderSearchUrl(artist.provider, artist.artistTag)
        window.open(url, "_blank", "noopener,noreferrer")
    }
    const handleRemoveClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
        e.preventDefault()
        e.stopPropagation()
        onRemove(artist.provider, artist.artistTag)
    }

    return (
        <motion.div
            layout
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 260, damping: 22 }}
        >
            <Card
                className="w-full overflow-hidden card-hover group flex flex-col relative transition-all duration-300 cursor-pointer"
                onClick={handleSearch}
                role="button"
                tabIndex={0}
                aria-label={`Search for artist ${displayName}`}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        handleSearch()
                    }
                }}
            >
                {/* Image section — matches masonry card proportions (3/4) */}
                <div className="relative bg-muted overflow-hidden aspect-[3/4]">
                    {thumbnailUrl && !imageError ? (
                        <Image
                            src={thumbnailUrl}
                            alt={`Reference artwork by ${displayName}`}
                            fill
                            className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                            unoptimized
                            loading="lazy"
                            decoding="async"
                            onError={() => setImageError(true)}
                        />
                    ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-gradient-to-br from-purple-500/10 to-muted/50 text-muted-foreground">
                            {imageError ? (
                                <>
                                    <ImageOff className="w-8 h-8 opacity-40" />
                                    <span className="text-xs opacity-60">Image unavailable</span>
                                </>
                            ) : (
                                <Palette className="w-12 h-12 opacity-30" />
                            )}
                        </div>
                    )}

                    {/* Top-left: provider badge */}
                    <div className="absolute top-2 left-2 pointer-events-none">
                        <Badge
                            variant="secondary"
                            className="px-2 py-0.5 text-[10px] font-medium bg-black/55 backdrop-blur-sm text-white/95 border-0 flex items-center gap-1"
                        >
                            <Palette className="w-3 h-3" />
                            {providerLabel}
                        </Badge>
                    </div>

                    {/* Top-right: hover actions (delete) */}
                    <div
                        className="absolute top-2 right-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    size="icon"
                                    variant="secondary"
                                    onClick={handleRemoveClick}
                                    aria-label={`Remove saved artist ${displayName}`}
                                    className={cn(
                                        "glass-effect h-7 w-7 transition-all",
                                        "text-muted-foreground hover:text-red-500",
                                    )}
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="left">Remove</TooltipContent>
                        </Tooltip>
                    </div>

                    {/* Artist name overlaid at bottom of image */}
                    <div className="absolute inset-x-0 bottom-0 p-2.5">
                        <h3 className="text-white font-semibold text-sm leading-tight line-clamp-2 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                            {displayName}
                        </h3>
                    </div>
                </div>

                {/* Action footer — mirrors masonry card footer style */}
                <div className="p-2 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                size="sm"
                                variant="secondary"
                                onClick={handleSearch}
                                className="flex-1 h-8 gap-1.5 text-xs"
                                aria-label={`Search posts by ${displayName}`}
                            >
                                <Search className="w-3.5 h-3.5" />
                                Search
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Send to search bar</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                size="icon"
                                variant="ghost"
                                onClick={handleOpenProvider}
                                className="h-8 w-8 focus-ring"
                                aria-label={`Open ${displayName} on ${providerLabel}`}
                            >
                                <ExternalLink className="w-3.5 h-3.5" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Open on {providerLabel}</TooltipContent>
                    </Tooltip>
                </div>
            </Card>
        </motion.div>
    )
}

interface ArtistGridProps {
    artists: SavedArtist[]
    onSearch: (tag: string, provider: string) => void
    onRemove: (provider: string, artistTag: string) => void
}

export function ArtistGrid({ artists, onSearch, onRemove }: ArtistGridProps) {
    if (artists.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                <div className="relative mb-4">
                    <div className="absolute inset-0 blur-2xl bg-purple-500/20 rounded-full" />
                    <Palette className="relative w-16 h-16 text-purple-400/60" strokeWidth={1.5} />
                </div>
                <h3 className="text-lg font-semibold mb-2">No artists saved yet</h3>
                <p className="text-sm text-muted-foreground max-w-md">
                    Click the palette icon on any post to save its artist. You&apos;ll find them all here, ready
                    to search when you forget their name.
                </p>
            </div>
        )
    }

    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4 mb-8">
            <AnimatePresence mode="popLayout">
                {artists.map((artist) => (
                    <ArtistCard
                        key={`${artist.provider}:${artist.artistTag}`}
                        artist={artist}
                        onSearch={onSearch}
                        onRemove={onRemove}
                    />
                ))}
            </AnimatePresence>
        </div>
    )
}
