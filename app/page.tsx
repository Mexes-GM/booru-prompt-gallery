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
  // Maintenance mode curtain — set MAINTENANCE_MODE=1 to take the app offline.
  // Blocks all non-root routes via middleware, serves this static page on /.
  if (process.env.MAINTENANCE_MODE === "1") {
    return <VercelPauseCurtain />
  }

  return <PageClient />
}
