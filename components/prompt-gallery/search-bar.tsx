"use client"

import { useState } from "react"
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
import { Search, X, RefreshCw } from "lucide-react"
import { CensorLabel, ShuffleLabel } from "@/components/prompt-gallery/search-toggle-labels"
import { userPreferences } from "@/lib/storage"
import { shouldConfirmNsfwEnable, nextRatingFilter, ALL_RATING } from "@/lib/nsfw-consent"
import { EASE_OUT_STRONG_CSS } from "@/lib/motion"
import { cn } from "@/lib/utils"
import { usePostHog } from 'posthog-js/react'
import { useReducedMotion } from "framer-motion"

/** Strong ease-out for the ↻ button sliding in/out next to Shuffle and the
 *  NSFW switch thumb. */
const SHUFFLE_EASE = `220ms ${EASE_OUT_STRONG_CSS}`

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
  /** Docked to the left edge of the input — the provider picker. */
  leading?: React.ReactNode
}

/**
 * The search row: provider picker + autocomplete search box, then the NSFW
 * switch and the Shuffle control. There is no "search" button on purpose —
 * results refetch on their own whenever the query or a filter changes; the
 * only manual action left is re-rolling a shuffled batch (↻, shown only while
 * Shuffle is on, since without it a refetch returns the same posts).
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
  leading,
}: SearchBarProps) {
  const posthog = usePostHog()
  const reduceMotion = useReducedMotion()

  // Capa 2: first-time confirmation before enabling NSFW. Once acknowledged
  // (persisted), the toggle is instant. Turning NSFW back off never prompts.
  const [nsfwDialogOpen, setNsfwDialogOpen] = useState(false)
  // Replays the Shuffle label's "deal" (toggle on / reshuffle clicks only).
  const [shuffleFx, setShuffleFx] = useState(0)

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

  const isRule34 = booruProvider === 'rule34'
  const nsfwOn = isRule34 || ratingFilter !== "rating:general"

  return (
    <div className="flex flex-col sm:flex-row gap-2" data-tour="search-row">
      <div className="flex flex-1 min-w-0" data-tour="search">
        {leading && (
          <div className="flex h-12 shrink-0 overflow-hidden rounded-l-lg border border-r-0 border-input">
            {leading}
          </div>
        )}
        <div className="relative flex-1 min-w-0">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center justify-center w-5 h-5 text-muted-foreground pointer-events-none z-20">
            <Search className="h-[18px] w-[18px]" />
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
            className={cn(
              "pl-10 pr-10 h-12 text-base z-10 relative bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
              leading ? "rounded-l-none rounded-r-lg" : "rounded-lg"
            )}
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
      </div>

      <div className="flex gap-2" data-tour="quick-controls">
        {isClient && (
          <button
            type="button"
            role="switch"
            aria-checked={nsfwOn}
            disabled={isRule34}
            onClick={handleToggleRating}
            data-tour="safety-controls"
            title={isRule34 ? "NSFW is always enabled for Rule34" : undefined}
            aria-label={nsfwOn ? "NSFW content shown. Click to show safe content only." : "Safe content only. Click to also show NSFW content."}
            className="flex h-12 items-center gap-2.5 rounded-lg border border-input bg-background px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            <CensorLabel revealed={nsfwOn} />
            <span
              aria-hidden="true"
              className={cn(
                "flex h-[18px] w-8 items-center rounded-full p-0.5 transition-colors",
                nsfwOn ? "bg-primary" : "bg-muted-foreground/30"
              )}
            >
              <span
                className={cn("h-3.5 w-3.5 rounded-full transition-colors", nsfwOn ? "bg-primary-foreground" : "bg-muted-foreground")}
                style={{
                  transform: nsfwOn ? "translateX(14px)" : "translateX(0)",
                  transition: reduceMotion ? "none" : `transform ${SHUFFLE_EASE}`,
                }}
              />
            </span>
          </button>
        )}

        {/* Split control: left half toggles Shuffle, right half (↻) re-rolls the
            shuffled batch and only exists while Shuffle is on (without it a
            refetch returns the same posts). */}
        <div
          className={cn(
            "flex h-12 items-stretch overflow-hidden rounded-lg border transition-colors",
            isShuffle ? "border-primary/40 bg-primary/10" : "border-input bg-background"
          )}
        >
          <button
            type="button"
            onClick={() => {
              // Deal the word out again only when Shuffle turns on.
              if (!isShuffle) setShuffleFx((n) => n + 1)
              toggleShuffle()
            }}
            aria-pressed={isShuffle}
            title={isShuffle ? "Disable shuffle" : "Enable shuffle"}
            className={cn(
              "flex items-center gap-2 px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              isShuffle ? "text-primary-text" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <ShuffleLabel playKey={shuffleFx} />
          </button>
          {/* Always mounted so it can animate: width 0 → 44px + fade/scale.
              `inert` while hidden keeps it out of the tab order and clicks. */}
          <button
            type="button"
            onClick={() => {
              setShuffleFx((n) => n + 1)
              refresh()
            }}
            disabled={isValidating}
            inert={!isShuffle}
            aria-hidden={!isShuffle}
            title="Reshuffle results"
            aria-label="Reshuffle results"
            style={{
              width: isShuffle ? 44 : 0,
              opacity: isShuffle ? 1 : 0,
              borderLeftWidth: isShuffle ? 1 : 0,
              transition: reduceMotion ? "none" : `width ${SHUFFLE_EASE}, opacity ${SHUFFLE_EASE}, border-width ${SHUFFLE_EASE}`,
            }}
            className="flex shrink-0 items-center justify-center overflow-hidden border-primary/40 text-primary-text transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60"
          >
            {/* Outer span animates in (scale + turn); the icon itself keeps
                animate-spin free to run while a reshuffle is loading. */}
            <span
              className="flex"
              style={{
                transform: isShuffle ? "scale(1) rotate(0deg)" : "scale(0.5) rotate(-90deg)",
                transition: reduceMotion ? "none" : `transform ${SHUFFLE_EASE}`,
              }}
            >
              <RefreshCw className={cn("h-4 w-4 shrink-0", isValidating && "animate-spin")} />
            </span>
          </button>
        </div>
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
