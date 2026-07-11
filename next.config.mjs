// ── Unified release identifier ──────────────────────────────────────────────
// Source maps are uploaded by withSentryConfig under this release name, and the
// SAME value is injected into the runtime bundle (via `env` below) so that
// Sentry.init({ release }) reports events tagged with the identical release.
// Previously runtime used an (empty) NEXT_PUBLIC_APP_VERSION while uploads used
// the git SHA → mismatch → events arrived with an empty release and source maps
// were never applied (minified stack traces). Resolving them to one value fixes it.
const RELEASE =
  process.env.NEXT_PUBLIC_APP_VERSION ||
  process.env.VERCEL_GIT_COMMIT_SHA ||   // Vercel
  process.env.COMMIT_REF ||              // Netlify
  process.env.CF_PAGES_COMMIT_SHA ||     // Cloudflare Pages
  undefined

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/ingest/static/:path*',
        destination: 'https://us-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/array/:path*',
        destination: 'https://us-assets.i.posthog.com/array/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://us.i.posthog.com/:path*',
      },
    ]
  },
  // Required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
  // Expose the resolved release to the client/server/edge runtimes so that the
  // Sentry.init() calls tag events with the same release used for map upload.
  env: {
    NEXT_PUBLIC_APP_VERSION: RELEASE ?? '',
  },
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
          // Do NOT set Vercel-CDN-Cache-Control here!
          // It overrides per-response headers set by API routes.
          // Each API route sets its own Vercel-CDN-Cache-Control per-response
          // (public for success, no-store for errors).
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
        source: '/((?!extension).*)',
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
      {
        source: '/extension',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
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
          {
            key: 'Content-Security-Policy',
            value: 'frame-ancestors https://tensor.art https://seaart.ai',
          },
          {
            key: 'X-Frame-Options',
            value: 'ALLOW-FROM https://tensor.art',
          },
        ],
      },
    ]
  },
}

// Only wrap with Sentry in production (SENTRY_AUTH_TOKEN + NODE_ENV=production).
// In development the edge-instrumentation.js generated by withSentryConfig uses
// eval() for webpack source maps, which the Edge Runtime sandbox disallows,
// causing "EvalError: Code generation from strings disallowed" on every request.
const sentryConfigured = Boolean(process.env.SENTRY_AUTH_TOKEN) && process.env.NODE_ENV === 'production'
let config = nextConfig

if (sentryConfigured) {
  try {
    const { withSentryConfig } = await import('@sentry/nextjs')
    config = withSentryConfig(nextConfig, {
      org: 'boorupromptgallery',
      project: 'sentry-fulvous-anchor',

      // Pin the upload release to the SAME identifier the runtime reports
      // (see RELEASE above). Falls back to Sentry's git auto-detection when
      // RELEASE is undefined (e.g. local production builds).
      ...(RELEASE ? { release: { name: RELEASE } } : {}),

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
        automaticVercelMonitors: false,
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
