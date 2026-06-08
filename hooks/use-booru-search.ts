import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { useInfinitePosts, BooruProvider, BooruPost, apiUrl } from "@/lib/api-client"
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
   setCircuitOpen(false)
   loadMoreGuardRef.current = false
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

    loadMoreGuardRef.current = true
    setLoadMoreError(false)

    // Track deduped count so the no-more-results check can detect
    // when a new page brings only duplicate posts (CDN cache hit).
    setLastLoadAttempt(allPosts.length)

    const nextSize = size + 1
    setSize(nextSize)
    trackLoadMore({ order, nextPage: nextSize, currentCount: allPosts.length })
  }, [size, order, setSize, allPosts.length])

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
  }, [setSize])

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault()
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
    const tagCount = query ? query.split(',').map(t => t.trim()).filter(Boolean).length : 0
    trackSearch({ query: query || '(empty)', rating: ratingFilter, order, tagCount })
  }, [order, ratingFilter, searchTags, debouncedSearchTags, appliedTagCountFilter, appliedCharacterCountFilter, setSize])

  const clearSearch = useCallback(() => {
    setSearchTags("")
    setSize(1)
  }, [setSize])

  // Handle No More Results / Errors
  useEffect(() => {
    let timeoutId: NodeJS.Timeout | undefined;

    if (lastLoadAttempt > 0 && !isLoadingMore) {
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
  }, [allPosts.length, isLoadingMore, lastLoadAttempt, isReachingEnd, error, toast])

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