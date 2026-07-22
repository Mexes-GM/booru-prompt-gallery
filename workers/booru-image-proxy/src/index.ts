import { AutoRouter } from 'itty-router'
import { postsHandler } from './routes/posts'
import { favoritesHandler } from './routes/favorites'
import { booruTagsHandler } from './routes/booru-tags'
import { tagsHandler } from './routes/tags'
import { downloadHandler } from './routes/download'
import { feedbackHandler } from './routes/feedback'
import { healthHandler } from './routes/health'
import { versionHandler } from './routes/version'
import { convertPromptHandler } from './routes/convert-prompt'
import { corsHeaders, getCorsHeaders } from './utils'
import { imageProxyHandler } from './routes/image-proxy'
import { trendsHandler } from './routes/trends'
import { refreshTrendsCache } from './routes/trends'
import { securityTxtHandler, robotsTxtHandler } from './routes/security-txt'
import { posthogIngestHandler } from './routes/posthog-ingest'
import { logger } from './logger'
import { Env } from './types'

const router = AutoRouter()

// API routes
router.get('/api/posts', postsHandler)
router.post('/api/favorites', favoritesHandler)
router.get('/api/booru/tags', booruTagsHandler)
router.get('/api/tags', tagsHandler)
router.get('/api/download', downloadHandler)
router.post('/api/feedback', feedbackHandler)
router.get('/api/health', healthHandler)
router.get('/api/version', versionHandler)
router.post('/api/llm/convert', convertPromptHandler)
router.get('/api/trends', trendsHandler)

// Security
router.get('/security.txt', securityTxtHandler)

// PostHog reverse-proxy (analytics events + session recordings). Moved off the
// Next.js app's Vercel rewrites to keep ingestion from consuming Fluid Active
// CPU. Matches GET (assets/decide) and POST (events/recordings); OPTIONS
// preflight is served by the global handler below.
router.all('/ingest/*', posthogIngestHandler)

// Image proxy — legacy path (already deployed, used by NEXT_PUBLIC_IMAGE_PROXY_URL)
router.get('/', imageProxyHandler)

// OPTIONS preflight — use dynamic CORS based on request origin
router.options('*', (request: Request) => new Response(null, {
  status: 204,
  headers: getCorsHeaders(request.headers.get('Origin')),
}))

// 404
router.all('*', (request: Request) => new Response(JSON.stringify({ error: 'Not found' }), {
  status: 404,
  headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request.headers.get('Origin')) },
}))

export default {
  // Cron Triggers — see [triggers] in wrangler.toml. Keeps the trends cache
  // warm so users never trigger a cold Danbooru fetch and the external API is
  // hit on a predictable schedule.
  async scheduled(
    event: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    logger.info('scheduled', { cron: event.cron, scheduledTime: event.scheduledTime })
    ctx.waitUntil(refreshTrendsCache(env))
  },

  async fetch(request: Request, env: Record<string, string | undefined>, ctx: ExecutionContext): Promise<Response> {
    // Handle security.txt before router (itty-router doesn't match /.well-known/ paths)
    const url = new URL(request.url)
    if (url.pathname === '/.well-known/security.txt') {
      return securityTxtHandler()
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: getCorsHeaders(request.headers.get('Origin')) })
    }

    const startMs = Date.now()
    const requestId = request.headers.get('x-request-id') ?? undefined
    const log = requestId ? logger.child({ requestId }) : logger

    const response = await router.fetch(request, env, ctx)
    const durationMs = Date.now() - startMs

    // Structured request log (RED: Rate/Errors/Duration)
    const statusClass = Math.floor(response.status / 100) + 'xx'
    const logFields = { path: url.pathname, method: request.method, status: response.status, statusClass, durationMs }
    if (response.status >= 500) {
      log.error('request', logFields)
    } else if (response.status >= 400) {
      log.warn('request', logFields)
    } else {
      log.info('request', logFields)
    }

    const headers = new Headers(response.headers)
    if (requestId) headers.set('x-request-id', requestId)
    const requestCorsHeaders = getCorsHeaders(request.headers.get('Origin'))
    for (const [k, v] of Object.entries(requestCorsHeaders)) {
      headers.set(k, v)
    }
    return new Response(response.body, { status: response.status, headers })
  },
}
