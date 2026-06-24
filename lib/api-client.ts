
import useSWRInfinite from 'swr/infinite'
import useSWR, { mutate, useSWRConfig } from 'swr'
import { useState, useEffect, useRef, startTransition } from 'react'
import { useApiStatus } from '@/hooks/use-api-status'
import { BooruPost, isAibooruPost as checkIsAibooruPost } from './booru/types'
import { prefetchTagCounts } from '@/hooks/use-tag-counts'
import { PROVIDER_URLS, USER_AGENT } from '@/lib/constants'
import { createClient } from '@/lib/supabase/client'

// Re-export types

// CF Worker base URL — same worker handles both image proxy and API routes.
// Set NEXT_PUBLIC_IMAGE_PROXY_URL to your Cloudflare Worker URL.
// When empty (local dev), uses same-origin /api/* routes.
const API_BASE = process.env.NEXT_PUBLIC_IMAGE_PROXY_URL || ''

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`
}
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
    width: (typedPost.image_width as number) || (typedPost.width as number) || 0,
    height: (typedPost.image_height as number) || (typedPost.height as number) || 0,
    _provider: 'aibooru', // Explicitly mark as Aibooru
  }
}

// Helper to transform raw E621 posts to BooruPost (direct client fetch — CORS *, no auth)
// ponytail: minimal mapping, only fields the gallery uses. Add more when needed.
const transformE621Post = (post: unknown): BooruPost => {
  if (!post || typeof post !== 'object') {
    throw new Error('Invalid post data from E621')
  }
  const p = post as Record<string, unknown>
  const file = (p.file as Record<string, unknown>) || {}
  const sample = (p.sample as Record<string, unknown>) || {}
  const preview = (p.preview as Record<string, unknown>) || {}
  const tags = (p.tags as Record<string, string[]>) || {}
  const score = (p.score as Record<string, number>) || {}

  // Collect content tags (exclude meta/invalid categories)
  const contentCategories = ['general', 'species', 'character', 'copyright', 'artist', 'lore']
  const allTags: string[] = []
  contentCategories.forEach(cat => {
    if (tags[cat]) allTags.push(...tags[cat])
  })

  return {
    id: (p.id as number) || 0,
    file_url: (file.url as string) || '',
    large_file_url: (sample.url as string) || (file.url as string) || '',
    preview_file_url: (preview.url as string) || (file.url as string) || '',
    tag_string: allTags.join(' '),
    tag_string_artist: (tags.artist || []).join(' '),
    tag_string_character: (tags.character || []).join(' '),
    tag_string_copyright: (tags.copyright || []).join(' '),
    rating: (p.rating as string) || 'q',
    score: score.total ?? 0,
    width: (file.width as number) || 0,
    height: (file.height as number) || 0,
    _provider: 'e621',
  }
}

// Helper to transform raw Danbooru posts to BooruPost (for direct client fetches bypassing the Worker)
const transformDanbooruPost = (post: unknown): BooruPost => {
  if (!post || typeof post !== 'object') {
    throw new Error('Invalid post data from Danbooru')
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
    tag_string_meta: (typedPost.tag_string_meta as string) || undefined,
    rating: (typedPost.rating as string) || 'q',
    score: (typedPost.score as number) || 0,
    width: (typedPost.image_width as number) || (typedPost.width as number) || 0,
    height: (typedPost.image_height as number) || (typedPost.height as number) || 0,
    _provider: 'danbooru',
  }
}

// Client-side request deduplication: prevents SWR from firing multiple
// identical requests in rapid succession (React Strict Mode double-render,
// filter changes, etc.). Holds results for 5s after resolution so rapid
// re-renders reuse the settled promise instead of creating new ones.
const inflightRequests = new Map<string, Promise<BooruPost[]>>()

// Page-1 Danbooru request sequencer. During SWR initialization React can
// trigger 3+ different page-1 URLs in <100ms as state settles (default
// filter → saved preference → random seed). With 10 concurrent users
// that's 30+ requests hitting Danbooru in the first second.
// This chain serializes unique page-1 requests at 1s intervals so they
// never burst through Danbooru's 10 req/s limit.
let page1Chain: Promise<unknown> = Promise.resolve()
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

  const doFetch = async (): Promise<BooruPost[]> => {
    const MAX_RETRIES = 2

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const isDirectAibooru = url.startsWith(PROVIDER_URLS.AIBOORU)

        const headers: HeadersInit = isDirectAibooru
          ? {}
          : {
            'Accept': 'application/json',
            'User-Agent': USER_AGENT,
          }

        const res = await fetch(url, { headers })

        // Retry 429 responses after the server-suggested delay
        if (res.status === 429 && attempt < MAX_RETRIES) {
          let retryAfter = 5
          try {
            const body = await res.json()
            retryAfter = Math.min(body.retryAfter || 5, 30)
          } catch { /* use default */ }
          await new Promise(r => setTimeout(r, retryAfter * 1000))
          continue
        }

        if (!res.ok) {
          const error = new Error('Failed to fetch data') as Error & { info?: unknown; status?: number }
          try { error.info = await res.json() } catch { error.info = { message: res.statusText } }
          error.status = res.status
          throw error
        }

        const data = await res.json()

        let resultPosts = data
        let identifiedProvider: 'danbooru' | 'aibooru' | 'e621' | null = null

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
        } else if (url.includes('danbooru.donmai.us') && !url.includes('/api/')) {
          // Direct Danbooru API response — raw format, needs transformation
          identifiedProvider = 'danbooru'
          if (Array.isArray(data)) {
            resultPosts = data
              .filter(post =>
                post && post.id &&
                (post.file_url || post.large_file_url) &&
                !post.file_url?.includes("deleted") &&
                (post.tag_string || post.tags) &&
                !post.file_url?.match(/\.(mp4|webm|avi|mov|mkv)$/i)
              )
              .map(transformDanbooruPost)
          } else {
            resultPosts = []
          }
        } else if (url.includes('e621.net')) {
          // Direct E621 API response — { posts: [...] } format
          // ponytail: direct client fetch, no server enrichment. Tags come pre-categorized from E621.
          identifiedProvider = 'e621'
          const posts = (data as { posts?: unknown[] })?.posts
          if (Array.isArray(posts)) {
            resultPosts = posts
              .filter(post =>
                post && (post as Record<string, unknown>).id &&
                ((post as Record<string, unknown>).file as Record<string, unknown>)?.url
              )
              .map(transformE621Post)
          } else {
            resultPosts = []
          }
        } else if (
          url.includes('/api/posts') ||
          url.includes('/api/favorites') ||
          (url.includes('api/booru/search') && url.includes('provider=danbooru'))
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
        // Retry network errors (TypeError) — e.g. connection refused, DNS failure
        if (fetchError instanceof TypeError && attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 2000))
          continue
        }

        if (fetchError instanceof Response && fetchError.status !== 404) {
          console.error('[ApiClient] Fetch Error:', fetchError)
        } else if (!(fetchError instanceof Response)) {
          console.error('[ApiClient] Fetch Error:', fetchError)
        }
        throw fetchError
      }
    }

    throw new Error('Failed to fetch data')
  }

  // Serialize unique page-1 Danbooru requests. The first fires immediately;
  // each subsequent one waits 1s after the previous one settles. This
  // prevents SWR initialization bursts without delaying the first paint.
  let promise: Promise<BooruPost[]>
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
  // Note: order tags don't count towards the limit in the same way — being conservative here.
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

const DANBOORU_ONLY_FIELDS = 'id,file_url,large_file_url,preview_file_url,tag_string,tag_string_artist,tag_string_character,tag_string_copyright,tag_string_meta,rating,image_width,image_height'

function buildDirectDanbooruUrl(
  query: string,
  page: string,
  order: string,
  randomSeed?: number,
  pageIndex?: number
): string {
  let finalTags: string
  const isRandom = order === 'random' || /order:random|random:\d+/i.test(query)

  if (order === 'recent') {
    finalTags = query || ''
  } else if (isRandom) {
    const cleanTags = query ? query.replace(/order:random|random:\d+/gi, '').trim() : ''
    finalTags = cleanTags ? `${cleanTags} random:30` : 'random:30'
  } else {
    finalTags = query ? `${query} order:rank` : 'order:rank'
  }

  const params = new URLSearchParams({
    limit: '30',
    only: DANBOORU_ONLY_FIELDS,
    page,
    tags: finalTags,
  })

  if (isRandom && randomSeed !== undefined && pageIndex !== undefined) {
    params.append('_seed', `${randomSeed}_${pageIndex}`)
  }

  return `${PROVIDER_URLS.DANBOORU}/posts.json?${params.toString()}`
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

      // Danbooru: direct to danbooru.donmai.us to avoid shared IP rate limiting
      // (each user's browser has its own IP, so Danbooru's 10 req/s limit is per user)
      if (provider === 'danbooru') {
        const isRandomOrder = order === 'random' || /order:random|random:\d+/i.test(tags)
        const effectivePage = isRandomOrder ? 1 : pageIndex + 1
        return buildDirectDanbooruUrl(query, String(effectivePage), order, randomSeed, pageIndex)
      }

      // E621: direct client fetch — CORS *, no auth required.
      // Each user's browser has its own IP, eliminating shared rate-limit contention.
      // ponytail: direct URL, no transform needed (handled by fetcher).
      if (provider === 'e621') {
        const isRandom = order === 'random' || /order:random|random:\d+/i.test(tags)
        const effectivePage = isRandom ? "1" : (pageIndex + 1).toString()
        const params = new URLSearchParams({
          limit: "60",
          page: effectivePage,
          tags: query,
          _client: 'Boorugallery/9.2',
        })
        if (isRandom) {
          params.append("seed", `${randomSeed}_${pageIndex}`)
        }
        return `https://e621.net/posts.json?${params.toString()}`
      }

      // Other providers — route through the Worker API
      const apiEndpoint = '/api/posts'

      const isRandomOrder = order === 'random' || /order:random|random:\d+/i.test(tags)
      const effectivePage = isRandomOrder ? 1 : pageIndex + 1

      const baseUrl = apiUrl(`${apiEndpoint}?page=${effectivePage}&tags=${encodedQuery}&order=${order}&provider=${provider}`)

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
  const sorted = favorites
    .slice()
    .sort((a, b) => {
      const pDiff = a.provider.localeCompare(b.provider);
      return pDiff !== 0 ? pDiff : a.id - b.id;
    });

  let hash = 5381;
  for (const f of sorted) {
    const s = `${f.provider}:${f.id}`;
    for (let i = 0; i < s.length; i++) {
      hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
    }
  }
  return `favorites-${favorites.length}-${(hash >>> 0).toString(36)}`
}

