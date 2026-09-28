import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { generateRequestId } from '@/lib/logger'
import { isAdminMfaRequired } from '@/lib/auth/mfa'

/**
 * Apply the per-request security headers to non-API responses. Only the CSP
 * lives here, because /extension needs a different frame-ancestors; every
 * static security header (HSTS, nosniff, X-Frame-Options…) is set once for
 * both hosts in next.config.mjs.
 */
// React's dev tooling (call-stack reconstruction, Fast Refresh) needs eval();
// production bundles don't, so granting it there only widens what an injected
// script could do.
const SCRIPT_EVAL = process.env.NODE_ENV === 'development' ? "'unsafe-eval' " : ''

function applySecurityHeaders(response: NextResponse, isExtensionRoute = false): void {
  response.headers.set('X-DNS-Prefetch-Control', 'on')

  const frameAncestors = isExtensionRoute
    ? "frame-ancestors 'self' chrome-extension://* moz-extension://*;"
    : ""

  const csp = `
 default-src 'self';
 script-src 'self' ${SCRIPT_EVAL}'unsafe-inline' https://vercel.live https://netlify-cdp.netlify.app https://challenges.cloudflare.com https://*.workers.dev;
 style-src 'self' 'unsafe-inline';
 img-src 'self' blob: data: https://www.google.com https://*.google.com https://*.googleusercontent.com https://*.gstatic.com https://danbooru.donmai.us https://cdn.donmai.us https://aibooru.online https://*.aibooru.online https://cdn.aibooru.download https://*.aibooru.download https://api.rule34.xxx https://rule34.xxx https://*.rule34.xxx https://e621.net https://*.e621.net https://*.donmai.us https://*.buymeacoffee.com https://gelbooru.com https://*.gelbooru.com https://*.workers.dev https://*.cloudfront.net;
 font-src 'self';
 connect-src 'self' https://*.supabase.co wss://*.supabase.co https://aibooru.online https://*.aibooru.online https://cdn.aibooru.download https://*.aibooru.download https://danbooru.donmai.us https://cdn.donmai.us https://*.donmai.us https://api.rule34.xxx https://rule34.xxx https://*.rule34.xxx https://e621.net https://*.e621.net https://gelbooru.com https://*.gelbooru.com https://vercel.live https://netlify-cdp.netlify.app https://*.workers.dev https://*.cloudfront.net https://challenges.cloudflare.com;
 frame-src 'self' https://vercel.live https://challenges.cloudflare.com;
 worker-src 'self' blob:;
 ${frameAncestors}
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

export async function proxy(request: NextRequest) {
  const url = request.nextUrl

  // --- Request ID: generate or propagate ---
  const requestId = request.headers.get('x-request-id') ?? generateRequestId()

  // --- Maintenance Mode Curtain ---
  // When MAINTENANCE_MODE=1, block all non-root routes (API, admin, etc.).
  // The root page serves a static curtain (force-static, no serverless invocation).
  // Static assets are excluded by the matcher, so the curtain renders cleanly.
  // This stops API calls, Supabase connections, and admin access during migrations.
  if (process.env.MAINTENANCE_MODE === "1") {
    if (url.pathname !== '/') {
      return withRequestId(NextResponse.json(
        { error: 'The app is temporarily offline for maintenance. Please check back in a few minutes.' },
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
    applySecurityHeaders(response, url.pathname === '/extension')
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

      // Second factor: an admin session must be aal2 (TOTP verified) before it
      // can reach anything but the MFA enroll/verify screen itself.
      if (isAdminMfaRequired() && user.aal !== 'aal2' && url.pathname !== '/admin/mfa') {
        return withRequestId(NextResponse.redirect(new URL('/admin/mfa', request.url)), requestId)
      }
    }
  }

  // Security headers for non-API routes
  applySecurityHeaders(response, url.pathname === '/extension')

  return withRequestId(response, requestId)
}

export const config = {
 matcher: [
 // Only match pages that actually need middleware processing.
 // Exclude static assets, images, and well-known files to reduce CPU.
 // `ingest` is the PostHog reverse-proxy prefix (see next.config.mjs rewrites):
 // analytics/session-recording traffic (/ingest/s/, /ingest/e/, ...) is pure
 // machine-to-machine proxying — running auth/security-header middleware on it
 // (and a Supabase getUser() round-trip per session-recording heartbeat for
 // logged-in users) was the single largest Fluid Active CPU sink. Excluded here.
 // Works on both Vercel and Netlify (Netlify has no _vercel paths, so the exclusion is harmless).
 '/((?!_next/static|_next/image|favicon\\.ico|favicon\\.png|icon\\.png|apple-icon\\.png|manifest\\.json|robots\\.txt|sitemap\\.xml|ingest|_vercel|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|woff|woff2|ttf|eot|map)$).*)',
 ],
}
