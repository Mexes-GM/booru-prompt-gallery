import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { generateRequestId } from '@/lib/logger'
import { isAdminMfaRequired } from '@/lib/auth/mfa'

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
  // When MAINTENANCE_MODE=1, block every route the matcher covers (API, admin,
  // auth). The static pages (/, /extension) are outside the matcher and render
  // their own curtain at build time, so this stops API calls, Supabase
  // connections and admin access during migrations.
  if (process.env.MAINTENANCE_MODE === "1") {
    return withRequestId(NextResponse.json(
      { error: 'The app is temporarily offline for maintenance. Please check back in a few minutes.' },
      { status: 503 }
    ), requestId)
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
    return withRequestId(NextResponse.next(), requestId)
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

  return withRequestId(response, requestId)
}

// Only routes that need per-request logic. Everything else (/, /extension,
// /about, static assets) must stay out: on Netlify, middleware is an edge
// function that runs BEFORE the CDN cache, so a matched page pays an edge
// invocation (and its cold start) on every request even when the HTML is
// cached. Security headers, the CSP included, are static and live in
// next.config.mjs, as does the /?code= -> /auth/callback redirect.
export const config = {
  matcher: ['/api/:path*', '/admin/:path*', '/auth/:path*'],
}
