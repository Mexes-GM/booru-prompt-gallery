import { createBrowserClient } from '@supabase/ssr'

// Singleton pattern for the browser client
let supabase: ReturnType<typeof createBrowserClient> | undefined

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}

/**
 * Returns null when Supabase isn't configured (local development without
 * keys): account, sync and tag-table features switch themselves off instead
 * of throwing during render.
 */
export function createClient(): ReturnType<typeof createBrowserClient> | null {
  if (!isSupabaseConfigured()) return null
  if (!supabase) {
    supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }
  return supabase
}
