import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { useInfinitePosts, BooruProvider, BooruPost } from "@/lib/api-client"
import type { ScoreTier } from "@/lib/api-client"
import { userPreferences, STORAGE_KEYS, DEFAULT_MINIMUM_TAG_COUNT } from "@/lib/storage"
import { usePersistentState } from "@/hooks/use-persistent-state"
import {
  trackLoadMore,
  trackRefresh,
  trackProviderChange,
  trackUrlSyncLoop,
} from '@/lib/analytics'
import { useToast } from "@/hooks/use-toast"
import { useScrollRateLimiter, MAX_SESSION_PAGE_LOADS } from "@/hooks/use-scroll-rate-limiter"

// History watchdog + circuit breaker for the ?tags= URL sync. On 2026-09-01
// an iOS Safari session flapped the URL "/" <-> "?tags=..." ~1,200 times and
// the writer was never identified. This wraps pushState/replaceState once per
// page (module scope, so it survives remounts, and installed before Next.js
// patches history, so Next's own writes pass through it too). It always calls
// the original — nothing is blocked — but past URL_SYNC_MAX_WRITES writes in
// URL_SYNC_WINDOW_MS it stops our own URL sync and reports the recent writes
// (with stack frames) to PostHog, once.
const URL_SYNC_MAX_WRITES = 20
const URL_SYNC_WINDOW_MS = 10_000

type HistoryWrite = { at: number; method: string; url: string; nextInternal: boolean; stack: string }
const historyWatchdog = { installed: false, writes: [] as HistoryWrite[], tripped: false }

function installHistoryWatchdog() {
  if (typeof window === 'undefined' || historyWatchdog.installed) return
  historyWatchdog.installed = true
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = window.history[method].bind(window.history)
    window.history[method] = function (data: unknown, unused: string, url?: string | URL | null) {
      try {
        const now = Date.now()
        const w = historyWatchdog
        w.writes = w.writes.filter(x => now - x.at < URL_SYNC_WINDOW_MS)
        w.writes.push({
          at: now,
          method,
          url: String(url ?? '').replace(window.location.origin, ''),
          nextInternal: !!(data as { __NA?: boolean } | null)?.__NA,
          stack: (new Error().stack ?? '').split('\n').slice(2, 5).map(s => s.trim()).join(' | ').slice(0, 300),
        })
        if (!w.tripped && w.writes.length > URL_SYNC_MAX_WRITES) {
          w.tripped = true
          trackUrlSyncLoop({
            writes: w.writes.length,
            windowMs: URL_SYNC_WINDOW_MS,
            recentWrites: w.writes.slice(-8).map(({ at: _at, ...rest }) => rest),
          })
        }
      } catch {
        /* diagnostics must never break navigation */
      }
      return original(data, unused, url)
    }
  }
}
installHistoryWatchdog()

const readTagsFromUrl = (): string => {
  if (typeof window === 'undefined') return ""
  return new URLSearchParams(window.location.search).get('tags') ?? ""
}

function shallowEqual(objA: any, objB: any): boolean {
  if (Object.is(objA, objB)) return true;
  if (typeof objA !== 'object' || objA === null || typeof objB !== 'object' || objB === null) return false;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    const key = keysA[i];
    if (!Object.prototype.hasOwnProperty.call(objB, key) || !Object.is(objA[key], objB[key])) {
      return false;
    }
  }
  return true;
}

