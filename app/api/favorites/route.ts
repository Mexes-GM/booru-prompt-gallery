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
    
    // Convert back to array and limit to 100 items
    const limitedFavorites = Array.from(uniqueMap.values()).slice(0, 100);

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

    // Execute requests in parallel
    const promiseResults = await Promise.allSettled(
      Object.entries(groups).map(async ([providerName, ids]) => {
        try {
          const provider = BooruFactory.getProvider(providerName as any);
          
          // Construct ID query
          // Most boorus support id:1,2,3
          // Limit batch size if necessary, but we capped total at 100 so split per provider is safe-ish
          const query = `id:${ids.join(',')}`;

          const posts = await provider.search({
             tags: query,
             page: '1',
             limit: '100',
             order: 'recent' // 'popular' might add redundant sorting
          });

          // Inject provider info into the posts so UI knows origin
          return posts.map(post => ({
            ...post,
            _provider: providerName // Add a client-hint property
          }));
        } catch (err) {
          console.error(`Error fetching favorites for ${providerName}:`, err);
          return [];
        }
      })
    );

    // Flatten results
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
