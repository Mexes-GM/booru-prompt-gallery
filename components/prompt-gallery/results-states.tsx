"use client"

import { Button } from "@/components/ui/button"
import { InfiniteScrollTrigger } from "@/components/ui/infinite-scroll-trigger"
import { NoResultsState } from "@/components/prompt-gallery/no-results-state"
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react"

interface FavoritesProgress {
  loaded: number
  total: number
}

interface ResultsStatesProps {
  filteredPostsLength: number
  showFavorites: boolean
  /**
   * True while the History view is active. History's own posts (`historyPosts`)
   * never paginate — the InfiniteScrollTrigger below is wired to the REGULAR
   * search's `loadMore`, which fetches more gallery results into
   * `search.allPosts`. Without this gate, scrolling while History is open kept
   * firing normal-search pagination in the background: every load pulled fresh
   * posts into `search.allPosts`, and if one of those ids happened to already
   * be in History (e.g. the user was mid-copying from the gallery), the two
   * post objects for the same id collided downstream in MasonryGrid, producing
   * the duplicated/looping card.
   */
  showHistory: boolean
  activeFavoriteFolder: string | null | 'all' | 'artists'

  // search
  isLoading: boolean
  isLoadingMore: boolean
  noMoreResults: boolean
  loadMoreError: boolean
  loadMore: () => void
  /** Client-side burst throttle tripped (too many page loads in a short window). */
  scrollLimited: boolean
  /** Per-session page cap reached (bounds scroll-scraping). */
  sessionCapReached: boolean

  // favorites
  favsIsLoading: boolean
  favsIsRefreshing: boolean
  favoritesError: string | null
  postsError: boolean
  favoritesProgress: FavoritesProgress
  retryLoadFavorites: () => void

  // image rate limiting (owned by the parent — imageErrorCountRef lives there)
  imageRateLimited: boolean
  onResumeScroll: () => void
}

/**
 * Everything below the results grid that isn't a post card: the infinite
 * scroll trigger (with its rate-limited / errored fallbacks), the initial
 * loading state (with a favorites progress bar when applicable), the
 * favorites-specific error states, and the final "no results" / "no
 * favorites" empty state.
 */
export function ResultsStates({
  filteredPostsLength,
  showFavorites,
  showHistory,
  activeFavoriteFolder,
  isLoading,
  isLoadingMore,
  noMoreResults,
  loadMoreError,
  loadMore,
  scrollLimited,
  sessionCapReached,
  favsIsLoading,
  favsIsRefreshing,
  favoritesError,
  postsError,
  favoritesProgress,
  retryLoadFavorites,
  imageRateLimited,
  onResumeScroll,
}: ResultsStatesProps) {
  return (
    <>
      {/* Load More / States */}
      {filteredPostsLength > 0 && !showFavorites && !showHistory && activeFavoriteFolder !== 'artists' && (
        <div className="text-center pb-8">
          {sessionCapReached ? (
            <div className="space-y-1 max-w-xs mx-auto">
              <p className="text-sm text-amber-600 dark:text-amber-400">
                Session limit reached for this search.
              </p>
              <p className="text-xs text-muted-foreground">
                Try a new search, provider, or filter to keep browsing.
              </p>
            </div>
          ) : !loadMoreError && !imageRateLimited ? (
            scrollLimited ? (
              <div className="flex flex-col items-center gap-3 w-full max-w-xs mx-auto">
                <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                  <div className="w-1/4 h-full bg-amber-500 rounded-full animate-indeterminate-bar [content-visibility:auto]" />
                </div>
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  Scrolling too fast — pausing for 5s.
                </p>
              </div>
            ) : (
              <InfiniteScrollTrigger
                onIntersect={loadMore}
                hasNextPage={!noMoreResults && !imageRateLimited}
                isLoading={isLoadingMore}
                error={loadMoreError}
                loadedCount={filteredPostsLength}
              />
            )
          ) : imageRateLimited ? (
            <div className="space-y-2">
              <p className="text-sm text-amber-600 dark:text-amber-400">Slow down! Too many requests at once.</p>
              <Button
                onClick={onResumeScroll}
                variant="outline"
                className="gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Resume Scroll
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-destructive">Failed to load more posts.</p>
              <Button
                onClick={loadMore}
                variant="outline"
                className="gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Retry
              </Button>
            </div>
          )}

          {noMoreResults && !loadMoreError && !imageRateLimited && !sessionCapReached && (
            <p className="text-muted-foreground text-sm py-4">
              --- End of results ---
            </p>
          )}
        </div>
      )}

      {/* Loading / Empty States */}
      {/* Show progress bar only on initial load (no posts visible yet).
          During Load More, the button handles its own loading state. */}
      {((isLoading && filteredPostsLength === 0 && !showFavorites && !showHistory) || (showFavorites && (favsIsLoading || favsIsRefreshing) && filteredPostsLength === 0 && activeFavoriteFolder !== 'artists')) && (
        <div className="text-center py-12">
          {showFavorites && favoritesProgress.total > 0 ? (
            <>
              {/* Progress bar */}
              <div className="w-full max-w-xs mx-auto mb-3">
                <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${Math.round((favoritesProgress.loaded / favoritesProgress.total) * 100)}%` }}
                  />
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Loading favorites...{" "}
                <span className="font-medium text-foreground">
                  {favoritesProgress.loaded}
                </span>
                {" / "}
                {favoritesProgress.total}
                {favoritesProgress.loaded > 0 && (
                  <span className="text-xs ml-1">
                    ({Math.round((favoritesProgress.loaded / favoritesProgress.total) * 100)}%)
                  </span>
                )}
              </p>
            </>
          ) : (
            <>
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
              <p className="mt-4">Loading...</p>
            </>
          )}
        </div>
      )}

      {/* Favorites error states */}
      {showFavorites && filteredPostsLength === 0 && activeFavoriteFolder !== 'artists' && !favsIsLoading && !favsIsRefreshing && (favoritesError || postsError) && (
        <div className="text-center py-12 px-4">
          <AlertTriangle className="w-10 h-10 mx-auto text-amber-500 mb-3" />
          {favoritesError ? (
            <>
              <p className="text-lg font-medium mb-1">Could not load favorites from cloud</p>
              <p className="text-sm text-muted-foreground mb-4">Check your connection and try again.</p>
            </>
          ) : (
            <>
              <p className="text-lg font-medium mb-1">Failed to load favorites</p>
              <p className="text-sm text-muted-foreground mb-4">The post data could not be retrieved. Please try again.</p>
            </>
          )}
          <Button onClick={retryLoadFavorites} variant="outline" className="gap-2">
            <RefreshCw className="w-4 h-4" />
            Retry
          </Button>
        </div>
      )}

      {!isLoading && (!favsIsLoading && !favsIsRefreshing) && filteredPostsLength === 0 && !showHistory && activeFavoriteFolder !== 'artists' && !favoritesError && !postsError && (
        <>
          {showFavorites ? (
            <div className="text-center py-12 px-4">
              <p className="text-lg font-medium">No favorites yet</p>
            </div>
          ) : (
            <NoResultsState />
          )}
        </>
      )}
    </>
  )
}
