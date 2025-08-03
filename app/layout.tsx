import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toaster"
import { Analytics } from '@vercel/analytics/next'
import { StructuredData } from './structured-data'

const inter = Inter({ 
  subsets: ["latin"],
  display: 'swap',
  preload: true,
})

export const metadata: Metadata = {
  metadataBase: new URL('https://danbooru-prompt-gallery.vercel.app'),
  title: {
    default: "Danbooru Prompt Gallery - By Mexes",
    template: "%s | Danbooru Prompt Gallery"
  },
  description: "Generate prompts from Danbooru image tags. The system of this web app extracts and formats tags from posts, removing unnecessary metadata to create clean, ready-to-use prompts for AI art generation.",
  keywords: [
    "AI art", "prompts", "danbooru", "image generation", "stable diffusion",
    "midjourney", "dall-e", "prompt engineering", "tag extraction", "anime art",
    "digital art", "art generator", "prompt gallery", "booru", "tag database"
  ],
  authors: [{ name: "Mexes", url: "https://danbooru-prompt-gallery.vercel.app" }],
  creator: "Mexes",
  publisher: "Mexes",
  category: "Art & Design",
  classification: "AI Art Tools",
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon.png', sizes: '16x16', type: 'image/png' }
    ],
    shortcut: '/favicon.ico',
    apple: [
      { url: '/favicon.png', sizes: '180x180', type: 'image/png' }
    ],
  },
  manifest: '/manifest.json',
  openGraph: {
    title: "Danbooru Prompt Gallery - By Mexes",
    description: "Generate prompts from Danbooru image tags. Extract and format tags from posts, removing unnecessary metadata to create clean, ready-to-use prompts for AI art generation.",
    type: "website",
    url: "https://danbooru-prompt-gallery.vercel.app",
    siteName: "Danbooru Prompt Gallery",
    locale: "en_US",
    images: [
      {
        url: "/placeholder-logo.png",
        width: 1200,
        height: 630,
        alt: "Danbooru Prompt Gallery - By Mexes",
        type: "image/png"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: "Danbooru Prompt Gallery - By Mexes",
    description: "Generate prompts from Danbooru image tags for AI art generation",
    images: ["/placeholder-logo.png"],
    creator: "@your_twitter_handle"
  },
  alternates: {
    canonical: "https://danbooru-prompt-gallery.vercel.app"
  },
  generator: 'Next.js',
  applicationName: 'Danbooru Prompt Gallery',
  referrer: 'origin-when-cross-origin',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  robots: {
    index: true,
    follow: true,
    nocache: false,
    googleBot: {
      index: true,
      follow: true,
      noimageindex: false,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  verification: {
    google: 'your-google-verification-code',
    yandex: 'your-yandex-verification-code',
    yahoo: 'your-yahoo-verification-code',
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
        <link rel="icon" type="image/x-icon" href="/favicon.ico" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon.png" />
        <link rel="preconnect" href="https://danbooru.donmai.us" />
        <link rel="preconnect" href="https://cdn.donmai.us" />
        <link rel="dns-prefetch" href="https://danbooru.donmai.us" />
        <link rel="dns-prefetch" href="https://cdn.donmai.us" />
        <meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)" />
        <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Danbooru Gallery" />
        <link rel="apple-touch-icon" href="/favicon.png" />
        <link rel="mask-icon" href="/favicon.png" color="#000000" />
        <meta name="msapplication-TileColor" content="#000000" />
        <meta name="msapplication-config" content="/browserconfig.xml" />
      </head>
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <StructuredData />
          {children}
          <Toaster />
          <Analytics />
        </ThemeProvider>
      </body>
    </html>
  )
}
