import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const response = NextResponse.next()

  // Add security headers
  response.headers.set('X-DNS-Prefetch-Control', 'on')
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  
  // Add performance headers
  response.headers.set('X-Powered-By', 'Next.js')
  
  // Add SEO-friendly headers
  const url = request.nextUrl
  if (url.pathname === '/') {
    response.headers.set('Link', '</icon.png>; rel=preload; as=image')
  }
  
  // Handle API routes with specific headers
  if (url.pathname.startsWith('/api/')) {
    response.headers.set('Access-Control-Allow-Origin', '*')
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - favicon.png (favicon file)
     * - icon.png (app icon)
     * - manifest.json (PWA manifest)
     * - robots.txt (robots file)
     * - sitemap.xml (sitemap file)
     * - _vercel (Vercel analytics)
     */
    '/((?!_next/static|_next/image|favicon\\.ico|favicon\\.png|icon\\.png|manifest\\.json|robots\\.txt|sitemap\\.xml|_vercel).*)',
  ],
}
