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

// Get posts with production caching
export const usePosts = (page: number, tags: string = '', ratingFilter: string = 'rating:safe', order: string = 'popular') => {
  const ratingPart = ratingFilter ? `${ratingFilter} ` : ''
  const query = tags ? `${ratingPart}${tags}` : ratingPart.trim()
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
export const useInfinitePosts = (tags: string = '', ratingFilter: string = 'rating:safe', order: string = 'popular') => {
  const ratingPart = ratingFilter ? `${ratingFilter} ` : ''
  const query = tags ? `${ratingPart}${tags}` : ratingPart.trim()
  const encodedQuery = encodeURIComponent(query)
  
  return useSWRInfinite<DanbooruPost[]>(
    (pageIndex: number) => `/api/posts?page=${pageIndex + 1}&tags=${encodedQuery}&order=${order}`,
    fetcher,
    {
      revalidateFirstPage: true,
      revalidateAll: true,
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
export const prefetchPosts = async (page: number, tags: string = '', ratingFilter: string = 'rating:safe', order: string = 'popular') => {
  const ratingPart = ratingFilter ? `${ratingFilter} ` : ''
  const query = tags ? `${ratingPart}${tags}` : ratingPart.trim()
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
export const prefetchBatch = async (pages: number[], tags: string = '', ratingFilter: string = 'rating:safe', order: string = 'popular') => {
  if (pages.length > 5) {
    pages = pages.slice(0, 5) // Limit prefetch to 5 pages in production
  }
  
  const promises = pages.map(page => 
    prefetchPosts(page, tags, ratingFilter, order)
  )
  
  await Promise.allSettled(promises)
}