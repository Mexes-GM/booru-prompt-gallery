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
 * host. These are immutable, shared JS bundles (recorder.js, array.js, ...).
 */
function isAssetPath(path: string): boolean {
  return path.startsWith('/static/') || path.startsWith('/array/')
}

export async function posthogIngestHandler(
  request: Request,
  _env: Record<string, string | undefined>,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url)

  // Strip the "/ingest" mount prefix; preserve the rest of the path + query
  // verbatim. Trailing slashes are significant to PostHog (/e/, /s/, /flags/),
  // so no normalization is applied.
  const path = url.pathname.replace(/^\/ingest/, '') || '/'
  const useAssets = isAssetPath(path)
  const host = useAssets ? POSTHOG_ASSETS_HOST : POSTHOG_API_HOST
  const targetUrl = `https://${host}${path}${url.search}`

  // Static assets are immutable and identical for every visitor — serve them
  // from the Worker edge cache so PostHog is only hit on a cold cache.
  if (useAssets && request.method === 'GET') {
    const cache = caches.default
    const cached = await cache.match(request)
    if (cached) return cached

    const assetResp = await fetch(targetUrl, { method: 'GET' })
    if (assetResp.ok) {
      ctx.waitUntil(cache.put(request, assetResp.clone()))
    }
    return assetResp
  }

  // Event ingestion / session recordings / flags / decide — forward as-is.
  // `new Request(request)` copies method, body and headers; the target URL
  // passed to fetch() overrides the destination and lets the runtime derive
  // the correct Host. The Cookie header is dropped so the app's Supabase
  // session cookies never reach PostHog. CORS headers are added by the outer
  // fetch wrapper in index.ts.
  const forwarded = new Request(request)
  forwarded.headers.delete('cookie')

  return fetch(targetUrl, forwarded)
}
