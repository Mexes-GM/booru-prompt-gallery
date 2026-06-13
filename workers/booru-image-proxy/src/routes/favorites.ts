import { Env } from '../types'
import { BooruFactory } from '../lib/booru/factory'
import { BooruPost } from '../lib/booru/types'
import { Redis, getRedis } from '../lib/redis'
import { checkCircuitOpen } from '../lib/circuit-breaker'
import { jsonResponse, errorResponse, getClientIp } from '../utils'
import { sleep } from '../utils'

interface FavoriteRequestItem {
  id: number
  provider: string
}

const DANBOORU_BATCH_DELAY = 1100
const BATCH_SIZE = 20

export async function favoritesHandler(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const body = (await request.json()) as any
    let favoritesToFetch: FavoriteRequestItem[] = []

    if (body.ids && Array.isArray(body.ids)) {
      const provider = body.provider || 'danbooru'
      favoritesToFetch = body.ids.map((id: number) => ({ id, provider }))
    } else if (body.favorites && Array.isArray(body.favorites)) {
      favoritesToFetch = body.favorites
    }

    if (favoritesToFetch.length === 0) {
      return jsonResponse([], 200)
    }

    // Deduplicate
    const uniqueMap = new Map<string, FavoriteRequestItem>()
    favoritesToFetch.forEach((item) => {
      uniqueMap.set(`${item.provider}:${item.id}`, item)
    })
    const limitedFavorites = Array.from(uniqueMap.values()).slice(0, 500)

    // Group by provider
    const groups: Record<string, number[]> = {}
    limitedFavorites.forEach((item) => {
      try {
        BooruFactory.getProvider(item.provider as any)
        if (!groups[item.provider]) groups[item.provider] = []
        groups[item.provider].push(item.id)
      } catch {
        // Invalid provider, ignore
      }
    })

    const redis = getRedis(env)
    const hasDanbooru = !!groups['danbooru']

    // Rate limit + circuit breaker for Danbooru
    if (hasDanbooru && redis) {
      const clientIp = getClientIp(request)

      // Separate key from posts/download routes — browsing shouldn't
      // consume the favorites budget. 60 req/60s gives enough headroom
      // for 445 favorites (23 batches) without colliding with search.
      const userKey = `ratelimit:danbooru:fav:${clientIp}`
      const userCount = await redis.incrWithExpire(userKey, 60)
      if (userCount > 60) {
        return errorResponse(
          'Too many requests. Please wait before loading favorites.',
          429,
          { 'Retry-After': '10' }
        )
      }

      const globalKey = 'ratelimit:danbooru:global:favorites'
      const globalCount = await redis.incrWithExpire(globalKey, 60)
      if (globalCount > 100) {
        return errorResponse(
          'Danbooru requests are temporarily throttled. Please wait a moment.',
          429,
          { 'Retry-After': '2' }
        )
      }

      const circuit = await checkCircuitOpen(redis, 'danbooru-api')
      if (circuit.open) {
        return errorResponse(
          'Danbooru is saturated. Please wait before retrying.',
          429,
          { 'Retry-After': String(circuit.retryAfter) }
        )
      }
    }

    const envRecord: Record<string, string | undefined> = {
      DANBOORU_USERNAME: env.DANBOORU_USERNAME,
      DANBOORU_API_KEY: env.DANBOORU_API_KEY,
      GELBOORU_API_KEY: env.GELBOORU_API_KEY,
      GELBOORU_USER_ID: env.GELBOORU_USER_ID,
      RULE34_API_KEY: env.RULE34_API_KEY,
      RULE34_USER_ID: env.RULE34_USER_ID,
    }

    const allPosts: (BooruPost & { _provider?: string })[] = []

    for (const [providerName, ids] of Object.entries(groups)) {
      const provider = BooruFactory.getProvider(providerName as any, envRecord)

      // Split into batches
      const batches: number[][] = []
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        batches.push(ids.slice(i, i + BATCH_SIZE))
      }

      if (providerName === 'danbooru') {
        for (let i = 0; i < batches.length; i++) {
          try {
            const query = `id:${batches[i].join(',')}`
            const posts = await provider.search({ tags: query, page: '1', order: 'recent' })
            allPosts.push(...posts.map((post) => ({ ...post, _provider: providerName })))
          } catch (err) {
            console.error(`[favorites] Danbooru batch ${i} error:`, err)
          }
          if (i < batches.length - 1) {
            await sleep(DANBOORU_BATCH_DELAY)
          }
        }
      } else {
        const promiseResults = await Promise.allSettled(
          batches.map(async (batchIds) => {
            try {
              if (providerName === 'gelbooru') {
                const indPosts = await Promise.allSettled(
                  batchIds.map(async (id) => {
                    const p = await provider.search({ tags: `id:${id}`, page: '1', order: 'recent' })
                    return p[0]
                  })
                )
                return indPosts
                  .filter(
                    (res): res is PromiseFulfilledResult<BooruPost> =>
                      res.status === 'fulfilled' && !!res.value
                  )
                  .map((res) => ({ ...res.value, _provider: providerName }))
              } else {
                const query = `id:${batchIds.join(',')}`
                const posts = await provider.search({ tags: query, page: '1', order: 'recent' })
                return posts.map((post) => ({ ...post, _provider: providerName }))
              }
            } catch {
              return []
            }
          })
        )

        promiseResults.forEach((result) => {
          if (result.status === 'fulfilled') {
            allPosts.push(...result.value)
          }
        })
      }
    }

    return jsonResponse(allPosts, 200, {
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      'CDN-Cache-Control': 'public, s-maxage=300',
    })
  } catch (error) {
    console.error('[favorites] error:', error)
    return errorResponse('Failed to fetch favorites', 500)
  }
}
