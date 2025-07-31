import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toaster"

const inter = Inter({ 
  subsets: ["latin"],
  display: 'swap',
  preload: true,
})

export const metadata: Metadata = {
  title: "Danbooru Prompt Gallery - AI Art Prompt Generator",
  description: "Generate prompts from Danbooru image tags. This web app extracts and formats tags from posts, removing unnecessary metadata to create clean, ready-to-use prompts for AI art generation.",
  keywords: ["AI art", "prompts", "danbooru", "image generation", "stable diffusion"],
  authors: [{ name: "Danbooru Prompt Gallery" }],
  openGraph: {
    title: "Danbooru Prompt Gallery",
    description: "Generate prompts from Danbooru image tags. This web app extracts and formats tags from posts, removing unnecessary metadata to create clean, ready-to-use prompts for AI art generation.",
    type: "website",
  },
  generator: 'v0.dev',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://danbooru.donmai.us" />
        <link rel="preconnect" href="https://cdn.donmai.us" />
        <link rel="dns-prefetch" href="https://danbooru.donmai.us" />
        <link rel="dns-prefetch" href="https://cdn.donmai.us" />
      </head>
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
