
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy singleton: avoid throwing at module-load time during build/page-data
// collection when env vars may not yet be available.
let _client: SupabaseClient | null = null
let _initAttempted = false

function isConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  return Boolean(url && key)
}

function getClient(): SupabaseClient | null {
  if (_client) return _client
  if (_initAttempted) return null
  _initAttempted = true

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceKey) {
    console.warn('Supabase admin not configured — admin features disabled')
    return null
  }
  _client = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  })
  return _client
}

/**
 * Creates a chainable no-op mock that mimics Supabase's PostgREST query builder.
 * Every method in the chain returns another chainable mock, and awaiting resolves
 * to { data: null, error: new Error('Supabase not configured') }.
 */
function createNoopChain(): any {
  const noopResult = { data: null, error: new Error('Supabase not configured') }

  const handler: ProxyHandler<() => any> = {
    get(_target, prop) {
      if (prop === 'then') {
        // Make it thenable so `await` works → returns the noop result
        return (resolve: (v: any) => void) => resolve(noopResult)
      }
      if (prop === 'catch') {
        return (reject: (e: any) => void) => reject(noopResult.error)
      }
      // All other property accesses return a new chainable mock
      return createNoopChain()
    },
    apply(_target, _thisArg, _args) {
      // When called as a function, return chainable mock
      return createNoopChain()
    }
  }

  return new Proxy(() => {}, handler)
}

// Graceful proxy: returns real Supabase client when configured,
// or a chainable no-op mock that all code can interact with safely.
// WARNING: access to this client should be restricted to server-side contexts only
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getClient()
    if (!client) {
      return createNoopChain()
    }
    return Reflect.get(client as object, prop)
  },
  has(_target, prop) {
    const client = getClient()
    if (!client) return false
    return prop in (client as object)
  }
})

export { isConfigured as isSupabaseAdminConfigured }
