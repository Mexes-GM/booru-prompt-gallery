"use client"

import dynamic from "next/dynamic"
import { AppShell } from "@/components/prompt-gallery/app-shell"
import { prefetchFirstPostsPage } from "@/lib/booru/posts-prefetch"

const loadGallery = () => import("@/components/prompt-gallery/gallery-root")

// Runs when this chunk loads, before the gallery chunk below is even requested.
prefetchFirstPostsPage()

// Starts the gallery's chunks as soon as this chunk runs instead of when the
// page first renders. Not preloaded from the HTML on purpose: there they
// compete with the page's own scripts for the first paint.
if (typeof window !== "undefined") void loadGallery()

const GalleryRoot = dynamic(
  () => loadGallery().then((mod) => mod.GalleryRoot),
  {
    ssr: false,
    loading: () => <AppShell />,
  },
)

export default function PageClient() {
  return <GalleryRoot />
}
