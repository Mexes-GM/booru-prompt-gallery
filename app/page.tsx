import type { Metadata } from "next"
import PageClient from "./page-client"
import { VercelPauseCurtain } from "@/components/prompt-gallery/vercel-pause-curtain"

// Force this page to be fully static at build time. On Vercel this means "/"
// is served from the CDN without running any serverless function, so it does
// not consume Fluid CPU or hit Supabase on every request.
export const dynamic = "force-static"

export const metadata: Metadata = {
  title: "Booru Prompt Gallery - By Mexes",
}

export default function DanbooruPromptGenerator() {
  // Pause the Vercel deployment by serving a static curtain instead of the app.
  if (process.env.VERCEL === "1") {
    return <VercelPauseCurtain />
  }

  return <PageClient />
}
