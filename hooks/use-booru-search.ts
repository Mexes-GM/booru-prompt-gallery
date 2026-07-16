import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { useInfinitePosts, BooruProvider, BooruPost, apiUrl } from "@/lib/api-client"
import type { ScoreTier } from "@/lib/api-client"
import { userPreferences, STORAGE_KEYS } from "@/lib/storage"
import { usePersistentState } from "@/hooks/use-persistent-state"
import {
  trackSearch,
  trackLoadMore,
  trackRefresh,
  trackProviderChange,
  trackRatingChange,
} from '@/lib/analytics'
import { useToast } from "@/hooks/use-toast"

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
  const [searchTags, setSearchTagsState] = useState(() => {
    if (typeof window === 'undefined') return ""
    const params = new URLSearchParams(window.location.search)
    const tagsFromUrl = params.get('tags')
    if (tagsFromUrl) return tagsFromUrl
    return ""
  })

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
  const [debouncedSearchTags, setDebouncedSearchTags] = useState("")

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

  const [hasPromptFilter, setHasPromptFilter] = usePersistentState(
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
    "5",
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

  const [characterCountRange, _setCharacterCountRange] = usePersistentState<[number, number]>(
    [0, 10000],
    userPreferences.getCharacterCountRange,
    userPreferences.setCharacterCountRange,
    "characterCountRange",
    STORAGE_KEYS.CHARACTER_COUNT_RANGE
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

  const setCharacterCountRange = useCallback((value: [number, number] | ((prev: [number, number]) => [number, number])) => {
    userInteractionRef.current = true
    _setCharacterCountRange(value)
  }, [_setCharacterCountRange])

  const [appliedTagCountFilter, setAppliedTagCountFilter] = useState("5")
  const [appliedScoreTier, setAppliedScoreTier] = useState<ScoreTier>("off")
  const [appliedCharacterCountFilter, setAppliedCharacterCountFilter] = useState("0")
  const [appliedCharacterCountRange, setAppliedCharacterCountRange] = useState<[number, number]>([0, 10000])
  const [isClient, setIsClient] = useState(false)

  // Sync applied filter with persistent state on load (when no user interaction has occurred)
  useEffect(() => {
    if (!userInteractionRef.current) {
      setAppliedTagCountFilter(tagCountFilter)
      setAppliedScoreTier(scoreTier)
      setAppliedCharacterCountFilter(characterCountFilter)
      setAppliedCharacterCountRange(characterCountRange)
    }
  }, [tagCountFilter, scoreTier, characterCountFilter, characterCountRange])

 // Loading states
 const [loadMoreError, setLoadMoreError] = useState(false)
 const [noMoreResults, setNoMoreResults] = useState(false)
 const [lastLoadAttempt, setLastLoadAttempt] = useState(0)
 const [randomSeed, setRandomSeed] = useState<number>(0)
 const loadMoreGuardRef = useRef(false)
 const [circuitOpen, setCircuitOpen] = useState(false)

  // Store the rating before we forced it to 'all' for Rule34
  const forcedRule34RatingRef = useRef<string | null>(null)

  const { toast } = useToast()



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
    setHasPromptFilter(booruProvider === 'aibooru')

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
   setSessionCapReached(false)
   loadMoreGuardRef.current = false
 }, [booruProvider, order, ratingFilter, debouncedSearchTags, appliedTagCountFilter, appliedScoreTier, appliedCharacterCountFilter, setSize])

  // --- Derived Data ---

  const stablePostsRef = useRef<BooruPost[]>([])
  const lastSearchKeyRef = useRef<string>('')

  // Create a stable key for the current search parameters
  const currentSearchKey = `${booruProvider}-${debouncedSearchTags}-${ratingFilter}-${order}-${randomSeed}-${appliedTagCountFilter}-${appliedScoreTier}-${appliedCharacterCountFilter}`

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

  // Prefetch next page API response when new data arrives.
  // Skip random order — each seed produces a unique URL so there is no
  // cache to warm, and the extra request only consumes rate-limit budget.
  useEffect(() => {
    if (!pages || pages.length === 0) return
    if (noMoreResults || isReachingEnd) return
    if (order === 'random') return

    const nextPage = size + 1
    const encodedQuery = encodeURIComponent(debouncedSearchTags || '')

    let apiEndpoint = '/api/posts'
    // All providers now use /api/posts?provider=X (consolidated route)
    let provider = booruProvider
    if (booruProvider === 'rule34') provider = 'rule34'
    else if (booruProvider === 'e621') provider = 'e621'
    else if (booruProvider === 'gelbooru') provider = 'gelbooru'

    const nextUrl = apiUrl(`${apiEndpoint}?page=${nextPage}&tags=${encodedQuery}&order=${order}&provider=${provider}`)

    const link = document.createElement('link')
    link.rel = 'prefetch'
    link.href = nextUrl
    link.as = 'fetch'
    document.head.appendChild(link)

    return () => {
      if (link.parentNode) link.parentNode.removeChild(link)
    }
  }, [pages, size, noMoreResults, isReachingEnd, debouncedSearchTags, order, booruProvider, randomSeed])

  // --- Actions ---

  // Client-side scroll rate limiter — proactive, not reactive.
  //
  // Every existing protection (Danbooru's own per-IP limit, our Redis-backed
  // limiters for Gelbooru/Rule34) only reacts AFTER a request lands. Fast,
  // sustained scrolling can fire many page loads before any of those kick in
  // — worse in dev, where our own /api/posts limiter is intentionally
  // disabled (NODE_ENV==='development'), and irrelevant for Danbooru/e621,
  // which never touch /api/posts at all (direct browser→provider fetch).
  // This runs in the browser, for every provider, in every environment —
  // it doesn't depend on any backend deciding to reject us.
  //
  // A plain "minimum X ms between calls" throttle only spaces out individual
  // calls — it doesn't bound total volume. A user who keeps the trigger
  // re-firing at exactly that interval can still pull unlimited pages over
  // time. This is a real sliding-window cap: at most MAX_LOADS_PER_WINDOW
  // page loads within WINDOW_MS. Once hit, further loads are refused (with
  // user-visible feedback) until the oldest load in the window expires.
  //
  // TIGHTENED (2026-07-03, real ~500 users/day sizing): 5/10s was more burst
  // room than natural human scroll needs (reading/looking at each page takes
  // longer than 2s in practice). 3/10s still feels fluid for normal scrolling
  // but cuts automated/scripted scrolling off sooner, reducing the aggregate
  // request volume a normal day of traffic generates.
  const WINDOW_MS = 10_000
  const MAX_LOADS_PER_WINDOW = 2
  // Fixed cooldown once the burst cap trips (see SIMPLIFIED note below) —
  // predictable and easy to show in the UI, instead of a variable wait
  // computed from the sliding window's exact expiry.
  const SCROLL_COOLDOWN_MS = 5_000
  const loadTimestampsRef = useRef<number[]>([])
  const throttleRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollLimitedRef = useRef(false)
  const [scrollLimited, setScrollLimited] = useState(false)

  // Hard per-session page cap (F5 — rate-limit-antiabuse plan). Bounds
  // automated scroll-scraping: a bot that keeps the infinite-scroll trigger
  // firing can otherwise pull unlimited pages. `size` is the SWR page count
  // for the CURRENT search and resets to 1 on any new search/provider/filter
  // change, so this cap is naturally per-search-session.
  //
  // TIGHTENED (2026-07-03, real ~500 users/day sizing): 100 pages (~3000
  // posts) was sized to never bother a human, but that also meant it did
  // nothing to reduce the aggregate request volume of normal browsing — only
  // stopped extreme scraping. 35 pages (~1050 posts) is still generous for a
  // real browsing session (few users scroll that deep in one sitting) while
  // meaningfully lowering the ceiling per search session. Changing search,
  // provider, order, or any filter resets this cap immediately — a full page
  // refresh is NOT required to keep browsing.
  const MAX_SESSION_PAGE_LOADS = 35
  const [sessionCapReached, setSessionCapReached] = useState(false)

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

    // Hard per-session cap (F5): refuse further auto/manual loads once the
    // session has pulled MAX_SESSION_PAGE_LOADS pages. Bounds scroll-scraping
    // without hurting humans (who effectively never reach it); changing the
    // search/provider/filters resets `size` and lets browsing continue.
    if (size >= MAX_SESSION_PAGE_LOADS) {
      if (!sessionCapReached) {
        setSessionCapReached(true)
        toast({
          title: "Session Limit Reached",
          description: `You've loaded ${MAX_SESSION_PAGE_LOADS} pages for this search. Try a new search or filter to keep browsing.`,
          variant: "default",
        })
      }
      return
    }

    const now = Date.now()
    // Drop timestamps outside the window before evaluating the cap.
    loadTimestampsRef.current = loadTimestampsRef.current.filter(t => now - t < WINDOW_MS)

    if (loadTimestampsRef.current.length >= MAX_LOADS_PER_WINDOW) {
      // Cap hit: refuse this load and surface it to the user instead of
      // silently queuing forever — sustained scrolling should visibly
      // pause, not just get quietly delayed.
      //
      // SIMPLIFIED (2026-07-03): previously the cooldown was computed from
      // the sliding window itself (time until the oldest load ages out),
      // which was mathematically precise but gave the user an unpredictable
      // wait (anywhere from ~0 to ~10s) with no way to communicate a real
      // number in the UI. A fixed, short cooldown is easier to reason about
      // and to show ("pausing for 3s") at the cost of being slightly less
      // precise about the exact moment the window would allow a retry.
      const wasAlreadyLimited = scrollLimitedRef.current
      scrollLimitedRef.current = true
      setScrollLimited(true)
      if (!wasAlreadyLimited) {
        toast({
          title: "Scrolling Too Fast",
          description: `Loading is paused for ${SCROLL_COOLDOWN_MS / 1000}s to avoid overloading the provider. Please slow down.`,
          variant: "default",
        })
      }
      if (throttleRetryRef.current) clearTimeout(throttleRetryRef.current)
      throttleRetryRef.current = setTimeout(() => {
        throttleRetryRef.current = null
        scrollLimitedRef.current = false
        setScrollLimited(false)
        // Clear the burst window on cooldown expiry so the user gets a full
        // fresh allowance instead of immediately re-tripping the cap with
        // whatever timestamps are still inside WINDOW_MS.
        loadTimestampsRef.current = []
      }, SCROLL_COOLDOWN_MS)
      return
    }

    scrollLimitedRef.current = false
    setScrollLimited(false)
    loadTimestampsRef.current.push(now)

    loadMoreGuardRef.current = true
    setLoadMoreError(false)

    // Track deduped count so the no-more-results check can detect
    // when a new page brings only duplicate posts (CDN cache hit).
    setLastLoadAttempt(allPosts.length)

    const nextSize = size + 1
    setSize(nextSize)
    trackLoadMore({ order, nextPage: nextSize, currentCount: allPosts.length })
  }, [size, order, setSize, allPosts.length, toast, sessionCapReached])

  // Cancel any pending throttle retry on unmount to avoid calling a stale
  // closure after the component is gone.
  useEffect(() => {
    return () => {
      if (throttleRetryRef.current) clearTimeout(throttleRetryRef.current)
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
    
    // NOTE: This uses searchTags, not debouncedSearchTags, because the form
    // submission should execute immediately with whatever is in the input box,
    // rather than waiting for the debounce interval to settle.
    const query = searchTags.trim()
    const tagCount = query ? query.split(',').reduce((count, t) => t.trim() ? count + 1 : count, 0) : 0
    trackSearch({ query: query || '(empty)', rating: ratingFilter, order, tagCount })
  }, [order, ratingFilter, searchTags, setSize])

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
      } else if (currentDedupedCount === lastLoadAttempt || isReachingEnd) {
        // No new deduped posts arrived — all new pages were duplicates or empty
        setNoMoreResults(true)
        setLoadMoreError(false)
        setLastLoadAttempt(0)
      } else if (currentDedupedCount > lastLoadAttempt) {
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
    hasPromptFilter, setHasPromptFilter,
    removeLoRaTags, setRemoveLoRaTags,
    removeQualityTags, setRemoveQualityTags,
    tagCountFilter, setTagCountFilter,
    appliedTagCountFilter, setAppliedTagCountFilter,
    scoreTier, setScoreTier,
    appliedScoreTier, setAppliedScoreTier,
    characterCountFilter, setCharacterCountFilter,
    appliedCharacterCountFilter, setAppliedCharacterCountFilter,
    characterCountRange, setCharacterCountRange,
    appliedCharacterCountRange, setAppliedCharacterCountRange,
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
 scrollLimited,
 sessionCapReached,

    loadMore,
    refresh,
    handleSearch,
    clearSearch,

    // Trackers
    trackProviderChange,
    trackRatingChange,
  }
}