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
import { securityTxtHandler, robotsTxtHandler } from './routes/security-txt'

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
  async fetch(request: Request, env: Record<string, string | undefined>, ctx: ExecutionContext): Promise<Response> {
    // Handle security.txt before router (itty-router doesn't match /.well-known/ paths)
    const url = new URL(request.url)
    if (url.pathname === '/.well-known/security.txt') {
      return securityTxtHandler()
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: getCorsHeaders(request.headers.get('Origin')) })
    }
    const response = await router.fetch(request, env, ctx)
    const headers = new Headers(response.headers)
    const requestCorsHeaders = getCorsHeaders(request.headers.get('Origin'))
    for (const [k, v] of Object.entries(requestCorsHeaders)) {
      headers.set(k, v)
    }
    return new Response(response.body, { status: response.status, headers })
  },
}
