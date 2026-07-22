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

  // Build a PLAIN RequestInit (matches the working imageProxyHandler in this
  // Worker). Do NOT pass the incoming Request as fetch()'s init: the Workers
  // runtime rejects that with "Invalid URL: [object Request]".
  //
  // - Cookie is dropped so the app's Supabase session never reaches PostHog.
  // - Host is dropped so the runtime derives it from targetUrl (a stale Host
  //   header would break upstream routing).
  // - The body is read fully into an ArrayBuffer (no streaming/duplex quirks).
  //   PostHog compresses payloads itself, so the raw bytes + original
  //   Content-Encoding header are forwarded untouched.
  // CORS headers are added by the outer fetch wrapper in index.ts.
  const headers = new Headers(request.headers)
  headers.delete('cookie')
  headers.delete('host')

  const init: RequestInit = { method: request.method, headers }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer()
  }

  return fetch(targetUrl, init)
}
