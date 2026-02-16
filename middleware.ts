import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const url = request.nextUrl

  // --- API Routes: Lightweight path (NO auth overhead) ---
  // Skipping auth/session checks on API routes drastically reduces
  // Fast Origin Transfer on Vercel.
  if (url.pathname.startsWith('/api/')) {
    const response = NextResponse.next()

    response.headers.set('X-Content-Type-Options', 'nosniff')
    response.headers.set('Access-Control-Allow-Origin', '*')
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    return response
  }

  // --- Non-API Routes ---
  const response = NextResponse.next()

  // Security headers
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
    connect-src 'self' https://*.supabase.co wss://*.supabase.co https://aibooru.online https://*.aibooru.online https://cdn.aibooru.download https://*.aibooru.download https://danbooru.donmai.us https://cdn.donmai.us https://*.donmai.us https://api.rule34.xxx https://rule34.xxx https://*.rule34.xxx https://e621.net https://*.e621.net https://gelbooru.com https://*.gelbooru.com https://vercel.live https://vitals.vercel-insights.com;
    frame-src 'self' https://vercel.live;
  `.replace(/\s+/g, ' ').trim()

  response.headers.set('Content-Security-Policy', csp)

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|favicon\\.png|icon\\.png|manifest\\.json|robots\\.txt|sitemap\\.xml|_vercel).*)',
  ],
}
