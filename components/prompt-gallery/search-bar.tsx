"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog"
import { SearchWithAutocomplete } from "@/components/prompt-gallery/search-with-autocomplete"
import {
  Search,
  X,
  Shield,
  Shuffle,
  RefreshCw,
  Settings,
} from "lucide-react"
import { userPreferences } from "@/lib/storage"
import { shouldConfirmNsfwEnable, nextRatingFilter, ALL_RATING } from "@/lib/nsfw-consent"
import { usePostHog } from 'posthog-js/react'

const BlacklistManager = dynamic(() => import("@/components/prompt-gallery/blacklist-manager").then(m => m.BlacklistManager), { ssr: false, loading: () => null })

interface SearchBarProps {
  placeholders: string[]
  searchTags: string
  setSearchTags: (tags: string) => void
  handleSearch: (e: React.FormEvent) => void
  clearSearch: () => void
  isClient: boolean
  booruProvider: string
  ratingFilter: string
  setRatingFilter: (rating: string) => void
  isShuffle: boolean
  toggleShuffle: () => void
  refresh: () => void
  isValidating: boolean

  blacklist: string[]
  addTag: (tag: string) => void
  removeTag: (tag: string) => void
  resetBlacklist: () => void

  showSettings: boolean
  setShowSettings: (open: boolean) => void
}

/**
 * The search input row: autocomplete search box + clear button, the blacklist
 * manager and NSFW toggle attached to the input, and the row of action
 * buttons (shuffle, refresh, prompt history sheet, settings toggle).
 */
export function SearchBar({
  placeholders,
  searchTags,
  setSearchTags,
  handleSearch,
  clearSearch,
  isClient,
  booruProvider,
  ratingFilter,
  setRatingFilter,
  isShuffle,
  toggleShuffle,
  refresh,
  isValidating,
  blacklist,
  addTag,
  removeTag,
  resetBlacklist,
  showSettings,
  setShowSettings,
}: SearchBarProps) {
  const posthog = usePostHog()
  
  // Capa 2: first-time confirmation before enabling NSFW. Once acknowledged
  // (persisted), the toggle is instant. Turning NSFW back off never prompts.
  const [nsfwDialogOpen, setNsfwDialogOpen] = useState(false)

  const handleToggleRating = () => {
    if (shouldConfirmNsfwEnable(ratingFilter, userPreferences.getNsfwAcknowledged())) {
      setNsfwDialogOpen(true)
      return
    }
    const newRating = nextRatingFilter(ratingFilter)
    posthog.capture('nsfw_preference_changed', { rating_filter: newRating })
    setRatingFilter(newRating)
  }

  const confirmEnableNsfw = () => {
    userPreferences.setNsfwAcknowledged(true)
    posthog.capture('nsfw_preference_changed', { rating_filter: ALL_RATING })
    setRatingFilter(ALL_RATING)
    setNsfwDialogOpen(false)
  }

  return (
    <div className="flex flex-col sm:flex-row gap-3">
      <div className="flex flex-1 group gap-0" data-tour="search">
        <div className="relative flex-1">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center justify-center w-5 h-5 text-muted-foreground pointer-events-none z-20">
            <Search className="h-5 w-5" />
          </div>
          <SearchWithAutocomplete
            placeholders={placeholders}
            value={searchTags}
            setValue={setSearchTags}
            onSearch={() => {
              posthog.capture('search_executed', {
                booru_source: booruProvider,
                query_length: searchTags.length,
                is_shuffle: isShuffle
              })
              handleSearch({ preventDefault: () => { } } as React.FormEvent)
            }}
            className="pl-10 pr-10 h-11 text-base shadow-sm rounded-r-none border-r-0 z-10 relative bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
            aria-label="Search tags input"
          />
          {searchTags && (
            <button
              type="button"
              onClick={clearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1 z-20"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Blacklist Manager + NSFW Toggle - grouped for the tour spotlight */}
        <div className="inline-flex items-center" data-tour="safety-controls">
          {isClient && (
            <BlacklistManager
              blacklist={blacklist}
              onAdd={addTag}
              onRemove={removeTag}
              onReset={resetBlacklist}
            />
          )}

          {/* NSFW Toggle - Attached to Input */}
          {isClient && (
            <Button
              type="button"
              disabled={booruProvider === 'rule34'}
              variant="outline"
              onClick={handleToggleRating}
              className={`h-11 px-2.5 sm:px-4 rounded-l-none border-l-0 shadow-sm transition-all z-0 ${booruProvider === 'rule34'
                ? "opacity-50 cursor-not-allowed bg-muted"
                : ratingFilter === "rating:general"
                  ? "bg-green-50 text-green-700 hover:bg-green-100 hover:text-green-800 border-green-200/50 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30 dark:border-green-800/50"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              title={booruProvider === 'rule34' ? "NSFW is always enabled for Rule34" : "Toggle NSFW content"}
              aria-label={ratingFilter === "rating:general" ? "Current filter: Safe content. Click to show all." : "Current filter: All content. Click to show safe only."}
            >
              <Shield className="w-4 h-4 mr-1 sm:mr-2 shrink-0" />
              <span className="text-xs font-semibold whitespace-nowrap">
                {ratingFilter === "rating:general" ? "Safe" : "NSFW"}
              </span>
            </Button>
          )}
        </div>
      </div>
      <div className="flex gap-2 flex-wrap" data-tour="quick-controls">

        <Button
          type="button"
          variant={isShuffle ? "default" : "outline"}
          onClick={toggleShuffle}
          className="h-11 w-11 p-0 shadow-sm"
          title={isShuffle ? "Disable shuffle" : "Enable shuffle"}
          aria-label={isShuffle ? "Disable shuffle" : "Enable shuffle"}
        >
          <Shuffle className="w-4 h-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={refresh}
          disabled={isValidating}
          className="h-11 w-11 p-0 shadow-sm"
          title="Refresh results"
          aria-label="Refresh results"
        >
          <RefreshCw className={`w-4 h-4 ${isValidating ? "animate-spin" : ""}`} />
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setShowSettings(!showSettings)}
          className={`h-11 w-11 p-0 shadow-sm ${showSettings ? "bg-muted" : ""}`}
          title="Toggle settings"
          aria-label={showSettings ? "Hide settings" : "Show settings"}
        >
          <Settings className="w-4 h-4" />
        </Button>
      </div>

      {/* Capa 2: NSFW enable confirmation (first time only) */}
      <AlertDialog open={nsfwDialogOpen} onOpenChange={setNsfwDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Show adult (NSFW) content?</AlertDialogTitle>
            <AlertDialogDescription>
              You&apos;re about to turn off the Safe filter. Results may include
              explicit / adult (18+) content. Only continue if you are of legal
              age and want to see this material. You can switch back to Safe at
              any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Stay in Safe mode</AlertDialogCancel>
            <AlertDialogAction type="button" onClick={confirmEnableNsfw}>
              Show NSFW
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
