'use server'

import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireAuth, UnauthorizedError } from '@/lib/auth/authorization'

// Self-service data rights promised in app/privacy (§8: access and delete).
// Both actions act only on the caller's own id, taken from the verified
// session — never from an argument — so they can't be aimed at someone else.

const PAGE_SIZE = 1000

async function fetchAllRows(table: string, columns: string, userId: string) {
  const rows: Record<string, unknown>[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(columns)
      .eq('user_id', userId)
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    rows.push(...((data ?? []) as unknown as Record<string, unknown>[]))
    if (!data || data.length < PAGE_SIZE) return rows
  }
}

export type AccountExportResult =
  | { success: true; data: Record<string, unknown> }
  | { success: false; message: string }

export async function exportAccountData(): Promise<AccountExportResult> {
  try {
    const user = await requireAuth()

    const [profile, favorites, folders, artists] = await Promise.all([
      supabaseAdmin.from('profiles').select('username, avatar_url, preferences, created_at, updated_at').eq('id', user.id).maybeSingle(),
      fetchAllRows('favorites', 'provider, post_id, folder_ids, position, created_at', user.id),
      fetchAllRows('favorite_folders', 'id, name, icon, created_at', user.id),
      fetchAllRows('saved_artists', 'provider, artist_tag, thumbnail_url, thumbnail_post_id, created_at', user.id),
    ])
    if (profile.error) throw profile.error

    return {
      success: true,
      data: {
        exported_at: new Date().toISOString(),
        account: { id: user.id, email: user.email, created_at: user.created_at },
        profile: profile.data,
        favorite_folders: folders,
        favorites,
        saved_artists: artists,
      },
    }
  } catch (error) {
    if (error instanceof UnauthorizedError) return { success: false, message: 'You need to be signed in.' }
    console.error('[exportAccountData]', error)
    return { success: false, message: 'Could not export your data. Please try again.' }
  }
}

export async function deleteAccount(): Promise<{ success: boolean; message?: string }> {
  try {
    const user = await requireAuth()

    // Explicit deletes first: not every table's FK is guaranteed to cascade
    // from auth.users (profiles and saved_artists predate the versioned
    // migrations), and a leftover row would outlive the account.
    for (const table of ['favorites', 'favorite_folders', 'saved_artists'] as const) {
      const { error } = await supabaseAdmin.from(table).delete().eq('user_id', user.id)
      if (error) throw error
    }
    const { error: profileError } = await supabaseAdmin.from('profiles').delete().eq('id', user.id)
    if (profileError) throw profileError

    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(user.id)
    if (authError) throw authError

    return { success: true }
  } catch (error) {
    if (error instanceof UnauthorizedError) return { success: false, message: 'You need to be signed in.' }
    console.error('[deleteAccount]', error)
    return { success: false, message: 'Could not delete your account. Please try again or contact us.' }
  }
}
