import useSWR from 'swr'
import useSWRInfinite from 'swr/infinite'

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

export interface TagData {
  name: string
  category: number
  aliases?: string[]
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

// Function to process user input tags for Danbooru API
// Danbooru API allows 2 tags total. When using order:rank, we limit to 1 user tag. When not using order, we allow 2 user tags.
const processTagsForAPI = (tags: string, order: string = 'popular'): string => {
  if (!tags.trim()) return ''
  
  // Split by commas and process each tag
  const processedTags = tags
    .split(',')
    .map(tag => tag.trim())
    .filter(tag => tag.length > 0)
    .map(tag => tag.replace(/\s+/g, '_')) // Replace spaces with underscores
  
  // For recent posts (no order tag), allow 2 user tags. For popular posts (with order:rank), limit to 1 user tag
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
  
  // Add order tag if popular
  if (order === 'popular') {
    tags.push('order:rank')
  }
  
  // Add processed user tags
  const processedUserTags = processTagsForAPI(userTags, order)
  if (processedUserTags) {
    tags.push(...processedUserTags.split(' '))
  }
  
  return tags
}

// Get posts with production caching
export const usePosts = (page: number, tags: string = '', ratingFilter: string = 'rating:general', order: string = 'popular') => {
  const ratingPart = ratingFilter && ratingFilter !== 'all' ? `${ratingFilter} ` : ''
  const processedTags = processTagsForAPI(tags, order)
  const query = processedTags ? `${ratingPart}${processedTags}` : ratingPart.trim()
  const encodedQuery = encodeURIComponent(query)
  
  return useSWR<DanbooruPost[]>(
    `/api/posts?page=${page}&tags=${encodedQuery}&order=${order}`,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 300000, // 5 minutes for production
      focusThrottleInterval: 60000, // 1 minute
      shouldRetryOnError: true,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
    }
  )
}

// Infinite scroll for posts - production optimized
export const useInfinitePosts = (tags: string = '', ratingFilter: string = 'rating:general', order: string = 'popular') => {
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

// Get tags with production caching
export const useTags = (category?: number) => {
  const url = category !== undefined ? `/api/tags?category=${category}` : '/api/tags'
  
  return useSWR<TagData[]>(
    url,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 600000, // 10 minutes for production
      shouldRetryOnError: true,
      errorRetryCount: 2,
      errorRetryInterval: 2000,
    }
  )
}

// Prefetch posts for next page - production optimized
export const prefetchPosts = async (page: number, tags: string = '', ratingFilter: string = 'rating:general', order: string = 'popular') => {
  const ratingPart = ratingFilter && ratingFilter !== 'all' ? `${ratingFilter} ` : ''
  const processedTags = processTagsForAPI(tags, order)
  const query = processedTags ? `${ratingPart}${processedTags}` : ratingPart.trim()
  const encodedQuery = encodeURIComponent(query)
  const url = `/api/posts?page=${page}&tags=${encodedQuery}&order=${order}`
  
  try {
    await fetch(url, { 
      method: 'HEAD',
      headers: {
        'User-Agent': 'BooruPromptGallery/1.0',
      }
    })
  } catch (error) {
    // Silently fail prefetch in production
    if (process.env.NODE_ENV === 'development') {
      console.warn('Prefetch failed:', error)
    }
  }
}

// Batch prefetch - production optimized
export const prefetchBatch = async (pages: number[], tags: string = '', ratingFilter: string = 'rating:general', order: string = 'popular') => {
  if (pages.length > 5) {
    pages = pages.slice(0, 5) // Limit prefetch to 5 pages in production
  }
  
  const promises = pages.map(page => 
    prefetchPosts(page, tags, ratingFilter, order)
  )
  
  await Promise.allSettled(promises)
}
