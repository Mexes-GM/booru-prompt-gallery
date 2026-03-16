import { useState, useEffect, useMemo, useCallback } from "react"
import { mutate } from "swr"
import { BooruProvider, FavoriteItem, useFavoritePosts, BooruPost } from "@/lib/api-client"
import { toast } from "@/hooks/use-toast"
import { trackFavorite, safeTrack } from "@/lib/analytics"
import { useUser } from "@/hooks/use-user"
import { createClient } from "@/lib/supabase/client"

// Helper to generate cache key (inlined to avoid circular dependencies/build issues)
const getFavoritesCacheKey = (favorites: FavoriteItem[]) => {
  if (favorites.length === 0) return null
  // Sort by provider then ID for consistent cache key
  const sortedKey = favorites
    .slice()
    .sort((a, b) => {
      const pDiff = a.provider.localeCompare(b.provider);
      return pDiff !== 0 ? pDiff : a.id - b.id;
    })
    .map(f => `${f.provider}:${f.id}`)
    .join(',');

  return `favorites-mixed-${sortedKey}`
}

export interface FavoriteFolder {
  id: string
  name: string
  icon?: string | null
}

export interface UseBooruFavoritesReturn {
  favorites: Set<string>
  folders: FavoriteFolder[]
  favoriteFolderMap: Record<string, string[]> // Changed to array
  favoritesLoaded: boolean
  showFavorites: boolean
  favoritePosts: BooruPost[] | undefined

  toggleFavorite: (postId: number, providerOverride?: string, folderId?: string | null) => Promise<void>
  createFolder: (name: string, icon?: string | null) => Promise<FavoriteFolder | null>
  deleteFolder: (folderId: string) => Promise<void>
  toggleShowFavorites: () => void
  clearFavorites: () => Promise<void>
  syncFavorites: () => Promise<void>
  isFavorite: (provider: string, id: number) => boolean
  favoriteItems: FavoriteItem[]
  isLoading: boolean
}

interface LocalStorageV2 {
  folders: FavoriteFolder[]
  favorites: Record<string, string | null>
}

interface LocalStorageV3 {
  folders: FavoriteFolder[]
  favorites: Record<string, string[]>
}

