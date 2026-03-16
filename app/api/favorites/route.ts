import { NextRequest, NextResponse } from 'next/server'
import { BooruFactory } from '@/lib/booru/factory'
import { BooruPost } from '@/lib/booru/types'

export const runtime = 'edge'

interface FavoriteRequestItem {
  id: number;
  provider: string;
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

    // Execute requests in parallel — split large ID lists into batches
    const promiseResults = await Promise.allSettled(
      Object.entries(groups).flatMap(([providerName, ids]) => {
        const provider = BooruFactory.getProvider(providerName as any);

        // Split IDs into batches of BATCH_SIZE
        const batches: number[][] = [];
        for (let i = 0; i < ids.length; i += BATCH_SIZE) {
          batches.push(ids.slice(i, i + BATCH_SIZE));
        }

        return batches.map(async (batchIds) => {
          try {
            if (providerName === 'gelbooru') {
              // Gelbooru DAPI doesn't support multiple IDs in one tag query (id:1,2)
              // We must fetch them concurrently
              const indPosts = await Promise.allSettled(
                batchIds.map(async (id) => {
                  const p = await provider.search({
                    tags: `id:${id}`,
                    page: '1',
                    order: 'recent',
                  });
                  return p[0];
                })
              );
              
              const resolvedPosts = indPosts
                .filter((res): res is PromiseFulfilledResult<BooruPost> => res.status === 'fulfilled' && !!res.value)
                .map(res => ({
                  ...res.value,
                  _provider: providerName,
                }));
              return resolvedPosts;
            } else {
              const query = `id:${batchIds.join(',')}`;

              const posts = await provider.search({
                tags: query,
                page: '1',
                order: 'recent',
              });

              // Inject provider info into the posts so UI knows origin
              return posts.map(post => ({
                ...post,
                _provider: providerName,
              }));
            }
          } catch (err) {
            console.error(`Error fetching favorites batch for ${providerName}:`, err);
            return [] as (BooruPost & { _provider?: string })[];
          }
        });
      })
    );

    // Flatten results from all batches
    const allPosts: (BooruPost & { _provider?: string })[] = [];
    promiseResults.forEach(result => {
      if (result.status === 'fulfilled') {
        allPosts.push(...result.value);
      }
    });

    // Sort result to match input order? 
    // It's tricky with mixed providers. We'll just return the list.
    // The UI usually displays them in added order or grid, we return the metadata found.

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
