import { Env } from '../types'
import { getSupabase } from '../lib/supabase'
import { jsonResponse, errorResponse, getClientIp } from '../utils'
import { memoryRateLimit } from '../lib/rate-limit-cache'
import { WORKER_LIMITS } from '../lib/limits'

const CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
  'CDN-Cache-Control': 'public, s-maxage=300',
}

export async function healthHandler(
  request: Request,
  env: Env
): Promise<Response> {
  // ponytail: per-IP rate limit (WORKER_LIMITS.health). Health check hits Supabase;
  // without a limit it's a trivial DoS vector. This endpoint never touches
  // donmai, so a pure in-memory limiter is enough — no Redis commands spent
  // (Fase 5, redis-optimization-plan.md).
  const clientIp = getClientIp(request)
  if (!memoryRateLimit(`health:${clientIp}`, WORKER_LIMITS.health.perIp.max, WORKER_LIMITS.health.perIp.windowS * 1000)) {
    return errorResponse('Too many health check requests', 429, {
      'Retry-After': '10',
      'Cache-Control': 'no-store',
      'CDN-Cache-Control': 'no-store',
    })
  }

  const startTime = Date.now()
  const supabase = getSupabase(env)

  if (!supabase) {
    return jsonResponse(
      {
        status: 'degraded',
        message: 'Supabase not configured',
        timestamp: new Date().toISOString(),
        responseTime: 0,
        supabase: { status: 'unconfigured' },
      },
      503,
      CACHE_HEADERS
    )
  }

  try {
    const { error } = await supabase.from('booru_posts_cache').select('id').limit(1)
    const responseTime = Date.now() - startTime

    if (error) {
      return jsonResponse(
        {
          status: 'degraded',
          message: 'Database connection issue',
          timestamp: new Date().toISOString(),
          responseTime,
          supabase: { status: 'unhealthy', error: error.message },
        },
        503,
        CACHE_HEADERS
      )
    }

    return jsonResponse(
      {
        status: 'healthy',
        message: 'Application is running and database is reachable',
        timestamp: new Date().toISOString(),
        responseTime,
        supabase: { status: 'healthy' },
      },
      200,
      CACHE_HEADERS
    )
  } catch (error: any) {
    const responseTime = Date.now() - startTime
    return jsonResponse(
      {
        status: 'unhealthy',
        message: `Health check failed: ${error.message}`,
        timestamp: new Date().toISOString(),
        responseTime,
      },
      503,
      CACHE_HEADERS
    )
  }
}
