// ─────────────────────────────────────────────────────────────────────────────
// Pure favorites logic — extracted from use-booru-favorites so the decision logic
// can be unit-tested without React/Supabase/SWR. No side effects, no imports of
// runtime state. See lib/favorites-logic.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

import type { BooruProvider } from "./booru/types"

export interface FavoriteItem {
  provider: BooruProvider
  id: number
}

/**
 * Canonical favorites key builder. ALWAYS lowercases the provider so the key is
 * identical no matter where it is built (DB load, realtime, optimistic toggle,
 * render). Fixes F9: previously the load/realtime paths lowercased the provider
 * but the toggle/render/isFavorite paths did not, which would desync the heart
 * state and folder filter for any provider stored with mixed case.
 */
export function favKey(provider: string, id: number | string): string {
  return `${String(provider).toLowerCase()}:${id}`
}

/**
 * Remove a folder id from every favorite that references it.
 *
 * WHY THIS EXISTS (root cause of the "favorites disappear from folders" bug):
 * `favorites.folder_ids` is a Postgres `text[]` column, not a foreign key, so a
 * standard `ON DELETE CASCADE` on `favorite_folders` CANNOT strip the deleted
 * folder id out of those arrays. If the id is left behind, the favorite keeps a
 * non-empty `folder_ids` pointing at a folder that no longer exists — it then
 * vanishes from "Uncategorized" (array not empty) AND from every folder view
 * (no matching folder tab). We must clean the arrays explicitly.
 *
 * Returns the new in-memory map plus the list of rows that actually changed, so
 * the caller can persist exactly those rows to the database.
 */
export function removeFolderFromFavorites(
  folderMap: Record<string, string[]>,
  folderId: string,
): {
  newMap: Record<string, string[]>
  affected: { key: string; folderIds: string[] }[]
} {
  const newMap: Record<string, string[]> = { ...folderMap }
  const affected: { key: string; folderIds: string[] }[] = []

  for (const [key, ids] of Object.entries(folderMap)) {
    if (ids.includes(folderId)) {
      const folderIds = ids.filter((id) => id !== folderId)
      newMap[key] = folderIds
      affected.push({ key, folderIds })
    }
  }

  return { newMap, affected }
}

export interface FavoriteUpsertRow {
  user_id: string
  provider: string
  post_id: number
  folder_ids: string[]
  position?: number
}

/**
 * Build the row for a `favorites` upsert.
 *
 * WHY (root cause of the "favorites reorder themselves" bug): `position` must be
 * stamped ONLY when a favorite is first created. The previous code set
 * `position: Date.now() * -1` on every upsert, so merely toggling a folder on an
 * existing favorite rewrote its position and catapulted it to the top on the
 * next load. A PostgREST upsert only updates the columns present in the payload,
 * so omitting `position` for edits preserves the original ordering.
 */
export function buildFavoriteUpsertRow(params: {
  userId: string
  provider: string
  postId: number
  folderIds: string[]
  isNewFavorite: boolean
  now?: number
}): FavoriteUpsertRow {
  const row: FavoriteUpsertRow = {
    user_id: params.userId,
    provider: params.provider,
    post_id: params.postId,
    folder_ids: params.folderIds,
  }
  if (params.isNewFavorite) {
    row.position = (params.now ?? Date.now()) * -1
  }
  return row
}

/**
 * Convert an in-memory favorites Set (keys `provider:postId`) into the
 * FavoriteItem[] shape used to compute SWR cache keys. Mirrors the mapping used
 * throughout the hook; centralized here so the optimistic-add rollback and other
 * call sites cannot drift apart.
 */
export function favoritesSetToItems(favorites: Set<string> | string[]): FavoriteItem[] {
  const keys = Array.isArray(favorites) ? favorites : Array.from(favorites)
  return keys
    .map((key) => {
      const [p, idStr] = key.split(":")
      if (!idStr) return { provider: "danbooru" as BooruProvider, id: parseInt(key, 10) }
      return { provider: p as BooruProvider, id: parseInt(idStr, 10) }
    })
    .filter((item) => !isNaN(item.id))
}
