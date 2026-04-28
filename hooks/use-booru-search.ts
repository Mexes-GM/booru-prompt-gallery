import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { useInfinitePosts, BooruProvider, BooruPost } from "@/lib/api-client"
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

// Only 1 API call (~60 images) per window to stay under Danbooru's radar.
// The user must wait out the window before loading the next batch.
const DANBOORU_MAX_LOADS_PER_WINDOW = 1
const DANBOORU_WINDOW_MS = 15_000

// Jitter: add 0%–30% random delay so multiple clients don't
// synchronize their request windows and hammer the server.
// Only positive jitter — negative jitter would expire the throttle
// before the window ends, causing a cascade of re-throttles.
function applyJitter(baseMs: number): number {
  const jitter = Math.random() * 0.3 // 0% to +30%
  return Math.round(baseMs * (1 + jitter))
}

// Search hash for cross-tab coordination — only tabs with the same
// search parameters share rate limit state.
function getSearchHash(tags: string, rating: string, order: string): string {
  return `${tags}::${rating}::${order}`
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

  const setCharacterCountFilter = useCallback((value: string | ((prev: string) => string)) => {
    userInteractionRef.current = true
    _setCharacterCountFilter(value)
  }, [_setCharacterCountFilter])

  const [appliedTagCountFilter, setAppliedTagCountFilter] = useState("5")
  const [appliedCharacterCountFilter, setAppliedCharacterCountFilter] = useState("0")
  const [isClient, setIsClient] = useState(false)

  // Sync applied filter with persistent state on load (when no user interaction has occurred)
  useEffect(() => {
    if (!userInteractionRef.current) {
      setAppliedTagCountFilter(tagCountFilter)
      setAppliedCharacterCountFilter(characterCountFilter)
    }
  }, [tagCountFilter, characterCountFilter])

  // Loading states
  const [isLoadingLock, setIsLoadingLock] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState(false)
  const [noMoreResults, setNoMoreResults] = useState(false)
  const [lastLoadAttempt, setLastLoadAttempt] = useState(0)
  const [randomSeed, setRandomSeed] = useState<number>(0)
  const loadTimestampsRef = useRef<number[]>([])
  const throttleExpiresAtRef = useRef<number>(0)
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null)
  const loadMoreGuardRef = useRef(false)
  const wasLoadingMoreRef = useRef(false)
  const [isScrollThrottled, setIsScrollThrottled] = useState(false)
  const [throttleCountdown, setThrottleCountdown] = useState(0)
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
  }, [booruProvider])

  const {
    data: pages,
    error,
    isLoading,
    isValidating,
    size,
    setSize,
    mutate,
  } = useInfinitePosts(debouncedSearchTags, ratingFilter, order, randomSeed, booruProvider, hasPromptFilter, appliedTagCountFilter)

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
    setIsScrollThrottled(false)
    setThrottleCountdown(0)
    setCircuitOpen(false)
    loadTimestampsRef.current = []
    throttleExpiresAtRef.current = 0
    loadMoreGuardRef.current = false
    wasLoadingMoreRef.current = false
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current)
      countdownIntervalRef.current = null
    }
  }, [order, ratingFilter, debouncedSearchTags, appliedTagCountFilter, appliedCharacterCountFilter, setSize])

  // --- Derived Data ---

  const allPosts = useMemo(() => {
    if (!pages) return []

    const flatPosts = pages.flat()
    const seenIds = new Set<number>()
    const keptPosts: BooruPost[] = []

    // Single pass through all posts - O(n) time complexity
    for (let i = 0; i < flatPosts.length; i++) {
      const post = flatPosts[i]

      if (seenIds.has(post.id)) {
        continue
      }

      seenIds.add(post.id)
      keptPosts.push(post)
    }

    return keptPosts
  }, [pages])

  const isLoadingMore = isValidating && size > 0
  const isEmpty = !isLoading && pages?.[0]?.length === 0
  const lastPageFromAPI = pages && pages.length > 0 ? pages[pages.length - 1] : null
  const isReachingEnd = isEmpty || (lastPageFromAPI !== null && lastPageFromAPI.length === 0)

  // Diagnostic: log SWR state transitions to trace data loading
  useEffect(() => {
    console.log('[DanbooruThrottle] SWR state changed', {
      size,
      pagesCount: pages?.length ?? 0,
      totalPosts: pages ? pages.flat().length : 0,
      isValidating,
      isLoadingMore,
      isLoading,
      isReachingEnd,
      error: error ? String(error) : null,
      lastPageEmpty: lastPageFromAPI !== null && lastPageFromAPI.length === 0,
    })
  }, [size, pages, isValidating, isLoading, error, isReachingEnd])

  // Prefetch next page API response when new data arrives
  useEffect(() => {
    if (!pages || pages.length === 0) return
    if (noMoreResults || isReachingEnd) return

    const nextPage = size + 1
    const encodedQuery = encodeURIComponent(debouncedSearchTags || '')

    let apiEndpoint = '/api/posts'
    if (booruProvider === 'rule34') apiEndpoint = '/api/rule34'
    else if (booruProvider === 'e621') apiEndpoint = '/api/e621'
    else if (booruProvider === 'gelbooru') apiEndpoint = '/api/gelbooru'

    const isRandomOrder = order === 'random'
    const effectivePage = isRandomOrder ? 1 : nextPage
    const seedParam = isRandomOrder && randomSeed ? `&seed=${randomSeed}_${nextPage - 1}` : ''

    const nextUrl = `${apiEndpoint}?page=${effectivePage}&tags=${encodedQuery}&order=${order}${seedParam}`

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

  const loadMore = useCallback(() => {
    // Synchronous guard: prevents re-entry from stale closures
    // (e.g. IntersectionObserver callback firing after React has
    // already committed a loadMore call in the same tick).
    if (loadMoreGuardRef.current) {
      console.log('[DanbooruThrottle] loadMore BLOCKED by guard ref')
      return
    }
    const now = Date.now()

    if (isLoadingLock || isLoadingMore) {
      console.log('[DanbooruThrottle] loadMore BLOCKED by lock', { isLoadingLock, isLoadingMore })
      return
    }

    loadMoreGuardRef.current = true

    const isDanbooru = booruProvider === 'danbooru'

    if (isDanbooru) {
      const windowStart = now - DANBOORU_WINDOW_MS
      const timestampsBefore = loadTimestampsRef.current.length
      loadTimestampsRef.current = loadTimestampsRef.current.filter(t => t > windowStart)
      const timestampsAfter = loadTimestampsRef.current.length

      if (loadTimestampsRef.current.length >= DANBOORU_MAX_LOADS_PER_WINDOW) {
        const oldestTimestamp = loadTimestampsRef.current[0]
        const oldestAge = now - oldestTimestamp
        const baseRetryAfter = oldestTimestamp + DANBOORU_WINDOW_MS - now
        const retryAfter = Math.max(1000, applyJitter(baseRetryAfter))
        const expiresAt = now + retryAfter
        const countdownDisplay = Math.ceil(retryAfter / 1000)

        console.log('[DanbooruThrottle] THROTTLE ACTIVATED', {
          oldestAge,
          oldestAgeSec: (oldestAge / 1000).toFixed(1) + 's',
          windowMs: DANBOORU_WINDOW_MS,
          baseRetryAfter,
          baseRetryAfterSec: (baseRetryAfter / 1000).toFixed(1) + 's',
          retryAfter,
          retryAfterSec: (retryAfter / 1000).toFixed(1) + 's',
          expiresAt,
          countdownDisplay,
          timestampsBefore,
          timestampsAfter,
        })

        throttleExpiresAtRef.current = expiresAt
        setIsScrollThrottled(true)
        setThrottleCountdown(countdownDisplay)

        // Single interval: both counts down AND expires the throttle.
        // Uses absolute expiresAt so it survives background-tab throttling.
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
        countdownIntervalRef.current = setInterval(() => {
          const remaining = Math.max(0, throttleExpiresAtRef.current - Date.now())
          const countdown = Math.ceil(remaining / 1000)
          // Only update state when the displayed value actually changes
          setThrottleCountdown(prev => prev === countdown ? prev : countdown)

          if (remaining <= 0) {
            console.log('[DanbooruThrottle] THROTTLE EXPIRED via interval')
            if (countdownIntervalRef.current) {
              clearInterval(countdownIntervalRef.current)
              countdownIntervalRef.current = null
            }
            setIsScrollThrottled(false)
            throttleExpiresAtRef.current = 0

            if (broadcastChannelRef.current) {
              const hash = getSearchHash(debouncedSearchTags, ratingFilter, order)
              broadcastChannelRef.current.postMessage({ type: 'unthrottled', searchHash: hash })
            }
          }
        }, 250)

        // Cross-tab broadcast
        if (broadcastChannelRef.current) {
          const searchHash = getSearchHash(debouncedSearchTags, ratingFilter, order)
          broadcastChannelRef.current.postMessage({
            type: 'throttled',
            searchHash,
            expiresAt,
          })
        }
        loadMoreGuardRef.current = false
        return
      }

      loadTimestampsRef.current.push(now)
      console.log('[DanbooruThrottle] loadMore ALLOWED — pushed timestamp', {
        now,
        timestampsBefore,
        timestampsAfter,
        totalInWindow: loadTimestampsRef.current.length,
      })
    }
    // Non-Danbooru providers: no rate limit, unrestricted infinite scroll

    setIsLoadingLock(true)
    setLoadMoreError(false)

    const currentRawPostCount = pages ? pages.flat().length : 0
    setLastLoadAttempt(currentRawPostCount)

    const nextSize = size + 1
    console.log('[DanbooruThrottle] loadMore calling setSize', {
      currentSize: size,
      nextSize,
      currentPostCount: allPosts.length,
      currentPageCount: pages?.length ?? 0,
    })
    setSize(nextSize)
    trackLoadMore({ order, nextPage: nextSize, currentCount: allPosts.length })
  }, [isLoadingLock, isLoadingMore, booruProvider, size, pages, order, debouncedSearchTags, ratingFilter, setSize, allPosts.length])

  // Track previous isLoadingMore so we only release on true→false transition.
  // Prevents premature release when SWR hasn't set isValidating yet after setSize.
  useEffect(() => {
    wasLoadingMoreRef.current = wasLoadingMoreRef.current || isLoadingMore
  }, [isLoadingMore])

  // Release lock effect — only fires when a load was actually in progress
  // (wasLoadingMore was true) and then completed (isLoadingMore becomes false).
  useEffect(() => {
    console.log('[DanbooruThrottle] Release effect CHECK', {
      isLoadingMore, isLoadingLock, wasLoadingMore: wasLoadingMoreRef.current
    })
    if (!isLoadingMore && isLoadingLock && wasLoadingMoreRef.current) {
      console.log('[DanbooruThrottle] Release effect FIRED — clearing lock and guard')
      setIsLoadingLock(false)
      loadMoreGuardRef.current = false
      wasLoadingMoreRef.current = false
    }
  }, [isLoadingMore, isLoadingLock])

  // Cleanup countdown on unmount
  useEffect(() => {
    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
      if (broadcastChannelRef.current) broadcastChannelRef.current.close()
    }
  }, [])

  // Cross-tab coordination via BroadcastChannel
  // Tabs with the same search share rate limit state so multi-tab
  // browsing doesn't double the request rate on Danbooru.
  useEffect(() => {
    if (typeof window === 'undefined' || booruProvider !== 'danbooru') return

    try {
      const channel = new BroadcastChannel('booru-rate-limit')
      broadcastChannelRef.current = channel

      channel.onmessage = (event) => {
        const { type, searchHash, expiresAt: remoteExpiresAt } = event.data || {}
        const currentHash = getSearchHash(debouncedSearchTags, ratingFilter, order)

        // Only react to messages from tabs with the same search
        if (searchHash && searchHash !== currentHash) return

        if (type === 'throttled' && remoteExpiresAt) {
          const remaining = Math.max(0, remoteExpiresAt - Date.now())
          if (remaining <= 0) {
            console.log('[DanbooruThrottle] Broadcast RX throttled — already expired, ignoring')
            return
          }

          console.log('[DanbooruThrottle] Broadcast RX throttled', {
            remainingSec: (remaining / 1000).toFixed(1) + 's',
            remoteExpiresAt,
          })

          throttleExpiresAtRef.current = remoteExpiresAt
          setIsScrollThrottled(true)
          setThrottleCountdown(Math.ceil(remaining / 1000))

          // Start local countdown so this tab also counts down
          if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
          countdownIntervalRef.current = setInterval(() => {
            const r = Math.max(0, throttleExpiresAtRef.current - Date.now())
            const cd = Math.ceil(r / 1000)
            setThrottleCountdown(prev => prev === cd ? prev : cd)

            if (r <= 0) {
              console.log('[DanbooruThrottle] Broadcast THROTTLE EXPIRED via interval')
              if (countdownIntervalRef.current) {
                clearInterval(countdownIntervalRef.current)
                countdownIntervalRef.current = null
              }
              setIsScrollThrottled(false)
              throttleExpiresAtRef.current = 0
            }
          }, 250)
        } else if (type === 'unthrottled') {
          console.log('[DanbooruThrottle] Broadcast RX unthrottled')
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current)
            countdownIntervalRef.current = null
          }
          setIsScrollThrottled(false)
          setThrottleCountdown(0)
          throttleExpiresAtRef.current = 0
        }
      }

      return () => {
        channel.close()
        broadcastChannelRef.current = null
      }
    } catch {
      // BroadcastChannel not available (e.g., some mobile browsers)
    }
  }, [booruProvider, debouncedSearchTags, ratingFilter, order])

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
  }, [setSize])

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    setSize(1)
    const query = searchTags.trim()
    const tagCount = query ? query.split(',').map(t => t.trim()).filter(Boolean).length : 0
    trackSearch({ query: query || '(empty)', rating: ratingFilter, order, tagCount })
  }, [searchTags, size, setSize, ratingFilter, order])

  const clearSearch = useCallback(() => {
    setSearchTags("")
    setSize(1)
  }, [setSize])

  // Handle No More Results / Errors
  useEffect(() => {
    if (lastLoadAttempt > 0 && !isLoadingMore) {
      const currentRawPostCount = pages ? pages.flat().length : 0

      if (error) {
        setLoadMoreError(true)
        setNoMoreResults(false)

        const message = error?.message || ''
        const isCircuitOpen = message.includes('saturated') || message.includes('circuit breaker')
        const isRateLimit = !isCircuitOpen && (message.includes('429') || message.includes('rate limit') || message.includes('Too many requests'))

        if (isCircuitOpen) {
          setCircuitOpen(true)
          // Auto-recover after 65s (circuit timeout is 60s + margin)
          setTimeout(() => setCircuitOpen(false), 65_000)
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
      } else if (currentRawPostCount === lastLoadAttempt || isReachingEnd) {
        setNoMoreResults(true)
        setLoadMoreError(false)
        setLastLoadAttempt(0)
      } else if (currentRawPostCount > lastLoadAttempt) {
        setNoMoreResults(false)
        setLoadMoreError(false)
        setLastLoadAttempt(0)
        setCircuitOpen(false)
      }
    }
  }, [pages, isLoadingMore, lastLoadAttempt, isReachingEnd, error, toast])

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
    isLoadingLock,
    isScrollThrottled,
    throttleCountdown,
    circuitOpen,

    loadMore,
    refresh,
    handleSearch,
    clearSearch,

    // Trackers
    trackProviderChange,
    trackRatingChange,
  }
}