// ── LocalStorage cache for favorites posts ──
const FAV_CACHE_PREFIX = 'booru_fav_cache_'
const MAX_CACHE_ENTRIES = 5
const MAX_CACHE_SIZE = 2_000_000 // 2MB per entry

function getCachedFavorites(key: string): BooruPost[] | null {
  if (typeof window === 'undefined') return null
  try {
    const allKeys = Object.keys(localStorage).filter(k => k.startsWith(FAV_CACHE_PREFIX) && k.endsWith(key))
    // Pick the most recent entry by sorting keys (timestamps are lexicographically sortable)
    allKeys.sort()
    const raw = allKeys.length > 0 ? localStorage.getItem(allKeys[allKeys.length - 1]) : null
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as BooruPost[]
  } catch { /* corrupt entry */ }
  return null
}

function setCachedFavorites(key: string, data: BooruPost[]): void {
  if (typeof window === 'undefined' || data.length === 0) return
  try {
    const serialized = JSON.stringify(data)
    if (serialized.length > MAX_CACHE_SIZE) return // too large, skip
    localStorage.setItem(`${FAV_CACHE_PREFIX}${Date.now()}_${key}`, serialized)
    // Prune old entries, keep only the most recent MAX_CACHE_ENTRIES
    const allKeys = Object.keys(localStorage)
      .filter(k => k.startsWith(FAV_CACHE_PREFIX))
      .sort()
    if (allKeys.length > MAX_CACHE_ENTRIES) {
      // Remove oldest entries (first in alphabetical = oldest timestamp prefix)
      const toRemove = allKeys.slice(0, allKeys.length - MAX_CACHE_ENTRIES)
      toRemove.forEach(k => localStorage.removeItem(k))
    }
  } catch {
    // localStorage full — clear all favorites cache
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith(FAV_CACHE_PREFIX))
        .forEach(k => localStorage.removeItem(k))
    } catch { /* hopeless */ }
  }
}

