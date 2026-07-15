"use client"

import { AnimatePresence, motion, LayoutGroup } from "framer-motion"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { renderIcon } from "@/components/prompt-gallery/save-favorite-button"

interface FavoriteFolder {
  id: string
  name: string
  icon?: string | null
}

interface FavoritesFolderTabsProps {
  showFavorites: boolean
  favoriteFolderMap: Record<string, string[]>
  favoritesCount: number
  savedArtistsCount: number
  folders: FavoriteFolder[]
  activeFavoriteFolder: string | null | 'all' | 'artists'
  setActiveFavoriteFolder: (id: string | null | 'all' | 'artists') => void
  setFolderToDelete: (folder: { id: string; name: string } | null) => void
}

/**
 * The "Your Favorites" folder tab strip: All Favorites / Artists (reserved
 * virtual folder) / Uncategorized / user-created folders, each with a live
 * count derived from `favoriteFolderMap` (not from loaded posts, so counts
 * stay correct even while favorites are still loading). Only rendered while
 * the favorites view is active.
 */
export function FavoritesFolderTabs({
  showFavorites,
  favoriteFolderMap,
  favoritesCount,
  savedArtistsCount,
  folders,
  activeFavoriteFolder,
  setActiveFavoriteFolder,
  setFolderToDelete,
}: FavoritesFolderTabsProps) {
  return (
    <AnimatePresence>
      {showFavorites && (
        <motion.div
          initial={{ opacity: 0, height: 0, marginBottom: 0 }}
          animate={{ opacity: 1, height: "auto", marginBottom: 24 }}
          exit={{ opacity: 0, height: 0, marginBottom: 0 }}
          className="flex flex-col gap-3 overflow-hidden"
        >
          <div className="flex items-center justify-between px-2 pt-2">
            <h2 className="text-lg font-semibold tracking-tight">Your Favorites</h2>
          </div>
          <ScrollArea className="w-full whitespace-nowrap pb-2 pt-1">
            <div className="flex w-max space-x-2 px-2">
              <LayoutGroup id="favoritesTabs">
                {(() => {
                  // Calculate counts from core state (source of truth), NOT from loaded posts
                  const folderMap = favoriteFolderMap || {};
                  const folderEntries = Object.entries(folderMap);

                  const allCount = favoritesCount;

                  const uncategorizedCount = folderEntries.filter(([_, ids]) => ids.length === 0).length;

                  return [
                    { id: 'all', name: 'All Favorites', count: allCount, icon: null, isArtists: false },
                    // Reserved virtual folder for saved artists — always pinned
                    // right after "All Favorites" for discoverability.
                    { id: 'artists', name: 'Artists', count: savedArtistsCount, icon: 'Palette', isArtists: true },
                    { id: null, name: 'Uncategorized', count: uncategorizedCount, icon: 'Folder', isArtists: false },
                    ...folders.map(f => ({
                      id: f.id as string | null | 'all' | 'artists',
                      name: f.name,
                      count: folderEntries.filter(([_, ids]) => ids.includes(f.id)).length,
                      icon: f.icon,
                      isArtists: false,
                    }))
                  ].map((tab, i) => {
                    const isActive = activeFavoriteFolder === tab.id;
                    const isArtistsTab = tab.isArtists;
                    return (
                      <motion.button
                        key={String(tab.id)}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05, type: "spring", stiffness: 300, damping: 20 }}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setActiveFavoriteFolder(tab.id as any)}
                        className={cn(
                          "relative px-4 py-1.5 rounded-full text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 flex items-center gap-2",
                          isActive
                            ? "text-primary-foreground shadow-sm"
                            : isArtistsTab
                              ? "text-purple-700 dark:text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/40 ring-1 ring-purple-500/20 shadow-[0_0_10px_rgba(168,85,247,0.15)]"
                              : "text-muted-foreground hover:text-foreground bg-secondary/50 hover:bg-secondary border border-border/50",
                        )}
                      >
                        {isActive && (
                          <motion.div
                            layoutId="activeFavoriteFolderBubble"
                            className={cn(
                              "absolute inset-0 rounded-full shadow-sm",
                              isArtistsTab
                                ? "bg-gradient-to-r from-purple-500 to-fuchsia-500 shadow-[0_0_16px_rgba(168,85,247,0.45)]"
                                : "bg-red-500",
                            )}
                            transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                          />
                        )}
                        <span className="relative z-10 flex items-center gap-2">
                          {tab.icon && renderIcon(tab.icon, { className: `w-3.5 h-3.5 ${isActive ? "text-primary-foreground" : isArtistsTab ? "text-purple-500" : "opacity-80"}` })}
                          <span>{tab.name}</span>
                          <span className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded-full font-mono",
                            isActive ? "bg-black/20" : isArtistsTab ? "bg-purple-500/15 text-purple-700 dark:text-purple-200" : "bg-background/80",
                          )}>{tab.count}</span>
                          {tab.id !== 'all' && tab.id !== null && tab.id !== 'artists' && (
                            <span
                              role="button"
                              tabIndex={0}
                              title="Delete Folder"
                              onClick={(e) => {
                                e.stopPropagation()
                                setFolderToDelete({ id: tab.id as string, name: tab.name })
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  setFolderToDelete({ id: tab.id as string, name: tab.name })
                                }
                              }}
                              className={`ml-1 rounded-full p-1.5 min-w-[32px] min-h-[32px] flex items-center justify-center transition-[background-color,color,transform] duration-150 ease-out active:scale-90 motion-reduce:active:scale-100 cursor-pointer ${isActive ? "hover:bg-black/20 text-primary-foreground" : "hover:bg-secondary-foreground/20 text-muted-foreground hover:text-foreground"}`}
                              aria-label={`Delete folder ${tab.name}`}
                            >
                              <X className="w-3.5 h-3.5" />
                            </span>
                          )}
                        </span>
                      </motion.button>
                    )
                  });
                })()}
              </LayoutGroup>
            </div>
            <ScrollBar orientation="horizontal" className="h-2.5" />
          </ScrollArea>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