export function useBooruFavorites(booruProvider: BooruProvider): UseBooruFavoritesReturn {

  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const [folders, setFolders] = useState<FavoriteFolder[]>([])
  const [favoriteFolderMap, setFavoriteFolderMap] = useState<Record<string, string[]>>({})
  const [favoritesLoaded, setFavoritesLoaded] = useState(false)
  const [showFavorites, setShowFavorites] = useState(false)

  const { user, session, loading: userLoading } = useUser()
  const supabase = createClient()
  // const { mutate } = useSWRConfig()

  // Auto-save favorites to localStorage (Legacy/Anonymous) when state changes
  useEffect(() => {
    if (!user && favoritesLoaded && typeof window !== 'undefined') {
      const timeoutId = setTimeout(() => {
        try {
          const state: LocalStorageV3 = {
            folders: folders,
            favorites: favoriteFolderMap
          }
          localStorage.setItem('booruFavoritesV3', JSON.stringify(state))
        } catch (error) {
          console.warn('Error saving favorites to localStorage:', error)
        }
      }, 1000)
      return () => clearTimeout(timeoutId)
    }
  }, [user, favoritesLoaded, folders, favoriteFolderMap])


  // Generate simple unique ID for local storage folders if needed
  const generateLocalId = () => Math.random().toString(36).substring(2, 9)

  // Load favorites
  useEffect(() => {
    if (userLoading) return

    let isMounted = true

    async function fetchFavorites() {
      try {
        if (user) {
          const { data: dbFolders, error: foldersErr } = await supabase
            .from('favorite_folders')
            .select('id, name, icon')
            .order('created_at', { ascending: true })
          if (foldersErr) console.error("Folders fetch error:", foldersErr)

          const { data: dbFavorites, error: favsErr } = await supabase
            .from('favorites')
            .select('provider, post_id')
          if (favsErr) console.error("Favorites fetch error:", favsErr)

          const { data: dbFolderItems, error: itemsErr } = await supabase
            .from('favorite_folder_items')
            .select('provider, post_id, folder_id')
          if (itemsErr) console.error("Items fetch error:", itemsErr)

          const loadedFolders: FavoriteFolder[] = dbFolders || []
          const newSet = new Set<string>()
          const newMap: Record<string, string[]> = {}

          if (dbFavorites) {
            dbFavorites.forEach((item: any) => {
              const key = `${item.provider.toLowerCase()}:${item.post_id}`
              newSet.add(key)
              newMap[key] = []
            })
          }

          if (dbFolderItems) {
            dbFolderItems.forEach((item: any) => {
              const key = `${item.provider.toLowerCase()}:${item.post_id}`
              if (newMap[key] !== undefined) {
                newMap[key].push(item.folder_id)
              }
            })
          }

          // Migrate local favorites V2 and V3 to account
          if (typeof window !== 'undefined') {
            const savedV3 = localStorage.getItem('booruFavoritesV3')
            const savedV2 = localStorage.getItem('booruFavoritesV2')
            const savedLegacy = localStorage.getItem('globalBooruFavorites')

            if (savedV3 || savedV2 || savedLegacy) {
              let migrated = false
              const upsertFavorites: any[] = []

              const localFolderIdMap: Record<string, string> = {} // maps local folder ID to Supabase UUID

              // Process local folders first (from V2 or V3)
              const processFolders = async (foldersToProcess: FavoriteFolder[]) => {
                if (foldersToProcess && foldersToProcess.length > 0) {
                  for (const lf of foldersToProcess) {
                    const existing = loadedFolders.find(df => df.name === lf.name)
                    if (existing) {
                      localFolderIdMap[lf.id] = existing.id
                    } else {
                      const { data: newFolderData } = await supabase
                        .from('favorite_folders')
                        .upsert({ user_id: user.id, name: lf.name, icon: lf.icon || null }, { onConflict: 'user_id,name' })
                        .select()
                        .single()

                      if (newFolderData) {
                        loadedFolders.push({ id: newFolderData.id, name: newFolderData.name, icon: newFolderData.icon })
                        localFolderIdMap[lf.id] = newFolderData.id
                      }
                    }
                  }
                }
              }

              if (savedV2) {
                try {
                  const parsed: LocalStorageV2 = JSON.parse(savedV2)
                  await processFolders(parsed.folders)

                } catch (e) {
                  console.error('V2 Migration error:', e)
                }
              }

              // Migrate V3 folders and favorites
              if (savedV3) {
                try {
                  const parsedV3: LocalStorageV3 = JSON.parse(savedV3)
                  await processFolders(parsedV3.folders)
                  if (parsedV3.favorites) {
                    for (const [key, localFolderIds] of Object.entries(parsedV3.favorites)) {
                      if (!newSet.has(key)) {
                        newSet.add(key)
                        migrated = true

                        const [p, idStr] = key.split(':')
                        const post_id = parseInt(idStr, 10)

                        let targetFolderIds: string[] = []
                        if (Array.isArray(localFolderIds)) {
                          for (const lId of localFolderIds) {
                            if (localFolderIdMap[lId]) {
                              targetFolderIds.push(localFolderIdMap[lId])
                            }
                          }
                        }

                        newMap[key] = targetFolderIds

                        if (!isNaN(post_id)) {
                          upsertFavorites.push({
                            user_id: user.id,
                            provider: p,
                            post_id
                          })
                          if (targetFolderIds.length > 0) {
                            // we would upsert to folder_items but since this is an array let's just do it
                            // actually, we will handle junction table insertions below
                            for (const tfId of targetFolderIds) {
                              upsertFavorites.push({ type: 'item', user_id: user.id, provider: p, post_id, folder_id: tfId })
                            }
                          }
                        }
                      }
                    }
                  }

                } catch (e) {
                  console.error('V3 Migration error:', e)
                }
              }

              // Migrate V1 Legacy
              if (savedLegacy) {
                try {
                  const arr = JSON.parse(savedLegacy)
                  if (Array.isArray(arr) && arr.length > 0) {
                    for (const key of arr) {
                      if (!newSet.has(key)) {
                        newSet.add(key)
                        migrated = true
                        newMap[key] = []

                        const [p, idStr] = key.split(':')
                        const post_id = parseInt(idStr, 10)
                        if (!isNaN(post_id)) {
                          upsertFavorites.push({ user_id: user.id, provider: p, post_id })
                        }
                      }
                    }
                  }
                } catch (e) {
                  console.error('Legacy migration error:', e)
                }
              }

              let hasUpsertError = false
              if (upsertFavorites.length > 0) {
                const baseFavs = upsertFavorites.filter(u => !u.type)
                const folderFavs = upsertFavorites.filter(u => u.type === 'item').map(({ type, ...rest }) => rest)

                if (baseFavs.length > 0) {
                  const { error } = await supabase.from('favorites').upsert(baseFavs, { onConflict: 'user_id,provider,post_id', ignoreDuplicates: true })
                  if (error) {
                    console.error('[loadFavorites] Migration base upsert error:', error)
                    hasUpsertError = true
                  }
                }
                if (folderFavs.length > 0 && !hasUpsertError) {
                  const { error } = await supabase.from('favorite_folder_items').upsert(folderFavs, { onConflict: 'user_id,provider,post_id,folder_id', ignoreDuplicates: true })
                  if (error) {
                    console.error('[loadFavorites] Migration folder upsert error:', error)
                    hasUpsertError = true
                  }
                }
              }

              if (hasUpsertError) {
                console.error('[loadFavorites] Aborting local storage wipe due to Supabase upsert error.')
                migrated = false
              }

              if (migrated) {
                // Re-fetch from DB strictly after migration to ensure local state has everything 
                // plus any existing cloud data that wasn't local.
                const { data: refreshedFolders } = await supabase.from('favorite_folders').select('id, name, icon').order('created_at', { ascending: true })
                const { data: refreshedFavs } = await supabase.from('favorites').select('provider, post_id')
                const { data: refreshedFolderItems } = await supabase.from('favorite_folder_items').select('provider, post_id, folder_id')

                if (refreshedFolders) {
                  loadedFolders.length = 0
                  loadedFolders.push(...refreshedFolders)
                }

                if (refreshedFavs) {
                  newSet.clear()
                  for (const k in newMap) delete newMap[k]

                  refreshedFavs.forEach((item: any) => {
                    const key = `${item.provider.toLowerCase()}:${item.post_id}`
                    newSet.add(key)
                    newMap[key] = []
                  })
                }

                if (refreshedFolderItems) {
                  refreshedFolderItems.forEach((item: any) => {
                    const key = `${item.provider.toLowerCase()}:${item.post_id}`
                    if (newMap[key] !== undefined) {
                      newMap[key].push(item.folder_id)
                    }
                  })
                }
              }

              if (!hasUpsertError) {
                localStorage.removeItem('booruFavoritesV3')
                localStorage.removeItem('booruFavoritesV2')
                localStorage.removeItem('globalBooruFavorites')
              }

              if (!isMounted) return

              setFolders(loadedFolders)
              setFavorites(newSet)
              setFavoriteFolderMap(newMap)
              setFavoritesLoaded(true)
            } else {
              // User is authenticated, but has NO local storage to migrate.
              // We just set the state using the freshly parsed cloud database data.
              if (!isMounted) return
              setFolders(loadedFolders)
              setFavorites(newSet)
              setFavoriteFolderMap(newMap)
              setFavoritesLoaded(true)
            }
          } else {
            // SSR fallback for authenticated users
            if (!isMounted) return
            setFolders(loadedFolders)
            setFavorites(newSet)
            setFavoriteFolderMap(newMap)
            setFavoritesLoaded(true)
          }
        } else {
          // Build anonymous state for unauthenticated users
          if (typeof window !== 'undefined') {
            const newSet = new Set<string>()
            let newFolders: FavoriteFolder[] = []
            const newMap: Record<string, string[]> = {}
            let shouldSave = false

            const savedV3 = localStorage.getItem('booruFavoritesV3')
            const savedV2 = localStorage.getItem('booruFavoritesV2')
            const savedLegacy = localStorage.getItem('globalBooruFavorites')

            if (savedV3) {
              try {
                const parsed: LocalStorageV3 = JSON.parse(savedV3)
                if (parsed.folders) newFolders = parsed.folders
                if (parsed.favorites) {
                  for (const [key, folderIds] of Object.entries(parsed.favorites)) {
                    newSet.add(key)
                    newMap[key] = folderIds
                  }
                }
              } catch (e) { }
            } else if (savedV2) {
              // Migrate local V2 to V3
              try {
                const parsed: LocalStorageV2 = JSON.parse(savedV2)
                if (parsed.folders) newFolders = parsed.folders
                if (parsed.favorites) {
                  for (const [key, folderId] of Object.entries(parsed.favorites)) {
                    newSet.add(key)
                    newMap[key] = folderId ? [folderId] : []
                  }
                }
                shouldSave = true
              } catch (e) { }
            }

            if (savedLegacy) {
              try {
                const arr = JSON.parse(savedLegacy)
                if (Array.isArray(arr)) {
                  arr.forEach(k => {
                    if (!newSet.has(k)) {
                      newSet.add(k)
                      newMap[k] = []
                      shouldSave = true
                    }
                  })
                }
              } catch (e) { }
              if (shouldSave) localStorage.removeItem('globalBooruFavorites')
            }

            setFolders(newFolders)
            setFavorites(newSet)
            setFavoriteFolderMap(newMap)
            setFavoritesLoaded(true)

            if (shouldSave) {
              localStorage.setItem('booruFavoritesV3', JSON.stringify({ folders: newFolders, favorites: newMap }))
              localStorage.removeItem('booruFavoritesV2')
            }
          }
        }
      } catch (error) {
        console.error('[loadFavorites] CRITICAL EXCEPTION:', error)
      }
    } // end of async function fetchFavorites()

    fetchFavorites()

    return () => {
      isMounted = false
    }
  }, [user?.id, session?.access_token, userLoading, booruProvider])

  // Expose the manual sync function
  const syncFavorites = useCallback(async () => {
    try {
      if (!user || userLoading) return
      setFavoritesLoaded(false)

      const { data: dbFolders, error: foldersErr } = await supabase
        .from('favorite_folders')
        .select('id, name, icon')
        .order('created_at', { ascending: true })
      if (foldersErr) console.error("Folders fetch error:", foldersErr)

      const { data: dbFavorites, error: favsErr } = await supabase
        .from('favorites')
        .select('provider, post_id')
      if (favsErr) console.error("Favorites fetch error:", favsErr)

      const { data: dbFolderItems, error: itemsErr } = await supabase
        .from('favorite_folder_items')
        .select('provider, post_id, folder_id')
      if (itemsErr) console.error("Items fetch error:", itemsErr)

      const loadedFolders: FavoriteFolder[] = dbFolders || []
      const newSet = new Set<string>()
      const newMap: Record<string, string[]> = {}

      if (dbFavorites) {
        dbFavorites.forEach((item: any) => {
          const key = `${item.provider.toLowerCase()}:${item.post_id}`
          newSet.add(key)
          newMap[key] = []
        })
      }

      if (dbFolderItems) {
        dbFolderItems.forEach((item: any) => {
          const key = `${item.provider.toLowerCase()}:${item.post_id}`
          if (newMap[key] !== undefined) {
            newMap[key].push(item.folder_id)
          }
        })
      }

      setFolders(loadedFolders)
      setFavorites(newSet)
      setFavoriteFolderMap(newMap)
      setFavoritesLoaded(true)
      toast({ title: "Sync Complete", description: "Favorites downloaded from cloud" })
    } catch (error) {
      console.error('[syncFavorites] CRITICAL EXCEPTION:', error)
    }
  }, [user, userLoading])

  const toggleFavorite = useCallback(async (postId: number, providerOverride?: string, folderId?: string | null) => {
    const targetProvider = providerOverride || booruProvider
    const uniqueKey = `${targetProvider}:${postId}`
    const isCurrentlyFavorited = favorites.has(uniqueKey)
    const currentlyInFolders = favoriteFolderMap[uniqueKey] || []

    let isRemovingEntirely = false
    let isRemovingFolder = false
    let isAddingFolder = false

    const newFavorites = new Set(favorites)
    const newMap = { ...favoriteFolderMap }

    if (folderId === undefined) {
      // Toggle the entire favorite (Main heart button)
      if (isCurrentlyFavorited) {
        isRemovingEntirely = true
        newFavorites.delete(uniqueKey)
        delete newMap[uniqueKey]
        toast({ title: "Removed from favorites", description: "Image removed from your favorites" })
        trackFavorite(postId, 'remove')
      } else {
        newFavorites.add(uniqueKey)
        newMap[uniqueKey] = []
        toast({ title: "Saved to favorites", description: "Saved to Uncategorized" })
        trackFavorite(postId, 'add')
      }
    } else if (folderId === null) {
      // Explicitly setting to Uncategorized (clearing all folders but keeping it favorited)
      newFavorites.add(uniqueKey)
      newMap[uniqueKey] = []
      toast({ title: "Saved to favorites", description: "Saved to Uncategorized" })
    } else {
      // Toggling a specific folder
      newFavorites.add(uniqueKey)
      const hasFolder = currentlyInFolders.includes(folderId)

      if (hasFolder) {
        isRemovingFolder = true
        newMap[uniqueKey] = currentlyInFolders.filter(id => id !== folderId)
        // If they remove the last folder, it behaves like uncategorized but stays favorited.
      } else {
        isAddingFolder = true
        newMap[uniqueKey] = [...currentlyInFolders, folderId]
      }
    }

    // --- Optimistic Update Logic ---
    // If we are removing an item entirely, we can update the SWR cache to avoid a refetch/flash.
    
    if (isRemovingEntirely && favoritePosts) {
      // 1. Calculate the NEW key that will be generated by the hook in the next render
      const newFavoriteItems = Array.from(newFavorites).map(key => {
        const [p, idStr] = key.split(':')
          if (!idStr) return { provider: 'danbooru' as BooruProvider, id: parseInt(key, 10) }
          return { provider: p as BooruProvider, id: parseInt(idStr, 10) }
        }).filter(item => !isNaN(item.id))

      if (newCacheKey) {
        console.log('[toggleFavorite] Mutating Key:', newCacheKey)
        // 2. Filter the current posts to exclude the removed one
        const filteredPosts = favoritePosts.filter(p => {
          const k = `${p._provider || p.provider}:${p.id}`
          return k !== uniqueKey
        })
        
        // 3. Mutate the NEW key with the filtered data
        // We set revalidate: false because we know the data is correct (it's a subset)
        mutate(newCacheKey, filteredPosts, { revalidate: false })
      }
    }
    
    // -------------------------------

    setFavorites(newFavorites)
    setFavoriteFolderMap(newMap)

    // Persist
    if (user) {
      if (isRemovingEntirely) {
        await supabase.from('favorites').delete().match({ user_id: user.id, provider: targetProvider, post_id: postId })
      } else {
        if (!isCurrentlyFavorited) {
          // Ensure base favorite row exists
          await supabase.from('favorites').upsert({
            user_id: user.id,
            provider: targetProvider,
            post_id: postId
          }, { onConflict: 'user_id,provider,post_id', ignoreDuplicates: true })
        }

        if (folderId === null) {
          // Clear all folders for this post
          await supabase.from('favorite_folder_items').delete().match({ user_id: user.id, provider: targetProvider, post_id: postId })
        } else if (folderId !== undefined) {
          if (isRemovingFolder) {
            await supabase.from('favorite_folder_items').delete().match({ user_id: user.id, provider: targetProvider, post_id: postId, folder_id: folderId })
          } else if (isAddingFolder) {
            await supabase.from('favorite_folder_items').upsert({
              user_id: user.id,
              provider: targetProvider,
              post_id: postId,
              folder_id: folderId
            }, { onConflict: 'user_id,provider,post_id,folder_id', ignoreDuplicates: true })
          }
        }
      }
    }
  }, [favorites, favoriteFolderMap, folders, booruProvider, user])

  const createFolder = useCallback(async (name: string, icon?: string | null): Promise<FavoriteFolder | null> => {
    const trimmed = name.trim()
    if (!trimmed) return null
    if (folders.some(f => f.name.toLowerCase() === trimmed.toLowerCase())) {
      toast({ title: "Category exists", description: "You already have a category with this name.", variant: "destructive" })
      return null
    }

    let newFolder: FavoriteFolder
    if (user) {
      const { data, error } = await supabase
        .from('favorite_folders')
        .upsert({ user_id: user.id, name: trimmed, icon: icon || null }, { onConflict: 'user_id,name' })
        .select()
        .single()

      if (error || !data) {
        toast({ title: "Error creating category", description: error?.message || "Something went wrong", variant: "destructive" })
        return null
      }
      newFolder = { id: data.id, name: data.name, icon: data.icon }
    } else {
      newFolder = { id: generateLocalId(), name: trimmed, icon: icon || null }
    }

    const newFolders = [...folders, newFolder]
    setFolders(newFolders)

    toast({ title: "Category created", description: `"${trimmed}" is now available.` })
    return newFolder
  }, [folders, user])

  const deleteFolder = useCallback(async (folderId: string) => {
    const newFolders = folders.filter(f => f.id !== folderId)
    const newMap = { ...favoriteFolderMap }

    // Remove this folder completely from all items' arrays
    for (const [key, val] of Object.entries(newMap)) {
      if (val.includes(folderId)) {
        newMap[key] = val.filter(id => id !== folderId)
      }
    }

    setFolders(newFolders)
    setFavoriteFolderMap(newMap)

    if (user) {
      await supabase.from('favorite_folders').delete().match({ id: folderId })
      // favorites in db automatically cascade to NULL via ON DELETE SET NULL foreign key policy
    }

    toast({ title: "Category deleted", description: "Items moved to Uncategorized" })
  }, [folders, favoriteFolderMap, user])

  const toggleShowFavorites = useCallback(() => {
    setShowFavorites(prev => {
      const next = !prev
      safeTrack('toggle_favorites_view', { show: next, count: favorites.size })
      return next
    })
  }, [favorites.size])

  const clearFavorites = useCallback(async () => {
    setFavorites(new Set())
    setFavoriteFolderMap({})
    if (user) {
      await supabase.from('favorites').delete().eq('user_id', user.id)
    }
    toast({ title: "Favorites cleared", description: "All favorites have been removed" })
  }, [user])

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
    isLoading: favoritesLoading,
  } = useFavoritePosts(favoriteItems)

  return {
    favorites,
    folders,
    favoriteFolderMap,
    favoritesLoaded,
    showFavorites,
    favoritePosts,
    toggleFavorite,
    createFolder,
    deleteFolder,
    toggleShowFavorites,
    clearFavorites,
    syncFavorites,
    isFavorite,
    favoriteItems,
    isLoading: favoritesLoading
  }
}