/**
 * Merge cached posts from ALL previous cache entries.
 * When adding/removing a single favorite, the exact cache key changes,
 * but individual posts are still valid. This avoids re-fetching 87 posts
 * just because 1 new favorite was added.
 */
function getMergedCachedFavorites(favorites: FavoriteItem[]): BooruPost[] {
  if (typeof window === 'undefined') return []
  const postMap = new Map<string, BooruPost>()
  const allKeys = Object.keys(localStorage)
    .filter(k => k.startsWith(FAV_CACHE_PREFIX))
    // Process newest entries LAST so they overwrite older ones
    .sort()

  for (const key of allKeys) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const posts = JSON.parse(raw)
      if (!Array.isArray(posts)) continue
      for (const post of posts) {
        if (post && post._provider && post.id) {
          const entryKey = `${(post._provider as string).toLowerCase()}:${post.id}`
          // Let newer entries overwrite older (no has() check)
          postMap.set(entryKey, post as BooruPost)
        }
      }
    } catch { /* corrupt entry, skip */ }
  }

  return favorites
    .map(f => postMap.get(`${f.provider}:${f.id}`))
    .filter((p): p is BooruPost => p !== undefined)
}

// ── Supabase booru_posts_cache helpers ──
// Converts a booru_posts_cache row back to a BooruPost the UI can use.

