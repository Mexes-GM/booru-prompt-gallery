import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { mutate } from "swr"
import * as Sentry from "@sentry/nextjs"
import {
  BooruProvider,
  FavoriteItem,
  useFavoritePosts,
  BooruPost,
  getFavoritesCacheKey,
  apiUrl,
  persistToCache,
} from "@/lib/api-client"
import { toast } from "@/hooks/use-toast"
import { trackFavorite, safeTrack } from "@/lib/analytics"
import { useUser } from "@/hooks/use-user"
import { createClient } from "@/lib/supabase/client"
import { useFavoritesCore, FavoriteFolder } from "@/hooks/use-favorites-core"
import { useFavoritesSync } from "@/hooks/use-favorites-sync"
import { booruPostToCacheRow } from "@/lib/cache-utils"
import {
  removeFolderFromFavorites,
  buildFavoriteUpsertRow,
  favoritesSetToItems,
  favKey,
} from "@/lib/favorites-logic"

// Re-export FavoriteFolder from core (single source of truth)
export type { FavoriteFolder }

const generateLocalId = () => Math.random().toString(36).substring(2, 9)

export interface UseBooruFavoritesReturn {
  favorites: Set<string>
  folders: FavoriteFolder[]
  favoriteFolderMap: Record<string, string[]>
  favoritesLoaded: boolean
  showFavorites: boolean
  favoritePosts: BooruPost[] | undefined
  favoritesProgress: { loaded: number; total: number }
  isRefreshing: boolean
  favoritesError: string | null
  postsError: boolean

  toggleFavorite: (postId: number, providerOverride?: string, folderId?: string | null, postData?: BooruPost) => Promise<void>
  createFolder: (name: string, icon?: string | null) => Promise<FavoriteFolder | null>
  deleteFolder: (folderId: string) => Promise<void>
  toggleShowFavorites: () => void
  clearFavorites: () => Promise<void>
  syncFavorites: () => Promise<void>
  retryLoadFavorites: () => void
  injectRecoveredPosts: (posts: BooruPost[]) => Promise<void>
  isFavorite: (provider: string, id: number) => boolean
  favoriteItems: FavoriteItem[]
  isLoading: boolean
}

