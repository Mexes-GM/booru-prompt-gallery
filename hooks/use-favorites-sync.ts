"use client"

import { useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { favKey } from "@/lib/favorites-logic"
import type { FavoriteFolder } from "@/hooks/use-favorites-core"
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js"

type DbFavoritePayload = {
  provider: string
  post_id: number
  folder_ids: string[]
  user_id: string
}

type DbFolderPayload = {
  id: string
  name: string
  icon: string | null
  user_id: string
}

interface UseFavoritesSyncParams {
  userId: string | undefined
  setFavorites: React.Dispatch<React.SetStateAction<Set<string>>>
  setFavoriteFolderMap: React.Dispatch<React.SetStateAction<Record<string, string[]>>>
  setFolders: React.Dispatch<React.SetStateAction<FavoriteFolder[]>>
}

export function useFavoritesSync({
  userId,
  setFavorites,
  setFavoriteFolderMap,
  setFolders,
}: UseFavoritesSyncParams) {
  const supabase = createClient()

  useEffect(() => {
    if (!userId) return

    const channel = supabase.channel("favorites-sync")

    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "favorites",
        filter: `user_id=eq.${userId}`,
      },
      (payload: RealtimePostgresChangesPayload<DbFavoritePayload>) => {
        const row = (payload.new || payload.old) as Partial<DbFavoritePayload>
        const provider = row?.provider
        const post_id = row?.post_id
        if (!provider || post_id == null) return

        const key = favKey(provider, post_id)

        switch (payload.eventType) {
          case "INSERT":
            if (payload.new) {
              setFavorites((prev) => {
                // Prepend to maintain newest-first (created_at DESC) ordering.
                // Set.add() appends to the end, which would put new favorites last.
                const next = new Set(prev)
                next.delete(key) // ensure no stale position
                return new Set([key, ...next])
              })
              setFavoriteFolderMap((prev) => ({
                ...prev,
                [key]: payload.new!.folder_ids || [],
              }))
            }
            break

          case "UPDATE":
            if (payload.new) {
              setFavorites((prev) => {
                // UPDATE only changes folder_ids — preserve existing position.
                const next = new Set(prev)
                next.add(key)
                return next
              })
              setFavoriteFolderMap((prev) => ({
                ...prev,
                [key]: payload.new!.folder_ids || [],
              }))
            }
            break

          case "DELETE":
            setFavorites((prev) => {
              const next = new Set(prev)
              next.delete(key)
              return next
            })
            setFavoriteFolderMap((prev) => {
              const next = { ...prev }
              delete next[key]
              return next
            })
            break
        }
      }
    )

    // F7: also sync folder create/rename/delete across tabs & devices.
    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "favorite_folders",
        filter: `user_id=eq.${userId}`,
      },
      (payload: RealtimePostgresChangesPayload<DbFolderPayload>) => {
        const row = (payload.new ?? payload.old) as Partial<DbFolderPayload> | undefined
        const id = row?.id
        if (!id) return

        switch (payload.eventType) {
          case "INSERT":
            if (payload.new) {
              const folder: FavoriteFolder = {
                id: payload.new.id,
                name: payload.new.name,
                icon: payload.new.icon,
              }
              setFolders((prev) =>
                prev.some((f) => f.id === folder.id) ? prev : [...prev, folder],
              )
            }
            break

          case "UPDATE":
            if (payload.new) {
              setFolders((prev) =>
                prev.map((f) =>
                  f.id === payload.new!.id
                    ? { id: payload.new!.id, name: payload.new!.name, icon: payload.new!.icon }
                    : f,
                ),
              )
            }
            break

          case "DELETE":
            setFolders((prev) => prev.filter((f) => f.id !== id))
            // The favorites rows that referenced this folder are cleaned up by
            // deleteFolder (F1) and arrive as separate `favorites` UPDATE events.
            break
        }
      }
    )

    channel.subscribe((status: string) => {
      if (status === "CHANNEL_ERROR") {
        console.error("[useFavoritesSync] Realtime channel error")
      }
    })

    return () => {
      supabase.removeChannel(channel).catch((err: unknown) => {
        console.warn("[useFavoritesSync] Error removing channel:", err)
      })
    }
  }, [userId, supabase, setFavorites, setFavoriteFolderMap, setFolders])
}
