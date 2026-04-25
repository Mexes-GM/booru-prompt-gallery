import { createClient } from '@/lib/supabase/client'
import { User, Session, AuthChangeEvent } from '@supabase/supabase-js'
import { useState, useEffect, useCallback, useMemo } from 'react'

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

    supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
      if (!isSubscribed) return
      setUser(session?.user ?? null)
      setSession(session ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (!isSubscribed) return
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
