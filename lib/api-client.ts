
import useSWRInfinite from 'swr/infinite'
import useSWR from 'swr'
import { useApiStatus } from '@/hooks/use-api-status'
import { BooruPost, isAibooruPost as checkIsAibooruPost } from './booru/types'

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
const transformAibooruPost = (post: any): BooruPost => {
  // Ensure we have minimal required fields
  if (!post || typeof post !== 'object') {
    throw new Error('Invalid post data from Aibooru')
  }

  return {
    id: post.id || 0,
    file_url: post.file_url || '',
    large_file_url: post.large_file_url || post.file_url || '',
    preview_file_url: post.preview_file_url || post.file_url || '',
    tag_string: post.tag_string || '',
    tag_string_artist: post.tag_string_artist || '',
    tag_string_character: post.tag_string_character || '',
    tag_string_copyright: post.tag_string_copyright || '',
    rating: post.rating || 'q',
    score: post.score || 0,
    ai_metadata: post.ai_metadata || undefined,
    width: post.image_width || 0,
    height: post.image_height || 0,
    _provider: 'aibooru', // Explicitly mark as Aibooru
  }
}

// Production fetcher with error handling and retry logic
const fetcher = async (url: string) => {
  try {
    // Check if we are fetching directly from Aibooru (client-side bypass)
    const isDirectAibooru = url.startsWith('https://aibooru.online')

    const headers: HeadersInit = isDirectAibooru
      ? {} // Browsers automatically set Origin, no special headers for CORS requests
      : {
        'Accept': 'application/json',
        'User-Agent': 'BooruPromptGallery/1.0',
      }

    // Add signal support if needed, but for now simple fetch
    const res = await fetch(url, { headers })

    if (!res.ok) {
      const error = new Error('Failed to fetch data') as Error & { info?: unknown; status?: number }
      try {
        error.info = await res.json()
      } catch {
        error.info = { message: res.statusText }
      }
      error.status = res.status
      throw error
    }

    const data = await res.json()

    // Transform data if it's from Aibooru direct fetch
    if (isDirectAibooru) {
      if (Array.isArray(data)) {
        return data
          .filter(post =>
            post &&
            post.id &&
            (post.file_url || post.large_file_url) &&
            !post.file_url?.includes("deleted") &&
            (post.tag_string || post.tags) &&
            !post.file_url?.match(/\.(mp4|webm|avi|mov|mkv)$/i)
          )
          .map(transformAibooruPost)
      } else {
        // Handle empty response or unexpected format gracefully
        return []
      }
    }

    return data
  } catch (fetchError: any) {
    // Log only critical errors, not 404s for end of pagination
    if (fetchError.status !== 404) {
      console.error('[ApiClient] Fetch Error:', fetchError)
    }
    throw fetchError
  }
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
    // Always force ">" operator for tag count
    tags.push(`tagcount:>${tagCountFilter.replace(/\D/g, '')}`)
  }

  // Add order tag if popular or random
  if (order === 'popular') {
    tags.push('order:rank')
  } else if (order === 'random') {
    // For random, we use random:N instead of order:random for better performance
    tags.push('random:20') // Using the same limit as in API_CONFIG.randomParams
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
  // Danbooru uses tagcount:>X, E621 supports range but tagcount:>X is standard range syntax for them
  const tagCountPart = (tagCountFilter && (provider === 'danbooru' || provider === 'e621')) ? `tagcount:>${tagCountFilter.replace(/\D/g, '')} ` : ''

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
          const randomCount = "20"
          finalTags = [query, promptFilter, `random:${randomCount}`].filter(Boolean).join(' ')
        } else {
          finalTags = [query, promptFilter, 'order:rank'].filter(Boolean).join(' ')
        }

        // For random order, we must stick to page 1 because random:20 limits the result set to 20 items.
        // We ensure uniqueness for SWR keys by adding a seed parameter.
        const isRandom = order === 'random'
        const effectivePage = isRandom ? "1" : (pageIndex + 1).toString()

        const params = new URLSearchParams({
          limit: "20",
          only: "id,file_url,large_file_url,preview_file_url,tag_string,tag_string_artist,tag_string_character,tag_string_copyright,rating,score,ai_metadata,image_width,image_height",
          page: effectivePage,
          tags: finalTags
        })

        if (isRandom) {
          params.append("seed", `${randomSeed}_${pageIndex}`)
        }

        const directUrl = `https://aibooru.online/posts.json?${params.toString()}`
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
      dedupingInterval: 5000, // 5s dedup window; random uses unique seed keys so it's unaffected
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
        const response = await fetch('/api/favorites', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ favorites }),
        })

        const responseTime = Date.now() - startTime

        if (!response.ok) {
          const errorData = new Error(`HTTP error! status: ${response.status}`) as Error & { info?: unknown; status?: number }
          errorData.status = response.status

          // Reportar error a las notificaciones
          reportError(new Error(`Error ${response.status}: Error al cargar favoritos`))

          throw errorData
        }

        // Verificar si la respuesta fue lenta (>10 segundos)
        if (responseTime > 10000) {
          reportSlowResponse(responseTime)
        }

        const posts = await response.json()
        
        // Sort posts to match the requested order to prevent layout shifts (API race conditions)
        const postsMap = new Map(posts.map((p: any) => [`${p._provider || p.provider}:${p.id}`, p]))
        
        const sortedPosts = favorites
          .map(f => postsMap.get(`${f.provider}:${f.id}`))
          .filter((p): p is BooruPost => p !== undefined)

        return sortedPosts
      } catch (fetchError: any) {
        // Silently handle connection errors which are common during navigation/logout
        if (fetchError instanceof TypeError || fetchError.name === 'AbortError' || fetchError.message === 'Failed to fetch') {
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
