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

  // Validate redirect target to prevent open redirects
  // Only allow relative paths starting with / and not // (protocol relative)
  const isValidRedirect = next.startsWith('/') && !next.startsWith('//')
  const redirectTo = isValidRedirect ? next : '/'

  // If there's an error from Supabase, redirect to error page with details
  if (error) {
    Sentry.captureMessage(`Auth callback error: ${errorDescription || error}`, {
      level: "error",
      tags: { context: "auth_callback_error" }
    })
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

    Sentry.captureException(exchangeError, {
      tags: { context: "auth_code_exchange" }
    })
    // Redirect to error page with specific error details
    const errorUrl = new URL(`${origin}/auth/auth-code-error`)
    errorUrl.searchParams.set('error_description', exchangeError.message || 'Failed to exchange code for session')
    return NextResponse.redirect(errorUrl.toString())
  }

  // return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/auth/auth-code-error`)
}
