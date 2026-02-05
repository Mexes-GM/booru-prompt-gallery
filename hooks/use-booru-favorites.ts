import { useState, useEffect, useMemo, useCallback } from "react"
import { BooruProvider, FavoriteItem, useFavoritePosts, BooruPost } from "@/lib/api-client"
import { toast } from "@/hooks/use-toast"
import { trackFavorite, safeTrack } from "@/lib/analytics"

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

  // Helper to save favorites
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

  // Load favorites from localStorage on mount (Unified Storage)
  useEffect(() => {
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

      // 2. Migrate Legacy Danbooru (booruFavorites)
      const legacyDanbooru = localStorage.getItem('booruFavorites')
      if (legacyDanbooru) {
        try {
          const arr = JSON.parse(legacyDanbooru)
          if (Array.isArray(arr) && arr.length > 0) {
            arr.forEach(id => newSet.add(`danbooru:${id}`))
            localStorage.removeItem('booruFavorites')
            migrated = true
          }
        } catch (e) {}
      }

      // 3. Migrate Segregated Providers (e.g. booruFavorites-e621)
      const providers = ['e621', 'rule34', 'aibooru']
      providers.forEach(p => {
        const key = `booruFavorites-${p}`
        const raw = localStorage.getItem(key)
        if (raw) {
          try {
            const arr = JSON.parse(raw)
            if (Array.isArray(arr) && arr.length > 0) {
               arr.forEach(id => newSet.add(`${p}:${id}`))
               localStorage.removeItem(key)
               migrated = true
            }
          } catch(e) {}
        }
      })

      setFavorites(newSet)
      if (migrated) {
        saveFavoritesToStorage(newSet)
      }
      setFavoritesLoaded(true)
    }
  }, [saveFavoritesToStorage])

  const toggleFavorite = useCallback((postId: number, providerOverride?: string) => {
    // Construct unique key, using override if provided (for favorites view logic), else current provider
    const targetProvider = providerOverride || booruProvider
    const uniqueKey = `${targetProvider}:${postId}`
    
    // Use current state directly to determine action, avoiding side effects in state setter
    const isCurrentlyFavorited = favorites.has(uniqueKey)
    const newFavorites = new Set(favorites)

    if (isCurrentlyFavorited) {
        newFavorites.delete(uniqueKey)
        toast({
            title: "Removed from favorites",
            description: "Image removed from your favorites",
        })
        trackFavorite(postId, 'remove')
    } else {
        newFavorites.add(uniqueKey)
        toast({
            title: "Added to favorites",
            description: "Image added to your favorites",
        })
        trackFavorite(postId, 'add')
    }

    setFavorites(newFavorites)
    saveFavoritesToStorage(newFavorites)
  }, [favorites, booruProvider, saveFavoritesToStorage])

  const toggleShowFavorites = useCallback(() => {
    setShowFavorites(prev => {
        const next = !prev
        safeTrack('toggle_favorites_view', { show: next, count: favorites.size })
        return next
    })
  }, [favorites.size])

  const clearFavorites = useCallback(() => {
    setFavorites(new Set())
    saveFavoritesToStorage(new Set())
    
    toast({
      title: "Favorites cleared",
      description: "All favorites have been removed",
    })
  }, [saveFavoritesToStorage])

  const isFavorite = useCallback((provider: string, id: number) => {
      return favorites.has(`${provider}:${id}`)
  }, [favorites])

  // Prepare favorites list for hook
  const favoriteItems: FavoriteItem[] = useMemo(() => {
    return Array.from(favorites).map(key => {
      const [p, idStr] = key.split(':')
      // Handle legacy format (id only -> assume danbooru) or malformed keys
      if (!idStr) {
        return { provider: 'danbooru', id: parseInt(key, 10) }
      }
      return { provider: p as BooruProvider, id: parseInt(idStr, 10) }
    }).filter(item => !isNaN(item.id))
  }, [favorites])

   // Fetch favorite posts separately
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
