import { VercelPauseCurtain } from "@/components/prompt-gallery/vercel-pause-curtain"
import ExtensionClient from "./extension-client"

export const dynamic = "force-static"

export default function ExtensionPage() {
  // Maintenance mode curtain — set MAINTENANCE_MODE=1 to take the app offline.
  if (process.env.MAINTENANCE_MODE === "1") {
    return <VercelPauseCurtain />
  }

  return <ExtensionClient />
}
