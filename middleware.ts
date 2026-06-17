import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { getRateLimit } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { generateRequestId } from '@/lib/logger'

/** Apply common security headers to non-API responses. */
function applySecurityHeaders(response: NextResponse): void {
  response.headers.set('X-DNS-Prefetch-Control', 'on')
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')

  const csp = `
 default-src 'self';
 script-src 'self' 'unsafe-eval' 'unsafe-inline' https://va.vercel-scripts.com https://vercel.live https://netlify-cdp.netlify.app;
 style-src 'self' 'unsafe-inline';
 img-src 'self' blob: data: https://www.google.com https://*.google.com https://*.googleusercontent.com https://*.gstatic.com https://danbooru.donmai.us https://cdn.donmai.us https://aibooru.online https://*.aibooru.online https://cdn.aibooru.download https://*.aibooru.download https://api.rule34.xxx https://rule34.xxx https://*.rule34.xxx https://e621.net https://*.e621.net https://*.donmai.us https://*.ko-fi.com https://gelbooru.com https://*.gelbooru.com https://*.workers.dev;
 font-src 'self';
 connect-src 'self' https://*.supabase.co wss://*.supabase.co https://aibooru.online https://*.aibooru.online https://cdn.aibooru.download https://*.aibooru.download https://danbooru.donmai.us https://cdn.donmai.us https://*.donmai.us https://api.rule34.xxx https://rule34.xxx https://*.rule34.xxx https://e621.net https://*.e621.net https://gelbooru.com https://*.gelbooru.com https://vercel.live https://vitals.vercel-insights.com https://*.ingest.us.sentry.io https://netlify-cdp.netlify.app https://*.workers.dev;
 frame-src 'self' https://vercel.live;
 object-src 'none';
 base-uri 'self';
 form-action 'self';
 `.replace(/\s+/g, ' ').trim()

  response.headers.set('Content-Security-Policy', csp)
}

/**
 * Stamp a response with the correlation request ID and return it.
 * Every response must pass through this so x-request-id is always present.
 */
function withRequestId(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId)
  return response
}

export async function middleware(request: NextRequest) {
  const url = request.nextUrl
  const ip = request.headers.get('x-forwarded-for') ?? '127.0.0.1'

  // --- Request ID: generate or propagate ---
  const requestId = request.headers.get('x-request-id') ?? generateRequestId()

  // --- Vercel Pause Override ---
  // If the app is paused on Vercel to save limits, block all routes except the root.
  // Static assets are already excluded by the matcher, so they load fine for the curtain.
  // This effectively stops any API calls, Supabase connections, and compute usage.
  if (process.env.VERCEL === "1") {
    if (url.pathname !== '/') {
      return withRequestId(NextResponse.json(
        { error: 'Vercel deployment is paused due to usage limits. Please use the Netlify mirror.' },
        { status: 503 }
      ), requestId)
    }
  }

  // --- Auth callback recovery ---
  // Supabase magic links sometimes redirect to /?code=... instead of /auth/callback?code=...
  // (when emailRedirectTo isn't in the Supabase whitelist). Redirect to the proper callback.
  const code = url.searchParams.get('code')
  if (code && url.pathname !== '/auth/callback') {
    const callbackUrl = new URL('/auth/callback', request.url)
    callbackUrl.searchParams.set('code', code)
    // Preserve the "next" param if present
    const next = url.searchParams.get('next')
    if (next) callbackUrl.searchParams.set('next', next)
    return withRequestId(NextResponse.redirect(callbackUrl), requestId)
  }

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
          return withRequestId(NextResponse.json(
            { error: 'Too many requests' },
            { status: 429, headers: { 'X-RateLimit-Remaining': remaining.toString() } }
          ), requestId)
        }
      }
    }

    // Minimal security + CORS headers for API routes
    response.headers.set('X-Content-Type-Options', 'nosniff')
    response.headers.set('Access-Control-Allow-Origin', url.origin)
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    return withRequestId(response, requestId)
  }

  // --- Non-API Routes: Full Supabase auth path ---
  //
  // Skip the Supabase round-trip when there are no auth cookies at all.
  // Supabase cookies are named `sb-<project-ref>-auth-token` (two cookies:
  // one for access token, one for refresh). If neither exists, getUser()
  // would return null immediately — we can skip the call entirely.
  const hasAuthCookie = request.cookies.getAll().some(
    c => c.name.startsWith('sb-') && c.name.endsWith('-auth-token')
  )

  // Admin routes always need auth, so never skip
  if (!hasAuthCookie && !url.pathname.startsWith('/admin')) {
    const response = NextResponse.next()
    applySecurityHeaders(response)
    return withRequestId(response, requestId)
  }

  const { response, user } = await updateSession(request)

  // Admin route protection with role verification
  if (url.pathname.startsWith('/admin')) {
    if (url.pathname === '/admin/login') {
      if (user) {
        return withRequestId(NextResponse.redirect(new URL('/admin', request.url)), requestId)
      }
    } else {
      if (!user) {
        const loginUrl = new URL('/admin/login', request.url)
        return withRequestId(NextResponse.redirect(loginUrl), requestId)
      }
      
      // Verify admin role
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()
      
      if (!profile || profile.role !== 'admin') {
        return withRequestId(NextResponse.redirect(new URL('/', request.url)), requestId)
      }
    }
  }

  // Security headers for non-API routes
  applySecurityHeaders(response)

  return withRequestId(response, requestId)
}

export const config = {
 matcher: [
 // Only match pages that actually need middleware processing.
 // Exclude static assets, images, and well-known files to reduce CPU.
 // Works on both Vercel and Netlify (Netlify has no _vercel paths, so the exclusion is harmless).
 '/((?!_next/static|_next/image|favicon\\.ico|favicon\\.png|icon\\.png|apple-icon\\.png|manifest\\.json|robots\\.txt|sitemap\\.xml|_vercel|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|woff|woff2|ttf|eot|map)$).*)',
 ],
}
