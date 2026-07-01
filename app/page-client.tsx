"use client"

import dynamic from "next/dynamic"
import { SavedArtistsProvider } from "@/hooks/use-saved-artists"
import { AppShell } from "@/components/prompt-gallery/app-shell"

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
