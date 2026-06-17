import type { Metadata } from "next"
import type React from "react"

export const metadata: Metadata = {
  title: "Booru Prompt Gallery - Pocket Extension",
  description: "A pocket version of Booru Prompt Gallery optimized for browser sidebars.",
}

export default function ExtensionLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
