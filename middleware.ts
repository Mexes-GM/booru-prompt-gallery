import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { decrypt } from '@/lib/session'

export async function middleware(request: NextRequest) {
  const response = NextResponse.next()
  const url = request.nextUrl

  // 1. Admin Authentication Protection
  // Protect all routes under /admin except /admin/login
  if (url.pathname.startsWith('/admin')) {
    const adminSession = request.cookies.get('admin_session')?.value
    const payload = adminSession ? await decrypt(adminSession) : null
    const isAuthenticated = payload?.role === 'admin'

    if (url.pathname === '/admin/login') {
      if (isAuthenticated) {
        return NextResponse.redirect(new URL('/admin', request.url))
      }
    } else {
      if (!isAuthenticated) {
        const loginUrl = new URL('/admin/login', request.url)
        return NextResponse.redirect(loginUrl)
      }
    }
  }

  // 2. Add security headers
  response.headers.set('X-DNS-Prefetch-Control', 'on')
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  
  // CSP for Aibooru and other providers
  // We use a permissive CSP to allow the various image CDNs and APIs required for the booru gallery
  const csp = `
    default-src 'self';
    script-src 'self' 'unsafe-eval' 'unsafe-inline' https://va.vercel-scripts.com https://vercel.live;
    style-src 'self' 'unsafe-inline';
    img-src 'self' blob: data: https://www.google.com https://*.google.com https://*.gstatic.com https://danbooru.donmai.us https://cdn.donmai.us https://aibooru.online https://*.aibooru.online https://cdn.aibooru.download https://*.aibooru.download https://api.rule34.xxx https://rule34.xxx https://*.rule34.xxx https://e621.net https://*.e621.net https://*.donmai.us https://*.ko-fi.com;
    font-src 'self';
    connect-src 'self' https://aibooru.online https://*.aibooru.online https://cdn.aibooru.download https://*.aibooru.download https://danbooru.donmai.us https://cdn.donmai.us https://*.donmai.us https://api.rule34.xxx https://rule34.xxx https://*.rule34.xxx https://e621.net https://*.e621.net https://vercel.live https://vitals.vercel-insights.com;
    frame-src 'self' https://vercel.live;
  `.replace(/\s+/g, ' ').trim()
  
  response.headers.set('Content-Security-Policy', csp)


  // Add performance headers
  response.headers.set('X-Powered-By', 'Next.js')
  
  // Add SEO-friendly headers
  if (url.pathname === '/') {
    // Remove preload to avoid unused preload warnings
    // response.headers.set('Link', '</icon.png>; rel=preload; as=image')
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
