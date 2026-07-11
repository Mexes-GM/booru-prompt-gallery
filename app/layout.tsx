import type React from "react"
import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toaster"
// Vercel Analytics — only collects data on Vercel deployments.
import { Analytics } from '@vercel/analytics/next'
// Cloudflare Web Analytics — privacy-friendly, works on Netlify and any host.
import { CloudflareAnalytics } from '@/components/analytics/cloudflare-analytics'
import ErrorBoundary from '@/components/error-boundary'
import { PostHogProvider } from '@/components/analytics/posthog-provider'

// Neutral, technical sans with character (anti-slop, not "toon"). Exposed as a
// CSS variable so Tailwind's `font-sans` (= var(--font-sans)) picks it up.
const fontSans = Geist({
  subsets: ["latin"],
  display: 'swap',
  preload: true,
  variable: '--font-sans',
})

// Monospace for data-heavy numeric fields; wired to Tailwind's `font-mono`.
const fontMono = Geist_Mono({
  subsets: ["latin"],
  display: 'swap',
  variable: '--font-mono',
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
    // Emits <meta name="google" content="notranslate"> — reinforces the
    // translate="no" attribute so Chrome/Google Translate never rewrites the
    // DOM and triggers React #185. See SENTRY-FULVOUS-ANCHOR-7.
    google: 'notranslate',
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
    { media: '(prefers-color-scheme: dark)', color: '#212936' },
    { media: '(prefers-color-scheme: light)', color: '#f6f9fb' },
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
    // translate="no" + the notranslate class opt the app out of browser/Google
    // auto-translation. Chrome (esp. on mobile, for non-English locales like
    // es-419) otherwise rewrites text nodes into <font> wrappers, mutating the
    // DOM out from under React and triggering "Maximum update depth exceeded"
    // (React #185) crashes. See SENTRY-FULVOUS-ANCHOR-7.
    <html lang="en" translate="no" suppressHydrationWarning>
      <body className={`${fontSans.variable} ${fontMono.variable} font-sans notranslate`} suppressHydrationWarning>
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
        <PostHogProvider>
          <ErrorBoundary>
            <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
              {children}
              <Toaster />
              {/* Vercel Analytics only reports data on Vercel; render it only there. */}
              {process.env.VERCEL === "1" && <Analytics />}
              {/* Cloudflare Web Analytics covers Netlify (and any other host). */}
              <CloudflareAnalytics />
            </ThemeProvider>
          </ErrorBoundary>
        </PostHogProvider>
      </body>
    </html>
  )
}
