import { useState, useEffect, useCallback, useRef, type Dispatch, type SetStateAction } from "react"
import { useUser } from "@/hooks/use-user"
import { createClient } from "@/lib/supabase/client"
import { favKey } from "@/lib/favorites-logic"
import * as Sentry from "@sentry/nextjs"

export interface FavoriteFolder {
  id: string
  name: string
  icon?: string | null
}

interface DbFavoriteRow {
  provider: string
  post_id: number
  folder_ids: string[]
}

interface LocalStorageV2 {
  folders: FavoriteFolder[]
  favorites: Record<string, string | null>
}

interface LocalStorageV3 {
  folders: FavoriteFolder[]
  favorites: Record<string, string[]>
}

export interface UseFavoritesCoreReturn {
  favorites: Set<string>
  folderMap: Record<string, string[]>
  folders: FavoriteFolder[]
  loaded: boolean
  error: string | null
  syncFavorites: () => Promise<void>
  setFavorites: Dispatch<SetStateAction<Set<string>>>
  setFolderMap: Dispatch<SetStateAction<Record<string, string[]>>>
  setFolders: Dispatch<SetStateAction<FavoriteFolder[]>>
  notifyLocalMutation: () => void
}

export function useFavoritesCore(): UseFavoritesCoreReturn {
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const [folderMap, setFolderMap] = useState<Record<string, string[]>>({})
  const [folders, setFolders] = useState<FavoriteFolder[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const syncVersionRef = useRef(0)
  // F6: detect local toggles that race the initial load, so the DB snapshot does
  // not silently revert a mutation that was in flight while the load ran.
  const loadingRef = useRef(false)
  const mutationDuringLoadRef = useRef(false)

  const { user, loading: userLoading } = useUser()
  const supabase = createClient()

  // Called by the parent hook whenever it performs an optimistic local mutation.
  // If the initial load is still running, we flag it so the load reconciles
  // (re-syncs) instead of clobbering the user's in-flight change.
  const notifyLocalMutation = useCallback(() => {
    if (loadingRef.current) mutationDuringLoadRef.current = true
  }, [])

  // Load favorites from Supabase (authenticated) or localStorage (anonymous)
  useEffect(() => {
    if (userLoading) return

    let cancelled = false

    async function loadFavorites() {
      setError(null)
      loadingRef.current = true
      mutationDuringLoadRef.current = false

      if (user) {
        // ── One-shot migration: localStorage → Supabase ──
        const isMigrated = user.user_metadata?.favorites_migrated === 'v2'

        // Helper: read + normalize all localStorage formats (same logic as anonymous path)
        async function migrateFromLocalStorage() {
          if (typeof window === "undefined") return

          try {
            const savedV3 = localStorage.getItem("booruFavoritesV3")
            const savedV2 = localStorage.getItem("booruFavoritesV2")
            const savedLegacy = localStorage.getItem("globalBooruFavorites")

            let localFolders: FavoriteFolder[] = []
            const favMap: Record<string, string[]> = {}

            if (savedV3) {
              const parsed: LocalStorageV3 = JSON.parse(savedV3)
              if (parsed.folders) localFolders = parsed.folders
              if (parsed.favorites) {
                for (const [key, folderIds] of Object.entries(parsed.favorites)) {
                  favMap[key] = folderIds
                }
              }
            } else if (savedV2) {
              const parsed: LocalStorageV2 = JSON.parse(savedV2)
              if (parsed.folders) localFolders = parsed.folders
              if (parsed.favorites) {
                for (const [key, folderId] of Object.entries(parsed.favorites)) {
                  favMap[key] = folderId ? [folderId] : []
                }
              }
            }

            if (savedLegacy) {
              const arr = JSON.parse(savedLegacy)
              if (Array.isArray(arr)) {
                arr.forEach((k: string) => {
                  if (!favMap[k]) favMap[k] = []
                })
              }
            }

            if (Object.keys(favMap).length === 0 && localFolders.length === 0) {
              return // Nothing to migrate
            }

            if (!user) return // narrow user for the upserts below

            // Step 1 — Migrate folders, building localId → SupabaseUUID map
            const folderIdMap: Record<string, string> = {}
            for (const folder of localFolders) {
              if (cancelled) return
              try {
                const { data, error: folderErr } = await supabase
                  .from("favorite_folders")
                  .upsert(
                    { user_id: user.id, name: folder.name, icon: folder.icon || null },
                    { onConflict: "user_id,name" }
                  )
                  .select("id")
                  .single()

                if (!folderErr && data) {
                  folderIdMap[folder.id] = data.id
                }
              } catch (e) {
                Sentry.captureException(e, {
                  level: "warning",
                  tags: { context: "use-favorites-core", action: "migrate_folder" }
                })
              }
            }

            // Step 2 — Build favorites rows with transformed folder IDs
            const rows: { user_id: string; provider: string; post_id: number; folder_ids: string[] }[] = []

            for (const [key, localFolderIds] of Object.entries(favMap)) {
              const [provider, postIdStr] = key.split(":")
              const postId = parseInt(postIdStr, 10)
              if (!provider || isNaN(postId)) continue

              const migratedFolderIds = localFolderIds
                .map(localId => folderIdMap[localId])
                .filter((id): id is string => !!id)

              rows.push({
                user_id: user.id,
                provider,
                post_id: postId,
                folder_ids: migratedFolderIds,
              })
            }

            if (rows.length === 0) return

            // Step 3 — Batch upsert with ON CONFLICT safety net
            const { error: insertErr } = await supabase
              .from("favorites")
              .upsert(rows, { onConflict: "user_id,provider,post_id" })

            if (insertErr) {
              Sentry.captureMessage(
                `Migration insert failed: ${insertErr.message}`,
                { level: "warning", tags: { context: "use-favorites-core", action: "migrate_insert" } }
              )
            } else {
              // F11: migration to Supabase succeeded — remove the local copies so a
              // future logout can't resurrect stale anonymous favorites.
              try {
                localStorage.removeItem("booruFavoritesV3")
                localStorage.removeItem("booruFavoritesV2")
                localStorage.removeItem("globalBooruFavorites")
              } catch (e) {
                Sentry.captureException(e, {
                  level: "warning",
                  tags: { context: "use-favorites-core", action: "migrate_cleanup_localstorage" },
                })
              }
            }
          } catch (e) {
            Sentry.captureException(e, {
              level: "warning",
              tags: { context: "use-favorites-core", action: "migrate_localstorage" }
            })
          }
        }

        if (!isMigrated) {
          try {
            const { count, error: countErr } = await supabase
              .from("favorites")
              .select("*", { count: "exact", head: true })
              .eq("user_id", user.id)

            if (cancelled) return

            if (!countErr) {
              if ((count ?? 0) > 0) {
                // Already has data in DB — just mark migrated
                try {
                  const { error: updateErr } = await supabase.auth.updateUser({
                    data: { favorites_migrated: 'v2' }
                  })
                  if (updateErr) {
                    Sentry.captureMessage(
                      `Failed to set favorites_migrated flag: ${updateErr.message}`,
                      { level: "warning", tags: { context: "use-favorites-core", action: "set_migration_flag" } }
                    )
                  }
                } catch (updateEx) {
                  Sentry.captureException(updateEx, {
                    level: "warning",
                    tags: { context: "use-favorites-core", action: "set_migration_flag" }
                  })
                }
              } else {
                // No data in DB — migrate from localStorage
                await migrateFromLocalStorage()
                // Mark as migrated (best-effort — guard count>0 prevents re-migration on next login)
                try {
                  const { error: updateErr } = await supabase.auth.updateUser({
                    data: { favorites_migrated: 'v2' }
                  })
                  if (updateErr) {
                    Sentry.captureMessage(
                      `Failed to set favorites_migrated flag after migration: ${updateErr.message}`,
                      { level: "warning", tags: { context: "use-favorites-core", action: "set_migration_flag_post_migrate" } }
                    )
                  }
                } catch (updateEx) {
                  Sentry.captureException(updateEx, {
                    level: "warning",
                    tags: { context: "use-favorites-core", action: "set_migration_flag_post_migrate" }
                  })
                }
              }
            }
          } catch (countEx) {
            Sentry.captureException(countEx, {
              level: "warning",
              tags: { context: "use-favorites-core", action: "check_migration_count" }
            })
          }
        }

        // Authenticated: load from Supabase
        try {
          const { data: dbFolders, error: foldersErr } = await supabase
            .from("favorite_folders")
            .select("id, name, icon")
            .order("created_at", { ascending: true })
            .limit(10000)

          const { data: dbFavorites, error: favsErr } = await supabase
            .from("favorites")
            .select("provider, post_id, folder_ids")
            .order("position", { ascending: true, nullsLast: true })
        .order("post_id", { ascending: true })
            .limit(10000)

          if (cancelled) return

          if (foldersErr || favsErr) {
            setError(foldersErr?.message || favsErr?.message || "Failed to load favorites")
          }

          const loadedFolders: FavoriteFolder[] = dbFolders || []
          const newSet = new Set<string>()
          const newMap: Record<string, string[]> = {}

          if (dbFavorites) {
            dbFavorites.forEach((item: DbFavoriteRow) => {
              const key = favKey(item.provider, item.post_id)
              newSet.add(key)
              newMap[key] = item.folder_ids || []
            })
          }

          setFolders(loadedFolders)
          setFavorites(newSet)
          setFolderMap(newMap)
          setLoaded(true)

          // F6: if a local toggle happened while this load was running, the DB
          // snapshot we just applied may have reverted it. Reconcile from the DB
          // (the toggle also persisted there) so the final state is correct.
          loadingRef.current = false
          if (mutationDuringLoadRef.current) {
            mutationDuringLoadRef.current = false
            syncFavorites()
          }
        } catch (e) {
          if (!cancelled) {
            setError(e instanceof Error ? e.message : "Failed to load favorites")
            setLoaded(true)
          }
          loadingRef.current = false
        }
      } else {
        // Anonymous: load from localStorage
        if (typeof window === "undefined") return

        try {
          const newSet = new Set<string>()
          let newFolders: FavoriteFolder[] = []
          const newMap: Record<string, string[]> = {}
          let shouldSave = false

          const savedV3 = localStorage.getItem("booruFavoritesV3")
          const savedV2 = localStorage.getItem("booruFavoritesV2")
          const savedLegacy = localStorage.getItem("globalBooruFavorites")

          if (savedV3) {
            const parsed: LocalStorageV3 = JSON.parse(savedV3)
            if (parsed.folders) newFolders = parsed.folders
            if (parsed.favorites) {
              for (const [key, folderIds] of Object.entries(parsed.favorites)) {
                newSet.add(key)
                newMap[key] = folderIds
              }
            }
          } else if (savedV2) {
            const parsed: LocalStorageV2 = JSON.parse(savedV2)
            if (parsed.folders) newFolders = parsed.folders
            if (parsed.favorites) {
              for (const [key, folderId] of Object.entries(parsed.favorites)) {
                newSet.add(key)
                newMap[key] = folderId ? [folderId] : []
              }
            }
            shouldSave = true
          }

          if (savedLegacy) {
            const arr = JSON.parse(savedLegacy)
            if (Array.isArray(arr)) {
              arr.forEach((k: string) => {
                if (!newSet.has(k)) {
                  newSet.add(k)
                  newMap[k] = []
                  shouldSave = true
                }
              })
            }
            if (shouldSave) localStorage.removeItem("globalBooruFavorites")
          }

          if (cancelled) return

          setFolders(newFolders)
          setFavorites(newSet)
          setFolderMap(newMap)
          setLoaded(true)
          loadingRef.current = false

          if (shouldSave) {
            localStorage.setItem("booruFavoritesV3", JSON.stringify({ folders: newFolders, favorites: newMap }))
            localStorage.removeItem("booruFavoritesV2")
          }
        } catch (e) {
          if (!cancelled) {
            setError(e instanceof Error ? e.message : "Failed to load local favorites")
            setLoaded(true)
          }
          loadingRef.current = false
        }
      }
    }

    loadFavorites()

    return () => {
      cancelled = true
    }
  }, [user?.id, userLoading])

  // Manual sync from Supabase (authenticated users only)
  const syncFavorites = useCallback(async () => {
    if (!user || userLoading) return

    syncVersionRef.current++
    const version = syncVersionRef.current

    setError(null)

    try {
      const { data: dbFolders, error: foldersErr } = await supabase
        .from("favorite_folders")
        .select("id, name, icon")
        .order("created_at", { ascending: true })
        .limit(10000)

      const { data: dbFavorites, error: favsErr } = await supabase
        .from("favorites")
        .select("provider, post_id, folder_ids")
        .order("position", { ascending: true, nullsLast: true })
        .order("post_id", { ascending: true })
        .limit(10000)

      if (syncVersionRef.current !== version) return

      if (foldersErr || favsErr) {
        setError(foldersErr?.message || favsErr?.message || "Sync failed")
      }

      const loadedFolders: FavoriteFolder[] = dbFolders || []
      const newSet = new Set<string>()
      const newMap: Record<string, string[]> = {}

      if (dbFavorites) {
        dbFavorites.forEach((item: DbFavoriteRow) => {
          const key = favKey(item.provider, item.post_id)
          newSet.add(key)
          newMap[key] = item.folder_ids || []
        })
      }

      if (syncVersionRef.current !== version) return

      setFolders(loadedFolders)
      setFavorites(newSet)
      setFolderMap(newMap)
      setLoaded(true)
    } catch (e) {
      if (syncVersionRef.current !== version) return
      setError(e instanceof Error ? e.message : "Sync failed")
      setLoaded(true)
    }
  }, [user?.id, userLoading])

  return {
    favorites,
    folderMap,
    folders,
    loaded,
    error,
    syncFavorites,
    setFavorites,
    setFolderMap,
    setFolders,
    notifyLocalMutation,
  }
}
