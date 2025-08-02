import useSWRInfinite from 'swr/infinite'
import useSWR from 'swr'

export interface DanbooruPost {
  id: number
  file_url: string
  large_file_url: string
  preview_file_url: string
  tag_string: string
  tag_string_artist: string
  tag_string_character: string
  tag_string_copyright: string
  rating: string
  score: number
}

// Production fetcher with error handling and retry logic
const fetcher = async (url: string) => {
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'BooruPromptGallery/1.0',
    }
  })
  
  if (!res.ok) {
    const error = new Error('Failed to fetch data') as Error & { info?: any; status?: number }
    try {
      error.info = await res.json()
    } catch {
      error.info = { message: res.statusText }
    }
    error.status = res.status
    throw error
  }
  
  return res.json()
}

// Fetcher for favorites API (POST request)
const favoritesFetcher = async (url: string, ids: number[]) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'BooruPromptGallery/1.0',
    },
    body: JSON.stringify({ ids })
  })
  
  if (!res.ok) {
    const error = new Error('Failed to fetch favorites') as Error & { info?: any; status?: number }
    try {
      error.info = await res.json()
    } catch {
      error.info = { message: res.statusText }
    }
    error.status = res.status
    throw error
  }
  
  return res.json()
}

// Function to process user input tags for Danbooru API
// Danbooru API allows 2 tags total. When using order:rank or order:random, we limit to 1 user tag. When not using order, we allow 2 user tags.
const processTagsForAPI = (tags: string, order: string = 'popular'): string => {
  if (!tags.trim()) return ''
  
  // Split by commas and process each tag
  const processedTags = tags
    .split(',')
    .map(tag => tag.trim())
    .filter(tag => tag.length > 0)
    .map(tag => tag.replace(/\s+/g, '_')) // Replace spaces with underscores
  
  // For recent posts (no order tag), allow 2 user tags. For popular/random posts (with order tag), limit to 1 user tag
  const maxTags = order === 'recent' ? 2 : 1
  return processedTags.slice(0, maxTags).join(' ')
}

// Function to check if user entered multiple tags and if it's allowed
export const hasMultipleTags = (tags: string, order: string = 'popular'): boolean => {
  if (!tags.trim()) return false
  
  const tagCount = tags
    .split(',')
    .map(tag => tag.trim())
    .filter(tag => tag.length > 0).length
  
  const maxTags = order === 'recent' ? 2 : 1
  return tagCount > maxTags
}

// Function to get the final query tags that will be sent to Danbooru API
export const getFinalQueryTags = (userTags: string, ratingFilter: string, order: string): string[] => {
  const tags: string[] = []
  
  // Add rating filter if not 'all'
  if (ratingFilter && ratingFilter !== 'all') {
    tags.push(ratingFilter)
  }
  
  // Add order tag if popular or random
  if (order === 'popular') {
    tags.push('order:rank')
  } else if (order === 'random') {
    // For random, we use random:N instead of order:random for better performance
    tags.push('random:15') // Using the same limit as in API_CONFIG.randomParams
  }
  
  // Add processed user tags
  const processedUserTags = processTagsForAPI(userTags, order)
  if (processedUserTags) {
    tags.push(...processedUserTags.split(' '))
  }
  
  return tags
}

export const useInfinitePosts = (tags: string, ratingFilter: string = 'rating:general', order: string = 'popular') => {
  const ratingPart = ratingFilter && ratingFilter !== 'all' ? `${ratingFilter} ` : ''
  const processedTags = processTagsForAPI(tags, order)
  const query = processedTags ? `${ratingPart}${processedTags}` : ratingPart.trim()
  const encodedQuery = encodeURIComponent(query)
  
  return useSWRInfinite<DanbooruPost[]>(
    (pageIndex: number) => `/api/posts?page=${pageIndex + 1}&tags=${encodedQuery}&order=${order}`,
    fetcher,
    {
      revalidateFirstPage: true,
      revalidateAll: false,
      persistSize: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 300000, // 5 minutes for production
      shouldRetryOnError: true,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
    }
  )
}

// Hook to fetch favorite posts by their IDs
export function useFavoritePosts(favoriteIds: number[]) {
  const shouldFetch = favoriteIds.length > 0
  const cacheKey = shouldFetch ? `favorites-${favoriteIds.sort().join(',')}` : null

  const { data, error, isLoading, mutate } = useSWR(
    cacheKey,
    async () => {
      if (!shouldFetch) return []
      
      const response = await fetch('/api/favorites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids: favoriteIds }),
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const posts = await response.json()
      return posts
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 60000,
    }
  )

  return {
    data: data?.length || 0,
    posts: data || [],
    error,
    isLoading,
    mutate,
  }
}
