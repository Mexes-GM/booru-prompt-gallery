import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import * as Sentry from "@sentry/nextjs"

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  // if "next" is in param, use it as the redirect URL
  const next = searchParams.get('next') ?? '/'

  // Expected, user-caused auth outcomes that are NOT actionable bugs. These are
  // logged as warnings (or skipped) instead of exceptions so they don't dominate
  // Sentry quota / issue list. Examples: link opened on another device, expired
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
    if (isExpectedAuthError(description)) {
      // Expected user-caused outcome — breadcrumb only, no issue created.
      Sentry.addBreadcrumb({
        category: "auth",
        message: `Auth callback expected error: ${description}`,
        level: "info",
      })
    } else {
      Sentry.captureMessage(`Auth callback error: ${description}`, {
        level: "warning",
        tags: { context: "auth_callback_error" }
      })
    }
    const errorUrl = new URL(`${origin}/auth/auth-code-error`)
    if (errorDescription) {
      errorUrl.searchParams.set('error_description', errorDescription)
    }
    return NextResponse.redirect(errorUrl.toString())
  }

  if (code) {
    Sentry.addBreadcrumb({
      category: "auth",
      message: "Exchanging code for session in callback",
      level: "info"
    })
    const supabase = await createClient()
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    if (!exchangeError) {
      Sentry.addBreadcrumb({
        category: "auth",
        message: "Successfully exchanged code for session",
        level: "info"
      })
      return NextResponse.redirect(`${origin}${redirectTo}`)
    }

    if (isExpectedAuthError(exchangeError.message)) {
      // Expected user-caused outcome (expired/used link, PKCE mismatch across
      // devices, rate limit). Breadcrumb only — do not create a Sentry issue.
      Sentry.addBreadcrumb({
        category: "auth",
        message: `Auth code exchange expected error: ${exchangeError.message}`,
        level: "info",
      })
    } else {
      Sentry.captureException(exchangeError, {
        tags: { context: "auth_code_exchange" }
      })
    }
    // Redirect to error page with specific error details
    const errorUrl = new URL(`${origin}/auth/auth-code-error`)
    errorUrl.searchParams.set('error_description', exchangeError.message || 'Failed to exchange code for session')
    return NextResponse.redirect(errorUrl.toString())
  }

  // return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/auth/auth-code-error`)
}
