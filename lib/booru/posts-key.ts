import { PROVIDER_URLS, USER_AGENT } from "@/lib/constants"
import { apiUrl, buildDirectDanbooruUrl } from "./urls"
import {
  getScoreFloor,
  isTagCountSupportedProvider,
  mapRatingForProvider,
  processTagsForAPI,
  type BooruProvider,
  type ScoreTier,
} from "./tag-limits"

/**
 * Everything that decides which URL a gallery page is fetched from. Kept out of
 * lib/api-client.ts (no React, no SWR) so the first-page prefetch in
 * lib/booru/posts-prefetch.ts can build the exact same URL without pulling the
 * gallery code into the page's first chunk.
 */
export interface PostsQuery {
  tags: string
  ratingFilter: string
  order: string
  randomSeed?: number
  provider: BooruProvider
  hasPrompt: boolean
  tagCountFilter?: string
  scoreTier: ScoreTier
}

/** SWR-infinite key function: the URL for `pageIndex`, or null to stop paging. */
export function createPostsKey({
  tags,
  ratingFilter,
  order,
  randomSeed,
  provider,
  hasPrompt,
  tagCountFilter,
  scoreTier,
}: PostsQuery) {
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

  return (pageIndex: number, previousPageData: unknown[] | null): string | null => {
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
  }
}
