import { NextRequest, NextResponse } from 'next/server'
import { BooruFactory } from '@/lib/booru/factory'
import { BooruPost } from '@/lib/booru/types'
import { getDanbooruApiRateLimit, getDanbooruGlobalRateLimit } from '@/lib/rate-limit'
import { isCircuitOpenShared, getCircuitRetryAfter } from '@/lib/circuit-breaker'

export const runtime = 'edge'

interface FavoriteRequestItem {
  id: number;
  provider: string;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Danbooru delay between sequential batch requests (matches provider delay)
const DANBOORU_BATCH_DELAY = 1100

function getClientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anonymous'
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    let favoritesToFetch: FavoriteRequestItem[] = [];

    // Handle legacy format (ids: [], provider: string)
    if (body.ids && Array.isArray(body.ids)) {
      const provider = body.provider || 'danbooru';
      favoritesToFetch = body.ids.map((id: number) => ({ id, provider }));
    }
    // Handle new format (favorites: [{id, provider}, ...])
    else if (body.favorites && Array.isArray(body.favorites)) {
      favoritesToFetch = body.favorites;
    }

    if (favoritesToFetch.length === 0) {
      return NextResponse.json([]);
    }

    // Deduplicate and limit total request size to prevent abuse
    // Use a composite key to deduplicate
    const uniqueMap = new Map<string, FavoriteRequestItem>();
    favoritesToFetch.forEach(item => {
      uniqueMap.set(`${item.provider}:${item.id}`, item);
    });

    // Convert back to array and limit to 500 items
    const limitedFavorites = Array.from(uniqueMap.values()).slice(0, 500);

    // Group by provider
    const groups: Record<string, number[]> = {};
    limitedFavorites.forEach(item => {
      // Validate provider exists to avoid injection or crashes
      try {
        // Just checking if factory throws
        BooruFactory.getProvider(item.provider as any);

        if (!groups[item.provider]) {
          groups[item.provider] = [];
        }
        groups[item.provider].push(item.id);
      } catch (e) {
        // Invalid provider, ignore
      }
    });

    // Batch size matches providers' default page limit (20)
    // to ensure all IDs are fetched without exceeding API limits
    const BATCH_SIZE = 20;

    // --- Rate limit and circuit breaker check for Danbooru ---
    const hasDanbooru = !!groups['danbooru']
    if (hasDanbooru) {
      // Per-user rate limit
      const ratelimit = getDanbooruApiRateLimit()
      if (ratelimit) {
        const clientIp = getClientIp(request)
        const { success } = await ratelimit.limit(clientIp)
        if (!success) {
          return NextResponse.json(
            { error: 'Too many requests. Please wait before loading favorites.' },
            { status: 429, headers: { 'Retry-After': '10' } }
          )
        }
      }

      // Global rate limit
      const globalLimit = getDanbooruGlobalRateLimit()
      if (globalLimit) {
        const { success } = await globalLimit.limit('danbooru-outbound')
        if (!success) {
          return NextResponse.json(
            { error: 'Danbooru requests are temporarily throttled. Please wait a moment.' },
            { status: 429, headers: { 'Retry-After': '2' } }
          )
        }
      }

      // Shared circuit breaker
      if (await isCircuitOpenShared('danbooru-api')) {
        const retryAfter = Math.ceil(getCircuitRetryAfter('danbooru-api') / 1000)
        return NextResponse.json(
          { error: 'Danbooru is saturated. Please wait before retrying.', retryAfter },
          { status: 429, headers: { 'Retry-After': String(retryAfter) } }
        )
      }
    }

    const allPosts: (BooruPost & { _provider?: string })[] = [];

    // --- Process each provider ---
    for (const [providerName, ids] of Object.entries(groups)) {
      const provider = BooruFactory.getProvider(providerName as any);

      // Split IDs into batches of BATCH_SIZE
      const batches: number[][] = [];
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        batches.push(ids.slice(i, i + BATCH_SIZE));
      }

      if (providerName === 'danbooru') {
        // SEQUENTIAL for Danbooru — prevents burst that exceeds rate limit
        for (let i = 0; i < batches.length; i++) {
          try {
            const query = `id:${batches[i].join(',')}`;
            const posts = await provider.search({ tags: query, page: '1', order: 'recent' });
            allPosts.push(...posts.map(post => ({ ...post, _provider: providerName })));
          } catch (err) {
            console.error(`Error fetching Danbooru favorites batch ${i}:`, err);
          }

          // Delay between batches to respect Danbooru's rate limit
          if (i < batches.length - 1) {
            await sleep(DANBOORU_BATCH_DELAY);
          }
        }
      } else {
        // PARALLEL for other providers — they have different rate limit profiles
        const promiseResults = await Promise.allSettled(
          batches.map(async (batchIds) => {
            try {
              if (providerName === 'gelbooru') {
                const indPosts = await Promise.allSettled(
                  batchIds.map(async (id) => {
                    const p = await provider.search({ tags: `id:${id}`, page: '1', order: 'recent' });
                    return p[0];
                  })
                );
                return indPosts
                  .filter((res): res is PromiseFulfilledResult<BooruPost> => res.status === 'fulfilled' && !!res.value)
                  .map(res => ({ ...res.value, _provider: providerName }));
              } else {
                const query = `id:${batchIds.join(',')}`;
                const posts = await provider.search({ tags: query, page: '1', order: 'recent' });
                return posts.map(post => ({ ...post, _provider: providerName }));
              }
            } catch (err) {
              console.error(`Error fetching favorites batch for ${providerName}:`, err);
              return [] as (BooruPost & { _provider?: string })[];
            }
          })
        );

        promiseResults.forEach(result => {
          if (result.status === 'fulfilled') {
            allPosts.push(...result.value);
          }
        });
      }
    }

    return NextResponse.json(allPosts, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        'X-Content-Type-Options': 'nosniff',
        'X-API-Version': '2.0',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  } catch (error) {
    console.error('Favorites API error:', error);
    return NextResponse.json({ error: 'Failed to fetch favorites' }, { status: 500 });
  }
}
