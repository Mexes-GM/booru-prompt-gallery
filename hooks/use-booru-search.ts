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

export function useBooruSearch() {
  const [searchTags, setSearchTags] = usePersistentState(
    "",
    userPreferences.getSearchTags,
    userPreferences.setSearchTags,
    "searchTags",
    STORAGE_KEYS.SEARCH_TAGS
  )
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

  const userInteractionRef = useRef(false)

  const setTagCountFilter = useCallback((value: string | ((prev: string) => string)) => {
    userInteractionRef.current = true
    _setTagCountFilter(value)
  }, [_setTagCountFilter])

  const [appliedTagCountFilter, setAppliedTagCountFilter] = useState("5")
  const [isClient, setIsClient] = useState(false)

  // Sync applied filter with persistent state on load (when no user interaction has occurred)
  useEffect(() => {
    if (!userInteractionRef.current) {
      setAppliedTagCountFilter(tagCountFilter)
    }
  }, [tagCountFilter])

  // Loading states
  const [isLoadingLock, setIsLoadingLock] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState(false)
  const [noMoreResults, setNoMoreResults] = useState(false)
  const [lastLoadAttempt, setLastLoadAttempt] = useState(0)
  const [randomSeed, setRandomSeed] = useState<number>(0)

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

  // Reset pagination
  useEffect(() => {
    setSize(1)
    setNoMoreResults(false)
    setLoadMoreError(false)
    setLastLoadAttempt(0)
  }, [order, ratingFilter, debouncedSearchTags, appliedTagCountFilter, setSize])

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

  // --- Actions ---

  const loadMore = useCallback(() => {
    if (isLoadingLock || isLoadingMore) return

    setIsLoadingLock(true)
    setLoadMoreError(false)

    const currentRawPostCount = pages ? pages.flat().length : 0
    setLastLoadAttempt(currentRawPostCount)

    setSize(size + 1)
    trackLoadMore({ order, nextPage: size + 1, currentCount: allPosts.length })
  }, [isLoadingLock, isLoadingMore, pages, order, searchTags, size, setSize, allPosts.length])

  // Release look effect
  useEffect(() => {
    if (!isLoadingMore && isLoadingLock) {
      setIsLoadingLock(false)
    }
  }, [isLoadingMore, isLoadingLock])

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
        toast({
          title: "Error loading more posts",
          description: "There was an error loading more posts. Click 'Retry' to try again.",
          variant: "destructive",
        })
        setLastLoadAttempt(0)
      } else if (currentRawPostCount === lastLoadAttempt || isReachingEnd) {
        setNoMoreResults(true)
        setLoadMoreError(false)
        toast({
          title: "No more results",
          description: "No more recent posts found for this search. Try different search terms or change the rating filter.",
          variant: "default",
        })
        setLastLoadAttempt(0)
      } else if (currentRawPostCount > lastLoadAttempt) {
        setNoMoreResults(false)
        setLoadMoreError(false)
        setLastLoadAttempt(0)
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

    loadMore,
    refresh,
    handleSearch,
    clearSearch,

    // Trackers
    trackProviderChange,
    trackRatingChange,
  }
}