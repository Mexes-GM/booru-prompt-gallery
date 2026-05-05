import { createBrowserClient } from '@supabase/ssr'

// Singleton pattern for the browser client
let supabase: ReturnType<typeof createBrowserClient> | undefined

export function createClient() {
  if (!supabase) {
    supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }
  return supabase
}
