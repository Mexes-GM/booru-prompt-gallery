import type React from "react"
import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toaster"
import { Analytics } from '@vercel/analytics/next'
import ErrorBoundary from '@/components/error-boundary'

const inter = Inter({
  subsets: ["latin"],
  display: 'swap',
  preload: true,
})

export const metadata: Metadata = {
  metadataBase: new URL('https://booru-prompt-gallery.vercel.app'),
  title: {
    default: "Booru Prompt Gallery - By Mexes",
    template: "%s | Booru Prompt Gallery"
  },
  description: "Generate clean prompts from Danbooru, Aibooru, Rule34, Gelbooru and e621 posts. Extract and format tags from images, remove unnecessary metadata, LoRa tags, and quality descriptors to create ready-to-use prompts for AI art generation.",
  keywords: [
    "AI art", "prompts", "danbooru", "aibooru", "rule34", "gelbooru", "e621", "image generation", "stable diffusion",
    "midjourney", "dall-e", "prompt engineering", "tag extraction", "anime art",
    "digital art", "art generator", "prompt gallery", "booru", "tag database",
    "lora tags", "quality tags", "prompt cleaning", "tag removal"
  ],
  authors: [{ name: "Mexes", url: "https://booru-prompt-gallery.vercel.app" }],
  creator: "Mexes",
  publisher: "Mexes",
  category: "Art & Design",
  classification: "AI Art Tools",
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon.png', sizes: '16x16', type: 'image/png' },
      { url: '/icon.png', sizes: '192x192', type: 'image/png' }
    ],
    shortcut: '/favicon.ico',
    apple: [
      { url: '/icon.png', sizes: '180x180', type: 'image/png' }
    ],
    other: [
      {
        rel: 'icon',
        url: '/icon.png',
        sizes: '192x192',
        type: 'image/png'
      }
    ]
  },
  manifest: '/manifest.json',
  openGraph: {
    title: "Danbooru Prompt Gallery - By Mexes",
    description: "Generate prompts from Danbooru image tags. Extract and format tags from posts, removing unnecessary metadata to create clean, ready-to-use prompts for AI art generation.",
    type: "website",
    url: "https://booru-prompt-gallery.vercel.app",
    siteName: "Booru Prompt Gallery",
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
    title: "Booru Prompt Gallery - By Mexes",
    description: "Generate prompts from Danbooru image tags for AI art generation",
    images: ["/placeholder-logo.png"],
    creator: "@mexes_art"
  },
  alternates: {
    canonical: "https://booru-prompt-gallery.vercel.app"
  },
  generator: 'Next.js',
  applicationName: 'Booru Prompt Gallery',
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

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'Booru Prompt Gallery',
    description: 'Generate clean prompts from Danbooru, Aibooru, Rule34, Gelbooru and e621 posts.',
    url: 'https://booru-prompt-gallery.vercel.app',
    applicationCategory: 'DesignApplication',
    operatingSystem: 'Any',
    author: {
      '@type': 'Person',
      name: 'Mexes'
    },
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD'
    }
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <link rel="icon" type="image/x-icon" href="/favicon.ico" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icon.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/icon.png" />
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
        <meta name="msapplication-TileColor" content="#000000" />
        <meta name="msapplication-config" content="/browserconfig.xml" />
      </head>
      <body className={inter.className} suppressHydrationWarning>
        <ErrorBoundary>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
            {children}
            <Toaster />
            <Analytics />
          </ThemeProvider>
        </ErrorBoundary>
      </body>
    </html>
  )
}
