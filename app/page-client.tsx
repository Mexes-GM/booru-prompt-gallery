"use client"

import dynamic from "next/dynamic"
import { SavedArtistsProvider } from "@/hooks/use-saved-artists"
import { AppShell } from "@/components/prompt-gallery/app-shell"
import { prefetchFirstPostsPage } from "@/lib/booru/posts-prefetch"

// Runs when this chunk loads, before the gallery chunk below is even requested.
prefetchFirstPostsPage()

const PromptGallery = dynamic(
  () => import("@/components/prompt-gallery/prompt-gallery").then((mod) => mod.PromptGallery),
  {
    ssr: false,
    loading: () => <AppShell />,
  },
)

export default function PageClient() {
  return (
    <SavedArtistsProvider>
      <PromptGallery />
    </SavedArtistsProvider>
  )
}
