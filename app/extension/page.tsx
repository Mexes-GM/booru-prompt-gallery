import { VercelPauseCurtain } from "@/components/prompt-gallery/vercel-pause-curtain"
import ExtensionClient from "./extension-client"

export const dynamic = "force-static"

export default function ExtensionPage() {
  if (process.env.VERCEL === "1") {
    return <VercelPauseCurtain />
  }

  return <ExtensionClient />
}
