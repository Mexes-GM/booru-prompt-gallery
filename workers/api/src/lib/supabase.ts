import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { Env } from '../types'

let _client: SupabaseClient | null = null

export function getSupabase(env: Env): SupabaseClient | null {
  if (_client) return _client
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('Supabase not configured')
    return null
  }
  _client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return _client
}

// Chainable noop mock — see project skill for pattern
export function createNoopChain(): any {
  const noopResult = { data: null, error: new Error('Supabase not configured') }
  const handler: ProxyHandler<() => any> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (v: any) => void) => resolve(noopResult)
      }
      return createNoopChain()
    },
    apply() {
      return createNoopChain()
    },
  }
  return new Proxy(() => {}, handler)
}
