"use client"

import { Download, ExternalLink, MoreHorizontal, Package, Palette, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useSavedArtists } from "@/hooks/use-saved-artists"
import type { BooruPost } from "@/lib/booru/types"

interface CardActionsMenuProps {
    post: BooruPost
    booruProvider: string
    postUrl: string
    size?: "sm" | "md"
    onConvert: () => void
    onDownload: () => void
    onOpenOriginal: () => void
    /** Outside Pack Mode only — activates it with this post as the base. */
    onMakePack?: () => void
}

/**
 * Secondary card actions (save artist, convert, download, view original),
 * collapsed behind a single "⋯" trigger so the card's hover state only adds
 * two controls (favorite + this menu). Lives in its own component so the
 * useSavedArtists context subscription doesn't re-render the memoized card.
 */
export function CardActionsMenu({
    post,
    booruProvider,
    postUrl,
    size = "md",
    onConvert,
    onDownload,
    onOpenOriginal,
    onMakePack,
}: CardActionsMenuProps) {
    const { isSaved, saveArtist, removeArtist } = useSavedArtists()

    const artistTag = post.tag_string_artist?.trim().split(" ").filter(Boolean)[0]
    const artistSaved = artistTag ? isSaved(booruProvider, artistTag) : false

    const toggleArtist = async () => {
        if (!artistTag) return
        if (artistSaved) {
            await removeArtist(booruProvider, artistTag)
        } else {
            await saveArtist({
                provider: booruProvider,
                artistTag,
                thumbnailUrl: post.large_file_url || post.file_url || post.preview_file_url || null,
                thumbnailPostId: post.id,
            })
        }
    }

    const isSmall = size === "sm"

    return (
        <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
                <Button
                    size="icon"
                    variant="secondary"
                    className={`rounded-full bg-background/80 hover:bg-background/95 text-muted-foreground hover:text-foreground shadow-sm ${isSmall ? "h-7 w-7" : "h-8 w-8"}`}
                    aria-label="More actions"
                >
                    <MoreHorizontal className={isSmall ? "w-3.5 h-3.5" : "w-4 h-4"} aria-hidden="true" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[10005] w-52" onClick={(e) => e.stopPropagation()}>
                {artistTag && (
                    <DropdownMenuItem onSelect={toggleArtist}>
                        <Palette className={`mr-2 h-4 w-4 ${artistSaved ? "text-primary-text" : ""}`} />
                        <span className="flex-1 truncate">
                            {artistSaved ? "Remove artist" : "Save artist"}
                        </span>
                    </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={onConvert}>
                    <Sparkles className="mr-2 h-4 w-4 text-primary-text" />
                    Convert to natural language
                </DropdownMenuItem>
                {onMakePack && (
                    <DropdownMenuItem onSelect={onMakePack}>
                        <Package className="mr-2 h-4 w-4 text-mode-pack-text" />
                        Make pack
                    </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={onDownload}>
                    <Download className="mr-2 h-4 w-4" />
                    Download image
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                    <a href={postUrl} target="_blank" rel="noopener noreferrer" onClick={onOpenOriginal}>
                        <ExternalLink className="mr-2 h-4 w-4" />
                        View original post
                    </a>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