export function useBooruSearch() {
  const [searchTags, setSearchTagsState] = useState(readTagsFromUrl)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const tagsFromUrl = params.get('tags')

      if (tagsFromUrl) {
        userPreferences.setSearchTags(tagsFromUrl)
      } else {
        const saved = userPreferences.getSearchTags()
        if (saved) {
          setSearchTagsState(saved)
        }
      }
    }
  }, [])

  const setSearchTags = useCallback((value: string | ((prev: string) => string)) => {
    setSearchTagsState(prev => {
      const newValue = typeof value === 'function' ? value(prev) : value
      userPreferences.setSearchTags(newValue)
      return newValue
    })
  }, [])
  // Seeded from the URL like searchTags: starting at "" made the URL-sync
  // effect below strip ?tags= on mount and put it back 500ms later (and fetch
  // an unfiltered first page in between).
  const [debouncedSearchTags, setDebouncedSearchTags] = useState(readTagsFromUrl)

  // --- Persistent State ---

  const [ratingFilter, setRatingFilter] = usePersistentState(
    "rating:general",
    userPreferences.getRatingFilter,
    userPreferences.setRatingFilter,
    "ratingFilter",
    STORAGE_KEYS.RATING_FILTER
  )

  const [isShuffle, setIsShuffle] = usePersistentState(
    false,
    userPreferences.getIsShuffle,
    userPreferences.setIsShuffle,
    "isShuffle",
    STORAGE_KEYS.IS_SHUFFLE
  )
  const order = isShuffle ? "random" : "recent"

  const [booruProvider, setBooruProvider] = usePersistentState<BooruProvider>(
    "danbooru",
    userPreferences.getBooruProvider,
    userPreferences.setBooruProvider,
    "booruProvider",
    STORAGE_KEYS.BOORU_PROVIDER
  )

  const [hasPromptFilter, _setHasPromptFilter] = usePersistentState(
    false,
    userPreferences.getHasPromptFilter,
    userPreferences.setHasPromptFilter,
    "hasPromptFilter",
    STORAGE_KEYS.HAS_PROMPT_FILTER
  )

  const [removeLoRaTags, setRemoveLoRaTags] = usePersistentState(
    false,
    userPreferences.getRemoveLoRaTags,
    userPreferences.setRemoveLoRaTags,
    "removeLoRaTags",
    STORAGE_KEYS.REMOVE_LORA_TAGS
  )

  const [removeQualityTags, setRemoveQualityTags] = usePersistentState(
    false,
    userPreferences.getRemoveQualityTags,
    userPreferences.setRemoveQualityTags,
    "removeQualityTags",
    STORAGE_KEYS.REMOVE_QUALITY_TAGS
  )

  const [tagCountFilter, _setTagCountFilter] = usePersistentState(
    DEFAULT_MINIMUM_TAG_COUNT,
    userPreferences.getMinimumTagCount,
    userPreferences.setMinimumTagCount,
    "minTagCount",
    STORAGE_KEYS.MINIMUM_TAG_COUNT
  )

  const [scoreTier, _setScoreTier] = usePersistentState<ScoreTier>(
    "off",
    userPreferences.getScoreTier,
    userPreferences.setScoreTier,
    "scoreTier",
    STORAGE_KEYS.SCORE_TIER
  )

  const [characterCountFilter, _setCharacterCountFilter] = usePersistentState(
    "0",
    userPreferences.getMinimumCharacterCount,
    userPreferences.setMinimumCharacterCount,
    "minCharacterCount",
    STORAGE_KEYS.MINIMUM_CHARACTER_COUNT
  )

  const userInteractionRef = useRef(false)

  const setTagCountFilter = useCallback((value: string | ((prev: string) => string)) => {
    userInteractionRef.current = true
    _setTagCountFilter(value)
  }, [_setTagCountFilter])

  const setScoreTier = useCallback((value: ScoreTier | ((prev: ScoreTier) => ScoreTier)) => {
    userInteractionRef.current = true
    _setScoreTier(value)
  }, [_setScoreTier])

  const setCharacterCountFilter = useCallback((value: string | ((prev: string) => string)) => {
    userInteractionRef.current = true
    _setCharacterCountFilter(value)
  }, [_setCharacterCountFilter])

  const [appliedTagCountFilter, setAppliedTagCountFilter] = useState(DEFAULT_MINIMUM_TAG_COUNT)
  const [appliedScoreTier, setAppliedScoreTier] = useState<ScoreTier>("off")
  const [appliedCharacterCountFilter, setAppliedCharacterCountFilter] = useState("0")
  const [isClient, setIsClient] = useState(false)

  // Sync applied filter with persistent state on load (when no user interaction has occurred)
  useEffect(() => {
    if (!userInteractionRef.current) {
      setAppliedTagCountFilter(tagCountFilter)
      setAppliedScoreTier(scoreTier)
      setAppliedCharacterCountFilter(characterCountFilter)
    }
  }, [tagCountFilter, scoreTier, characterCountFilter])

 // Loading states
 const [loadMoreError, setLoadMoreError] = useState(false)
 const [noMoreResults, setNoMoreResults] = useState(false)
 const [lastLoadAttempt, setLastLoadAttempt] = useState(0)
 const [randomSeed, setRandomSeed] = useState<number>(0)
 const loadMoreGuardRef = useRef(false)
 const [circuitOpen, setCircuitOpen] = useState(false)

 // Consecutive fetched pages that added ZERO new deduped posts. A single such
 // page is NOT a reliable end-of-results signal: it happens transiently from
 // pagination drift on order:recent (new uploads shift the page window) and
 // routinely on order:random (independent samples overlap). Treating one
 // all-duplicate page as terminal was the "shows Load More, then suddenly
 // End of results" bug. Only a sustained streak means the pool is exhausted.
 const duplicatePagesRef = useRef(0)
 // Best-effort auto-advance timer: keeps infinite scroll flowing across a
 // duplicate-only page. The visible list didn't grow, so the scroll position
 // (and the IntersectionObserver trigger) stays put and won't re-arm on its
 // own — without this the user would be stranded at a manual "Load More".
 const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Store the rating before we forced it to 'all' for Rule34
  const forcedRule34RatingRef = useRef<string | null>(null)

  const { toast } = useToast()

  // Client-side scroll rate limiter — proactive, not reactive.
  //
  // Every existing protection (Danbooru's own per-IP limit, our Redis-backed
  // limiters for Gelbooru/Rule34) only reacts AFTER a request lands. Fast,
  // sustained scrolling can fire many page loads before any of those kick in
  // — and those limiters are irrelevant for Danbooru/e621/Aibooru, which never
  // touch /api/posts at all (direct browser→provider fetch).
  // This runs in the browser, for every provider, in every environment —
  // it doesn't depend on any backend deciding to reject us.
  //
  // Guard logic (sliding-window burst cap + hard per-session page cap) lives
  // in the shared useScrollRateLimiter hook so Pack Mode's own seeding fetch
  // (hooks/use-pack-seed-search.ts) enforces the exact same numbers instead
  // of a second, potentially-drifting copy. See that hook for the full
  // rationale behind the specific constants.
  const rateLimiter = useScrollRateLimiter({
    onSessionCapReached: () => {
      toast({
        title: "Session Limit Reached",
        description: `You've loaded ${MAX_SESSION_PAGE_LOADS} pages for this search. Try a new search or filter to keep browsing.`,
        variant: "default",
      })
    },
    onScrollLimited: () => {
      toast({
        title: "Scrolling Too Fast",
        description: `Loading is paused for 5s to avoid overloading the provider. Please slow down.`,
        variant: "default",
      })
    },
  })

  // --- Initialization ---

  useEffect(() => {
    setIsClient(true)
    setRandomSeed(Date.now())
  }, []) // Run once on mount

  // Generate new seed when shuffle is enabled (useful when isShuffle is restored from storage)
  useEffect(() => {
    if (isShuffle && isClient) {
      setRandomSeed(Date.now())
    }
  }, [isShuffle, isClient])

  // Sync applied filter when persistent changes (e.g. from UI)
  // But wait for debounce/blur logic usually? In this component, setAppliedTagCountFilter is usually manual.
  // However, on init, we want it synced. The init effect handles the initial sync.

  // Auto-activate prompt filter when Aibooru is selected
  // Auto-disable NSFW filter when Rule34 is selected (default to allowed)
  // Restore previous rating when leaving Rule34 if it was forced
  useEffect(() => {
    _setHasPromptFilter(booruProvider === 'aibooru')

    if (booruProvider === 'rule34') {
      if (ratingFilter === 'rating:general') {
        forcedRule34RatingRef.current = 'rating:general'
        setRatingFilter('all')
      }
    } else {
      // Leaving Rule34 (or effectively redundant checks for other providers)
      if (forcedRule34RatingRef.current) {
        setRatingFilter(forcedRule34RatingRef.current)
        forcedRule34RatingRef.current = null
      }
    }
    // Intentionally scoped to `booruProvider` only: this effect must fire when
    // switching provider (to force/restore the Rule34 rating), not whenever the
    // user manually changes `ratingFilter` while already on the same provider —
    // adding `ratingFilter` here would re-run this on every manual rating change
    // and fight the user's own selection via `forcedRule34RatingRef`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booruProvider])

  const {
    data: pages,
    error,
    isLoading,
    isValidating,
    size,
    setSize,
    mutate,
  } = useInfinitePosts(debouncedSearchTags, ratingFilter, order, randomSeed, booruProvider, hasPromptFilter, appliedTagCountFilter, appliedScoreTier)

  // Debounce search tags
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTags(searchTags)
    }, 500)
    return () => clearTimeout(timer)
  }, [searchTags])

  // Sync URL (?tags=...) with the current (debounced) search, without polluting
  // history or triggering a Next router navigation. The <title> in the JSX
  // tree (React 19 hoisting) already reflects searchTags instantly, so we
  // debounce this to avoid a replaceState call on every keystroke.
  useEffect(() => {
    if (typeof window === 'undefined') return
    // Something is fighting over the URL (see installHistoryWatchdog): stop
    // syncing for this page load. Search keeps working; only the shareable
    // URL goes stale.
    if (historyWatchdog.tripped) return
    const url = new URL(window.location.href)
    const trimmed = debouncedSearchTags.trim()
    const current = url.searchParams.get('tags') ?? ''
    if (trimmed === current) return
    if (trimmed) {
      url.searchParams.set('tags', trimmed)
    } else {
      url.searchParams.delete('tags')
    }
    window.history.replaceState(window.history.state, '', url.toString())
  }, [debouncedSearchTags])

 // Reset pagination
 useEffect(() => {
   setSize(1)
   setNoMoreResults(false)
   setLoadMoreError(false)
   setLastLoadAttempt(0)
   setCircuitOpen(false)
   rateLimiter.reset()
   loadMoreGuardRef.current = false
   duplicatePagesRef.current = 0
   if (autoAdvanceTimerRef.current) {
     clearTimeout(autoAdvanceTimerRef.current)
     autoAdvanceTimerRef.current = null
   }
   // rateLimiter.reset is stable (useCallback with no deps in the shared hook)
   // appliedCharacterCountFilter is deliberately absent: it's a client-side
   // filter (useFilteredPosts) that never reaches the fetch, so changing it
   // must not throw away the pages already loaded.
   // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [booruProvider, order, ratingFilter, debouncedSearchTags, appliedTagCountFilter, appliedScoreTier, setSize])

  // --- Derived Data ---

  const stablePostsRef = useRef<BooruPost[]>([])
  const lastSearchKeyRef = useRef<string>('')

  // Create a stable key for the current search parameters (fetch inputs only —
  // client-side filters like appliedCharacterCountFilter are applied downstream)
  const currentSearchKey = `${booruProvider}-${debouncedSearchTags}-${ratingFilter}-${order}-${randomSeed}-${appliedTagCountFilter}-${appliedScoreTier}`

  const allPosts = useMemo(() => {
    if (!pages) return []

    // If search parameters changed, clear the stable cache
    if (currentSearchKey !== lastSearchKeyRef.current) {
      stablePostsRef.current = []
      lastSearchKeyRef.current = currentSearchKey
    }

    const flatPosts = pages.flat()
    const newStablePosts = [...stablePostsRef.current]
    const idToIndex = new Map<number, number>()
    
    // Map existing IDs to their indices
    newStablePosts.forEach((post, index) => {
      idToIndex.set(post.id, index)
    })

    let hasChanges = false

    for (let i = 0; i < flatPosts.length; i++) {
      const post = flatPosts[i]

      if (idToIndex.has(post.id)) {
        // Update existing post if any property changed (like scores)
        const index = idToIndex.get(post.id)!
        const existing = newStablePosts[index]
        if (!shallowEqual(existing, post)) {
          newStablePosts[index] = post
          hasChanges = true
        }
      } else {
        // Append new post at the end
        newStablePosts.push(post)
        idToIndex.set(post.id, newStablePosts.length - 1)
        hasChanges = true
      }
    }

    if (hasChanges || stablePostsRef.current.length === 0) {
      stablePostsRef.current = newStablePosts
    }

    return stablePostsRef.current
  }, [pages, currentSearchKey])

 const isLoadingMore = isValidating && size > 0
 // Ref for loadMore to read isLoadingMore without depending on it
 // (keeps the callback reference stable so the IntersectionObserver
 // in InfiniteScrollTrigger doesn't recreate on every loading change)
 const isLoadingMoreRef = useRef(isLoadingMore)
 useEffect(() => { isLoadingMoreRef.current = isLoadingMore }, [isLoadingMore])

 const isEmpty = !isLoading && pages?.[0]?.length === 0
  const lastPageFromAPI = pages && pages.length > 0 ? pages[pages.length - 1] : null
  const isReachingEnd = isEmpty || (lastPageFromAPI !== null && lastPageFromAPI.length === 0)

  // --- Actions ---

  // How many consecutive all-duplicate pages to tolerate before concluding the
  // result pool is genuinely exhausted. Small enough to stop wasting requests
  // on a truly-empty tail, large enough to ride out transient duplicate pages.
  const MAX_CONSECUTIVE_DUPLICATE_PAGES = 3

  const loadMore = useCallback(() => {
    // Synchronous guard: prevents re-entry from stale closures
    // (e.g. IntersectionObserver callback firing after React has
    // already committed a loadMore call in the same tick).
    if (loadMoreGuardRef.current) {
      return
    }

    if (isLoadingMoreRef.current) {
      return
    }

    // canLoadMore enforces both the hard per-session page cap and the
    // sliding-window burst cap, firing the toasts above via callbacks when
    // either newly trips. It also registers this load against the burst
    // window when it returns true, so no separate "register" call is needed.
    if (!rateLimiter.canLoadMore(size)) {
      return
    }

    loadMoreGuardRef.current = true
    setLoadMoreError(false)

    // Track deduped count so the no-more-results check can detect
    // when a new page brings only duplicate posts (CDN cache hit).
    setLastLoadAttempt(allPosts.length)

    const nextSize = size + 1
    setSize(nextSize)
    trackLoadMore({ order, nextPage: nextSize, currentCount: allPosts.length })
  }, [size, order, setSize, allPosts.length, rateLimiter])

  // Stable ref to loadMore so the auto-advance effect can trigger the next
  // page without listing loadMore in its deps (which would churn on every
  // size/count change) and without capturing a stale closure.
  const loadMoreRef = useRef(loadMore)
  useEffect(() => { loadMoreRef.current = loadMore }, [loadMore])

  // Cancel any pending auto-advance timer on unmount to avoid calling a stale
  // closure after the component is gone (the burst-cooldown timer is now
  // cleaned up internally by useScrollRateLimiter).
  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current)
    }
  }, [])

  // Clear guard when SWR starts validating (confirms the load was accepted)
  useEffect(() => {
    if (isLoadingMore) {
      loadMoreGuardRef.current = false
    }
  }, [isLoadingMore])

  const refresh = useCallback(() => {
    if (order === 'random' || /order:random|random:\d+/i.test(searchTags)) {
      setRandomSeed(Date.now())
    }
    mutate(undefined, { revalidate: true })
    trackRefresh(order)
  }, [order, searchTags, mutate])

  const toggleShuffle = useCallback(() => {
    setIsShuffle(prev => {
      const next = !prev
      if (next) {
        setRandomSeed(Date.now())
      }
      return next
    })
    setSize(1)
  }, [setIsShuffle, setSize])

  const handleSearch = useCallback((e?: React.FormEvent) => {
    e?.preventDefault()
    setSize(1)
    setNoMoreResults(false)
    setLoadMoreError(false)
    setLastLoadAttempt(0)
    setCircuitOpen(false)
    loadMoreGuardRef.current = false
    duplicatePagesRef.current = 0
    if (autoAdvanceTimerRef.current) {
      clearTimeout(autoAdvanceTimerRef.current)
      autoAdvanceTimerRef.current = null
    }
    // search_executed is captured by search-bar.tsx (with provider + is_shuffle).
  }, [setSize])

  const clearSearch = useCallback(() => {
    setSearchTags("")
    setSize(1)
  }, [setSize])

  // Handle No More Results / Errors
  useEffect(() => {
    let timeoutId: NodeJS.Timeout | undefined;

    // Gate: only evaluate completion once the requested page has actually been
    // fetched. After loadMore() calls setSize(size+1), there is a render window
    // where `lastLoadAttempt` is already set but SWR hasn't flipped `isValidating`
    // to true yet (so isLoadingMore is still false) AND the new page hasn't landed
    // (so allPosts hasn't grown). Without this gate the effect would run in that
    // window, see currentDedupedCount === lastLoadAttempt, and wrongly conclude
    // "no more results" — permanently halting pagination. This was most visible on
    // e621 (direct client fetch, no effective prefetch warming) where the fetch
    // window is widest. `pages.length >= size` is true only after SWR has stored
    // the page for the requested size (even an empty one, which isReachingEnd then
    // handles), so we never judge completion mid-fetch.
    // NOTE: an `error` bypasses the gate — a failed fetch never grows `pages`, so
    // error handling must not be blocked by requestedPageFetched.
    const requestedPageFetched = !!pages && pages.length >= size

    if (lastLoadAttempt > 0 && !isLoadingMore && (error || requestedPageFetched)) {
      const currentDedupedCount = allPosts.length

      if (error) {
        setLoadMoreError(true)
        setNoMoreResults(false)

        const status = (error as any)?.status
        const serverErrorMessage = (error as any)?.info?.error || ''
        const isCircuitOpen = status === 429 && serverErrorMessage.includes('saturated')
        const isRateLimit = status === 429 && !isCircuitOpen

        if (isCircuitOpen) {
          setCircuitOpen(true)
          // Auto-recover after 65s (circuit timeout is 60s + margin)
          timeoutId = setTimeout(() => setCircuitOpen(false), 65_000)
        }

        toast({
          title: isCircuitOpen
            ? "Danbooru Saturated"
            : isRateLimit
            ? "Service Temporarily Busy"
            : "Error Loading More Posts",
          description: isCircuitOpen
            ? "Danbooru is saturated. Requests are paused for 60 seconds to avoid a block."
            : isRateLimit
            ? "The image provider is limiting requests right now. Please wait a moment before loading more."
            : "There was an error loading more posts. Click 'Retry' to try again.",
          variant: isCircuitOpen || isRateLimit ? "default" : "destructive",
        })
        setLastLoadAttempt(0)
      } else if (isReachingEnd) {
        // Authoritative end: the API itself returned an empty page, so there
        // is genuinely nothing left to fetch.
        setNoMoreResults(true)
        setLoadMoreError(false)
        setLastLoadAttempt(0)
        duplicatePagesRef.current = 0
      } else if (currentDedupedCount === lastLoadAttempt) {
        // The fetched page added ZERO new deduped posts — every post was
        // already loaded. This is NOT a reliable end signal (pagination drift
        // on order:recent, sample overlap on order:random), so don't terminate
        // on a single occurrence. Count the streak instead.
        duplicatePagesRef.current += 1
        setLastLoadAttempt(0)

        if (duplicatePagesRef.current >= MAX_CONSECUTIVE_DUPLICATE_PAGES) {
          // Sustained duplicates — the pool is effectively exhausted.
          setNoMoreResults(true)
          setLoadMoreError(false)
          duplicatePagesRef.current = 0
        } else {
          // Keep pagination alive and auto-advance to the next page. The list
          // didn't grow, so the observer trigger stays in view and won't
          // re-arm by itself; nudge it forward. If the scroll rate limiter
          // refuses the load, the "Load More" button remains for a manual
          // retry (loadMore also enforces the per-session page cap).
          setNoMoreResults(false)
          setLoadMoreError(false)
          if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current)
          autoAdvanceTimerRef.current = setTimeout(() => {
            autoAdvanceTimerRef.current = null
            loadMoreRef.current()
          }, 150)
        }
      } else if (currentDedupedCount > lastLoadAttempt) {
        // New posts arrived — reset the duplicate streak and clear end/error.
        duplicatePagesRef.current = 0
        setNoMoreResults(false)
        setLoadMoreError(false)
        setLastLoadAttempt(0)
        setCircuitOpen(false)
      }
    }

    return () => {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [allPosts.length, isLoadingMore, lastLoadAttempt, isReachingEnd, error, toast, pages, size])

  return {
    searchTags, setSearchTags,
    debouncedSearchTags,
    ratingFilter, setRatingFilter,
    isShuffle, toggleShuffle,
    order,
    booruProvider, setBooruProvider,
    hasPromptFilter,
    removeLoRaTags, setRemoveLoRaTags,
    removeQualityTags, setRemoveQualityTags,
    tagCountFilter, setTagCountFilter,
    appliedTagCountFilter, setAppliedTagCountFilter,
    scoreTier, setScoreTier,
    appliedScoreTier, setAppliedScoreTier,
    characterCountFilter, setCharacterCountFilter,
    appliedCharacterCountFilter, setAppliedCharacterCountFilter,
    isClient,

    pages,
    allPosts,
    error,
    isLoading,
    isLoadingMore,
    isValidating,
    isEmpty,
    noMoreResults,
 loadMoreError,
 circuitOpen,
 scrollLimited: rateLimiter.scrollLimited,
 sessionCapReached: rateLimiter.sessionCapReached,

    loadMore,
    refresh,
    handleSearch,
    clearSearch,

    // Trackers
    trackProviderChange,
  }
}
