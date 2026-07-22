// PostHog reverse-proxy.
//
// Moved here from the Next.js app's next.config.mjs rewrites. Previously every
// analytics event and session-recording snapshot was proxied through Vercel
// (Next.js middleware + external rewrite), which was the single largest
// consumer of Fluid Active CPU on the free plan. Serving the proxy from this
// Worker keeps the first-party path (so ad-blockers don't drop events) while
// spending zero Vercel compute.
//
// Mirrors the three original rewrites exactly:
//   /ingest/static/*  ->  https://us-assets.i.posthog.com/static/*
//   /ingest/array/*   ->  https://us-assets.i.posthog.com/array/*
//   /ingest/*         ->  https://us.i.posthog.com/*
//
// The app points PostHog's `api_host` at `${WORKER_URL}/ingest`, so the SDK
// requests land here as `/ingest/...` and are forwarded upstream verbatim.

const POSTHOG_API_HOST = 'us.i.posthog.com'
const POSTHOG_ASSETS_HOST = 'us-assets.i.posthog.com'

/**
 * Paths under /ingest served by PostHog's *assets* host rather than the API
 * host. These are the lazily-loaded JS bundles (recorder.js, surveys.js,
 * exception-autocapture.js, array.js, ...).
 */
function isAssetPath(path: string): boolean {
  return path.startsWith('/static/') || path.startsWith('/array/')
}

export async function posthogIngestHandler(request: Request): Promise<Response> {
  const url = new URL(request.url)

  // Strip the "/ingest" mount prefix; preserve the rest of the path + query
  // verbatim. Trailing slashes are significant to PostHog (/e/, /s/, /flags/),
  // so no normalization is applied.
  const path = url.pathname.replace(/^\/ingest/, '') || '/'
  const host = isAssetPath(path) ? POSTHOG_ASSETS_HOST : POSTHOG_API_HOST
  const targetUrl = `https://${host}${path}${url.search}`

  // Forward everything (events, session recordings, decide/flags, and static
  // asset GETs) with the same plain proxy: `new Request(request)` copies the
  // method, body and headers; passing targetUrl to fetch() overrides only the
  // destination and lets the runtime derive the correct Host. The Cookie header
  // is dropped so the app's Supabase session cookies never reach PostHog.
  //
  // No Worker-side Cache API is used on purpose: PostHog serves its static
  // bundles with long Cache-Control, so the browser caches them anyway, and an
  // earlier `caches.default.put()` attempt threw on non-cacheable upstream
  // responses (Set-Cookie) — surfacing as a 500 that broke recorder.js/surveys.
  // CORS headers are added by the outer fetch wrapper in index.ts.
  const forwarded = new Request(request)
  forwarded.headers.delete('cookie')

  return fetch(targetUrl, forwarded)
}