interface CachedPostRow {
  provider: string
  post_id: number
  file_url: string | null
  large_file_url: string | null
  preview_file_url: string | null
  rating: string
  score: number
  image_width: number
  image_height: number
  tag_string: { general: string[]; artist: string[]; character: string[]; copyright: string[] } | string | null
  tag_string_artist: string | null
  tag_string_character: string | null
  tag_string_copyright: string | null
  tag_string_meta: string | null
  ai_metadata: Record<string, unknown> | null
}

function cachedRowToBooruPost(row: CachedPostRow): BooruPost {
  let tagStr = ''
  if (row.tag_string) {
    if (typeof row.tag_string === 'string') {
      tagStr = row.tag_string
    } else {
      const all: string[] = []
      Object.values(row.tag_string).forEach(arr => { if (Array.isArray(arr)) all.push(...arr) })
      tagStr = all.join(' ')
    }
  }
  return {
    id: row.post_id,
    file_url: row.file_url || '',
    large_file_url: row.large_file_url || row.file_url || '',
    preview_file_url: row.preview_file_url || row.file_url || '',
    tag_string: tagStr,
    tag_string_artist: row.tag_string_artist || '',
    tag_string_character: row.tag_string_character || '',
    tag_string_copyright: row.tag_string_copyright || '',
    tag_string_meta: row.tag_string_meta || undefined,
    rating: row.rating || 'q',
    score: row.score || 0,
    width: row.image_width || 0,
    height: row.image_height || 0,
    _provider: row.provider,
    ai_metadata: row.ai_metadata as BooruPost['ai_metadata'] || undefined,
  }
}

// Convert a BooruPost to a booru_posts_cache row for upsert.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function booruPostToCacheRow(post: BooruPost, provider: string): any {
  const tags = (post.tag_string || '').split(/\s+/).filter(Boolean)
  const artistTags = (post.tag_string_artist || '').split(/\s+/).filter(Boolean)
  const charTags = (post.tag_string_character || '').split(/\s+/).filter(Boolean)
  const copyTags = (post.tag_string_copyright || '').split(/\s+/).filter(Boolean)
  return {
    provider,
    post_id: post.id,
    file_url: post.file_url || null,
    large_file_url: post.large_file_url || null,
    preview_file_url: post.preview_file_url || null,
    rating: post.rating || 'q',
    score: post.score || 0,
    image_width: post.width || 0,
    image_height: post.height || 0,
    tag_string: {
      general: tags.filter(t => !artistTags.includes(t) && !charTags.includes(t) && !copyTags.includes(t)),
      artist: artistTags,
      character: charTags,
      copyright: copyTags,
    },
    tag_string_artist: post.tag_string_artist || null,
    tag_string_character: post.tag_string_character || null,
    tag_string_copyright: post.tag_string_copyright || null,
    tag_string_meta: (post as any).tag_string_meta || null,
    ai_metadata: (post as any).ai_metadata || null,
    stale_at: null,
  }
}

// Persist fetched posts to Supabase booru_posts_cache for future visits.
export async function persistToCache(posts: BooruPost[]): Promise<void> {
  if (posts.length === 0) return
  try {
    const supabase = createClient()
    const rows = posts.map(p => booruPostToCacheRow(p, p._provider || 'danbooru'))
    const { error } = await supabase.from('booru_posts_cache').upsert(rows, {
      onConflict: 'provider,post_id',
      ignoreDuplicates: false,
    })
    if (error) console.warn('[persistToCache] Upsert failed:', error.message)
  } catch (e) {
    console.warn('[persistToCache] Failed:', e)
  }
}

