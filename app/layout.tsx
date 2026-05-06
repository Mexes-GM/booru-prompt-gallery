import type React from "react"
import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toaster"
// Vercel Analytics — only renders on Vercel deployments (no-op on Netlify/other hosts)
import { Analytics } from '@vercel/analytics/next'
import ErrorBoundary from '@/components/error-boundary'

const inter = Inter({
  subsets: ["latin"],
  display: 'swap',
  preload: true,
})

// Base URL: set NEXT_PUBLIC_APP_URL in your deployment environment (Vercel or Netlify).
// Falls back to Vercel auto-detected URL, then hardcoded default.
const baseUrl = process.env.NEXT_PUBLIC_APP_URL 
  || (process.env.NEXT_PUBLIC_VERCEL_URL ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}` : '')
  || 'https://booru-prompt-gallery.netlify.app'

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: "Booru Prompt Gallery - By Mexes",
    template: "%s | Booru Prompt Gallery"
  },
  description: "Generate clean prompts from Danbooru, Aibooru, Rule34, Gelbooru and e621 posts. Extract and format tags for AI art generation.",
  keywords: [
    "AI art", "prompts", "danbooru", "aibooru", "rule34", "gelbooru", "e621", "image generation", "stable diffusion",
    "midjourney", "dall-e", "prompt engineering", "tag extraction", "anime art",
    "digital art", "art generator", "prompt gallery", "booru", "tag database",
    "lora tags", "quality tags", "prompt cleaning", "tag removal"
  ],
  authors: [{ name: "Mexes", url: baseUrl }],
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
    title: "Booru Prompt Gallery - By Mexes",
    description: "Generate prompts from Danbooru, Aibooru, Rule34, Gelbooru and e621 posts. Extract and format tags from posts, removing unnecessary metadata to create clean, ready-to-use prompts for AI art generation.",
    type: "website",
    url: baseUrl,
    siteName: "Booru Prompt Gallery",
    locale: "en_US",
    images: [
      {
        url: "/placeholder-logo.png",
        width: 1200,
        height: 630,
        alt: "Booru Prompt Gallery - By Mexes",
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
    canonical: baseUrl
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
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Booru Gallery',
  },
  other: {
    'msapplication-TileColor': '#000000',
    'msapplication-config': '/browserconfig.xml',
  },
  verification: {
    google: 'oV_N0Kfu6vS1TFmbLjhRvmawBmVCnRk9VrlKawuEosE',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
  ],
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
    url: baseUrl,
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
      <body className={inter.className} suppressHydrationWarning>
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 z-50 bg-background px-4 py-2 border rounded shadow-md">
          Skip to content
        </a>
        {process.env.NEXT_PUBLIC_IMAGE_PROXY_URL && (
          <>
            <link rel="preconnect" href={process.env.NEXT_PUBLIC_IMAGE_PROXY_URL} />
            <link rel="dns-prefetch" href={process.env.NEXT_PUBLIC_IMAGE_PROXY_URL} />
          </>
        )}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
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
