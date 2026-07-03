"use client"

import { ArtistGrid } from "@/components/prompt-gallery/artist-card"
import type { SavedArtist } from "@/hooks/use-saved-artists"

interface ArtistGridSectionProps {
  show: boolean
  artists: SavedArtist[]
  onSearch: (tag: string, provider?: string) => void
  onRemove: (provider: string, artistTag: string) => void
}

/**
 * Wraps the saved-artists grid shown when the "Artists" virtual favorites
 * folder is active. `onSearch` is owned by the caller (it needs to switch
 * provider, fire analytics, and exit favorites view), not reimplemented here.
 */
export function ArtistGridSection({ show, artists, onSearch, onRemove }: ArtistGridSectionProps) {
  if (!show) return null

  return (
    <div className="mb-8 min-h-[500px] mt-4">
      <ArtistGrid
        artists={artists}
        onSearch={onSearch}
        onRemove={onRemove}
      />
    </div>
  )
}
