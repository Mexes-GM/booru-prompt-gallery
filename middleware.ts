import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { getRateLimit } from '@/lib/rate-limit'

export async function middleware(request: NextRequest) {
  const url = request.nextUrl
  const ip = request.headers.get('x-forwarded-for') ?? '127.0.0.1'

  // --- API Routes: Lightweight path (NO Supabase auth) ---
  // API routes don't need session updates. Skipping updateSession() saves
  // a Supabase round-trip on every API call, reducing Fast Origin Transfer.
  if (url.pathname.startsWith('/api/')) {
    const response = NextResponse.next()

    // Rate limiting only for feedback submissions
    if (url.pathname === '/api/feedback') {
      const rateLimit = getRateLimit()
      if (rateLimit) {
        const { success, remaining } = await rateLimit.limit(ip)
        if (!success) {
          return NextResponse.json(
            { error: 'Too many requests' },
            { status: 429, headers: { 'X-RateLimit-Remaining': remaining.toString() } }
          )
        }
      }
    }

    // Minimal security + CORS headers for API routes
    response.headers.set('X-Content-Type-Options', 'nosniff')
    response.headers.set('Access-Control-Allow-Origin', '*')
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    return response
  }

  // --- Non-API Routes: Full Supabase auth path ---
  const { response, user } = await updateSession(request)

  // Admin route protection
  if (url.pathname.startsWith('/admin')) {
    if (url.pathname === '/admin/login') {
      if (user) {
        return NextResponse.redirect(new URL('/admin', request.url))
      }
    } else {
      if (!user) {
        const loginUrl = new URL('/admin/login', request.url)
        return NextResponse.redirect(loginUrl)
      }
    }
  }

  // Security headers for non-API routes
  response.headers.set('X-DNS-Prefetch-Control', 'on')
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')

  // CSP
  const csp = `
    default-src 'self';
    script-src 'self' 'unsafe-eval' 'unsafe-inline' https://va.vercel-scripts.com https://vercel.live;
    style-src 'self' 'unsafe-inline';
    img-src 'self' blob: data: https://www.google.com https://*.google.com https://*.googleusercontent.com https://*.gstatic.com https://danbooru.donmai.us https://cdn.donmai.us https://aibooru.online https://*.aibooru.online https://cdn.aibooru.download https://*.aibooru.download https://api.rule34.xxx https://rule34.xxx https://*.rule34.xxx https://e621.net https://*.e621.net https://*.donmai.us https://*.ko-fi.com https://gelbooru.com https://*.gelbooru.com;
    font-src 'self';
    connect-src 'self' https://*.supabase.co wss://*.supabase.co https://aibooru.online https://*.aibooru.online https://cdn.aibooru.download https://*.aibooru.download https://danbooru.donmai.us https://cdn.donmai.us https://*.donmai.us https://api.rule34.xxx https://rule34.xxx https://*.rule34.xxx https://e621.net https://*.e621.net https://gelbooru.com https://*.gelbooru.com https://vercel.live https://vitals.vercel-insights.com https://*.ingest.us.sentry.io;
    frame-src 'self' https://vercel.live;
  `.replace(/\s+/g, ' ').trim()

  response.headers.set('Content-Security-Policy', csp)

  return response
}

export const config = {
  matcher: [
    // Only match pages that actually need middleware processing.
    // Exclude static assets, images, and well-known files to reduce CPU.
    '/((?!_next/static|_next/image|favicon\\.ico|favicon\\.png|icon\\.png|apple-icon\\.png|manifest\\.json|robots\\.txt|sitemap\\.xml|_vercel|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|woff|woff2|ttf|eot|map)$).*)',
  ],
}
