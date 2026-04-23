"use client"

import { Palette } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useSavedArtists } from "@/hooks/use-saved-artists"
import type { BooruPost } from "@/lib/booru/types"

interface SaveArtistButtonProps {
    post: BooruPost
    booruProvider: string
    size?: "sm" | "md"
}

export function SaveArtistButton({ post, booruProvider, size = "md" }: SaveArtistButtonProps) {
    const { isSaved, saveArtist, removeArtist } = useSavedArtists()

    const artistTag = post.tag_string_artist?.trim().split(" ").filter(Boolean)[0]

    if (!artistTag) return null

    const saved = isSaved(booruProvider, artistTag)

    const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault()
        e.stopPropagation()

        if (saved) {
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
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    size="icon"
                    variant="secondary"
                    onClick={handleClick}
                    aria-label={saved ? `Remove artist ${artistTag}` : `Save artist ${artistTag}`}
                    className={cn(
                        "glass-effect transition-all",
                        isSmall ? "h-7 w-7" : "h-8 w-8",
                        saved
                            ? "text-purple-400 hover:text-purple-500"
                            : "text-muted-foreground hover:text-purple-400",
                    )}
                >
                    <Palette className={isSmall ? "w-3 h-3" : "w-3.5 h-3.5"} />
                </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
                {saved ? "Remove artist" : "Save artist"}
            </TooltipContent>
        </Tooltip>
    )
}
