import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

export interface SessionUser {
  id: string
  /** Authenticator assurance level: 'aal1' (password/magic link) or 'aal2' (MFA verified). */
  aal: string | null
}

export async function updateSession(
  request: NextRequest
): Promise<{ response: NextResponse; user: SessionUser | null }> {
  // If Supabase is not configured, skip auth entirely
  if (!SUPABASE_CONFIGURED) {
    return {
      response: NextResponse.next({ request: { headers: request.headers } }),
      user: null,
    }
  }

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
        response = NextResponse.next({
          request: {
            headers: request.headers,
          },
        })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        )
      },
    },
  })

  // IMPORTANT: Avoid writing any logic between createServerClient and
  // supabase.auth.getClaims(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  // getClaims() verifies the access token locally against the project's JWKS
  // when it uses asymmetric signing keys (no Auth round-trip on every page
  // navigation), and falls back to a getUser()-equivalent server check for
  // legacy HS256 projects. Either way it refreshes an expired session first.
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims
  const user: SessionUser | null = claims?.sub
    ? { id: claims.sub, aal: typeof claims.aal === 'string' ? claims.aal : null }
    : null

  return { response, user }
}
