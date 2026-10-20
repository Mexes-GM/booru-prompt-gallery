// ── Unified release identifier ──────────────────────────────────────────────
// PostHog source maps are uploaded under this release name, and the SAME value
// is injected into the runtime bundle (via `env` below), so error events and
// their source maps line up on both deployments (Vercel and Netlify).
const RELEASE =
  process.env.NEXT_PUBLIC_APP_VERSION ||
  process.env.VERCEL_GIT_COMMIT_SHA ||   // Vercel
  process.env.COMMIT_REF ||              // Netlify
  undefined

// React's dev tooling (call-stack reconstruction, Fast Refresh) needs eval();
// production bundles don't, so granting it there only widens what an injected
// script could do.
const SCRIPT_EVAL = process.env.NODE_ENV === 'development' ? "'unsafe-eval' " : ''

/** @param {string} [frameAncestors] */
function contentSecurityPolicy(frameAncestors = '') {
  return `
 default-src 'self';
 script-src 'self' ${SCRIPT_EVAL}'unsafe-inline' https://vercel.live https://netlify-cdp.netlify.app https://challenges.cloudflare.com https://*.workers.dev;
 style-src 'self' 'unsafe-inline';
 img-src 'self' blob: data: https://www.google.com https://*.google.com https://*.googleusercontent.com https://*.gstatic.com https://danbooru.donmai.us https://cdn.donmai.us https://aibooru.online https://*.aibooru.online https://cdn.aibooru.download https://*.aibooru.download https://api.rule34.xxx https://rule34.xxx https://*.rule34.xxx https://e621.net https://*.e621.net https://*.donmai.us https://*.buymeacoffee.com https://gelbooru.com https://*.gelbooru.com https://*.workers.dev https://*.cloudfront.net;
 font-src 'self';
 connect-src 'self' https://*.supabase.co wss://*.supabase.co https://aibooru.online https://*.aibooru.online https://cdn.aibooru.download https://*.aibooru.download https://danbooru.donmai.us https://cdn.donmai.us https://*.donmai.us https://api.rule34.xxx https://rule34.xxx https://*.rule34.xxx https://e621.net https://*.e621.net https://gelbooru.com https://*.gelbooru.com https://vercel.live https://netlify-cdp.netlify.app https://*.workers.dev https://*.cloudfront.net https://challenges.cloudflare.com;
 frame-src 'self' https://vercel.live https://challenges.cloudflare.com;
 worker-src 'self' blob:;
 ${frameAncestors}
 object-src 'none';
 base-uri 'self';
 form-action 'self';
 `.replace(/\s+/g, ' ').trim()
}

/** @param {string} csp */
const pageHeaders = (csp) => [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  // NOTE: the PostHog reverse-proxy rewrites (/ingest/* -> *.i.posthog.com) used
  // to live here. They were moved to the Cloudflare Worker
  // (workers/booru-image-proxy/src/routes/posthog-ingest.ts) because proxying
  // every analytics event / session-recording snapshot through Next.js
  // middleware + an external rewrite was the largest Fluid Active CPU consumer
  // on Vercel. The client now points PostHog's api_host at the Worker
  // (see instrumentation-client.ts), so no /ingest handling is needed here.
  // Kept to support PostHog-style trailing-slash API requests elsewhere and to
  // avoid unintended trailing-slash redirects on existing routes.
  skipTrailingSlashRedirect: true,
  experimental: {
    optimizePackageImports: ['lucide-react', '@radix-ui/react-icons'],
  },
  reactStrictMode: true,
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
      {
        protocol: 'https',
        hostname: 'img.buymeacoffee.com',
        pathname: '/**',
      },
    ],
    dangerouslyAllowSVG: false,
    formats: ['image/webp', 'image/avif'],
  },
  // Supabase magic links land on /?code=... instead of /auth/callback?code=...
  // when emailRedirectTo isn't in the Supabase redirect whitelist. This used to
  // live in proxy.ts, but that kept "/" in the middleware matcher, and on
  // Netlify middleware is an edge function that runs before the CDN cache on
  // every request. A config redirect is routing, not middleware, so "/" stays
  // cacheable. Query values (code, next) pass through to the destination.
  redirects: async () => [
    {
      source: '/((?!api/|auth/).*)',
      has: [{ type: 'query', key: 'code' }],
      destination: '/auth/callback',
      permanent: false,
    },
  ],
  // Single source of truth for response headers on BOTH hosts: Vercel and
  // Netlify (@netlify/plugin-nextjs) both apply next.config headers, including
  // to /public files and to pages served from the CDN cache. Do not re-add
  // headers to vercel.json, netlify.toml or proxy.ts — divergent copies there
  // are how the two deployments drifted apart, and headers set in proxy.ts
  // force every matched route through middleware.
  headers: async () => {
    const securityHeaders = [
      { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-XSS-Protection', value: '1; mode=block' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ]
    const cache = (value) => [{ key: 'Cache-Control', value }]

    return [
      { source: '/:path*', headers: securityHeaders },
      // Every route except /extension, which the browser extension embeds in
      // an iframe; its framing policy is the CSP frame-ancestors below.
      { source: '/((?!extension).*)', headers: [{ key: 'X-Frame-Options', value: 'DENY' }] },
      // Pages get the CSP; API responses are JSON and never had one. The two
      // sources don't overlap, so each page gets exactly one policy.
      { source: '/((?!api/|extension).*)', headers: pageHeaders(contentSecurityPolicy()) },
      {
        source: '/extension',
        headers: pageHeaders(
          contentSecurityPolicy("frame-ancestors 'self' chrome-extension://* moz-extension://*;")
        ),
      },
      {
        source: '/api/(.*)',
        headers: [
          // API routes set their own Vercel-/Netlify-CDN-Cache-Control per
          // response. This is only the Netlify safety net: netlify-vary ignores
          // our query params (page, tags, seed…), so a public CDN cache would
          // serve one /api/posts response for every page.
          { key: 'Netlify-CDN-Cache-Control', value: 'no-store' },
          { key: 'Vary', value: 'Accept, Accept-Encoding' },
        ],
      },
      { source: '/_next/image(.*)', headers: cache('public, max-age=2678400, immutable') },
      { source: '/(favicon\\.ico|favicon\\.png|icon\\.png)', headers: cache('public, max-age=86400') },
      { source: '/(sitemap\\.xml|manifest\\.json)', headers: cache('public, s-maxage=86400, stale-while-revalidate=43200') },
      { source: '/(tags-taxonomy-cache|tags-core)\\.json', headers: cache('public, max-age=604800, stale-while-revalidate=86400') },
    ]
  },
}

let config = nextConfig

// Upload client-bundle source maps to PostHog error tracking so stack traces
// resolve to real file/function names instead of minified chunk output.
// Requires a personal API key with error-tracking write access — only wired
// up when present, so local/dev builds (and forks without it) are unaffected.
const posthogSourceMapsConfigured =
  Boolean(process.env.POSTHOG_API_KEY) && Boolean(process.env.POSTHOG_PROJECT_ID)

if (posthogSourceMapsConfigured) {
  try {
    const { withPostHogConfig } = await import('@posthog/nextjs-config')
    config = withPostHogConfig(config, {
      personalApiKey: process.env.POSTHOG_API_KEY,
      projectId: process.env.POSTHOG_PROJECT_ID,
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      sourcemaps: {
        // Tag the upload with the unified release identifier (see RELEASE above),
        // so error events and their source maps line up under one release.
        ...(RELEASE ? { releaseVersion: RELEASE } : {}),
      },
    })
  } catch {
    console.warn('PostHog source map upload not configured for this build')
  }
}

export default config
