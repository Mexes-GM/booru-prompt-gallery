import { AutoRouter } from 'itty-router'
import { postsHandler } from './routes/posts'
import { favoritesHandler } from './routes/favorites'
import { booruTagsHandler } from './routes/booru-tags'
import { tagsHandler } from './routes/tags'
import { downloadHandler } from './routes/download'
import { feedbackHandler } from './routes/feedback'
import { healthHandler } from './routes/health'
import { versionHandler } from './routes/version'
import { corsHeaders } from './utils'
import { imageProxyHandler } from './routes/image-proxy'

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

// Image proxy — legacy path (already deployed, used by NEXT_PUBLIC_IMAGE_PROXY_URL)
router.get('/', imageProxyHandler)

// OPTIONS preflight
router.options('*', () => new Response(null, { status: 204, headers: corsHeaders }))

// 404
router.all('*', () => new Response(JSON.stringify({ error: 'Not found' }), {
  status: 404,
  headers: { 'Content-Type': 'application/json', ...corsHeaders },
}))

export default {
  async fetch(request: Request, env: Record<string, string | undefined>, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }
    const response = await router.fetch(request, env, ctx)
    const headers = new Headers(response.headers)
    for (const [k, v] of Object.entries(corsHeaders)) {
      if (!headers.has(k)) headers.set(k, v)
    }
    return new Response(response.body, { status: response.status, headers })
  },
}
