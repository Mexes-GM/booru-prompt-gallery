"use client"

import { SavedArtistsProvider } from "@/hooks/use-saved-artists"
import { PromptGallery } from "@/components/prompt-gallery/prompt-gallery"

/**
 * Everything the home page renders once its gallery chunk has loaded. The
 * saved-artists provider lives here, not in app/page-client.tsx, because it
 * pulls in the Supabase client: imported from the page it would ship in the
 * scripts the HTML loads up front, ahead of the first paint.
 */
export function GalleryRoot() {
  return (
    <SavedArtistsProvider>
      <PromptGallery />
    </SavedArtistsProvider>
  )
}
