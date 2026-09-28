"use client"

import { useMemo } from "react"
import { type BooruPost, type BooruProvider } from "@/lib/api-client"
import { favKey } from "@/lib/favorites-logic"
import { isTagCountSupportedProvider } from "@/lib/booru/tag-limits"

export interface UseFilteredPostsArgs {
  /** All fetched posts for the current query (search.allPosts). */
  allPosts: BooruPost[]
  /** Current booru provider, used as a fallback when a post lacks `_provider`. */
  booruProvider: BooruProvider
  /** Global tag blacklist (underscored or spaced, normalized internally). */
  blacklist: string[]
  /** Whether character tags are included — gates the character-count filter. */
  includeCharacters: boolean
  /** Applied "Minimum Character Posts" filter value (string, parsed as int). */
  appliedCharacterCountFilter: string
  /** Per-tag booru post counts (Danbooru/Aibooru/Gelbooru/Rule34 via proxy; empty for other providers). */
  tagCounts: Record<string, number>
  /**
   * Client-side tag count filter (extension only). When set and the provider
   * does NOT support the `tagcount:>=N` metatag server-side, posts are filtered
   * client-side by splitting `tag_string` and checking the count. Providers
   * WITH server-side support already have this enforced at the API level, so
   * the client-side filter is a no-op for them.
   */
  appliedTagCountFilter?: string
  /**
   * Favorites integration (web app only). When omitted, the hook behaves as if
   * favorites mode is always off — which is the Pocket's case, since it has no
   * favorites feature.
   */
  favorites?: {
    showFavorites: boolean
    favoritePosts: BooruPost[] | undefined
    favoriteFolderMap: Record<string, string[]>
  }
  /** Active favorites folder filter (web app only; ignored without `favorites`). */
  activeFavoriteFolder?: string | null | "all" | "artists"
  /**
   * History integration (web app only), mirroring `favorites`. When
   * `showHistory` is true, `historyPosts` becomes the post source instead of
   * `allPosts`/favorites — same precedence favorites has today. Mutually
   * exclusive with favorites at the call site (prompt-gallery.tsx only shows
   * one of the two toggles active at a time).
   */
  history?: {
    showHistory: boolean
    historyPosts: BooruPost[] | undefined
  }
}

/**
 * Canonical post-filtering pipeline shared by the web app and the Pocket:
 * favorites/folder filter (web app only) → blacklist → minimum character-post
 * count → image-extension check. Extracted from `prompt-gallery.tsx` (that
 * version is the source of truth) so both shells stay in sync instead of
 * carrying two hand-maintained copies that can silently drift — which is
 * exactly what had happened before this hook existed (the Pocket's copy was
 * missing the image-extension check and had an extra pass-through branch the
 * web app never had for posts missing `tag_string_character`).
 */
export function useFilteredPosts({
  allPosts,
  booruProvider,
  blacklist,
  includeCharacters,
  appliedCharacterCountFilter,
  tagCounts,
  appliedTagCountFilter,
  favorites,
  activeFavoriteFolder = "all",
  history,
}: UseFilteredPostsArgs): BooruPost[] {
  return useMemo(() => {
    const showFavorites = favorites?.showFavorites ?? false
    const showHistory = history?.showHistory ?? false
    let source = allPosts
    if (showHistory) {
      source = history?.historyPosts || []
    } else if (showFavorites) {
      source = favorites?.favoritePosts || []
    }

    // Visual-only folder filter — applied at render, not in the favorites hook.
    // Never applies in history mode (history has no folder concept).
    const filterByFolder =
      !showHistory &&
      showFavorites &&
      activeFavoriteFolder !== "all" &&
      activeFavoriteFolder !== "artists"

    const normalizedBlacklist = blacklist.map(tag => tag.replace(/\s+/g, '_'))
    const normalizedBlacklistSet = new Set(normalizedBlacklist)

    return source.filter(post => {
      // Folder filter (web app only)
      if (filterByFolder && favorites) {
        const key = favKey(post._provider || booruProvider, post.id)
        const postFolders = favorites.favoriteFolderMap[key] || []
        if (activeFavoriteFolder === null) {
          if (postFolders.length !== 0) return false
        } else {
          if (!postFolders.includes(activeFavoriteFolder)) return false
        }
      }

      // Blacklist filter
      if (post.tag_string) {
        const postTags = post.tag_string.split(' ')
        if (postTags.some(tag => normalizedBlacklistSet.has(tag))) {
          return false
        }
      }

      // Character count filter
      const minCharPostCount = (includeCharacters && parseInt(appliedCharacterCountFilter)) || 0
      if (minCharPostCount > 0) {
        // The "Minimum Character Post Count" filter needs per-tag booru post counts.
        // Danbooru/Aibooru have native tag count APIs; Gelbooru/Rule34 use Danbooru
        // as a proxy (character tags share names across platforms). Only e621 and
        // other unsupported providers skip this filter entirely.
        const postProvider = (post._provider as BooruProvider | undefined) || booruProvider
        const supportsCharCounts = postProvider === 'danbooru' || postProvider === 'aibooru'
          || postProvider === 'gelbooru' || postProvider === 'rule34'

        if (supportsCharCounts) {
          if (!post.tag_string_character) {
            return false
          }
          const charTags = post.tag_string_character.split(' ').filter(Boolean)
          let hasValidCount = false

          for (const tag of charTags) {
            const count = tagCounts[tag]
            if (count === undefined) {
              continue
            } else if (count >= minCharPostCount) {
              hasValidCount = true
              break
            }
          }

          if (!hasValidCount) {
            return false
          }
        }
        // else: provider has no per-tag counts — skip this filter entirely.
      }

      // Client-side tag count filter — fallback for providers without server-side
      // `tagcount:>=N` metatag support (Gelbooru, Rule34). Providers WITH server-side
      // support (Danbooru, Aibooru, e621) already enforce this at the API level, so
      // running it again client-side would be redundant. Only the extension passes
      // appliedTagCountFilter; the web app omits it (undefined → no-op).
      const minTagCount = parseInt(appliedTagCountFilter || '0') || 0
      if (minTagCount > 0) {
        const postProvider = (post._provider as BooruProvider | undefined) || booruProvider
        if (!isTagCountSupportedProvider(postProvider)) {
          const tagString = (post.tag_string || '').trim()
          const tagCount = tagString.split(/\s+/).filter(Boolean).length
          if (tagCount < minTagCount) return false
        }
      }

      if (showFavorites || showHistory) return true
      const fileUrl = post.large_file_url || post.file_url
      const match = fileUrl?.match(/\.(jpg|jpeg|png|gif|webp|avif)$/i)
      return !!match
    })
  }, [
    allPosts,
    booruProvider,
    blacklist,
    includeCharacters,
    appliedCharacterCountFilter,
    tagCounts,
    appliedTagCountFilter,
    favorites,
    favorites?.showFavorites,
    favorites?.favoritePosts,
    favorites?.favoriteFolderMap,
    activeFavoriteFolder,
    history,
    history?.showHistory,
    history?.historyPosts,
  ])
}
