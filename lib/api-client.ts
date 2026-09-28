
import useSWRInfinite from 'swr/infinite'
import { BooruPost, isAibooruPost as checkIsAibooruPost } from './booru/types'
import { prefetchTagCounts } from '@/hooks/use-tag-counts'
import { splitCommaSeparatedTags } from './utils/tag-utils'
import { PROVIDER_URLS, USER_AGENT } from '@/lib/constants'
// URL helpers extracted to lib/booru/urls.ts (pure, no React). Re-exported below
// so existing `@/lib/api-client` consumers keep working.
import { apiUrl, buildDirectDanbooruUrl, urlHasHost } from './booru/urls'
import { getAuthHeader } from './booru/auth-header'
import { transformAibooruPost, transformDanbooruPost, transformE621Post } from './booru/post-transformers'
import { relaxScoreFloorInUrl, SCORE_FLOOR_BY_PROVIDER, type BooruProvider as TagLimitsBooruProvider, type ScoreTier } from './booru/tag-limits'

export { transformAibooruPost, transformE621Post }

// Re-export types


export { apiUrl }
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
    'score_4_up',
    'score_8',
    'score_7'
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
  let tags = splitCommaSeparatedTags(result)

  // Remove quality tags from each individual tag
  tags = tags.filter(tag => {
    const lowerTag = tag.toLowerCase()

    if (qualityTags.some(qualityTag => lowerTag === qualityTag.toLowerCase())) {
      return false
    }

    // Check for compound tags that contain quality words
    // Remove tags that are primarily quality-focused
    const qualityWords = ['detailed', 'ultra', 'extremely', 'highly', 'very', 'best', 'high', 'highest', 'amazing', 'quality', 'masterpiece']
    const qualityWordSet = new Set(qualityWords)
    const tagWords = lowerTag.split(' ')

    // If tag contains "detailed" and other quality words, remove it entirely
    if (tagWords.includes('detailed')) {
      const hasOtherQualityWords = tagWords.some(word =>
        qualityWordSet.has(word) && word !== 'detailed'
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

    prompt = removeDuplicateTags(prompt)

    return prompt
  }
  return null
}

// transformAibooruPost / transformE621Post moved to lib/booru/post-transformers.ts
// so hooks/use-favorite-posts.ts can import
// them without creating an api-client.ts <-> hooks/use-favorite-posts.ts cycle.
// Re-exported below so existing consumers of `@/lib/api-client` keep working.

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

// Fase 3 (§8 of docs/prompt-genericness-mitigation-plan.md): niche-tag fallback. A page is
// considered "starved" by the quality floor when it comes back with fewer than a quarter of
// the provider's per-page size (60) — clearly cut short by score:>=N rather than just being
// the last, naturally-shorter page of results.
const RELAX_MIN_RESULTS = 15

// Detects which provider a fetcher URL belongs to (mirrors the identification logic already
// used later in doFetch for response parsing) purely from the URL shape, so the niche-tag
// fallback doesn't need scoreTier/provider threaded through the SWR key function.
const detectProviderFromUrl = (url: string): TagLimitsBooruProvider | null => {
  if (url.startsWith(PROVIDER_URLS.AIBOORU)) return 'aibooru'
  if (urlHasHost(url, 'danbooru.donmai.us')) return 'danbooru'
  if (urlHasHost(url, 'e621.net')) return 'e621'
  if (url.includes('/api/posts')) {
    if (url.includes('provider=gelbooru')) return 'gelbooru'
    if (url.includes('provider=rule34')) return 'rule34'
    if (url.includes('provider=e621')) return 'e621'
    if (url.includes('provider=aibooru')) return 'aibooru'
    return 'danbooru'
  }
  return null
}

// Finds which tier's score:>=N (if any) is present in the URL for this provider, trying the
// strongest floors first (a 'best' URL also numerically matches a weaker tier's number only
// when they coincide, which SCORE_FLOOR_BY_PROVIDER's calibration avoids in practice).
const detectActiveScoreTier = (url: string, provider: TagLimitsBooruProvider): ScoreTier | null => {
  const floors = SCORE_FLOOR_BY_PROVIDER[provider]
  if (!floors) return null
  for (const tier of ['best', 'great', 'good'] as const) {
    const floor = floors[tier]
    const rawPattern = new RegExp(`score:>=${floor}(?=[\\s+&]|%20|$)`, 'i')
    const encodedPattern = new RegExp(`score(?:%3A|:)(?:%3E%3D|>=|%3E=|>%3D)${floor}(?=[\\s+&]|%20|$)`, 'i')
    if (rawPattern.test(url) || encodedPattern.test(url)) return tier
  }
  return null
}

// Seconds to wait before retrying a 429: the standard Retry-After header first
// (the Worker exposes it via Access-Control-Expose-Headers), then a JSON
// `retryAfter` body field, else 5s. Capped so a UI never stalls for minutes.
const getRetryAfterSeconds = async (res: Response): Promise<number> => {
  const header = Number(res.headers.get('Retry-After'))
  if (Number.isFinite(header) && header > 0) return Math.min(header, 30)
  try {
    const body = await res.json()
    if (typeof body?.retryAfter === 'number' && body.retryAfter > 0) return Math.min(body.retryAfter, 30)
  } catch { /* not JSON */ }
  return 5
}

const TRANSIENT_STATUSES = new Set([502, 503, 504])

const fetcher = async (url: string, skipPage1Queue = false) => {
  // Deduplicate identical concurrent requests
  const inflight = inflightRequests.get(url)
  if (inflight) {
    return inflight
  }

  const isDanbooruApi = url.includes('/api/posts') || urlHasHost(url, 'danbooru.donmai.us')
  const isDanbooruPage1 = isDanbooruApi && url.includes('page=1')

  const doFetch = async (): Promise<BooruPost[]> => {
    // This fetcher is the ONLY client-side retry layer (SWR's own error retry
    // is disabled below): one retry for a network error, a 429 (after its
    // Retry-After) or — for direct provider calls only — a transient 5xx.
    // Worker (/api/*) 5xx are not retried here: the Worker already retried
    // the provider, and stacking layers multiplied upstream calls.
    const MAX_RETRIES = 1

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const isDirectAibooru = url.startsWith(PROVIDER_URLS.AIBOORU)
        // only attach the Supabase access
        // token to requests that actually reach OUR infrastructure
        // (/api/posts — same-origin Next.js or our Cloudflare Worker).
        // Direct cross-origin fetches to third-party boorus (Danbooru,
        // e621, Aibooru...) must NOT get a custom Authorization header —
        // it turns a simple CORS request into one requiring a preflight,
        // which those APIs don't handle and rejects the whole request.
        const isOwnInfra = url.includes('/api/posts')

        // attach the Supabase access token
        // (if any) so the Worker can key adaptive limits by authed user
        // instead of IP. No-op when there's no session or the flag is off.
        const authHeader = isOwnInfra ? await getAuthHeader() : {}

        // NOTE: Do NOT include 'User-Agent' here — it is a forbidden request
        // header per the Fetch spec; browsers control it, not JS.
        // Chrome silently drops it but Firefox includes it in the CORS
        // preflight, which causes the request to fail if the server's
        // Access-Control-Allow-Headers doesn't match exactly.
        const headers: HeadersInit = isDirectAibooru
          ? {}
          : {
            'Accept': 'application/json',
            ...authHeader,
          }

        const res = await fetch(url, { headers })

        // Retry 429 responses after the server-suggested delay
        if (res.status === 429 && attempt < MAX_RETRIES) {
          const retryAfter = await getRetryAfterSeconds(res)
          await new Promise(r => setTimeout(r, retryAfter * 1000))
          continue
        }

        // Direct provider calls have no server-side retry layer.
        if (!isOwnInfra && TRANSIENT_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 2000))
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
        } else if (urlHasHost(url, 'danbooru.donmai.us') && !url.includes('/api/')) {
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
        } else if (urlHasHost(url, 'e621.net')) {
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

        // Fase 3 (§8 of docs/prompt-genericness-mitigation-plan.md): niche-tag fallback.
        // If a quality-floor tier is active and this page came back starved (a niche search
        // tag simply doesn't have enough posts clearing the score threshold), relax one tier
        // and retry the SAME page once. Never applies to page 1 of a page-1-empty=stop
        // pagination scheme differently — this only concerns count, not the stop condition
        // (an empty array still means "no more results" regardless of the floor).
        if (
          attempt === 0 &&
          Array.isArray(resultPosts) &&
          resultPosts.length > 0 &&
          resultPosts.length < RELAX_MIN_RESULTS
        ) {
          const provider = detectProviderFromUrl(url)
          const activeTier = provider ? detectActiveScoreTier(url, provider) : null
          if (provider && activeTier) {
            const relaxedUrl = relaxScoreFloorInUrl(url, provider, activeTier)
            if (relaxedUrl && relaxedUrl !== url) {
              try {
                // This fallback runs while the parent page-1 request is still pending.
                // It must bypass the page-1 queue or it would wait on its own parent.
                const relaxedPosts = await fetcher(relaxedUrl, true)
                // Only use the relaxed result if it actually did better — never regress.
                if (Array.isArray(relaxedPosts) && relaxedPosts.length > resultPosts.length) {
                  return relaxedPosts
                }
              } catch {
                // Relaxed retry failed — fall through and return the original (starved) result
                // rather than losing the page entirely.
              }
            }
          }
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
  if (isDanbooruPage1 && !skipPage1Queue) {
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



// Per-provider fixed tag search limits, exclusion/order/rating counting rules, and the
// hasMultipleTags/processTagsForAPI/getProviderTagLimit helpers now live in a dependency-free
// module (lib/booru/tag-limits.ts) so they can be unit-tested without pulling in React/Next.
// See that file for the full empirical/documentation rationale behind each provider's limit.
export { hasMultipleTags, getProviderTagLimit, isTagCountSupportedProvider, isRandomOrderSafeProvider, getScoreFloor } from './booru/tag-limits'
import { processTagsForAPI, mapRatingForProvider, isTagCountSupportedProvider, getScoreFloor } from './booru/tag-limits'

// Function to check if user entered more than 2 search terms total
export const hasMoreThanTwoTerms = (tags: string): boolean => {
  if (!tags.trim()) return false

  const tagCount = tags
    .split(',')
    .map(tag => tag.trim())
    .filter(tag => tag.length > 0).length

  return tagCount > 2
}

// getFinalQueryTags also lives in lib/booru/tag-limits.ts (pure, unit-tested) and is
// re-exported here for backwards compatibility with existing imports.
export { getFinalQueryTags, getFinalQueryTagsWithMeta, detectMisusedMetatags } from './booru/tag-limits'
export type { QueryTagMeta, FinalQueryTagsResult, MisusedMetatagWarning, ScoreTier } from './booru/tag-limits'

export const useInfinitePosts = (tags: string, ratingFilter: string = 'rating:general', order: string = 'popular', randomSeed?: number, provider: BooruProvider = 'danbooru', hasPrompt: boolean = false, tagCountFilter?: string, scoreTier: ScoreTier = 'off') => {
  // Provider-specific rating vocabulary mapping (e.g. e621 has no "general" tier —
  // see lib/booru/tag-limits.ts for the full empirical rationale).
  const effectiveRating = mapRatingForProvider(ratingFilter, provider)

  const ratingPart = effectiveRating && effectiveRating !== 'all' ? `${effectiveRating} ` : ''
  // Tag count filter: supported (confirmed empirically) on Danbooru, Aibooru and e621 —
  // NOT on Gelbooru/Rule34. See lib/booru/tag-limits.ts for the full rationale.
  const tagCountPart = (tagCountFilter && isTagCountSupportedProvider(provider)) ? `tagcount:>=${tagCountFilter.replace(/\D/g, '')} ` : ''

  // Quality floor (Palanca 1, docs/prompt-genericness-mitigation-plan.md §7-§8): score:>=N,
  // free on all 5 providers (confirmed §7.2). No-op when scoreTier is 'off' (the default).
  const scoreFloor = getScoreFloor(provider, scoreTier)
  const scoreTierPart = scoreFloor != null ? `score:>=${scoreFloor} ` : ''

  // order:rank / random:N are appended to the query later (below, per-provider) and are
  // confirmed to consume one slot of the provider's tag limit — same as a normal tag.
  const systemOrderTagCount = (order === 'popular' || order === 'random') ? 1 : 0
  const processedTags = processTagsForAPI(tags, provider, systemOrderTagCount)

  const query = processedTags ? `${ratingPart}${tagCountPart}${scoreTierPart}${processedTags}` : `${ratingPart}${tagCountPart}${scoreTierPart}`.trim()
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
          only: "id,file_url,large_file_url,preview_file_url,tag_string,tag_string_artist,tag_string_character,tag_string_copyright,rating,score,ai_metadata,image_width,image_height",
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
          _client: USER_AGENT,
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
      revalidateFirstPage: false, // Don't revalidate first page when loading more
      revalidateAll: false,
      persistSize: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false, // Prevent reconnect from triggering revalidation
      dedupingInterval: 15000, // 15s dedup window; random uses unique seed keys so it's unaffected
      // Retries live in the fetcher (one layer only). SWR's error retry used to
      // stack 3 more attempts on top of the fetcher's and the Worker's, turning
      // one failing page into up to ~36 upstream calls.
      shouldRetryOnError: false,
      parallel: false, // Pages are fetched sequentially
    }
  )
}

// The favorites cache helpers and useBooruPostsByIds live in
// lib/favorites/cache.ts and hooks/use-booru-posts-by-ids.ts; re-exported here
// so existing `@/lib/api-client` consumers keep working.
export {
  getFavoritesCacheKey,
  getCachedFavorites,
  setCachedFavorites,
  getMergedCachedFavorites,
  cachedRowToBooruPost,
  persistToCache,
} from './favorites/cache'
export { booruPostToCacheRow } from './cache-utils'
export type { FavoriteItem, CachedPostRow } from './favorites/cache'
export { useBooruPostsByIds, useBooruPostsByIds as useFavoritePosts } from '@/hooks/use-booru-posts-by-ids'

/**
 * Fetch post counts for a batch of character tags.
 * Falls back to an empty record for unsupported providers.
 */
export async function fetchBatchTagCounts(
  tags: string[],
  provider: BooruProvider
): Promise<Record<string, number> | null> {
  if (!tags.length) return {}
  
  // Gelbooru/Rule34 lack a native tag count API, but character tags share the
  // same names across boorus and models are largely trained on Danbooru data.
  // Redirect to Danbooru as a proxy source of truth for character popularity.
  const effectiveProvider: BooruProvider =
    (provider === 'gelbooru' || provider === 'rule34') ? 'danbooru' : provider

  if (effectiveProvider !== 'danbooru' && effectiveProvider !== 'aibooru') {
    return {} // Only Danbooru-like APIs have a tags endpoint
  }

  try {
    const params = new URLSearchParams({
      tags: tags.join(','),
      provider: effectiveProvider
    })
    
    // Uses relative path; apiUrl() prepends CF Worker URL when configured.
    // Attach the Supabase access token (if any) for adaptive limits.
    const authHeader = await getAuthHeader()
    const response = await fetch(apiUrl(`/api/booru/tags?${params.toString()}`), { headers: authHeader })
    
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
