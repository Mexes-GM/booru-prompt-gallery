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

// Custom fetcher with error handling
const fetcher = async (url: string) => {
  const res = await fetch(url)
  
  if (!res.ok) {
    const error = new Error('An error occurred while fetching the data.') as Error & { info?: any; status?: number }
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

// Get posts with caching
export const usePosts = (page: number, tags: string = '', ratingFilter: string = 'rating:safe', order: string = 'popular') => {
  const query = tags ? `${ratingFilter} ${tags}` : `${ratingFilter}`
  const encodedQuery = encodeURIComponent(query)
  
  return useSWR<DanbooruPost[]>(
    `/api/posts?page=${page}&tags=${encodedQuery}&order=${order}`,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 60000, // 1 minute
      focusThrottleInterval: 30000, // 30 seconds
    }
  )
}

// Infinite scroll for posts
export const useInfinitePosts = (tags: string = '', ratingFilter: string = 'rating:safe', order: string = 'popular') => {
  const query = tags ? `${ratingFilter} ${tags}` : `${ratingFilter}`
  const encodedQuery = encodeURIComponent(query)
  
  return useSWRInfinite<DanbooruPost[]>(
    (pageIndex: number) => `/api/posts?page=${pageIndex + 1}&tags=${encodedQuery}&order=${order}`,
    fetcher,
    {
      revalidateFirstPage: false,
      revalidateAll: false,
      persistSize: false,
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    }
  )
}

// Get tags with caching
export const useTags = (category?: number) => {
  const url = category !== undefined ? `/api/tags?category=${category}` : '/api/tags'
  
  return useSWR<TagData[]>(
    url,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 300000, // 5 minutes
    }
  )
}

// Prefetch posts for next page
export const prefetchPosts = async (page: number, tags: string = '', ratingFilter: string = 'rating:safe', order: string = 'popular') => {
  const query = tags ? `${ratingFilter} ${tags}` : `${ratingFilter}`
  const encodedQuery = encodeURIComponent(query)
  const url = `/api/posts?page=${page}&tags=${encodedQuery}&order=${order}`
  
  try {
    await fetch(url, { method: 'HEAD' })
  } catch (error) {
    console.warn('Prefetch failed:', error)
  }
}

// Batch prefetch
export const prefetchBatch = async (pages: number[], tags: string = '', ratingFilter: string = 'rating:safe', order: string = 'popular') => {
  const promises = pages.map(page => 
    prefetchPosts(page, tags, ratingFilter, order)
  )
  
  await Promise.allSettled(promises)
}