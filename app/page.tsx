"use client"

import { Suspense } from "react"
import { PromptGallery } from "@/components/prompt-gallery/prompt-gallery"
import { Loader2 } from "lucide-react"

export default function DanbooruPromptGenerator() {
  return (
    <Suspense fallback={<div className="flex h-screen w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
      <PromptGallery />
    </Suspense>
  )
}
