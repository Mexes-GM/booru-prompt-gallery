"use client"

import { useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js"

type DbFavoritePayload = {
  provider: string
  post_id: number
  folder_ids: string[]
  user_id: string
}

interface UseFavoritesSyncParams {
  userId: string | undefined
  setFavorites: React.Dispatch<React.SetStateAction<Set<string>>>
  setFavoriteFolderMap: React.Dispatch<React.SetStateAction<Record<string, string[]>>>
}

export function useFavoritesSync({
  userId,
  setFavorites,
  setFavoriteFolderMap,
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
        const provider = (payload.new || payload.old)?.provider
        const post_id = (payload.new || payload.old)?.post_id
        if (!provider || post_id == null) return

        const key = `${provider.toLowerCase()}:${post_id}`

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

    channel.subscribe((status) => {
      if (status === "CHANNEL_ERROR") {
        console.error("[useFavoritesSync] Realtime channel error")
      }
    })

    return () => {
      supabase.removeChannel(channel).catch((err) => {
        console.warn("[useFavoritesSync] Error removing channel:", err)
      })
    }
  }, [userId])
}
