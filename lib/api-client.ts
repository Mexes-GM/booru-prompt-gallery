
import useSWRInfinite from 'swr/infinite'
import useSWR from 'swr'
import { useApiStatus } from '@/hooks/use-api-status'
import { BooruPost, isAibooruPost as checkIsAibooruPost } from './booru/types'
import { prefetchTagCounts } from '@/hooks/use-tag-counts'
import { PROVIDER_URLS, USER_AGENT } from '@/lib/constants'

// Re-export types
export type { BooruPost }

// Export function
export const isAibooruPost = checkIsAibooruPost

export type BooruProvider = 'danbooru' | 'aibooru' | 'rule34' | 'e621' | 'gelbooru'

// Helper function to get prompt from a post
// Function to clean and extract prompt from malformed JSON data
export const cleanPromptData = (promptData: string): string => {
  try {
    // Try to parse as JSON first
    const parsed = JSON.parse(promptData)

    // If it's an object with prompt field, extract it
    if (typeof parsed === 'object' && parsed.prompt) {
      return parsed.prompt
    }

    // If it has v4_prompt structure, extract from there
    if (parsed.v4_prompt?.caption?.base_caption) {
      return parsed.v4_prompt.caption.base_caption
    }

    // If it's already a string, return as is
    if (typeof parsed === 'string') {
      return parsed
    }

    return promptData
  } catch {
    // If not JSON, return as is
    return promptData
  }
}

// Function to remove duplicate tags from prompt
export const removeDuplicateTags = (prompt: string): string => {
  const tags = prompt.split(',').map(tag => tag.trim())
  const uniqueTags = [...new Set(tags)]
  return uniqueTags.join(', ')
}

// Function to remove LoRa tags from prompt
export const removeLoRaTags = (prompt: string): string => {
  return prompt
    .replace(/<lora:[^>]+>/g, '') // Remove LoRa tags like <lora:name:weight>
    .replace(/<segment:[^>]+>/g, '') // Remove segment tags like <segment:yolo-face.pt, 0.6, 0.6//cid=11>
    .replace(/,\s*,/g, ',').trim()
}

