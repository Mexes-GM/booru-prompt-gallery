import { useState, useEffect, useMemo, useCallback } from "react"
import { BooruProvider, FavoriteItem, useFavoritePosts, BooruPost } from "@/lib/api-client"
import { toast } from "@/hooks/use-toast"
import { trackFavorite, safeTrack } from "@/lib/analytics"
import { useUser } from "@/hooks/use-user"
import { createClient } from "@/lib/supabase/client"

export interface UseBooruFavoritesReturn {
  favorites: Set<string>
  favoritesLoaded: boolean
  showFavorites: boolean
  favoritePosts: BooruPost[] | undefined
  toggleFavorite: (postId: number, providerOverride?: string) => void
  toggleShowFavorites: () => void
  clearFavorites: () => void
  isFavorite: (provider: string, id: number) => boolean
  favoriteItems: FavoriteItem[]
  isLoading: boolean
}

export function useBooruFavorites(booruProvider: BooruProvider) {
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const [favoritesLoaded, setFavoritesLoaded] = useState(false)
  const [showFavorites, setShowFavorites] = useState(false)
  const { user, loading: userLoading } = useUser()
  const supabase = createClient()

  // Helper to save favorites to localStorage (Legacy/Anonymous)
  const saveFavoritesToStorage = useCallback((newFavorites: Set<string>) => {
    if (typeof window !== 'undefined') {
      try {
        const favoritesArray = Array.from(newFavorites)
        localStorage.setItem('globalBooruFavorites', JSON.stringify(favoritesArray))
      } catch (error) {
        console.warn('Error saving favorites to localStorage:', error)
      }
    }
  }, [])

  // Load favorites
  useEffect(() => {
    async function loadFavorites() {
      if (userLoading) return

      if (user) {
        // Load from Supabase
        const { data, error } = await supabase
          .from('favorites')
          .select('provider, post_id')

        const newSet = new Set<string>()
        if (data) {
          data.forEach((item: any) => {
            newSet.add(`${item.provider}:${item.post_id}`)
          })
        }

        // Migrate local favorites to account
        if (typeof window !== 'undefined') {
          const savedFavorites = localStorage.getItem('globalBooruFavorites')
          if (savedFavorites) {
            try {
              const arr = JSON.parse(savedFavorites)
              if (Array.isArray(arr) && arr.length > 0) {
                let migrated = false
                const upserts = []
                for (const key of arr) {
                  if (!newSet.has(key)) {
                    newSet.add(key)
                    migrated = true
                    const [p, idStr] = key.split(':')
                    const post_id = parseInt(idStr, 10)
                    if (!isNaN(post_id)) {
                      upserts.push({ user_id: user.id, provider: p, post_id })
                    }
                  }
                }
                if (upserts.length > 0) {
                  await supabase.from('favorites').upsert(upserts)
                }
                if (migrated) {
                  localStorage.removeItem('globalBooruFavorites')
                }
              }
            } catch (e) {
              console.error('Migration error:', e)
            }
          }
        }

        setFavorites(newSet)
        setFavoritesLoaded(true)
      } else {
        // Load from LocalStorage
        if (typeof window !== 'undefined') {
          const savedFavorites = localStorage.getItem('globalBooruFavorites')
          let migrated = false
          const newSet = new Set<string>()

          // 1. Load Unified Format if exists
          if (savedFavorites) {
            try {
              const arr = JSON.parse(savedFavorites)
              if (Array.isArray(arr)) {
                arr.forEach(k => newSet.add(k))
              }
            } catch (e) { console.error(e) }
          }

          // 2. Migrate Legacy keys (only if no unified data or to merge)
          // ... (Legacy migration logic kept for anonymous users) ...
          const legacyDanbooru = localStorage.getItem('booruFavorites')
          if (legacyDanbooru) {
            try {
              const arr = JSON.parse(legacyDanbooru)
              if (Array.isArray(arr) && arr.length > 0) {
                arr.forEach(id => newSet.add(`danbooru:${id}`))
                localStorage.removeItem('booruFavorites')
                migrated = true
              }
            } catch (e) { }
          }

          setFavorites(newSet)
          if (migrated) saveFavoritesToStorage(newSet)
          setFavoritesLoaded(true)
        }
      }
    }

    loadFavorites()
  }, [user, userLoading, saveFavoritesToStorage, supabase])

  const toggleFavorite = useCallback(async (postId: number, providerOverride?: string) => {
    const targetProvider = providerOverride || booruProvider
    const uniqueKey = `${targetProvider}:${postId}`
    const isCurrentlyFavorited = favorites.has(uniqueKey)
    const newFavorites = new Set(favorites)

    // Optimistic Update
    if (isCurrentlyFavorited) {
      newFavorites.delete(uniqueKey)
      toast({ title: "Removed from favorites", description: "Image removed from your favorites" })
      trackFavorite(postId, 'remove')
    } else {
      newFavorites.add(uniqueKey)
      toast({ title: "Added to favorites", description: "Image added to your favorites" })
      trackFavorite(postId, 'add')
    }
    setFavorites(newFavorites)

    // Persist
    if (user) {
      if (isCurrentlyFavorited) {
        await supabase.from('favorites').delete().match({ user_id: user.id, provider: targetProvider, post_id: postId })
      } else {
        await supabase.from('favorites').upsert({ user_id: user.id, provider: targetProvider, post_id: postId })
      }
    } else {
      saveFavoritesToStorage(newFavorites)
    }
  }, [favorites, booruProvider, saveFavoritesToStorage, user, supabase])

  const toggleShowFavorites = useCallback(() => {
    setShowFavorites(prev => {
      const next = !prev
      safeTrack('toggle_favorites_view', { show: next, count: favorites.size })
      return next
    })
  }, [favorites.size])

  const clearFavorites = useCallback(async () => {
    setFavorites(new Set())
    if (user) {
      await supabase.from('favorites').delete().eq('user_id', user.id)
    } else {
      saveFavoritesToStorage(new Set())
    }
    toast({ title: "Favorites cleared", description: "All favorites have been removed" })
  }, [saveFavoritesToStorage, user, supabase])

  const isFavorite = useCallback((provider: string, id: number) => {
    return favorites.has(`${provider}:${id}`)
  }, [favorites])

  // Prepare favorites list for hook
  const favoriteItems: FavoriteItem[] = useMemo(() => {
    return Array.from(favorites).map(key => {
      const [p, idStr] = key.split(':')
      if (!idStr) return { provider: 'danbooru' as BooruProvider, id: parseInt(key, 10) }
      return { provider: p as BooruProvider, id: parseInt(idStr, 10) }
    }).filter(item => !isNaN(item.id))
  }, [favorites])

  const {
    posts: favoritePosts,
    error: favoritesError,
    isLoading: favoritesLoading,
  } = useFavoritePosts(favoriteItems)

  return {
    favorites,
    favoritesLoaded,
    showFavorites,
    favoritePosts,
    toggleFavorite,
    toggleShowFavorites,
    clearFavorites,
    isFavorite,
    favoriteItems,
    isLoading: favoritesLoading
  }
}
