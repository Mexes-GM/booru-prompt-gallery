"use client"

import dynamic from "next/dynamic"
import { Loader2 } from "lucide-react"

const PromptGallery = dynamic(
  () => import("@/components/prompt-gallery/prompt-gallery").then((mod) => mod.PromptGallery),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    ),
  },
)

export default function PageClient() {
  return <PromptGallery />
}