// Function to remove quality tags from prompt
export const removeQualityTags = (prompt: string): string => {
  const qualityTags = [
    'masterpiece',
    'best quality',
    'high quality',
    'highest quality',
    'amazing quality',
    'very aesthetic',
    'detailed',
    'beautiful color',
    'absurdres',
    'sensitive',
    'high_quality',
    'highres',
    'high_detail',
    'beautiful',
    '8k',
    'HDR',
    'ultra-detailed',
    'ultra detailed',
    'extremely detailed',
    'highly detailed',
    'very detailed',
    'good quality',
    'newest',
    'very awa',
    'quality details',
    '32k',
    'high resolution',
    'score_9',
    'score_8_up',
    'score_7_up',
    'score_6_up',
    'score_5_up',
    'score_4_up'
  ]

  // First, remove quality tags with parentheses and weights like (masterpiece:1) or (highest quality:1.)
  let result = prompt

  // Remove quality tags with parentheses and numeric weights
  qualityTags.forEach(tag => {
    // Pattern for (tag:number) or (tag:number.)
    const weightedRegex = new RegExp(`\\(\\s*${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*[0-9]*\\.?[0-9]*\\s*\\)`, 'gi')
    result = result.replace(weightedRegex, '')

    // Pattern for just (tag)
    const simpleParenRegex = new RegExp(`\\(\\s*${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\)`, 'gi')
    result = result.replace(simpleParenRegex, '')
  })

  // Split prompt into individual tags
  let tags = result.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0)

  // Remove quality tags from each individual tag
  tags = tags.filter(tag => {
    const lowerTag = tag.toLowerCase()

    // Check if the entire tag is a quality tag
    if (qualityTags.some(qualityTag => lowerTag === qualityTag.toLowerCase())) {
      return false
    }

    // Check for compound tags that contain quality words
    // Remove tags that are primarily quality-focused
    const qualityWords = ['detailed', 'ultra', 'extremely', 'highly', 'very', 'best', 'high', 'highest', 'amazing', 'quality', 'masterpiece']
    const tagWords = lowerTag.split(' ')

    // If tag contains "detailed" and other quality words, remove it entirely
    if (tagWords.includes('detailed')) {
      const hasOtherQualityWords = tagWords.some(word =>
        qualityWords.includes(word) && word !== 'detailed'
      )
      if (hasOtherQualityWords) {
        return false
      }

      // Special case: if it's just "detailed [body_part]" or similar descriptive tags, keep it
      // But remove pure quality combinations like "detailed eyes" when it appears with "ultra detailed"
      const bodyParts = ['eyes', 'face', 'hair', 'hands', 'body', 'skin', 'lips', 'nose']
      if (tagWords.length === 2 && tagWords[0] === 'detailed' && bodyParts.includes(tagWords[1])) {
        // Check if there are other detailed tags in the prompt that would make this redundant
        const hasUltraDetailed = tags.some(otherTag =>
          otherTag.toLowerCase().includes('ultra detailed') ||
          otherTag.toLowerCase().includes('extremely detailed') ||
          otherTag.toLowerCase().includes('highly detailed')
        )
        if (hasUltraDetailed) {
          return false
        }
      }
    }

    return true
  })

  // Join the filtered tags
  result = tags.join(', ')

  // Additional cleanup for any remaining quality fragments
  qualityTags.forEach(tag => {
    const regex = new RegExp(`\\b${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
    result = result.replace(regex, '')
  })

  // Comprehensive cleanup of commas and spaces
  result = result
    .replace(/,\s*,+/g, ',')           // Multiple consecutive commas
    .replace(/,\s*,/g, ',')            // Double commas with spaces
    .replace(/\s*,\s*,\s*/g, ', ')     // Multiple commas with various spacing
    .replace(/^\s*,+\s*|\s*,+\s*$/g, '') // Leading/trailing commas
    .replace(/\s+/g, ' ')              // Multiple spaces
    .replace(/,\s*$/g, '')             // Trailing comma
    .replace(/^\s*,\s*/g, '')          // Leading comma with any spaces
    .replace(/>\s*,\s*/g, '> ')        // Fix case where LoRa tags are followed by comma and space
    .trim()

  return result
}

export const getPromptFromPost = (post: BooruPost): string | null => {
  if (isAibooruPost(post) && post.ai_metadata?.prompt) {
    let prompt = post.ai_metadata.prompt

    // Clean malformed prompt data
    prompt = cleanPromptData(prompt)

    // Remove duplicate tags
    prompt = removeDuplicateTags(prompt)

    return prompt
  }
  return null
}

// Helper to transform raw Aibooru posts to BooruPost
const transformAibooruPost = (post: unknown): BooruPost => {
  // Ensure we have minimal required fields
  if (!post || typeof post !== 'object') {
    throw new Error('Invalid post data from Aibooru')
  }

  const typedPost = post as Record<string, unknown>
  return {
    id: (typedPost.id as number) || 0,
    file_url: (typedPost.file_url as string) || '',
    large_file_url: (typedPost.large_file_url as string) || (typedPost.file_url as string) || '',
    preview_file_url: (typedPost.preview_file_url as string) || (typedPost.file_url as string) || '',
    tag_string: (typedPost.tag_string as string) || '',
    tag_string_artist: (typedPost.tag_string_artist as string) || '',
    tag_string_character: (typedPost.tag_string_character as string) || '',
    tag_string_copyright: (typedPost.tag_string_copyright as string) || '',
    rating: (typedPost.rating as string) || 'q',
    score: (typedPost.score as number) || 0,
    ai_metadata: typedPost.ai_metadata as any,
    width: (typedPost.image_width as number) || 0,
    height: (typedPost.image_height as number) || 0,
    _provider: 'aibooru', // Explicitly mark as Aibooru
  }
}

// Client-side request deduplication: prevents SWR from firing multiple
// identical requests in rapid succession (React Strict Mode double-render,
// filter changes, etc.). Holds results for 5s after resolution so rapid
// re-renders reuse the settled promise instead of creating new ones.
const inflightRequests = new Map<string, Promise<unknown>>()

// Page-1 Danbooru request sequencer. During SWR initialization React can
// trigger 3+ different page-1 URLs in <100ms as state settles (default
// filter → saved preference → random seed). With 10 concurrent users
// that's 30+ requests hitting Danbooru in the first second.
// This chain serializes unique page-1 requests at 1s intervals so they
// never burst through Danbooru's 10 req/s limit.
let page1Chain: Promise<void> = Promise.resolve()
let isFirstPage1 = true
const PAGE1_SPACING_MS = 1000

// Production fetcher with error handling, retry logic, and page-1 sequencing.
const fetcher = async (url: string) => {
  // Deduplicate identical concurrent requests
  const inflight = inflightRequests.get(url)
  if (inflight) {
    return inflight
  }

  const isDanbooruApi = url.includes('/api/posts') || url.includes('danbooru.donmai.us')
  const isDanbooruPage1 = isDanbooruApi && url.includes('page=1')

  const doFetch = async () => {
    try {
      const isDirectAibooru = url.startsWith(PROVIDER_URLS.AIBOORU)

      const headers: HeadersInit = isDirectAibooru
        ? {}
        : {
          'Accept': 'application/json',
          'User-Agent': USER_AGENT,
        }

      const res = await fetch(url, { headers })

      if (!res.ok) {
        const error = new Error('Failed to fetch data') as Error & { info?: unknown; status?: number }
        try { error.info = await res.json() } catch { error.info = { message: res.statusText } }
        error.status = res.status
        throw error
      }

      const data = await res.json()

      let resultPosts = data
      let identifiedProvider: 'danbooru' | 'aibooru' | null = null

      if (isDirectAibooru) {
        identifiedProvider = 'aibooru'
        if (Array.isArray(data)) {
          resultPosts = data
            .filter(post =>
              post && post.id &&
              (post.file_url || post.large_file_url) &&
              !post.file_url?.includes("deleted") &&
              (post.tag_string || post.tags) &&
              !post.file_url?.match(/\.(mp4|webm|avi|mov|mkv)$/i)
            )
            .map(transformAibooruPost)
        } else {
          resultPosts = []
        }
      } else if (
        url.includes('/api/posts') ||
        url.includes('/api/favorites') ||
        (url.includes('api/booru/search') && url.includes('provider=danbooru')) ||
        url.includes('danbooru.donmai.us')
      ) {
        identifiedProvider = 'danbooru'
      }

      if (identifiedProvider && Array.isArray(resultPosts)) {
        queueMicrotask(() => {
          try { prefetchTagCounts(resultPosts as BooruPost[], identifiedProvider) }
          catch (error) { console.error('[ApiClient] Background tag prefetch error:', error) }
        })
      }

      return resultPosts
    } catch (fetchError: unknown) {
      if (fetchError instanceof Response && fetchError.status !== 404) {
        console.error('[ApiClient] Fetch Error:', fetchError)
      } else if (!(fetchError instanceof Response)) {
        console.error('[ApiClient] Fetch Error:', fetchError)
      }
      throw fetchError
    }
  }

  // Serialize unique page-1 Danbooru requests. The first fires immediately;
  // each subsequent one waits 1s after the previous one settles. This
  // prevents SWR initialization bursts without delaying the first paint.
  let promise: Promise<unknown>
  if (isDanbooruPage1) {
    if (isFirstPage1) {
      isFirstPage1 = false
      const chained = Promise.resolve().then(doFetch)
      page1Chain = chained.catch(() => {})
      promise = chained
    } else {
      const prevChain = page1Chain
      const chained = prevChain.then(() => new Promise(r => setTimeout(r, PAGE1_SPACING_MS))).then(doFetch)
      page1Chain = chained.catch(() => {})
      promise = chained
    }
  } else {
    promise = doFetch()
  }

  inflightRequests.set(url, promise)
  promise.finally(() => {
    setTimeout(() => inflightRequests.delete(url), 5000)
  })

  return promise
}



// Function to process user input tags for Danbooru API
// Danbooru API allows 2 tags total. When using order:rank or order:random, we limit to 1 user tag. When not using order, we allow 2 user tags.
const processTagsForAPI = (tags: string, order: string = 'popular', extraTagsCount: number = 0): string => {
  if (!tags.trim()) return ''

  // Split by commas and process each tag
  const rawTags = tags
    .split(',')
    .map(tag => tag.trim())
    .filter(tag => tag.length > 0)

  const metaTagPatterns = [
    /^tagcount:/i,
    /^rating:/i,
    /^order:/i,
    /^sort:/i,
    /^limit:/i,
    /^status:/i,
    /^user:/i,
    /^approver:/i,
    /^id:/i,
    /^width:/i,
    /^height:/i,
    /^mpixels:/i,
    /^score:/i,
    /^favcount:/i,
    /^date:/i,
    /^source:/i,
    /^pool:/i,
    /^parent:/i,
    /^md5:/i,
    /^filetype:/i,
    /^random:/i,
  ]

  const normalTags: string[] = []
  const metaTags: string[] = []

  rawTags.forEach(tag => {
    // Check if it matches any meta tag pattern
    if (metaTagPatterns.some(pattern => pattern.test(tag))) {
      metaTags.push(tag.replace(/\s+/g, '_'))
    } else {
      normalTags.push(tag.replace(/\s+/g, '_'))
    }
  })

  // Check if any meta tag is an order tag
  const hasOrderTag = metaTags.some(tag => /^order:/i.test(tag) || /^random:/i.test(tag))

  // For recent posts (no order tag), allow 2 user tags. For popular/random posts (with order tag), limit to 1 user tag
  // We also subtract any extra tags (like tagcount) from the limit
  const baseMaxTags = (order === 'recent' && !hasOrderTag) ? 2 : 1
  const maxTags = Math.max(0, baseMaxTags - extraTagsCount)

  const allowedNormalTags = normalTags.slice(0, maxTags)

  return [...allowedNormalTags, ...metaTags].join(' ')
}

// Function to check if user entered multiple tags and if it's allowed
export const hasMultipleTags = (tags: string, order: string = 'popular', extraTagsCount: number = 0): boolean => {
  if (!tags.trim()) return false

  const rawTags = tags
    .split(',')
    .map(tag => tag.trim())
    .filter(tag => tag.length > 0)

  const metaTagPatterns = [
    /^tagcount:/i,
    /^rating:/i,
    /^order:/i,
    /^sort:/i,
    /^limit:/i,
    /^status:/i,
    /^user:/i,
    /^approver:/i,
    /^id:/i,
    /^width:/i,
    /^height:/i,
    /^mpixels:/i,
    /^score:/i,
    /^favcount:/i,
    /^date:/i,
    /^source:/i,
    /^pool:/i,
    /^parent:/i,
    /^md5:/i,
    /^filetype:/i,
    /^random:/i,
  ]

  const normalTags = rawTags.filter(tag => !metaTagPatterns.some(pattern => pattern.test(tag)))
  const hasOrderTag = rawTags.some(tag => /^order:/i.test(tag) || /^random:/i.test(tag))
  const tagCount = normalTags.length

  const baseMaxTags = (order === 'recent' && !hasOrderTag) ? 2 : 1
  const maxTags = Math.max(0, baseMaxTags - extraTagsCount)

  return tagCount > maxTags
}

// Function to check if user entered more than 2 search terms total
export const hasMoreThanTwoTerms = (tags: string): boolean => {
  if (!tags.trim()) return false

  const tagCount = tags
    .split(',')
    .map(tag => tag.trim())
    .filter(tag => tag.length > 0).length

  return tagCount > 2
}

// Function to get the final query tags that will be sent to Danbooru API
export const getFinalQueryTags = (userTags: string, ratingFilter: string, order: string, tagCountFilter?: string, provider: BooruProvider = 'danbooru'): string[] => {
  const tags: string[] = []

  // Add rating filter if not 'all'
  if (ratingFilter && ratingFilter !== 'all') {
    tags.push(ratingFilter)
  }

  // Add tag count filter if present and supported (only Danbooru)
  if (tagCountFilter && provider === 'danbooru') {
    // Use ">="  operator to include the exact value and above
    tags.push(`tagcount:>=${tagCountFilter.replace(/\D/g, '')}`)
  }

  // Add order tag if popular or random
  if (order === 'popular') {
    tags.push('order:rank')
  } else if (order === 'random') {
    // For random, we use random:N instead of order:random for better performance
    tags.push('random:60')
  }

  // Calculate extra tags count (rating + tagcount)
  // Note: order tags don't count towards the limit in the same way, but let's be safe
  // Actually, order:rank counts as 1. rating:x counts as 1. tagcount:x counts as 1.
  // processTagsForAPI handles the limit for *user entered* tags.
  // We need to pass how many *system* tags we are adding that eat into the limit.
  // Danbooru free limit is 2 tags.
  // Metatags like tagcount and rating do not count towards the 2-tag limit.
  const extraTagsCount = 0

  // Add processed user tags
  const processedUserTags = processTagsForAPI(userTags, order, extraTagsCount)
  if (processedUserTags) {
    tags.push(...processedUserTags.split(' '))
  }

  return tags
}

export const useInfinitePosts = (tags: string, ratingFilter: string = 'rating:general', order: string = 'popular', randomSeed?: number, provider: BooruProvider = 'danbooru', hasPrompt: boolean = false, tagCountFilter?: string) => {
  // E621 uses rating:safe instead of rating:general
  const effectiveRating = (provider === 'e621' && ratingFilter === 'rating:general')
    ? 'rating:safe'
    : ratingFilter

  const ratingPart = effectiveRating && effectiveRating !== 'all' ? `${effectiveRating} ` : ''
  // Apply tag count filter for Danbooru and E621
  // Using >= operator to include the exact value and above (minimum tag count = exact value or more)
  const tagCountPart = (tagCountFilter && (provider === 'danbooru' || provider === 'e621')) ? `tagcount:>=${tagCountFilter.replace(/\D/g, '')} ` : ''

  const extraTagsCount = 0
  const processedTags = processTagsForAPI(tags, order, extraTagsCount)

  const query = processedTags ? `${ratingPart}${tagCountPart}${processedTags}` : `${ratingPart}${tagCountPart}`.trim()
  const encodedQuery = encodeURIComponent(query)

  return useSWRInfinite<BooruPost[]>(
    (pageIndex: number, previousPageData: BooruPost[] | null) => {
      // Stop fetching if we received an empty array (no more results)
      if (previousPageData && previousPageData.length === 0) {
        return null
      }

      // Special handling for Aibooru: Direct client-side fetch to bypass Vercel IP blocks
      if (provider === 'aibooru') {
        const promptFilter = hasPrompt ? 'has:prompt' : ''
        let finalTags: string

        // Use raw 'query' instead of 'encodedQuery' to avoid double encoding by URLSearchParams
        if (order === 'recent') {
          finalTags = [query, promptFilter].filter(Boolean).join(' ').trim()
        } else if (order === 'random') {
          const randomCount = "60"
          finalTags = [query, promptFilter, `random:${randomCount}`].filter(Boolean).join(' ')
        } else {
          finalTags = [query, promptFilter, 'order:rank'].filter(Boolean).join(' ')
        }

        // For random order, we must stick to page 1 because random:20 limits the result set to 20 items.
        // We ensure uniqueness for SWR keys by adding a seed parameter.
        const isRandom = order === 'random'
        const effectivePage = isRandom ? "1" : (pageIndex + 1).toString()

        const params = new URLSearchParams({
          limit: "60",
          only: "id,file_url,large_file_url,preview_file_url,tag_string,tag_string_artist,tag_string_character,tag_string_copyright,rating,ai_metadata,image_width,image_height",
          page: effectivePage,
          tags: finalTags
        })

        if (isRandom) {
          params.append("seed", `${randomSeed}_${pageIndex}`)
        }

        const directUrl = `${PROVIDER_URLS.AIBOORU}/posts.json?${params.toString()}`
        return directUrl
      }

      // Select the correct API endpoint based on provider
      let apiEndpoint = '/api/posts' // Default to Danbooru
      if (provider === 'rule34') {
        apiEndpoint = '/api/rule34'
      } else if (provider === 'e621') {
        apiEndpoint = '/api/e621'
      } else if (provider === 'gelbooru') {
        apiEndpoint = '/api/gelbooru'
      }

      // CRITICAL: Page index is 0-based, but API expects 1-based page numbers
      // pageIndex + 1 ensures correct page progression: 0 -> page 1, 1 -> page 2, etc.
      // For random order, we must stick to page 1 because random:20 limits the result set to 20 items.
      const isRandomOrder = order === 'random' || /order:random|random:\d+/i.test(tags)
      const effectivePage = isRandomOrder ? 1 : pageIndex + 1

      const baseUrl = `${apiEndpoint}?page=${effectivePage}&tags=${encodedQuery}&order=${order}`

      // Add random seed for random searches to force cache invalidation
      // Also add seed if tags contain order:random to ensure we get new results
      // We append pageIndex to seed to ensure we get *different* random posts for each page
      const seedParam = isRandomOrder && randomSeed ? `&seed=${randomSeed}_${pageIndex}` : ''

      const finalUrl = `${baseUrl}${seedParam}`

      return finalUrl
    },
    fetcher,
    {
      revalidateFirstPage: false, // FIXED: Don't revalidate first page when loading more
      revalidateAll: false,
      persistSize: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false, // FIXED: Prevent reconnect from triggering revalidation
      dedupingInterval: 15000, // 15s dedup window; random uses unique seed keys so it's unaffected
      shouldRetryOnError: (error) => {
        // Don't retry on 422 errors (invalid tags/search parameters)
        // Don't retry on 4xx client errors in general
        return error.status >= 500
      },
      errorRetryCount: 3,
      errorRetryInterval: 1000,
      parallel: false, // CRITICAL: Ensure pages are fetched sequentially, not in parallel
    }
  )
}

// Hook to fetch favorite posts by their IDs (supports mixed providers)
export interface FavoriteItem {
  id: number;
  provider: BooruProvider;
}

export const getFavoritesCacheKey = (favorites: FavoriteItem[]) => {
  if (favorites.length === 0) return null
  // Sort by provider then ID for consistent cache key
  const sortedKey = favorites
    .slice()
    .sort((a, b) => {
      const pDiff = a.provider.localeCompare(b.provider);
      return pDiff !== 0 ? pDiff : a.id - b.id;
    })
    .map(f => `${f.provider}:${f.id}`)
    .join(',');

  return `favorites-mixed-${sortedKey}`
}

export function useFavoritePosts(favorites: FavoriteItem[]) {
  const shouldFetch = favorites.length > 0
  const cacheKey = getFavoritesCacheKey(favorites)
  const { reportError, reportSlowResponse } = useApiStatus()

  const { data, error, isLoading, mutate } = useSWR<BooruPost[]>(
    cacheKey,
    async () => {
      if (!shouldFetch) return []

      const startTime = Date.now()

      try {
        const aibooruFavs = favorites.filter(f => f.provider === 'aibooru')
        const serverFavs = favorites.filter(f => f.provider !== 'aibooru')

        const fetchPromises: Promise<BooruPost[]>[] = []

        if (serverFavs.length > 0) {
          const serverPromise = fetch('/api/favorites', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ favorites: serverFavs }),
          }).then(async (response) => {
            const responseTime = Date.now() - startTime

            if (!response.ok) {
              const errorData = new Error(`HTTP error! status: ${response.status}`) as Error & { info?: unknown; status?: number }
              errorData.status = response.status

              reportError(new Error(`Error ${response.status}: Error al cargar favoritos`))

              throw errorData
            }

            if (responseTime > 10000) {
              reportSlowResponse(responseTime)
            }

            return response.json()
          })

          fetchPromises.push(serverPromise)
        }

        if (aibooruFavs.length > 0) {
          const aibooruIds = aibooruFavs.map(f => f.id).join(',')
          const params = new URLSearchParams({
            limit: "500",
            only: "id,file_url,large_file_url,preview_file_url,tag_string,tag_string_artist,tag_string_character,tag_string_copyright,rating,score,ai_metadata,image_width,image_height",
            tags: `id:${aibooruIds}`
          })
          
          const aibooruPromise = fetch(`${PROVIDER_URLS.AIBOORU}/posts.json?${params.toString()}`)
            .then(res => res.ok ? res.json() : [])
            .then(data => {
              if (Array.isArray(data)) {
                return data
                  .filter(post => post && post.id)
                  .map(post => ({
                    ...transformAibooruPost(post),
                    _provider: 'aibooru'
                  }))
              }
              return []
            })
            .catch(err => {
              console.warn("[useFavoritePosts] Aibooru client fetch error:", err)
              return []
            })
            
          fetchPromises.push(aibooruPromise)
        }

        const results = await Promise.all(fetchPromises)
        const allPosts = results.flat() as BooruPost[]

        // Sort posts to match the requested order to prevent layout shifts (API race conditions)
        const postsMap = new Map(allPosts.map((p: BooruPost) => [`${p._provider}:${p.id}`, p]))

        const sortedPosts = favorites
          .map(f => postsMap.get(`${f.provider}:${f.id}`))
          .filter((p): p is BooruPost => p !== undefined)

        return sortedPosts
      } catch (fetchError: unknown) {
        // Silently handle connection errors which are common during navigation/logout
        if (fetchError instanceof TypeError || (fetchError instanceof Error && (fetchError.name === 'AbortError' || fetchError.message === 'Failed to fetch'))) {
          console.warn('[ApiClient] Favorites fetch interrupted (likely navigation/logout)')
          return []
        }

        throw fetchError
      }
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 60000,
      keepPreviousData: true,
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

/**
 * Fetch post counts for a batch of character tags.
 * Falls back to an empty record for unsupported providers.
 */
export async function fetchBatchTagCounts(
  tags: string[],
  provider: BooruProvider
): Promise<Record<string, number> | null> {
  if (!tags.length) return {}
  
  if (provider !== 'danbooru' && provider !== 'aibooru') {
    return {} // Only supported providers via the api route
  }

  try {
    const params = new URLSearchParams({
      tags: tags.join(','),
      provider
    })
    
    // Uses the relative path since this runs on the client
    const response = await fetch(`/api/booru/tags?${params.toString()}`)
    
    if (!response.ok) {
      console.error(`Failed to fetch tag counts: ${response.status}`)
      return null
    }
    
    return await response.json()
  } catch (error) {
    console.error('Error fetching batch tag counts:', error)
    return null
  }
}
