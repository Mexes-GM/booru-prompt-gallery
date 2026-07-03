// ---------------------------------------------------------------------------
// Client-side auth header helper (F4, rate-limit-antiabuse plan)
//
// Attaches `Authorization: Bearer <access_token>` to fetch() calls that cross
// into the Cloudflare Worker (posts, booru-tags) so the worker can resolve
// authed identity for adaptive rate limits (see workers/.../lib/
// rate-limit-identity.ts and lib/rate-limit-identity.ts).
//
// Purely additive: if there's no active Supabase session (anonymous user, or
// Supabase not configured), this resolves to an empty object and every
// existing call behaves exactly as before. The worker/Next routes only look
// at this header when ADAPTIVE_LIMITS is on — off, it's ignored entirely.
//
// `getSession()` reads from local storage and only hits the network to
// refresh an expired token, so this stays cheap on the hot path (page loads,
// tag lookups).
// ---------------------------------------------------------------------------

import { createClient } from "@/lib/supabase/client"

/**
 * Resolve the current Supabase access token (if any) as a fetch header
 * object. Returns `{}` when there's no session or Supabase isn't configured
 * — safe to spread into any fetch() headers unconditionally.
 */
export async function getAuthHeader(): Promise<Record<string, string>> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return {}
  }
  try {
    const supabase = createClient()
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}
