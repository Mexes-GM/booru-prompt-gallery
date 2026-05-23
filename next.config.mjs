/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    optimizePackageImports: ['lucide-react', '@radix-ui/react-icons'],
  },
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  // output: 'standalone', // Removed: not needed for Vercel and forces SSR, increasing origin transfer
  poweredByHeader: false,
  compress: true,
  generateEtags: true,
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'danbooru.donmai.us',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'cdn.donmai.us',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'aibooru.online',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.aibooru.online',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'cdn.aibooru.download',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.aibooru.download',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'rule34.xxx',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.rule34.xxx',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'e621.net',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.e621.net',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'static1.e621.net',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'gelbooru.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.gelbooru.com',
        pathname: '/**',
      },
    ],
    dangerouslyAllowSVG: false,
    formats: ['image/webp', 'image/avif'],
  },
  headers: async () => {
    return [
      {
        source: '/api/(.*)',
        headers: [
          // Vercel CDN cache directive (Vercel varies cache by full URL including query params)
          {
            key: 'Vercel-CDN-Cache-Control',
            value: 'public, s-maxage=600',
          },
          // Do NOT set Netlify-CDN-Cache-Control here!
          // Netlify's netlify-vary only includes Next.js internal query params
          // (__nextDataReq, _rsc), NOT our API params (page, tags, seed, order).
          // Setting a public cache here causes ALL /api/posts?* URLs to share
          // one cached response, breaking infinite scroll pagination.
          // Each API route sets its own Netlify-CDN-Cache-Control per-response.
          {
            key: 'Netlify-CDN-Cache-Control',
            value: 'no-store',
          },
        ],
      },
      {
        source: '/_next/image(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=2678400, immutable',
          },
        ],
      },
      {
        source: '/sitemap.xml',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, s-maxage=86400, stale-while-revalidate=43200',
          },
        ],
      },
      {
        source: '/manifest.json',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, s-maxage=86400, stale-while-revalidate=43200',
          },
        ],
      },
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ]
  },
}

// Only wrap with Sentry when SENTRY_AUTH_TOKEN is set (production builds)
const sentryConfigured = Boolean(process.env.SENTRY_AUTH_TOKEN)
let config = nextConfig

if (sentryConfigured) {
  try {
    const { withSentryConfig } = await import('@sentry/nextjs')
    config = withSentryConfig(nextConfig, {
      org: 'boorupromptgallery',
      project: 'sentry-fulvous-anchor',

      // Only print logs for uploading source maps in CI
      silent: !process.env.CI,

      // Upload a larger set of source maps for prettier stack traces
      widenClientFileUpload: true,

      // Attach source maps for better debugging
      // Requires SENTRY_AUTH_TOKEN to be set in environment
      authToken: process.env.SENTRY_AUTH_TOKEN,

      // Hide source maps from bundle to reduce size
      hideSourceMaps: true,

      // Do NOT tunnel Sentry requests through Next.js server —
      // this would add CPU and bandwidth to your Vercel bill.
      // tunnelRoute: "/monitoring",  // DISABLED to save resources

      webpack: {
        automaticVercelMonitors: true,
        treeshake: {
          removeDebugLogging: true,
        },
      },
    })
  } catch {
    console.warn('Sentry not configured — error tracking disabled in this build')
  }
}

export default config
