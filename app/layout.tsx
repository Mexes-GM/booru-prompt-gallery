import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toaster"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Danbooru Prompt Gallery - AI Art Prompt Generator",
  description: "Generate high-quality prompts from Danbooru image tags. Our system extracts and formats tags from posts, removing unnecessary metadata to create clean, ready-to-use prompts for AI art generation.",
  keywords: ["AI art", "prompts", "danbooru", "image generation", "stable diffusion"],
  authors: [{ name: "Danbooru Prompt Gallery" }],
  openGraph: {
    title: "Danbooru Prompt Gallery",
    description: "Generate high-quality prompts from Danbooru image tags. Our system extracts and formats tags from posts, removing unnecessary metadata to create clean, ready-to-use prompts for AI art generation.",
    type: "website",
  },
    generator: 'v0.dev'
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
