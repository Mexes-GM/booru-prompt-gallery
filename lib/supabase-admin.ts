
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy singleton: avoid throwing at module-load time during build/page-data
// collection when env vars may not yet be available.
let _client: SupabaseClient | null = null

function getClient(): SupabaseClient {
  if (_client) return _client
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Supabase admin env vars are missing (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)')
  }
  _client = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  })
  return _client
}

// WARNING: access to this client should be restricted to server-side contexts only
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient() as object, prop, receiver)
  },
  has(_target, prop) {
    return prop in (getClient() as object)
  }
})
