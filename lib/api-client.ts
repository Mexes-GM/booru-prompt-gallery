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

export interface AibooruPost extends DanbooruPost {
  ai_metadata?: {
    prompt?: string
    negative_prompt?: string
    model?: string
    steps?: number
    cfg_scale?: number
    sampler?: string
    seed?: number
  }
}

export interface Rule34Post extends DanbooruPost {
  // Rule34 uses the same structure as DanbooruPost
}

export type BooruPost = DanbooruPost | AibooruPost | Rule34Post
export type BooruProvider = 'danbooru' | 'aibooru' | 'rule34'

// Helper function to check if a post is from Aibooru and has AI metadata
export const isAibooruPost = (post: BooruPost): post is AibooruPost => {
  return 'ai_metadata' in post && post.ai_metadata !== undefined
}

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

// Production fetcher with error handling and retry logic
const fetcher = async (url: string) => {
  const startTime = Date.now()
  
  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'BooruPromptGallery/1.0',
      }
    })
    
    const responseTime = Date.now() - startTime
    
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
    
    return res.json()
  } catch (fetchError: any) {
    throw fetchError
  }
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

export const useInfinitePosts = (tags: string, ratingFilter: string = 'rating:general', order: string = 'popular', randomSeed?: number, provider: BooruProvider = 'danbooru', hasPrompt: boolean = false) => {
  const ratingPart = ratingFilter && ratingFilter !== 'all' ? `${ratingFilter} ` : ''
  const processedTags = processTagsForAPI(tags, order)
  const query = processedTags ? `${ratingPart}${processedTags}` : ratingPart.trim()
  const encodedQuery = encodeURIComponent(query)
  
  return useSWRInfinite<BooruPost[]>(
    (pageIndex: number) => {
      // Select the correct API endpoint based on provider
      let apiEndpoint = '/api/posts' // Default to Danbooru
      if (provider === 'aibooru') {
        apiEndpoint = '/api/aibooru'
      } else if (provider === 'rule34') {
        apiEndpoint = '/api/rule34'
      }
      
      const baseUrl = `${apiEndpoint}?page=${pageIndex + 1}&tags=${encodedQuery}&order=${order}`
      
      // Add hasPrompt parameter for Aibooru
      const promptParam = provider === 'aibooru' && hasPrompt ? '&hasPrompt=true' : ''
      
      // Add random seed for random searches to force cache invalidation
      const seedParam = order === 'random' && randomSeed ? `&seed=${randomSeed}` : ''
      
      return `${baseUrl}${promptParam}${seedParam}`
    },
    fetcher,
    {
      revalidateFirstPage: true,
      revalidateAll: false,
      persistSize: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: order === 'random' ? 0 : 300000, // No caching for random searches
      shouldRetryOnError: (error) => {
        // Don't retry on 422 errors (invalid tags/search parameters)
        // Don't retry on 4xx client errors in general
        return error.status >= 500
      },
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
      
      const startTime = Date.now()
      
      try {
        const response = await fetch('/api/favorites', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ids: favoriteIds }),
        })
        
        const responseTime = Date.now() - startTime

        if (!response.ok) {
          // Importar dinámicamente para evitar dependencias circulares
      const { useApiStatus } = await import('@/hooks/use-api-status')
      const { reportError } = useApiStatus()
          
          const errorData = new Error(`HTTP error! status: ${response.status}`) as Error & { info?: unknown; status?: number }
          errorData.status = response.status
          
          // Reportar error a las notificaciones
          reportError(new Error(`Error ${response.status}: Error al cargar favoritos`))
          
          throw errorData
        }
        
        // Verificar si la respuesta fue lenta (>10 segundos)
        if (responseTime > 10000) {
      const { useApiStatus } = await import('@/hooks/use-api-status')
      const { reportSlowResponse } = useApiStatus()
          reportSlowResponse(responseTime)
        }

        const posts = await response.json()
        return posts
  } catch (fetchError: any) {
        // Si es un error de red o timeout
        if (fetchError instanceof TypeError || fetchError.name === 'AbortError') {
          const { useApiStatus } = await import('@/hooks/use-api-status')
          const { reportError } = useApiStatus()
          reportError(new Error('Error de conexión: No se pudo cargar favoritos'))
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
