import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  // if "next" is in param, use it as the redirect URL
  const next = searchParams.get('next') ?? '/'

  // Expected, user-caused auth outcomes that are NOT actionable bugs. These are
  // skipped instead of logged as errors so they don't bury real failures in
  // the function logs. Examples: link opened on another device, expired
  // magic link, double-clicked link, Supabase 30s rate-limit.
  const isExpectedAuthError = (msg: string | null | undefined): boolean => {
    if (!msg) return false
    const m = msg.toLowerCase()
    return (
      m.includes('pkce') ||
      m.includes('code verifier') ||
      m.includes('expired') ||
      m.includes('otp_expired') ||
      m.includes('access_denied') ||
      m.includes('invalid flow state') ||
      m.includes('flow state') ||
      m.includes('for security purposes') ||      // 30s rate limit
      m.includes('only request this after') ||
      m.includes('both auth code and code verifier should be non-empty')
    )
  }

  // Validate redirect target to prevent open redirects
  // Only allow relative paths starting with / and not // (protocol relative)
  const isValidRedirect = next.startsWith('/') && !next.startsWith('//')
  const redirectTo = isValidRedirect ? next : '/'

  // If there's an error from Supabase, redirect to error page with details
  if (error) {
    const description = errorDescription || error
    if (!isExpectedAuthError(description)) {
      console.warn(`[auth_callback_error] ${description}`)
    }
    const errorUrl = new URL(`${origin}/auth/auth-code-error`)
    if (errorDescription) {
      errorUrl.searchParams.set('error_description', errorDescription)
    }
    return NextResponse.redirect(errorUrl.toString())
  }

  if (code) {
    const supabase = await createClient()
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    if (!exchangeError) {
      return NextResponse.redirect(`${origin}${redirectTo}`)
    }

    // Expected user-caused outcomes (expired/used link, PKCE mismatch across
    // devices, rate limit) are not logged.
    if (!isExpectedAuthError(exchangeError.message)) {
      console.error("[auth_code_exchange]", exchangeError)
    }
    // Redirect to error page with specific error details
    const errorUrl = new URL(`${origin}/auth/auth-code-error`)
    errorUrl.searchParams.set('error_description', exchangeError.message || 'Failed to exchange code for session')
    return NextResponse.redirect(errorUrl.toString())
  }

  // return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/auth/auth-code-error`)
}
