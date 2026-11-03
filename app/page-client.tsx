"use client"

import dynamic from "next/dynamic"
import { AppShell } from "@/components/prompt-gallery/app-shell"
import { prefetchFirstPostsPage } from "@/lib/booru/posts-prefetch"

// Runs when this chunk loads, before the gallery chunk below is even requested.
prefetchFirstPostsPage()

const GalleryRoot = dynamic(
  () => import("@/components/prompt-gallery/gallery-root").then((mod) => mod.GalleryRoot),
  {
    ssr: false,
    loading: () => <AppShell />,
  },
)

export default function PageClient() {
  return <GalleryRoot />
}
