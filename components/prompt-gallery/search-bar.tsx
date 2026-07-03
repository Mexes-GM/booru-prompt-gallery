"use client"

import dynamic from "next/dynamic"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { SearchWithAutocomplete } from "@/components/prompt-gallery/search-with-autocomplete"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import {
  Search,
  X,
  Shield,
  Shuffle,
  RefreshCw,
  History,
  Settings,
  Trash2,
  Copy,
} from "lucide-react"
import type { HistoryItem } from "@/lib/storage"

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

  history: HistoryItem[]
  removeHistoryItem: (id: string) => void
  copyToClipboard: (content: string, postId: number, isPrompt?: boolean, thumbnailUrl?: string) => void
  clearHistory: () => void

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
  history,
  removeHistoryItem,
  copyToClipboard,
  clearHistory,
  showSettings,
  setShowSettings,
}: SearchBarProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-3">
      <div className="flex flex-1 group gap-0">
        <div className="relative flex-1">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center justify-center w-5 h-5 text-muted-foreground pointer-events-none z-20">
            <Search className="h-5 w-5" />
          </div>
          <SearchWithAutocomplete
            placeholders={placeholders}
            value={searchTags}
            setValue={setSearchTags}
            onSearch={() => handleSearch({ preventDefault: () => { } } as React.FormEvent)}
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

        {/* Blacklist Manager */}
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
            onClick={() => {
              const newRating = ratingFilter === "rating:general" ? "all" : "rating:general"
              setRatingFilter(newRating)
            }}
            className={`h-11 px-4 rounded-l-none border-l-0 shadow-sm transition-all z-0 ${booruProvider === 'rule34'
              ? "opacity-50 cursor-not-allowed bg-muted"
              : ratingFilter === "rating:general"
                ? "bg-green-50 text-green-700 hover:bg-green-100 hover:text-green-800 border-green-200/50 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30 dark:border-green-800/50"
                : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            title={booruProvider === 'rule34' ? "NSFW is always enabled for Rule34" : "Toggle NSFW content"}
            aria-label={ratingFilter === "rating:general" ? "Current filter: Safe content. Click to show all." : "Current filter: All content. Click to show safe only."}
          >
            <Shield className="w-4 h-4 sm:mr-2" />
            <span className="text-xs font-semibold hidden sm:inline">
              {ratingFilter === "rating:general" ? "Safe" : "NSFW"}
            </span>
          </Button>
        )}
      </div>
      <div className="flex gap-2 flex-wrap">

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
        <Sheet>
          <SheetTrigger asChild>
            <Button type="button" variant="outline" size="icon" className="h-11 w-11 shadow-sm" aria-label="View history">
              <History className="w-4 h-4" />
            </Button>
          </SheetTrigger>
          <SheetContent className="w-full sm:w-[400px] md:w-[540px]">
            <SheetHeader>
              <SheetTitle>Prompt History</SheetTitle>
              <SheetDescription>Your recently copied prompts.</SheetDescription>
            </SheetHeader>
            <div className="mt-4 overflow-y-auto max-h-[calc(100vh-120px)] pr-2 space-y-4">
              {history.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No history yet</p>
              ) : (
                <>
                  {history.map((item) => (
                    <div key={item.id} className="border rounded-lg p-3 space-y-2 relative group">
                      <div className="flex gap-3">
                        {item.thumbnailUrl && (
                          <div className="relative w-16 h-16 flex-shrink-0 rounded overflow-hidden bg-muted">
                            <Image
                              src={item.thumbnailUrl}
                              alt={`History item: ${item.content.slice(0, 50)}...`}
                              fill
                              className="object-cover"
                              unoptimized
                            />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-muted-foreground mb-1">{new Date(item.timestamp).toLocaleString()}</p>
                          <p className="text-sm line-clamp-3 break-words font-mono bg-muted/50 p-1 rounded">{item.content}</p>
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 mt-2">
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => removeHistoryItem(item.id)} aria-label="Delete history item">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="secondary" className="h-8" onClick={() => copyToClipboard(item.content, item.postId || 0, true, item.thumbnailUrl)}>
                          <Copy className="h-3 w-3 mr-1" /> Copy
                        </Button>
                      </div>
                    </div>
                  ))}
                  <Button variant="outline" className="w-full text-destructive hover:text-destructive hover:bg-destructive/10" onClick={clearHistory}>
                    Clear History
                  </Button>
                </>
              )}
            </div>
          </SheetContent>
        </Sheet>
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
    </div>
  )
}
