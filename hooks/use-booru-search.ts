import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { useInfinitePosts, BooruProvider, BooruPost } from "@/lib/api-client"
import { userPreferences } from "@/lib/storage"
import { 
    trackSearch, 
    trackLoadMore, 
    trackRefresh, 
    trackProviderChange, 
    trackAibooruOption, 
    trackRatingChange, 
    trackDanbooruOption, 
    trackRule34Option, 
    trackE621Option 
} from '@/lib/analytics'
import { useToast } from "@/hooks/use-toast"

export function useBooruSearch() {
  const [searchTags, setSearchTags] = useState("")
  const [debouncedSearchTags, setDebouncedSearchTags] = useState("")
  const [ratingFilter, setRatingFilter] = useState("rating:general")
  const [isShuffle, setIsShuffle] = useState(false)
  const order = isShuffle ? "random" : "recent"
  
  const [booruProvider, setBooruProvider] = useState<BooruProvider>('danbooru')
  const [hasPromptFilter, setHasPromptFilter] = useState(false)
  const [removeLoRaTags, setRemoveLoRaTags] = useState(false)
  const [removeQualityTags, setRemoveQualityTags] = useState(false)
  const [tagCountFilter, setTagCountFilter] = useState("5") // Default to >5 tags
  const [appliedTagCountFilter, setAppliedTagCountFilter] = useState("5")
  const [isClient, setIsClient] = useState(false)
  
  // Loading states
  const [isLoadingLock, setIsLoadingLock] = useState(false) 
  const [loadMoreError, setLoadMoreError] = useState(false)
  const [noMoreResults, setNoMoreResults] = useState(false)
  const [lastLoadAttempt, setLastLoadAttempt] = useState(0)
  const [randomSeed, setRandomSeed] = useState<number>(0)

  const { toast } = useToast()

  // --- Initialization & Persistance ---

  useEffect(() => {
    setIsClient(true)
    setRandomSeed(Date.now())
    setBooruProvider(userPreferences.getBooruProvider())
    setRemoveLoRaTags(userPreferences.getRemoveLoRaTags())
    setRemoveQualityTags(userPreferences.getRemoveQualityTags())
    setRatingFilter(userPreferences.getRatingFilter())
    setTagCountFilter(userPreferences.getMinimumTagCount())
    setAppliedTagCountFilter(userPreferences.getMinimumTagCount())
  }, [])

  useEffect(() => { if (isClient) userPreferences.setBooruProvider(booruProvider) }, [booruProvider, isClient])
  useEffect(() => { if (isClient) userPreferences.setRemoveLoRaTags(removeLoRaTags) }, [removeLoRaTags, isClient])
  useEffect(() => { if (isClient) userPreferences.setRemoveQualityTags(removeQualityTags) }, [removeQualityTags, isClient])
  useEffect(() => { if (isClient) userPreferences.setRatingFilter(ratingFilter) }, [ratingFilter, isClient])
  useEffect(() => { if (isClient) userPreferences.setMinimumTagCount(tagCountFilter) }, [tagCountFilter, isClient])

  // Auto-activate prompt filter when Aibooru is selected
  useEffect(() => {
    setHasPromptFilter(booruProvider === 'aibooru')
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
        
        if (order === 'random' || /order:random|random:\d+/i.test(searchTags)) {
          setRandomSeed(Date.now())
        }
        
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
            setSize(1)
            if (next) setRandomSeed(Date.now())
            return next
        })
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
        
        loadMore,
        refresh,
        handleSearch,
        clearSearch,
        
        // Trackers
        trackProviderChange,
        trackRatingChange,
    }
}
