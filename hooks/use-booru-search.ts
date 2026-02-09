import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
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
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

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
  
  // Store the rating before we forced it to 'all' for Rule34
  const forcedRule34RatingRef = useRef<string | null>(null)

  const { toast } = useToast()

  const sanitizeTagCount = (val: string) => val.replace(/\D/g, '') || '5'

  // --- Initialization & Persistance ---

  useEffect(() => {
    setIsClient(true)
    setRandomSeed(Date.now())
    
    // 1. URL State (Priority)
    const urlQ = searchParams.get('q')
    const urlProvider = searchParams.get('provider')
    const urlRating = searchParams.get('rating')
    const urlCount = searchParams.get('count')
    const urlLora = searchParams.get('lora')
    const urlQuality = searchParams.get('quality')

    // 2. Initialize from URL or Fallback to LocalStorage
    if (urlQ !== null) setSearchTags(urlQ)
    
    if (urlProvider && ['danbooru', 'aibooru', 'rule34', 'e621'].includes(urlProvider)) {
        setBooruProvider(urlProvider as BooruProvider)
    } else {
        setBooruProvider(userPreferences.getBooruProvider())
    }

    if (urlRating) setRatingFilter(urlRating)
    else setRatingFilter(userPreferences.getRatingFilter())

    if (urlCount) {
        const cleanCount = sanitizeTagCount(urlCount)
        setTagCountFilter(cleanCount)
        setAppliedTagCountFilter(cleanCount)
    } else {
        const storedCount = sanitizeTagCount(userPreferences.getMinimumTagCount())
        setTagCountFilter(storedCount)
        setAppliedTagCountFilter(storedCount)
    }

    if (urlLora !== null) setRemoveLoRaTags(urlLora === 'true')
    else setRemoveLoRaTags(userPreferences.getRemoveLoRaTags())

    if (urlQuality !== null) setRemoveQualityTags(urlQuality === 'true')
    else setRemoveQualityTags(userPreferences.getRemoveQualityTags())

  }, []) // Run once on mount to hydrate state

  // React to URL changes (External Navigation / Trends)
  useEffect(() => {
      const urlQ = searchParams.get('q')
      if (urlQ !== null && urlQ !== searchTags) {
          setSearchTags(urlQ)
      }
      
      const urlRating = searchParams.get('rating')
      if (urlRating !== null && urlRating !== ratingFilter) {
          setRatingFilter(urlRating)
      }

      const urlProvider = searchParams.get('provider')
      if (urlProvider !== null && urlProvider !== booruProvider && ['danbooru', 'aibooru', 'rule34', 'e621'].includes(urlProvider)) {
          setBooruProvider(urlProvider as BooruProvider)
      }
  }, [searchParams])

  // Sync State -> URL
  useEffect(() => {
    if (!isClient) return

    const params = new URLSearchParams(searchParams.toString())
    
    // Helper to only set if different to avoid noise
    const setParam = (key: string, value: string | null) => {
        if (value) params.set(key, value)
        else params.delete(key)
    }

    setParam('q', searchTags || null)
    setParam('provider', booruProvider)
    setParam('rating', ratingFilter)
    setParam('count', sanitizeTagCount(tagCountFilter))
    // Only set boolean flags if true to keep URL clean
    setParam('lora', removeLoRaTags ? 'true' : null) 
    setParam('quality', removeQualityTags ? 'true' : null)

    const newSearch = params.toString()
    const currentSearch = searchParams.toString()

    if (newSearch !== currentSearch) {
        router.replace(`${pathname}?${newSearch}`, { scroll: false })
    }
  }, [
    isClient, 
    searchTags, 
    booruProvider, 
    ratingFilter, 
    tagCountFilter, 
    removeLoRaTags, 
    removeQualityTags,
    pathname,
    router,
    searchParams
  ])

  useEffect(() => { if (isClient) userPreferences.setBooruProvider(booruProvider) }, [booruProvider, isClient])
  useEffect(() => { if (isClient) userPreferences.setRemoveLoRaTags(removeLoRaTags) }, [removeLoRaTags, isClient])
  useEffect(() => { if (isClient) userPreferences.setRemoveQualityTags(removeQualityTags) }, [removeQualityTags, isClient])
  useEffect(() => { if (isClient) userPreferences.setRatingFilter(ratingFilter) }, [ratingFilter, isClient])
  useEffect(() => { if (isClient) userPreferences.setMinimumTagCount(tagCountFilter) }, [tagCountFilter, isClient])

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