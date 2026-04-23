import { createContext, createElement, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/hooks/use-user"
import { userPreferences, type SavedArtist } from "@/lib/storage"
import { toast } from "@/hooks/use-toast"

export type { SavedArtist }

interface DbSavedArtistRow {
  provider: string
  artist_tag: string
  thumbnail_url: string | null
  thumbnail_post_id: number | null
  created_at: string
}

export interface UseSavedArtistsReturn {
  savedArtists: SavedArtist[]
  isLoading: boolean
  loaded: boolean
  isSaved: (provider: string, artistTag: string) => boolean
  saveArtist: (artist: Omit<SavedArtist, "timestamp">) => Promise<void>
  removeArtist: (provider: string, artistTag: string) => Promise<void>
  clearAll: () => Promise<void>
  refresh: () => Promise<void>
}

const buildKey = (provider: string, tag: string) => `${provider.toLowerCase()}:${tag.toLowerCase()}`

function rowToArtist(row: DbSavedArtistRow): SavedArtist {
  return {
    provider: row.provider,
    artistTag: row.artist_tag,
    thumbnailUrl: row.thumbnail_url,
    thumbnailPostId: row.thumbnail_post_id,
    timestamp: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  }
}

function useSavedArtistsInternal(): UseSavedArtistsReturn {
  const { user, loading: userLoading } = useUser()
  const supabase = createClient()
  const [savedArtists, setSavedArtists] = useState<SavedArtist[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)

  const loadFromSupabase = useCallback(async () => {
    if (!user) return [] as SavedArtist[]
    const { data, error } = await supabase
      .from("saved_artists")
      .select("provider, artist_tag, thumbnail_url, thumbnail_post_id, created_at")
      .order("created_at", { ascending: false })
    if (error) {
      console.error("[useSavedArtists] fetch error:", error)
      return []
    }
    return (data || []).map((r: DbSavedArtistRow) => rowToArtist(r))
  }, [user, supabase])

  const loadFromLocal = useCallback((): SavedArtist[] => {
    return userPreferences.getSavedArtists()
  }, [])

  // One-time migration of local → cloud when a user signs in and has local artists
  const migrateLocalToCloud = useCallback(async () => {
    if (!user) return
    const local = userPreferences.getSavedArtists()
    if (local.length === 0) return

    const rows = local.map((a) => ({
      user_id: user.id,
      provider: a.provider,
      artist_tag: a.artistTag,
      thumbnail_url: a.thumbnailUrl,
      thumbnail_post_id: a.thumbnailPostId,
    }))

    const { error } = await supabase
      .from("saved_artists")
      .upsert(rows, { onConflict: "user_id,provider,artist_tag", ignoreDuplicates: true })

    if (!error) {
      userPreferences.clearSavedArtists()
    } else {
      console.error("[useSavedArtists] migration error:", error)
    }
  }, [user, supabase])

  const refresh = useCallback(async () => {
    setIsLoading(true)
    try {
      if (user) {
        await migrateLocalToCloud()
        const cloud = await loadFromSupabase()
        setSavedArtists(cloud)
      } else {
        setSavedArtists(loadFromLocal())
      }
      setLoaded(true)
    } finally {
      setIsLoading(false)
    }
  }, [user, loadFromSupabase, loadFromLocal, migrateLocalToCloud])

  useEffect(() => {
    if (userLoading) return
    let isMounted = true
    ;(async () => {
      setIsLoading(true)
      try {
        if (user) {
          await migrateLocalToCloud()
          const cloud = await loadFromSupabase()
          if (isMounted) setSavedArtists(cloud)
        } else {
          if (isMounted) setSavedArtists(loadFromLocal())
        }
        if (isMounted) setLoaded(true)
      } catch (e) {
        console.error("[useSavedArtists] load error:", e)
      } finally {
        if (isMounted) setIsLoading(false)
      }
    })()
    return () => {
      isMounted = false
    }
  }, [user?.id, userLoading, loadFromSupabase, loadFromLocal, migrateLocalToCloud])

  const isSaved = useCallback(
    (provider: string, artistTag: string) => {
      const k = buildKey(provider, artistTag)
      return savedArtists.some((a) => buildKey(a.provider, a.artistTag) === k)
    },
    [savedArtists],
  )

  const saveArtist = useCallback(
    async (artist: Omit<SavedArtist, "timestamp">) => {
      if (isSaved(artist.provider, artist.artistTag)) return

      // Optimistic update
      const newArtist: SavedArtist = { ...artist, timestamp: Date.now() }
      setSavedArtists((prev) => [newArtist, ...prev])

      if (user) {
        const { error } = await supabase.from("saved_artists").upsert(
          {
            user_id: user.id,
            provider: artist.provider,
            artist_tag: artist.artistTag,
            thumbnail_url: artist.thumbnailUrl,
            thumbnail_post_id: artist.thumbnailPostId,
          },
          { onConflict: "user_id,provider,artist_tag", ignoreDuplicates: false },
        )
        if (error) {
          console.error("[useSavedArtists] save error:", error)
          toast({ title: "Error saving artist", description: error.message, variant: "destructive" })
          // Rollback
          setSavedArtists((prev) =>
            prev.filter((a) => buildKey(a.provider, a.artistTag) !== buildKey(artist.provider, artist.artistTag)),
          )
          return
        }
      } else {
        userPreferences.addSavedArtist(artist)
      }

      toast({ title: "Artist saved", description: artist.artistTag })
    },
    [user, supabase, isSaved],
  )

  const removeArtist = useCallback(
    async (provider: string, artistTag: string) => {
      const key = buildKey(provider, artistTag)
      const before = savedArtists
      setSavedArtists((prev) => prev.filter((a) => buildKey(a.provider, a.artistTag) !== key))

      if (user) {
        const { error } = await supabase
          .from("saved_artists")
          .delete()
          .match({ user_id: user.id, provider, artist_tag: artistTag })
        if (error) {
          console.error("[useSavedArtists] remove error:", error)
          toast({ title: "Error removing artist", description: error.message, variant: "destructive" })
          // Rollback
          setSavedArtists(before)
          return
        }
      } else {
        userPreferences.removeSavedArtist(provider, artistTag)
      }

      toast({ title: "Artist removed", description: artistTag })
    },
    [user, supabase, savedArtists],
  )

  const clearAll = useCallback(async () => {
    const before = savedArtists
    setSavedArtists([])
    if (user) {
      const { error } = await supabase.from("saved_artists").delete().eq("user_id", user.id)
      if (error) {
        setSavedArtists(before)
        toast({ title: "Error clearing artists", description: error.message, variant: "destructive" })
        return
      }
    } else {
      userPreferences.clearSavedArtists()
    }
    toast({ title: "All artists removed" })
  }, [user, supabase, savedArtists])

  return {
    savedArtists,
    isLoading,
    loaded,
    isSaved,
    saveArtist,
    removeArtist,
    clearAll,
    refresh,
  }
}

// -----------------------------------------------------------------------------
// Context provider — ensures a single shared source of truth across the app so
// that any SaveArtistButton and the ArtistGrid stay in sync when artists are
// added/removed from anywhere in the tree.
// -----------------------------------------------------------------------------

const SavedArtistsContext = createContext<UseSavedArtistsReturn | null>(null)

export function SavedArtistsProvider({ children }: { children: ReactNode }) {
  const value = useSavedArtistsInternal()
  return createElement(SavedArtistsContext.Provider, { value }, children)
}

export function useSavedArtists(): UseSavedArtistsReturn {
  const ctx = useContext(SavedArtistsContext)
  if (!ctx) {
    throw new Error("useSavedArtists must be used within a <SavedArtistsProvider>")
  }
  return ctx
}
