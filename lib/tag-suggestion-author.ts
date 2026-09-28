import { getCurrentUser } from '@/lib/auth/authorization'

// Community tag suggestions are anonymous by design, keyed by IP. When the
// submitter IS signed in we also record their user id, so reputation and
// "undo my own suggestion" can follow the account instead of an IP that
// changes (mobile networks, VPNs) or is shared (NAT, campuses).
//
// The `user_id` column is added by
// supabase/migrations/20260928000000_user_data_hardening.sql. Until that
// migration is applied, writes fall back to the IP-only shape instead of
// failing — see isMissingColumnError.

export async function getSuggestionAuthorId(): Promise<string | null> {
  try {
    return (await getCurrentUser())?.id ?? null
  } catch {
    return null
  }
}

/** Postgres "undefined column" / PostgREST "column not in schema cache". */
export function isMissingColumnError(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42703' || error?.code === 'PGRST204'
}