export function useFavoritePosts(favorites: FavoriteItem[]) {
  // Cargar todos los favoritos de una vez — el cache de Supabase evita rate limits.
  const effectiveFavorites = favorites
  const shouldFetch = effectiveFavorites.length > 0
  const cacheKey = getFavoritesCacheKey(effectiveFavorites)
  const { reportError, reportSlowResponse } = useApiStatus()
  const { cache: swrCache } = useSWRConfig()
  const [progress, setProgress] = useState({ loaded: 0, total: favorites.length })

  // Keep total in sync when favorites list changes (e.g., after fetchFavorites loads)
  useEffect(() => {
    setProgress(prev => ({ ...prev, total: favorites.length }))
  }, [favorites.length])

  // ── Cache seeding & stale-while-revalidate ──
  // Compute fallbackData synchronously from localStorage (read-only, no mutate)
  // and seed cachedPostsRef so the fetcher skips already-loaded posts.
  // This avoids mutate() during render (React Error #185) while still providing
  // instant cache display via SWR fallbackData.
  const cachedPostsRef = useRef<Map<string, BooruPost>>(new Map())
  // Holds latest progress values so the SWR fetcher can flush them
  // without calling setState on every batch (reduces re-render pressure).
  const progressRef = useRef({ loaded: 0, total: 0 })
  // Rate-limit circuit breaker cooldown — prevents re-fetching for 30s after tripping
  const rateLimitCooldownUntilRef = useRef<number>(0)

  const BATCH_SIZE = 20
  const DANBOORU_DELAY = 1100

  // Helper: sort accumulated posts to match requested order.
  // IMPORTANT: always stamps _provider from the FavoriteItem (f.provider), NOT from
  // whatever the API or Supabase cache stored. This is the canonical provider from
  // core.favorites and is the only reliable value for downstream key comparisons
  // (folder filter, mismatch detection). Without this, a post cached with a wrong
  // provider would fail both this lookup AND the folder filter, creating a false positive.
  const getSortedPosts = (favs: FavoriteItem[], acc: Map<string, BooruPost>): BooruPost[] => {
    return favs
      .map(f => {
        const post = acc.get(`${f.provider}:${f.id}`)
        if (!post) return undefined
        // Guarantee _provider is always the canonical value from core.favorites
        return post._provider === f.provider
          ? post
          : { ...post, _provider: f.provider as BooruPost['_provider'] }
      })
      .filter((p): p is BooruPost => p !== undefined)
  }

  // ── Cache seeding: SWR global cache → localStorage → memory cache ──
  // Priority order ensures optimistic mutations from toggleFavorite are seen
  // immediately, before the fetcher completes.
  let fallbackData: BooruPost[] | undefined
  if (cacheKey) {
    // Priority 1: SWR in-memory global cache (catches optimistic mutations written
    // by toggleFavorite — eliminates the race between mutate() and fallbackData)
    const swrState = swrCache.get(cacheKey)
    const swrCachedPosts = swrState?.data as BooruPost[] | undefined

    if (swrCachedPosts && swrCachedPosts.length > 0) {
      swrCachedPosts.forEach(p =>
        cachedPostsRef.current.set(`${(p._provider || '').toLowerCase()}:${p.id}`, p)
      )
      fallbackData = swrCachedPosts
    } else {
      // Priority 2: localStorage exact cache hit (fast cold load after previous visit)
      const exactCached = getCachedFavorites(cacheKey)
      if (exactCached && exactCached.length > 0) {
        exactCached.forEach(p => cachedPostsRef.current.set(`${(p._provider || '').toLowerCase()}:${p.id}`, p))
        fallbackData = exactCached
      } else {
        // Priority 3: merge from old localStorage entries + memory cache
        const mergedPosts = getMergedCachedFavorites(effectiveFavorites)
        if (mergedPosts.length > 0) {
          mergedPosts.forEach(p => cachedPostsRef.current.set(`${(p._provider || '').toLowerCase()}:${p.id}`, p))
        }
        // Always retain memory cache across paginations to avoid UI dropping to 0
        fallbackData = getSortedPosts(effectiveFavorites, cachedPostsRef.current)
      }
    }
  } else {
    cachedPostsRef.current = new Map()
  }



  const { data, error, isLoading, isValidating, mutate: boundMutate } = useSWR<BooruPost[]>(
    cacheKey,
    async (key: string, { signal }: { signal?: AbortSignal } = {}) => {
      if (!shouldFetch) return []

      const startTime = Date.now()
      // Start with any posts already loaded from cache (exact or merged)
      const accumulated = new Map(cachedPostsRef.current)
      let loadedCount = effectiveFavorites.filter(f => accumulated.has(`${f.provider}:${f.id}`)).length

      // Only fetch favorites that aren't already in cache, within visible window
      const toFetch = effectiveFavorites.filter(f => !accumulated.has(`${f.provider}:${f.id}`))

      let lastProgressUpdate = 0
      const PROGRESS_THROTTLE_MS = 3000

      // Sync the persistent ref with current total
      progressRef.current.total = favorites.length

      const addProgress = (count: number) => {
        loadedCount += count
        const displayed = Math.min(loadedCount, favorites.length)
        const now = Date.now()
        const shouldFlush = loadedCount >= effectiveFavorites.length

        // Always keep the ref fresh so the final flush has the correct value
        progressRef.current = { loaded: displayed, total: favorites.length }

        if (shouldFlush) {
          lastProgressUpdate = now
          // Batch setProgress + mutate into one render cycle via startTransition
          startTransition(() => {
            setProgress({ loaded: displayed, total: favorites.length })
            if (cacheKey) {
              mutate(cacheKey, getSortedPosts(effectiveFavorites, accumulated), { revalidate: false })
            }
          })
        }
      }

      // Report cached posts as already loaded
      if (loadedCount > 0) {
        startTransition(() => {
          setProgress({ loaded: loadedCount, total: favorites.length })
        })
      }

      // Helper: fetch with retry on 429 (rate limit) — exponential backoff
      const fetchWithRetry = async (url: string, body: object, maxRetries = 3): Promise<Response> => {
        let lastStatus = 0
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          if (signal?.aborted) throw new Error("aborted")
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal,
          })
          if (res.ok || res.status !== 429) return res
          // 429 — wait and retry with exponential backoff
          lastStatus = res.status
          const retryAfter = parseInt(res.headers.get('Retry-After') || '2', 10)
          const delay = Math.max(retryAfter * 1000, 1000 * Math.pow(2, attempt))
          const jitter = delay * (0.4 * Math.random() - 0.2) // ±20% of delay
          const delayWithJitter = Math.round(delay + jitter)
          console.warn(`[useFavoritePosts] Rate limited (429), retrying in ${delayWithJitter}ms (attempt ${attempt + 1}/${maxRetries})`)
          await new Promise(r => setTimeout(r, delayWithJitter))
        }
        return new Response(null, { status: lastStatus })
      }

      try {
        // ── Supabase cache layer: query booru_posts_cache for posts not in localStorage ──
        // This avoids booru API calls entirely when posts are already cached in Supabase.
        if (toFetch.length > 0) {
          try {
            const supabase = createClient()
            const groups = new Map<string, number[]>()
            toFetch.forEach(f => {
              if (!groups.has(f.provider)) groups.set(f.provider, [])
              groups.get(f.provider)!.push(f.id)
            })
            const queries: Promise<{ data: CachedPostRow[] | null; error: unknown }>[] = []
            groups.forEach((ids, provider) => {
              queries.push(
                supabase.from('booru_posts_cache')
                  .select('*')
                  .eq('provider', provider)
                  .in('post_id', ids)
                  .order('post_id', { ascending: true })
                  .then((r: { data: CachedPostRow[] | null; error: unknown }) => ({ data: r.data as CachedPostRow[] | null, error: r.error }))
              )
            })
            const results = await Promise.allSettled(queries)
            let cacheHits = 0
            for (const result of results) {
              if (result.status === 'fulfilled' && result.value.data && !result.value.error) {
                for (const row of result.value.data) {
                  if (row && row.provider && row.post_id) {
                    const key = `${row.provider.toLowerCase()}:${row.post_id}`
                    if (!accumulated.has(key)) {
                      accumulated.set(key, cachedRowToBooruPost(row))
                      cacheHits++
                    }
                  }
                }
              }
            }
            if (cacheHits > 0) {
              console.log(`[useFavoritePosts] Supabase cache hit: ${cacheHits} posts (${toFetch.length - cacheHits} remaining)`)
              loadedCount += cacheHits
              startTransition(() => {
                setProgress({ loaded: loadedCount, total: favorites.length })
              })
              // Recompute toFetch after cache population
              toFetch.length = 0
              effectiveFavorites.forEach(f => {
                if (!accumulated.has(`${f.provider}:${f.id}`)) {
                  toFetch.push(f)
                }
              })
            }
          } catch (e) {
            // Supabase unavailable or user not authenticated — fall through to booru API fetch
            console.warn('[useFavoritePosts] Supabase cache query failed, falling back to booru API:', e)
          }
        }

        // If everything was cached (localStorage + Supabase), we're done
        if (toFetch.length === 0) return getSortedPosts(favorites, accumulated)

        const aibooruFavs = toFetch.filter(f => f.provider === 'aibooru')
        const e621Favs = toFetch.filter(f => f.provider === 'e621')
        const serverFavs = toFetch.filter(f => f.provider !== 'aibooru' && f.provider !== 'e621')

        // Separate Danbooru (needs sequential rate-limited batching) from others
        const danbooruFavs = serverFavs.filter(f => f.provider === 'danbooru')
        const otherServerFavs = serverFavs.filter(f => f.provider !== 'danbooru')

        // Track parallel operations so we can await them before final return
        const parallelTasks: Promise<void>[] = []

        // ── Circuit breaker for rate limiting ──
        // Tracks consecutive 429 responses across batches. After 3 consecutive
        // 429s (surviving fetchWithRetry), stops all remaining batches and
        // sets a 30-second cooldown to prevent hammering the API.
        let consecutive429Hits = 0
        const MAX_CONSECUTIVE_429 = 3
        const CIRCUIT_COOLDOWN_MS = 30000
        let circuitBroken = false
        let rateLimitHits = 0

        // Check if the circuit is already open from a previous trip
        if (Date.now() < rateLimitCooldownUntilRef.current) {
          // Still in cooldown — return whatever we had cached, don't re-fetch
          const cached = getSortedPosts(effectiveFavorites, cachedPostsRef.current)
          if (cached.length > 0) return cached
          // No cached data either — return empty list; cooldown expires soon
          return []
        }

        // 1. Non-Danbooru server favorites — fire and forget, updates progress when done
        if (otherServerFavs.length > 0) {
          const task = (async () => {
            if (signal?.aborted) return
            try {
              const res = await fetchWithRetry(apiUrl('/api/favorites'), { favorites: otherServerFavs })
              if (signal?.aborted) return
              const responseTime = Date.now() - startTime
              if (!res.ok) {
                if (res.status === 429) {
                  rateLimitHits++
                  consecutive429Hits++
                  if (consecutive429Hits >= MAX_CONSECUTIVE_429 && !circuitBroken) {
                    circuitBroken = true
                    rateLimitCooldownUntilRef.current = Date.now() + CIRCUIT_COOLDOWN_MS
                    reportError('Rate limit reached — pausing 30s. Some favorites may not load.')
                    console.warn(`[useFavoritePosts] Circuit breaker tripped after ${consecutive429Hits} consecutive 429s`)
                  }
                } else {
                  consecutive429Hits = 0
                }
                console.warn(`[useFavoritePosts] Fetch error for other servers (${res.status}) after ${responseTime}ms`)
                addProgress(otherServerFavs.length)
                return
              }
              consecutive429Hits = 0
              const posts: any[] = await res.json()
              if (signal?.aborted) return
              let loaded = 0
              posts.forEach((p: any) => {
                if (p && p.id) {
                  accumulated.set(`${(p._provider || '').toLowerCase()}:${p.id}`, p)
                  loaded++
                }
              })
              addProgress(loaded)
            } catch (err) {
              if (signal?.aborted) return
              console.warn("[useFavoritePosts] Other server favs fetch error:", err)
              addProgress(otherServerFavs.length)
            }
          })()
          parallelTasks.push(task)
        }

        // 2. Aibooru — direct client fetch, parallel with everything
        if (aibooruFavs.length > 0) {
          const task = (async () => {
            if (signal?.aborted) return
            try {
              const aibooruIds = aibooruFavs.map(f => f.id).join(',')
              const params = new URLSearchParams({
                limit: "500",
                only: "id,file_url,large_file_url,preview_file_url,tag_string,tag_string_artist,tag_string_character,tag_string_copyright,rating,score,ai_metadata,image_width,image_height",
                tags: `id:${aibooruIds}`
              })
              const res = await fetch(`${PROVIDER_URLS.AIBOORU}/posts.json?${params.toString()}`, { signal })
              if (res.ok) {
                const data = await res.json()
                if (Array.isArray(data)) {
                  data
                    .filter((post: any) => post && post.id)
                    .forEach((post: any) => {
                      accumulated.set(`aibooru:${post.id}`, {
                        ...transformAibooruPost(post),
                        _provider: 'aibooru' as const
                      } as BooruPost)
                    })
                }
              }
            } catch (err) {
              if (signal?.aborted) return
              console.warn("[useFavoritePosts] Aibooru client fetch error:", err)
            }
            addProgress(aibooruFavs.length)
          })()
          parallelTasks.push(task)
        }

        // 3. E621 — direct client fetch, parallel with everything
        // ponytail: same pattern as Aibooru. E621 CORS *, no auth needed.
        if (e621Favs.length > 0) {
          const task = (async () => {
            if (signal?.aborted) return
            try {
              const e621Ids = e621Favs.map(f => f.id).join(',')
              const params = new URLSearchParams({
                limit: "500",
                tags: `id:${e621Ids}`,
                _client: 'Boorugallery/9.2',
              })
              const res = await fetch(`https://e621.net/posts.json?${params.toString()}`, { signal })
              if (res.ok) {
                const data = await res.json()
                const posts = data?.posts
                if (Array.isArray(posts)) {
                  posts
                    .filter((post: any) => post && post.id)
                    .forEach((post: any) => {
                      accumulated.set(`e621:${post.id}`, {
                        ...transformE621Post(post),
                        _provider: 'e621' as const
                      } as BooruPost)
                    })
                }
              }
            } catch (err) {
              if (signal?.aborted) return
              console.warn("[useFavoritePosts] E621 client fetch error:", err)
            }
            addProgress(e621Favs.length)
          })()
          parallelTasks.push(task)
        }

        // 4. Danbooru server favorites — batch sequentially to respect rate limits
        if (danbooruFavs.length > 0) {
          const task = (async () => {
            const batches: FavoriteItem[][] = []
            for (let i = 0; i < danbooruFavs.length; i += BATCH_SIZE) {
              batches.push(danbooruFavs.slice(i, i + BATCH_SIZE))
            }

            for (let i = 0; i < batches.length; i++) {
              if (signal?.aborted) return
              if (circuitBroken) {
                addProgress(batches[i].length)
                continue
              }
              try {
                const res = await fetchWithRetry(apiUrl('/api/favorites'), { favorites: batches[i] })
                if (signal?.aborted) return
                const responseTime = Date.now() - startTime
                if (res.ok) {
                  consecutive429Hits = 0
                  const posts: any[] = await res.json()
                  if (signal?.aborted) return
                  let loaded = 0
                  posts.forEach((p: any) => {
                    if (p && p.id) {
                      accumulated.set(`${(p._provider || '').toLowerCase()}:${p.id}`, p)
                      loaded++
                    }
                  })
                  addProgress(loaded)
                } else {
                  if (res.status === 429) {
                    rateLimitHits++
                    consecutive429Hits++
                    if (consecutive429Hits >= MAX_CONSECUTIVE_429 && !circuitBroken) {
                      circuitBroken = true
                      rateLimitCooldownUntilRef.current = Date.now() + CIRCUIT_COOLDOWN_MS
                      reportError('Rate limit reached — pausing 30s. Some favorites may not load.')
                      console.warn(`[useFavoritePosts] Circuit breaker tripped after ${consecutive429Hits} consecutive 429s`)
                    }
                  } else {
                    consecutive429Hits = 0
                  }
                  console.warn(`[useFavoritePosts] Fetch error for Danbooru (${res.status}) after ${responseTime}ms`)
                  addProgress(batches[i].length)
                }
              } catch (err) {
                if (signal?.aborted) return
                console.warn(`[useFavoritePosts] Danbooru batch ${i} fetch error:`, err)
                addProgress(batches[i].length)
              }

              // Respect Danbooru rate limit (max 2 req/sec)
              if (i < batches.length - 1) {
                if (signal?.aborted) return
                await new Promise(resolve => setTimeout(resolve, DANBOORU_DELAY))
              }
            }
          })()
          parallelTasks.push(task)
        }

        // Wait for parallel tasks to settle before returning final sorted list
        await Promise.allSettled(parallelTasks)

        // Log rate-limit hits for observability
        if (rateLimitHits > 0) {
          console.warn(`[useFavoritePosts] ${rateLimitHits} batch(es) hit rate limit (429)${circuitBroken ? ' — circuit breaker tripped' : ''}`)
        }

        const finalPosts = getSortedPosts(effectiveFavorites, accumulated)
        // Persist to localStorage cache for instant loads on next visit
        if (cacheKey) setCachedFavorites(cacheKey, finalPosts)
        // Persist to Supabase cache so future visits skip booru API entirely
        persistToCache(finalPosts)
        return finalPosts
      } catch (fetchError: unknown) {
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
      fallbackData,
    }
  )

  return {
    data: data?.length || 0,
    posts: data || [],
    error,
    isLoading,
    isValidating,
    mutate: boundMutate,
    progress,
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
    
    // Uses relative path; apiUrl() prepends CF Worker URL when configured
    const response = await fetch(apiUrl(`/api/booru/tags?${params.toString()}`))
    
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