export function useBooruFavorites(
  booruProvider: BooruProvider,
  activeFolderId?: string | "all" | null,
): UseBooruFavoritesReturn {
  const { user } = useUser()
  const supabase = createClient()

  // ── Core state (loading, favourites, folders, folderMap) ──
  const core = useFavoritesCore()

  // ── UI-only state ──
  const [showFavorites, setShowFavorites] = useState(false)
  const [favoritesError, setFavoritesError] = useState<string | null>(null)
  // Mirror core.error → favoritesError
  useEffect(() => {
    setFavoritesError(core.error)
  }, [core.error])

  // ── Refs so stable callbacks never read stale closures (critical for React.memo'd items) ──
  const favoritesRef = useRef(core.favorites)
  const favoriteFolderMapRef = useRef(core.folderMap)
  const favoritePostsRef = useRef<BooruPost[] | undefined>(undefined)
  useEffect(() => { favoritesRef.current = core.favorites }, [core.favorites])
  useEffect(() => { favoriteFolderMapRef.current = core.folderMap }, [core.folderMap])

  // ── Realtime sync (Supabase Realtime → updates core state) ──
  useFavoritesSync({
    userId: user?.id,
    setFavorites: core.setFavorites,
    setFavoriteFolderMap: core.setFolderMap,
    setFolders: core.setFolders,
  })

  // ── Auto-save localStorage for anonymous users ──
  useEffect(() => {
    // F5: never persist when the load errored. On a parse failure the in-memory
    // state is empty while localStorage still holds the (recoverable) data;
    // writing empty over it would permanently wipe the user's favorites.
    if (!user && core.loaded && !core.error && typeof window !== "undefined") {
      const timeoutId = setTimeout(() => {
        try {
          const state = { folders: core.folders, favorites: core.folderMap }
          localStorage.setItem("booruFavoritesV3", JSON.stringify(state))
        } catch (e) {
          console.warn("Error saving favorites to localStorage:", e)
        }
      }, 1000)
      return () => clearTimeout(timeoutId)
    }
  }, [user, core.loaded, core.error, core.folders, core.folderMap])

  // ═══════════════════════════════════════════
  // Folder CRUD (adapted from useFavoriteFolders)
  // ═══════════════════════════════════════════

  const createFolder = useCallback(
    async (name: string, icon?: string | null): Promise<FavoriteFolder | null> => {
      const trimmed = name.trim()
      if (!trimmed) return null

      if (core.folders.some((f) => f.name.toLowerCase() === trimmed.toLowerCase())) {
        toast({
          title: "Category exists",
          description: "You already have a category with this name.",
          variant: "destructive",
        })
        return null
      }

      let newFolder: FavoriteFolder

      if (user) {
        const { data, error } = await supabase
          .from("favorite_folders")
          .upsert({ user_id: user.id, name: trimmed, icon: icon || null }, { onConflict: "user_id,name" })
          .select()
          .single()

        if (error || !data) {
          toast({
            title: "Error creating category",
            description: error?.message || "Something went wrong",
            variant: "destructive",
          })
          return null
        }
        newFolder = { id: data.id, name: data.name, icon: data.icon }
      } else {
        newFolder = { id: generateLocalId(), name: trimmed, icon: icon || null }
      }

      core.setFolders((prev) => [...prev, newFolder])
      toast({ title: "Category created", description: `"${trimmed}" is now available.` })
      return newFolder
    },
    [core.folders, user, supabase, core.setFolders],
  )

  const deleteFolder = useCallback(
    async (folderId: string) => {
      const prevFolders = core.folders
      const prevMap = core.folderMap

      const newFolders = prevFolders.filter((f) => f.id !== folderId)
      // Strip the folder id from every favorite that references it, and capture
      // exactly which rows changed so we can persist the same edits to the DB.
      const { newMap, affected } = removeFolderFromFavorites(prevMap, folderId)

      // Optimistic local update
      core.setFolders(newFolders)
      core.setFolderMap(newMap)

      if (user) {
        try {
          // A Postgres ON DELETE CASCADE cannot remove an element from a text[]
          // column, so the orphaned folder id must be stripped from each row
          // explicitly — otherwise the favorite keeps a dangling folder_ids entry
          // and disappears from both "Uncategorized" and every folder view.
          // Each row update targets a distinct favorite (independent write), so run
          // them concurrently instead of one at a time.
          await Promise.all(affected.map(async ({ key, folderIds }) => {
            const [provider, postIdStr] = key.split(":")
            const postId = parseInt(postIdStr, 10)
            if (!provider || isNaN(postId)) return
            const { error } = await supabase
              .from("favorites")
              .update({ folder_ids: folderIds })
              .match({ user_id: user.id, provider, post_id: postId })
            if (error) throw error
          }))

          const { error: deleteErr } = await supabase
            .from("favorite_folders")
            .delete()
            .match({ id: folderId })
          if (deleteErr) throw deleteErr
        } catch (e: any) {
          Sentry.captureException(e, {
            level: "warning",
            tags: { context: "use-booru-favorites", action: "delete_folder" },
          })
          // Rollback local state so the UI matches the (unchanged) DB.
          core.setFolders(prevFolders)
          core.setFolderMap(prevMap)
          toast({
            title: "Error deleting category",
            description: e?.message || "Failed to delete the category. Please try again.",
            variant: "destructive",
          })
          return
        }
      }

      toast({ title: "Category deleted", description: "Items moved to Uncategorized" })
    },
    [core.folders, core.folderMap, user, supabase, core.setFolders, core.setFolderMap],
  )

  // ═══════════════════════════════════════════
  // toggleFavorite (main action, preserves original 3-param signature)
  // ═══════════════════════════════════════════

  const toggleFavorite = useCallback(
    async (postId: number, providerOverride?: string, folderId?: string | null, postData?: BooruPost) => {
      const targetProvider = providerOverride || booruProvider
      const uniqueKey = favKey(targetProvider, postId)
      const currentFavorites = favoritesRef.current
      const currentFolderMap = favoriteFolderMapRef.current
      const currentFavoritePosts = favoritePostsRef.current
      const isCurrentlyFavorited = currentFavorites.has(uniqueKey)
      const currentlyInFolders = currentFolderMap[uniqueKey] || []

      let isRemovingEntirely = false
      let isRemovingFolder = false
      let isAddingFolder = false

      const newFavorites = new Set(
        !isCurrentlyFavorited ? [uniqueKey, ...currentFavorites] : currentFavorites,
      )
      const newMap = { ...currentFolderMap }

      if (folderId === undefined) {
        // Toggle the entire favorite (main heart button)
        if (isCurrentlyFavorited) {
          isRemovingEntirely = true
          newFavorites.delete(uniqueKey)
          delete newMap[uniqueKey]
          toast({ title: "Removed from favorites", description: "Image removed from your favorites" })
          trackFavorite(postId, "remove")
        } else {
          newMap[uniqueKey] = []
          toast({ title: "Saved to favorites", description: "Saved to Uncategorized" })
          trackFavorite(postId, "add")
        }
      } else if (folderId === null) {
        // Explicitly setting to Uncategorized (clear all folders, keep favorited)
        newMap[uniqueKey] = []
        toast({ title: "Saved to favorites", description: "Saved to Uncategorized" })
      } else {
        // Toggling a specific folder
        const hasFolder = currentlyInFolders.includes(folderId)
        if (hasFolder) {
          isRemovingFolder = true
          newMap[uniqueKey] = currentlyInFolders.filter((id) => id !== folderId)
        } else {
          isAddingFolder = true
          newMap[uniqueKey] = [...currentlyInFolders, folderId]
        }
      }

      // ── Optimistic SWR cache update on full removal ──
      if (isRemovingEntirely && currentFavoritePosts) {
        const newFavoriteItems: FavoriteItem[] = Array.from(newFavorites)
          .map((key) => {
            const [p, idStr] = key.split(":")
            if (!idStr) return { provider: "danbooru" as BooruProvider, id: parseInt(key, 10) }
            return { provider: p as BooruProvider, id: parseInt(idStr, 10) }
          })
          .filter((item) => !isNaN(item.id))

        const newCacheKey = getFavoritesCacheKey(newFavoriteItems)
        if (newCacheKey) {
          const filteredPosts = currentFavoritePosts.filter((p: any) => {
            const k = `${p._provider || p.provider}:${p.id}`
            return k !== uniqueKey
          })
          mutate(newCacheKey, filteredPosts, { revalidate: false })

          const currentItems: FavoriteItem[] = Array.from(currentFavorites)
            .map((key) => {
              const [p, idStr] = key.split(":")
              if (!idStr) return { provider: "danbooru" as BooruProvider, id: parseInt(key, 10) }
              return { provider: p as BooruProvider, id: parseInt(idStr, 10) }
            })
            .filter((item) => !isNaN(item.id))
          const currentCacheKey = getFavoritesCacheKey(currentItems)
          if (currentCacheKey) {
            mutate(currentCacheKey, filteredPosts, { revalidate: false })
          }
        }
      }

      // ── Optimistic SWR cache update on ADD ──
      const isAddingNewFavorite = !isCurrentlyFavorited && !isRemovingEntirely
      if (isAddingNewFavorite && currentFavoritePosts && postData) {
        const newFavoriteItems: FavoriteItem[] = Array.from(newFavorites)
          .map((key) => {
            const [p, idStr] = key.split(":")
            if (!idStr) return { provider: "danbooru" as BooruProvider, id: parseInt(key, 10) }
            return { provider: p as BooruProvider, id: parseInt(idStr, 10) }
          })
          .filter((item) => !isNaN(item.id))

        const newCacheKey = getFavoritesCacheKey(newFavoriteItems)
        if (newCacheKey) {
          const enrichedPost = { ...postData, _provider: postData._provider || targetProvider }
          const newPosts = [enrichedPost, ...currentFavoritePosts]
          mutate(newCacheKey, newPosts, { revalidate: false })

          const currentItems: FavoriteItem[] = Array.from(currentFavorites)
            .map((key) => {
              const [p, idStr] = key.split(":")
              if (!idStr) return { provider: "danbooru" as BooruProvider, id: parseInt(key, 10) }
              return { provider: p as BooruProvider, id: parseInt(idStr, 10) }
            })
            .filter((item) => !isNaN(item.id))
          const currentCacheKey = getFavoritesCacheKey(currentItems)
          if (currentCacheKey) {
            mutate(currentCacheKey, newPosts, { revalidate: false })
          }
        }
      }

      core.notifyLocalMutation()
      core.setFavorites(newFavorites)
      core.setFolderMap(newMap)

      // ── Fire-and-forget: cache post metadata for future instant loads ──
      if (isAddingNewFavorite) {
        fetch(apiUrl("/api/favorites"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ favorites: [{ id: postId, provider: targetProvider }] }),
        })
          .then((res) => (res.ok ? res.json() : null))
          .then((posts) => {
            if (posts?.[0]) {
              const row = booruPostToCacheRow(posts[0], targetProvider)
              supabase.from("booru_posts_cache").upsert(row, {
                onConflict: "provider,post_id",
              }).then(() => {}, () => {})
            }
          })
          .catch(() => {
            // Silent — post metadata will be cached on next lazy load
          })
      }

      // ── Persist to Supabase ──
      if (user) {
        try {
          if (isRemovingEntirely) {
            const { error } = await supabase
              .from("favorites")
              .delete()
              .match({ user_id: user.id, provider: targetProvider, post_id: postId })
            if (error) throw error
          } else {
            const targetFolderIds = newMap[uniqueKey] || []
            // F2: only stamp `position` when the favorite is newly created.
            // For folder-only edits we omit it so the PostgREST upsert preserves
            // the existing ordering instead of jumping the item to the top.
            const row = buildFavoriteUpsertRow({
              userId: user.id,
              provider: targetProvider,
              postId,
              folderIds: targetFolderIds,
              isNewFavorite: !isCurrentlyFavorited,
            })
            const { error } = await supabase
              .from("favorites")
              .upsert(row, { onConflict: "user_id,provider,post_id" })
            if (error) throw error
          }
        } catch (dbError: any) {
          console.error("[toggleFavorite] DB operation failed, rolling back:", dbError)
          toast({
            title: "Error saving favorite",
            description: `Failed to save your changes to the cloud. (${dbError?.message || "Unknown error"})`,
            variant: "destructive",
          })
          // Rollback
          core.setFavorites(currentFavorites)
          core.setFolderMap(currentFolderMap)

          if (isRemovingEntirely && currentFavoritePosts) {
            const currentCacheKey = getFavoritesCacheKey(favoritesSetToItems(currentFavorites))
            if (currentCacheKey) {
              mutate(currentCacheKey, currentFavoritePosts, { revalidate: false })
            }
          }

          // F3: on a failed ADD, revert the optimistic SWR cache mutation too.
          // The add optimistically prepended the post to BOTH the new-set cache
          // key and the current-set cache key; restore both to the pre-add list
          // so a phantom post does not linger in the favorites grid.
          if (isAddingNewFavorite && currentFavoritePosts) {
            const newCacheKey = getFavoritesCacheKey(favoritesSetToItems(newFavorites))
            const currentCacheKey = getFavoritesCacheKey(favoritesSetToItems(currentFavorites))
            if (newCacheKey) mutate(newCacheKey, currentFavoritePosts, { revalidate: false })
            if (currentCacheKey) mutate(currentCacheKey, currentFavoritePosts, { revalidate: false })
          }
          return
        }
      } else {
        // F4: anonymous users have no Supabase row, and the debounced auto-save
        // effect may not fire before a fast tab close / navigation. Persist the
        // new state to localStorage synchronously so the toggle is never lost.
        if (typeof window !== "undefined") {
          try {
            const state = { folders: core.folders, favorites: newMap }
            localStorage.setItem("booruFavoritesV3", JSON.stringify(state))
          } catch (e) {
            console.warn("Error saving favorites to localStorage:", e)
          }
        }
      }
    },
    [booruProvider, user, supabase, core.folders, core.notifyLocalMutation, core.setFavorites, core.setFolderMap],
  )

  // ═══════════════════════════════════════════
  // Other exposed functions
  // ═══════════════════════════════════════════

  const toggleShowFavorites = useCallback(() => {
    setShowFavorites((prev) => {
      const next = !prev
      safeTrack("toggle_favorites_view", { show: next, count: core.favorites.size })
      return next
    })
  }, [core.favorites.size])

  const clearFavorites = useCallback(async () => {
    core.setFavorites(new Set())
    core.setFolderMap({})
    core.setFolders([]) // F10: "clear all" must also drop the folders
    if (user) {
      await supabase.from("favorites").delete().eq("user_id", user.id)
      await supabase.from("favorite_folders").delete().eq("user_id", user.id)
    } else if (typeof window !== "undefined") {
      // F10/F4: persist the cleared state for anonymous users immediately.
      try {
        localStorage.setItem("booruFavoritesV3", JSON.stringify({ folders: [], favorites: {} }))
      } catch (e) {
        console.warn("Error clearing favorites in localStorage:", e)
      }
    }
    toast({ title: "Favorites cleared", description: "All favorites have been removed" })
  }, [user, supabase, core.setFavorites, core.setFolderMap, core.setFolders])

  const isFavorite = useCallback(
    (provider: string, id: number) => core.favorites.has(favKey(provider, id)),
    [core.favorites],
  )

  const retryLoadFavorites = useCallback(() => {
    setFavoritesError(null)
    core.syncFavorites()
  }, [core.syncFavorites])

  // ═══════════════════════════════════════════
  // favoriteItems: ALL favorites (no folder filter — filtering is done in UI)
  // Passing all items to useFavoritePosts keeps SWR cache stable across folder switches.
  // ═══════════════════════════════════════════

  const favoriteItems: FavoriteItem[] = useMemo(() => {
    return Array.from(core.favorites)
      .map((key) => {
        const [p, idStr] = key.split(":")
        if (!idStr) return { provider: "danbooru" as BooruProvider, id: parseInt(key, 10) }
        return { provider: p as BooruProvider, id: parseInt(idStr, 10) }
      })
      .filter((item) => !isNaN(item.id))
  }, [core.favorites])

  // ═══════════════════════════════════════════
  // useFavoritePosts (existing, no changes needed)
  // ═══════════════════════════════════════════

  const {
    posts: favoritePosts,
    isLoading: favoritesLoading,
    isValidating: isRefreshing,
    progress: favoritesProgress,
    mutate: mutateFavoritePosts,
  } = useFavoritePosts(favoriteItems)

  // ═══════════════════════════════════════════
  // Inject Recovered Posts
  // ═══════════════════════════════════════════
  const injectRecoveredPosts = useCallback(async (recovered: BooruPost[]) => {
    if (recovered.length === 0) return
    // Save to Supabase booru_posts_cache so they survive page reloads
    await persistToCache(recovered)
    // Trigger SWR re-fetch. Since they are now in the DB cache, the fetcher
    // will grab them instantly without hitting the booru API again.
    await mutateFavoritePosts()
  }, [mutateFavoritePosts])

  // Keep ref in sync so stable toggleFavorite always sees latest posts
  useEffect(() => {
    favoritePostsRef.current = favoritePosts
  }, [favoritePosts])

  // ═══════════════════════════════════════════
  // postsError: post-fetch failed despite having items to load
  // ═══════════════════════════════════════════

  const postsError = useMemo(() => {
    return (
      core.loaded &&
      !core.error &&
      !favoritesLoading &&
      favoritesProgress.total > 0 &&
      favoritesProgress.loaded === favoritesProgress.total &&
      (!favoritePosts || favoritePosts.length === 0)
    )
  }, [core.loaded, core.error, favoritesLoading, favoritesProgress, favoritePosts])

  // ═══════════════════════════════════════════
  // Return: identical public API to the original hook
  // ═══════════════════════════════════════════

  return {
    favorites: core.favorites,
    folders: core.folders,
    favoriteFolderMap: core.folderMap,
    favoritesLoaded: core.loaded,
    showFavorites,
    favoritePosts,
    favoritesProgress,
    isRefreshing,
    favoritesError,
    postsError,

    toggleFavorite,
    createFolder,
    deleteFolder,
    toggleShowFavorites,
    clearFavorites,
    syncFavorites: core.syncFavorites,
    retryLoadFavorites,
    injectRecoveredPosts,
    isFavorite,
    favoriteItems,
    isLoading: favoritesLoading,
  }
}
