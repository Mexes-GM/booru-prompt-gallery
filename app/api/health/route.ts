import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'edge'

// Cache health check results for 5 minutes at the CDN level.
// This prevents external monitors from triggering excessive
// outbound requests that could trip rate limits.
const CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
  'CDN-Cache-Control': 'public, s-maxage=300',
}

export async function GET() {
  const startTime = Date.now()

  try {
    // Check Supabase connectivity (our actual backend dependency)
    // instead of hammering external booru APIs.
    const { data, error } = await supabaseAdmin
      .from('trend_cache')
      .select('id')
      .limit(1)

    const responseTime = Date.now() - startTime

    if (error) {
      return NextResponse.json(
        {
          status: 'degraded',
          message: 'Database connection issue',
          timestamp: new Date().toISOString(),
          responseTime,
          supabase: { status: 'unhealthy', error: error.message },
        },
        {
          status: 503,
          headers: CACHE_HEADERS,
        }
      )
    }

    return NextResponse.json(
      {
        status: 'healthy',
        message: 'Application is running and database is reachable',
        timestamp: new Date().toISOString(),
        responseTime,
        supabase: { status: 'healthy' },
      },
      {
        status: 200,
        headers: CACHE_HEADERS,
      }
    )
  } catch (error) {
    const responseTime = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    return NextResponse.json(
      {
        status: 'unhealthy',
        message: `Health check failed: ${errorMessage}`,
        timestamp: new Date().toISOString(),
        responseTime,
      },
      {
        status: 503,
        headers: CACHE_HEADERS,
      }
    )
  }
}
