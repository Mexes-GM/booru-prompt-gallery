import { createClient } from '@/lib/supabase/client'
import { User, Session, AuthChangeEvent } from '@supabase/supabase-js'
import { useState, useEffect, useCallback, useMemo } from 'react'
import * as Sentry from "@sentry/nextjs"
import posthog from 'posthog-js'

// Module-level guard for the `user_authenticated` analytics event.
//
// useUser() is consumed by ~6 hooks/components, and EACH mounts its own
// supabase.auth.onAuthStateChange listener. Supabase emits SIGNED_IN not just
// on a real login but also on every TOKEN_REFRESHED-adjacent re-sync and on
// each listener's initial state delivery — so a single real sign-in was firing
// `user_authenticated` many times over (observed: ~4.8K events in 3 days vs a
// few hundred real sign-ins). This shared, cross-instance guard records the
// last authenticated user id and only captures the event when the identity
// actually transitions to a new signed-in user.
let lastAuthedUserId: string | null = null

function captureAuthOnce(userId: string) {
  if (typeof window === 'undefined') return
  if (lastAuthedUserId === userId) return
  lastAuthedUserId = userId
  try {
    posthog.capture('user_authenticated')
  } catch {
    /* non-fatal: telemetry is best-effort */
  }
}

export function useUser() {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const supabase = useMemo(() => {
    if (!mounted) return null
    return createClient()
  }, [mounted])

  useEffect(() => {
    if (!mounted || !supabase) return

    let isSubscribed = true

    supabase.auth.getSession().then(({ data: { session }, error }: { data: { session: Session | null }; error: unknown }) => {
      if (error) {
        Sentry.captureException(error, { tags: { context: "use_user_get_session" } })
      }
      if (!isSubscribed) return
      
      Sentry.addBreadcrumb({
        category: "auth",
        message: "Session loaded from getSession",
        level: "info",
        data: { hasUser: !!session?.user, userId: session?.user?.id }
      })

      // Identify the user by UUID only (no PII) so Sentry shows affected-user
      // counts and lets us filter a specific user's crashes. See SENTRY-FULVOUS-ANCHOR-7.
      Sentry.setUser(session?.user ? { id: session.user.id } : null)
      // Re-identify with PostHog on page refresh so events from returning sessions
      // are correlated to the correct person profile.
      if (session?.user) {
        posthog.identify(session.user.id)
      }
      setUser(session?.user ?? null)
      setSession(session ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      if (!isSubscribed) return

      Sentry.addBreadcrumb({
        category: "auth",
        message: `Auth state changed: ${event}`,
        level: "info",
        data: { hasUser: !!session?.user, userId: session?.user?.id }
      })

      // Identify the user by UUID only (no PII) so Sentry shows affected-user
      // counts and lets us filter a specific user's crashes. See SENTRY-FULVOUS-ANCHOR-7.
      Sentry.setUser(session?.user ? { id: session.user.id } : null)
      
      if (typeof window !== 'undefined') {
        if (session?.user) {
          posthog.identify(session.user.id)
        } else {
          posthog.reset()
          lastAuthedUserId = null
        }

        if (event === 'SIGNED_IN' && session?.user) {
          captureAuthOnce(session.user.id)
        }
      }
      
      setUser(session?.user ?? null)
      setSession(session ?? null)
      setLoading(false)
    })

    return () => {
      isSubscribed = false
      subscription.unsubscribe()
    }
  }, [mounted, supabase])

  return { user, session, loading }
}
