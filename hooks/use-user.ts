import { createClient } from '@/lib/supabase/client'
import { User, Session, AuthChangeEvent } from '@supabase/supabase-js'
import { useState, useEffect, useCallback, useMemo } from 'react'
import * as Sentry from "@sentry/nextjs"

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
