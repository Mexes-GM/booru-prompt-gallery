import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { Env } from '../types'

const clientCache = new Map<string, SupabaseClient>()

export function getSupabase(env: Env): SupabaseClient | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('Supabase not configured')
    return null
  }
  
  if (clientCache.has(env.SUPABASE_URL)) {
    return clientCache.get(env.SUPABASE_URL)!
  }

  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  
  clientCache.set(env.SUPABASE_URL, client)
  return client
}
